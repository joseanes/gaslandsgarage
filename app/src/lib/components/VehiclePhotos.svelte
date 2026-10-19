<script lang="ts">
	import { onMount } from 'svelte';
	import { user } from '$lib/firebase';
	import { PHOTO_PRIVACY_SHORT } from '$lib/photos/model';
	import { GALLERY_SHARE_COPY, SHARE_BUDDIES_LABEL, SHARE_GALLERY_LABEL, SHARE_LINK_LABEL, type ShareFlags } from '$lib/photos/share';
	import { setPhotoSharing } from '$lib/services/photoShare';
	import { deleteVehiclePhoto, listMyPhotos, uploadVehiclePhoto, type VehiclePhoto } from '$lib/services/vehiclePhotos';

	export let teamId: string | null = null;
	export let vehicleId: string;
	export let playMode = false;
	export let viewOnly = false;
	export let viewPhotos: { photoId: string; url: string; caption: string; vehicleType: string }[] = [];

	let photos: VehiclePhoto[] = [];
	let caption = '';
	let loading = false;
	let busy = false;
	let error = '';
	let status = '';

	async function refresh() {
		if (viewOnly || !$user || !teamId) {
			photos = [];
			return;
		}
		loading = true;
		error = '';
		try {
			const all = await listMyPhotos();
			photos = all.filter((photo) => photo.teamId === teamId && photo.vehicleId === vehicleId);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Photos could not be loaded.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		const stop = user.subscribe(() => {
			void refresh();
		});
		return stop;
	});

	$: if (teamId && vehicleId) void refresh();

	function requestSignIn() {
		window.dispatchEvent(new CustomEvent('gaslands-request-sign-in'));
	}

	async function onFile(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !teamId || busy) return;
		busy = true;
		error = '';
		status = 'Preparing photo...';
		try {
			status = 'Uploading photo...';
			await uploadVehiclePhoto({ teamId, vehicleId, file, caption });
			caption = '';
			status = '';
			await refresh();
		} catch (caught) {
			status = '';
			error = caught instanceof Error ? caught.message : 'That photo could not be uploaded.';
		} finally {
			busy = false;
		}
	}

	async function remove(photo: VehiclePhoto) {
		if (busy || playMode) return;
		if (!confirm('Delete this photo?')) return;
		busy = true;
		error = '';
		status = 'Deleting photo...';
		try {
			await deleteVehiclePhoto(photo);
			status = '';
			await refresh();
		} catch (caught) {
			status = '';
			error = caught instanceof Error ? caught.message : 'That photo could not be deleted.';
		} finally {
			busy = false;
		}
	}

	async function saveFlags(photo: VehiclePhoto, patch: Partial<ShareFlags>, input: HTMLInputElement) {
		const current =
			patch.showToBuddies !== undefined
				? photo.showToBuddies
				: patch.showOnShareLink !== undefined
					? photo.showOnShareLink
					: photo.showInGallery;
		input.checked = current;
		const next: ShareFlags = {
			showToBuddies: photo.showToBuddies,
			showOnShareLink: photo.showOnShareLink,
			showInGallery: photo.showInGallery,
			...patch
		};
		busy = true;
		error = '';
		status = 'Saving sharing...';
		try {
			await setPhotoSharing(photo.photoId, next);
			status = '';
			await refresh();
		} catch (caught) {
			status = '';
			error = caught instanceof Error ? caught.message : 'That sharing choice could not be saved.';
		} finally {
			busy = false;
		}
	}
</script>

{#if !viewOnly || viewPhotos.length > 0}
<section class="mb-3 rounded-lg border border-stone-300 bg-white p-3 dark:border-gray-600 dark:bg-gray-900" data-testid="vehicle-photos">
	<h3 class="text-sm font-semibold uppercase text-stone-800 dark:text-gray-100">Painted car</h3>
	{#if viewOnly}
		{#if viewPhotos.length > 0}
			<ul class="mt-3 grid grid-cols-3 gap-2" data-testid="shared-link-photos">
				{#each viewPhotos as photo (photo.photoId)}
					<li class="min-w-0">
						<img src={photo.url} alt={photo.caption || photo.vehicleType} class="h-24 w-full rounded object-cover bg-stone-100" />
						<p class="mt-1 truncate text-xs text-stone-700 dark:text-gray-200">{photo.vehicleType}</p>
						{#if photo.caption}
							<p class="truncate text-xs text-stone-600 dark:text-gray-300">{photo.caption}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{:else}
	<p class="mt-1 text-xs leading-snug text-stone-600 dark:text-gray-300" data-testid="photo-privacy">{PHOTO_PRIVACY_SHORT}</p>

	{#if loading}
		<p class="mt-2 text-sm text-stone-600 dark:text-gray-300" role="status">Loading photos...</p>
	{/if}

	{#if photos.length > 0}
		<ul class="mt-3 space-y-3">
			{#each photos as photo (photo.photoId)}
				<li class="flex min-w-0 gap-3">
					{#if photo.url}
						<img src={photo.url} alt={photo.caption || 'Painted car'} class="h-24 w-24 shrink-0 rounded object-cover bg-stone-100" />
					{:else}
						<div class="flex h-24 w-24 shrink-0 items-center justify-center rounded bg-stone-100 text-xs text-stone-600">Photo saved</div>
					{/if}
					<div class="min-w-0">
						{#if photo.caption}
							<p class="truncate text-xs text-stone-700 dark:text-gray-200">{photo.caption}</p>
						{/if}
						{#if !playMode}
							<button
								type="button"
								class="mt-1 text-xs text-red-800 underline dark:text-red-200"
								aria-label="Delete photo"
								disabled={busy}
								on:click={() => remove(photo)}
							>
								Delete
							</button>
							<fieldset class="mt-2 space-y-1" disabled={busy}>
								<legend class="sr-only">Sharing for this photo</legend>
								<label class="flex items-start gap-2 text-xs text-stone-700 dark:text-gray-200">
									<input
										type="checkbox"
										class="mt-0.5"
										data-testid="share-buddies"
										checked={photo.showToBuddies}
										on:change={(event) => {
											const input = event.currentTarget;
											if (input instanceof HTMLInputElement) void saveFlags(photo, { showToBuddies: input.checked }, input);
										}}
									/>
									{SHARE_BUDDIES_LABEL}
								</label>
								<label class="flex items-start gap-2 text-xs text-stone-700 dark:text-gray-200">
									<input
										type="checkbox"
										class="mt-0.5"
										data-testid="share-link"
										checked={photo.showOnShareLink}
										on:change={(event) => {
											const input = event.currentTarget;
											if (input instanceof HTMLInputElement) void saveFlags(photo, { showOnShareLink: input.checked }, input);
										}}
									/>
									{SHARE_LINK_LABEL}
								</label>
								<label class="flex items-start gap-2 text-xs text-stone-700 dark:text-gray-200">
									<input
										type="checkbox"
										class="mt-0.5"
										data-testid="share-gallery"
										checked={photo.showInGallery}
										on:change={(event) => {
											const input = event.currentTarget;
											if (input instanceof HTMLInputElement) void saveFlags(photo, { showInGallery: input.checked }, input);
										}}
									/>
									{SHARE_GALLERY_LABEL}
								</label>
								<p class="text-xs leading-snug text-stone-600 dark:text-gray-300" data-testid="gallery-share-copy">{GALLERY_SHARE_COPY}</p>
							</fieldset>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if status}
		<p class="mt-2 text-sm text-stone-700 dark:text-gray-200" role="status">{status}</p>
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-red-800 dark:text-red-200" role="alert">{error}</p>
	{/if}

	{#if !$user}
		<button type="button" class="mt-3 rounded-md px-3 py-2 text-sm amber-button" on:click={requestSignIn}>
			Sign in to add photos
		</button>
	{:else if !teamId}
		<p class="mt-3 text-sm text-stone-700 dark:text-gray-200">Save this team before adding photos.</p>
	{:else if !playMode && photos.length < 3}
		<div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
			<label class="inline-flex cursor-pointer items-center justify-center rounded-md px-3 py-2 text-sm amber-button {busy ? 'pointer-events-none opacity-60' : ''}">
				Add a photo
				<input
					type="file"
					accept="image/*"
					capture="environment"
					class="sr-only"
					data-testid="vehicle-photo-input"
					disabled={busy}
					on:change={onFile}
				/>
			</label>
			<input
				type="text"
				maxlength="140"
				bind:value={caption}
				placeholder="Caption (optional)"
				aria-label="Photo caption"
				class="w-full rounded-md border border-stone-300 bg-white px-2 py-2 text-sm text-stone-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 sm:max-w-xs"
			/>
		</div>
		<p class="mt-1 text-xs text-stone-500 dark:text-gray-400">Up to 3 photos on this vehicle. They are resized before upload.</p>
	{:else if photos.length >= 3 && !playMode}
		<p class="mt-3 text-sm text-stone-700 dark:text-gray-200">This vehicle already has 3 photos. Delete one to add another.</p>
	{/if}
	{/if}
</section>
{/if}
