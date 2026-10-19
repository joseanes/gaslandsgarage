<script lang="ts">
	import { onMount } from 'svelte';
	import { user } from '$lib/firebase';
	import { PHOTO_PRIVACY_SHORT } from '$lib/photos/model';
	import { deleteVehiclePhoto, listMyPhotos, uploadVehiclePhoto, type VehiclePhoto } from '$lib/services/vehiclePhotos';

	export let teamId: string | null = null;
	export let vehicleId: string;
	export let playMode = false;

	let photos: VehiclePhoto[] = [];
	let caption = '';
	let loading = false;
	let busy = false;
	let error = '';
	let status = '';

	async function refresh() {
		if (!$user || !teamId) {
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
</script>

<section class="mb-3 rounded-lg border border-stone-300 bg-white p-3 dark:border-gray-600 dark:bg-gray-900" data-testid="vehicle-photos">
	<h3 class="text-sm font-semibold uppercase text-stone-800 dark:text-gray-100">Painted car</h3>
	<p class="mt-1 text-xs leading-snug text-stone-600 dark:text-gray-300" data-testid="photo-privacy">{PHOTO_PRIVACY_SHORT}</p>

	{#if loading}
		<p class="mt-2 text-sm text-stone-600 dark:text-gray-300" role="status">Loading photos...</p>
	{/if}

	{#if photos.length > 0}
		<ul class="mt-3 grid grid-cols-3 gap-2">
			{#each photos as photo (photo.photoId)}
				<li class="min-w-0">
					{#if photo.url}
						<img src={photo.url} alt={photo.caption || 'Painted car'} class="h-24 w-full rounded object-cover bg-stone-100" />
					{:else}
						<div class="flex h-24 items-center justify-center rounded bg-stone-100 text-xs text-stone-600">Photo saved</div>
					{/if}
					{#if photo.caption}
						<p class="mt-1 truncate text-xs text-stone-700 dark:text-gray-200">{photo.caption}</p>
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
					{/if}
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
</section>
