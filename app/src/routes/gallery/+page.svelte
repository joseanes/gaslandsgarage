<script lang="ts">
	import { dev } from '$app/environment';
	import { page } from '$app/stores';
	import ShareCar from '$lib/components/ShareCar.svelte';
	import { user } from '$lib/firebase';
	import { carLabel, statRows } from '$lib/photos/carPage';
	import { listGalleryPhotos, reportSharedPhoto, type GalleryPhoto } from '$lib/services/photoShare';

	let status: 'loading' | 'ready' | 'error' = 'loading';
	let photos: GalleryPhoto[] = [];
	let vehicleType = 'All';
	let sort: 'newest' | 'oldest' = 'newest';
	let open: GalleryPhoto | null = null;
	let notice = '';
	let noticeError = false;
	let busy = false;

	const fieldClass =
		'rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

	async function load() {
		status = 'loading';
		notice = '';
		try {
			if (dev && $page.url.searchParams.get('fixture') === '1') {
				photos = [(await import('$lib/photos/carPageFixture')).sampleGalleryPhoto()];
				status = 'ready';
				return;
			}
			photos = await listGalleryPhotos();
			status = 'ready';
		} catch (error) {
			console.error('Could not load the gallery', error);
			status = 'error';
		}
	}

	function carHref(photoId: string): string {
		const preview = dev && $page.url.searchParams.get('fixture') === '1' ? '?fixture=1' : '';
		return `/car/${photoId}${preview}`;
	}

	function requestSignIn() {
		window.dispatchEvent(new CustomEvent('gaslands-request-sign-in'));
	}

	$: types = ['All', ...Array.from(new Set(photos.map((photo) => photo.vehicleType))).sort()];
	$: visible = photos
		.filter((photo) => vehicleType === 'All' || photo.vehicleType === vehicleType)
		.slice()
		.sort((a, b) => (sort === 'newest' ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));

	async function report(photo: GalleryPhoto) {
		if (!$user) {
			requestSignIn();
			return;
		}
		if (busy) return;
		if (!confirm('Report this photo to the administrators?')) return;
		busy = true;
		notice = '';
		noticeError = false;
		try {
			const result = await reportSharedPhoto(photo.photoId);
			if (result.hidden) {
				photos = photos.filter((item) => item.photoId !== photo.photoId);
				if (open?.photoId === photo.photoId) open = null;
				notice = 'Thanks. That photo is hidden while it is reviewed.';
			} else if (result.alreadyReported) {
				notice = 'You already reported this photo.';
			} else {
				notice = 'Thanks. Administrators can review that report.';
			}
		} catch (error) {
			noticeError = true;
			notice = error instanceof Error ? error.message : 'That report could not be saved.';
		} finally {
			busy = false;
		}
	}

	void load();
</script>

<svelte:head>
	<title>Gallery - Gaslands Garage</title>
	<meta name="description" content="Photos of painted Gaslands cars that players chose to share." />
</svelte:head>

<section class="mx-auto max-w-6xl px-2 py-8 text-stone-800 dark:text-gray-100" data-testid="gallery-page">
	<h1 class="mb-2 text-3xl font-bold">Gallery</h1>
	<p class="mb-6 max-w-2xl text-stone-600 dark:text-gray-300">
		Painted cars players chose to share. Each card shows their Gaslands display name, the vehicle type, and the caption.
		When they also share the car's stats, the card shows that snapshot.
	</p>

	{#if notice}
		<p role={noticeError ? 'alert' : 'status'} class="mb-4 rounded-lg border px-3 py-2 {noticeError ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100' : 'border-stone-300 bg-white dark:border-gray-600 dark:bg-gray-800'}">{notice}</p>
	{/if}

	{#if status === 'loading'}
		<p>Loading photos…</p>
	{:else if status === 'error'}
		<p role="alert">The gallery could not be loaded.</p>
	{:else if photos.length === 0}
		<p data-testid="gallery-empty">No shared photos yet.</p>
	{:else}
		<div class="mb-4 flex flex-col gap-2 sm:flex-row">
			<label class="text-sm">
				Vehicle type
				<select class="{fieldClass} ml-2" data-testid="gallery-type-filter" bind:value={vehicleType}>
					{#each types as type}
						<option value={type}>{type}</option>
					{/each}
				</select>
			</label>
			<label class="text-sm">
				Sort
				<select class="{fieldClass} ml-2" data-testid="gallery-sort" bind:value={sort}>
					<option value="newest">Newest</option>
					<option value="oldest">Oldest</option>
				</select>
			</label>
		</div>

		{#if visible.length === 0}
			<p>No photos of that vehicle type.</p>
		{:else}
			<ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="gallery-grid">
				{#each visible as photo (photo.photoId)}
					<li class="rounded-lg border border-stone-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
						<button type="button" class="w-full text-left" data-testid="gallery-card" on:click={() => (open = photo)}>
							<img src={photo.url} alt={photo.caption || `${photo.displayName} ${photo.vehicleType}`} class="h-40 w-full rounded-lg bg-stone-100 object-cover" />
							<p class="mt-2 truncate text-sm font-medium">{photo.displayName}</p>
							<p class="truncate text-xs text-stone-600 dark:text-gray-300">{photo.vehicleType}</p>
							{#if photo.caption}
								<p class="truncate text-xs text-stone-700 dark:text-gray-200">{photo.caption}</p>
							{/if}
							{#if photo.vehicleStats}
								<dl class="mt-1 space-y-0.5 text-xs text-stone-700 dark:text-gray-200" data-testid="gallery-stats">
									{#each statRows(photo.vehicleStats) as row}
										<div class="flex gap-1">
											<dt class="font-medium">{row.label}</dt>
											<dd class="min-w-0 truncate">{row.value}</dd>
										</div>
									{/each}
								</dl>
							{/if}
						</button>
						<div class="mt-2">
							<ShareCar shareId={photo.photoId} carName={carLabel({ vehicleType: photo.vehicleType, vehicleStats: photo.vehicleStats })} compact />
							<a class="mt-1 inline-block text-xs font-medium text-amber-800 underline dark:text-amber-300" href={carHref(photo.photoId)} data-testid="car-page-link">Car page</a>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Shared photo" data-testid="gallery-lightbox">
		<div class="max-h-full w-full max-w-3xl overflow-auto rounded-xl bg-white p-4 text-stone-800 dark:bg-gray-900 dark:text-gray-100">
			<img src={open.url} alt={open.caption || `${open.displayName} ${open.vehicleType}`} class="max-h-[70vh] w-full rounded-lg object-contain bg-stone-100" />
			<p class="mt-3 text-lg font-semibold">{open.displayName}</p>
			<p>{open.vehicleType}{#if open.teamName} · {open.teamName}{/if}</p>
			{#if open.caption}
				<p class="mt-1">{open.caption}</p>
			{/if}
			{#if open.vehicleStats}
				<dl class="mt-3 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2" data-testid="gallery-stats">
					{#each statRows(open.vehicleStats) as row}
						<div>
							<dt class="text-xs font-medium text-stone-500 dark:text-gray-400">{row.label}</dt>
							<dd>{row.value}</dd>
						</div>
					{/each}
				</dl>
			{/if}
			<div class="mt-4">
				<ShareCar shareId={open.photoId} carName={carLabel({ vehicleType: open.vehicleType, vehicleStats: open.vehicleStats })} />
			</div>
			<div class="mt-4 flex flex-wrap gap-2">
				<a class="rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-gray-600" href={carHref(open.photoId)} data-testid="car-page-link">Car page</a>
				<button type="button" class="rounded-md px-3 py-2 text-sm amber-button" data-testid="report-photo" disabled={busy} on:click={() => open && report(open)}>
					{$user ? 'Report photo' : 'Sign in to report'}
				</button>
				<button type="button" class="rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-gray-600" on:click={() => (open = null)}>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}
