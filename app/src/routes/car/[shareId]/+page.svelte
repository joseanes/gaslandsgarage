<script lang="ts">
	import { dev } from '$app/environment';
	import { page } from '$app/stores';
	import PublicCarBody from '$lib/components/PublicCarBody.svelte';
	import { NOT_SHARED_NOTICE, type PublicCar } from '$lib/photos/carPage';
	import { loadPublicCar } from '$lib/services/photoShare';

	let status: 'loading' | 'ready' | 'error' = 'loading';
	let car: PublicCar | null = null;
	let request = 0;

	async function load(shareId: string, fixture: boolean) {
		const current = ++request;
		status = 'loading';
		car = null;
		try {
			if (dev && fixture && (shareId === 'samplecar1' || shareId === 'darkcar0001')) {
				if (shareId === 'samplecar1') {
					car = (await import('$lib/photos/carPageFixture')).samplePublicCar();
				}
				if (current === request) status = 'ready';
				return;
			}
			const loaded = await loadPublicCar(shareId);
			if (current !== request) return;
			car = loaded;
			status = 'ready';
		} catch {
			if (current !== request) return;
			status = 'error';
		}
	}

	$: fixture = $page.url.searchParams.get('fixture') === '1';
	$: shareId = $page.params.shareId ?? '';
	$: void load(shareId, fixture);
	$: embedHref = car ? `/embed/car/${car.shareId}${fixture && dev ? '?fixture=1' : ''}` : '';
</script>

<svelte:head>
	<title>{car ? `${car.vehicleStats?.name || car.vehicleType} - Gaslands Garage` : 'Car - Gaslands Garage'}</title>
	<meta name="description" content={car ? `${car.displayName}'s ${car.vehicleType} on Gaslands Garage.` : NOT_SHARED_NOTICE} />
</svelte:head>

<section class="mx-auto max-w-4xl px-3 py-6" data-testid="car-route">
	{#if status === 'loading'}
		<p>Loading this car…</p>
	{:else if status === 'error'}
		<p role="alert">This car could not be loaded.</p>
	{:else if !car}
		<div data-testid="car-unshared">
			<h1 class="text-2xl font-bold">{NOT_SHARED_NOTICE}</h1>
			<p class="mt-3"><a class="text-amber-800 underline dark:text-amber-300" href="/gallery">Back to the Gallery</a></p>
		</div>
	{:else}
		<PublicCarBody {car} {embedHref} />
	{/if}
</section>
