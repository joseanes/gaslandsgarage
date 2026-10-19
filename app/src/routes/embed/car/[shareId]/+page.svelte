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
	$: carPageHref = car ? `/car/${car.shareId}${fixture && dev ? '?fixture=1' : ''}` : '';
</script>

<svelte:head>
	<title>{car ? `${car.vehicleStats?.name || car.vehicleType} - Gaslands Garage` : 'Car - Gaslands Garage'}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<section class="mx-auto max-w-sm py-3" data-testid="embed-route">
	{#if status === 'loading'}
		<p>Loading this car…</p>
	{:else if status === 'error'}
		<p role="alert">This car could not be loaded.</p>
	{:else if !car}
		<p data-testid="car-unshared">{NOT_SHARED_NOTICE}</p>
	{:else}
		<PublicCarBody {car} mode="embed" {carPageHref} />
	{/if}
</section>
