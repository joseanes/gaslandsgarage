<script lang="ts">
	import { onMount } from 'svelte';
	import { user } from '$lib/firebase';
	import { PHOTO_PRIVACY_SHORT, TEAM_ID_PATTERN, VEHICLE_ID_PATTERN } from '$lib/photos/model';
	import {
		GALLERY_SHARE_COPY,
		SHARE_BUDDIES_LABEL,
		SHARE_GALLERY_LABEL,
		SHARE_LINK_LABEL,
		SHARE_STATS_LABEL,
		STATS_SHARE_COPY,
		type ShareFlags
	} from '$lib/photos/share';
	import { setPhotoSharing } from '$lib/services/photoShare';
	import { attachLibraryPhoto, detachLibraryPhoto, listMyPhotos, photoOnVehicle, uploadVehiclePhoto, type VehiclePhoto } from '$lib/services/vehiclePhotos';

	export let teamId: string | null = null;
	export let vehicleId: string;
	export let playMode = false;
	export let viewOnly = false;
	export let viewPhotos: { photoId: string; url: string; caption: string; vehicleType: string }[] = [];

	let photos: VehiclePhoto[] = [];
	let caption = '';
	let uploadGallery = false;
	let uploadStats = false;
	let showLibrary = false;
	let library: VehiclePhoto[] = [];
	let loading = false;
	let busy = false;
	let error = '';
	let status = '';

	function photosCanBeStored(id: string | null, vehicle: string) {
		return typeof id === 'string' && TEAM_ID_PATTERN.test(id) && typeof vehicle === 'string' && VEHICLE_ID_PATTERN.test(vehicle);
	}

	async function refresh() {
		if (viewOnly || !$user || !photosCanBeStored(teamId, vehicleId)) {
			photos = [];
			return;
		}
		loading = true;
		error = '';
		try {
			const all = await listMyPhotos();
			photos = all.filter((photo) => photoOnVehicle(photo, teamId, vehicleId));
			library = all.filter((photo) => !photoOnVehicle(photo, teamId, vehicleId));
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

	$: if (photosCanBeStored(teamId, vehicleId)) void refresh();

	function requestSignIn() {
		window.dispatchEvent(new CustomEvent('gaslands-request-sign-in'));
	}

	async function onFile(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !teamId || !photosCanBeStored(teamId, vehicleId) || busy) return;
		busy = true;
		error = '';
		status = 'Preparing photo...';
		try {
			status = 'Uploading photo...';
			const uploaded = await uploadVehiclePhoto({ teamId, vehicleId, file, caption });
			const showInGallery = uploadGallery;
			const shareVehicleStats = uploadStats;
			caption = '';
			uploadGallery = false;
			uploadStats = false;
			if (showInGallery || shareVehicleStats) {
				status = 'Saving sharing...';
				await setPhotoSharing(
					uploaded.photoId,
					{
						showToBuddies: false,
						showOnShareLink: false,
						showInGallery,
						shareVehicleStats
					},
					{ teamId, vehicleId }
				);
			}
			status = '';
			await refresh();
		} catch (caught) {
			status = '';
			error = caught instanceof Error ? caught.message : 'That photo could not be uploaded.';
		} finally {
			busy = false;
		}
	}

	function shareSource(photo: VehiclePhoto): { teamId: string; vehicleId: string } {
		const chosen = photo.attachments.find((item) => item.teamId === photo.shareTeamId && item.vehicleId === photo.shareVehicleId);
		if (chosen) return chosen;
		const here = photo.attachments.find((item) => item.teamId === teamId && item.vehicleId === vehicleId);
		return here ?? photo.attachments[0] ?? { teamId, vehicleId };
	}

	async function remove(photo: VehiclePhoto) {
		if (busy || playMode || !teamId) return;
		if (!confirm('Remove this photo from this car? It stays in My Photos.')) return;
		busy = true;
		error = '';
		status = 'Removing photo from this car...';
		try {
			await detachLibraryPhoto(photo.photoId, teamId, vehicleId);
			status = '';
			await refresh();
		} catch (caught) {
			status = '';
			error = caught instanceof Error ? caught.message : 'That photo could not be removed from this car.';
		} finally {
			busy = false;
		}
	}

	async function attach(photo: VehiclePhoto) {
		if (busy || !teamId) return;
		busy = true;
		error = '';
		status = 'Attaching photo...';
		try {
			await attachLibraryPhoto(photo.photoId, teamId, vehicleId);
			showLibrary = false;
			status = '';
			await refresh();
		} catch (caught) {
			status = '';
			error = caught instanceof Error ? caught.message : 'That photo could not be attached.';
		} finally {
			busy = false;
		}
	}

	async function changeShareCar(photo: VehiclePhoto, source: { teamId: string; vehicleId: string }) {
		busy = true;
		error = '';
		status = 'Saving sharing...';
		try {
			await setPhotoSharing(
				photo.photoId,
				{
					showToBuddies: photo.showToBuddies,
					showOnShareLink: photo.showOnShareLink,
					showInGallery: photo.showInGallery,
					shareVehicleStats: photo.shareVehicleStats
				},
				source
			);
			status = '';
			await refresh();
		} catch (caught) {
			status = '';
			error = caught instanceof Error ? caught.message : 'That sharing choice could not be saved.';
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
					: patch.shareVehicleStats !== undefined
						? photo.shareVehicleStats
						: photo.showInGallery;
		input.checked = current;
		const next: ShareFlags = {
			showToBuddies: photo.showToBuddies,
			showOnShareLink: photo.showOnShareLink,
			showInGallery: photo.showInGallery,
			shareVehicleStats: photo.shareVehicleStats,
			...patch
		};
		busy = true;
		error = '';
		status = 'Saving sharing...';
		try {
			await setPhotoSharing(photo.photoId, next, shareSource(photo));
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
<details class="mt-4 rounded-lg border border-stone-300 bg-white p-3 dark:border-gray-600 dark:bg-gray-900" data-testid="vehicle-photos">
	<summary class="cursor-pointer text-sm font-semibold uppercase text-stone-800 dark:text-gray-100">
		Painted car{#if viewOnly ? viewPhotos.length > 0 : photos.length > 0} ({viewOnly ? viewPhotos.length : photos.length}){/if}
		{#if !viewOnly && $user && !photosCanBeStored(teamId, vehicleId)}
			<span class="ml-2 font-normal normal-case" data-testid="photos-need-save">Save the team to add photos</span>
		{/if}
	</summary>
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
								aria-label="Remove from this car"
								disabled={busy}
								on:click={() => remove(photo)}
							>
								Remove from this car
							</button>
							{#if photo.attachments.length > 1}
								<label class="mt-2 block text-xs text-stone-700 dark:text-gray-200">
									Share this photo from
									<select
										class="mt-1 block w-full rounded border border-stone-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
										data-testid="share-from-car"
										value="{shareSource(photo).teamId}/{shareSource(photo).vehicleId}"
										on:change={(event) => {
											const value = event.currentTarget instanceof HTMLSelectElement ? event.currentTarget.value : '';
											const [nextTeam, nextVehicle] = value.split('/');
											const match = photo.attachments.find((item) => item.teamId === nextTeam && item.vehicleId === nextVehicle);
											if (!match) return;
											photo.shareTeamId = match.teamId;
											photo.shareVehicleId = match.vehicleId;
											photos = photos;
											if (photo.showToBuddies || photo.showOnShareLink || photo.showInGallery) {
												void changeShareCar(photo, match);
											}
										}}
									>
										{#each photo.attachments as attachment (attachment.teamId + attachment.vehicleId)}
											<option value="{attachment.teamId}/{attachment.vehicleId}">
												{attachment.teamId === teamId && attachment.vehicleId === vehicleId ? 'This car' : attachment.vehicleId}
											</option>
										{/each}
									</select>
								</label>
							{/if}
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
								<label class="flex items-start gap-2 text-xs text-stone-700 dark:text-gray-200">
									<input
										type="checkbox"
										class="mt-0.5"
										data-testid="share-stats"
										checked={photo.shareVehicleStats}
										on:change={(event) => {
											const input = event.currentTarget;
											if (input instanceof HTMLInputElement) void saveFlags(photo, { shareVehicleStats: input.checked }, input);
										}}
									/>
									{SHARE_STATS_LABEL}
								</label>
								<p class="text-xs leading-snug text-stone-600 dark:text-gray-300" data-testid="stats-share-copy">{STATS_SHARE_COPY}</p>
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
	{:else if !photosCanBeStored(teamId, vehicleId)}
		<p class="mt-3 text-sm text-stone-700 dark:text-gray-200" data-testid="photos-need-save">Save the team to add photos</p>
	{:else if !playMode && photos.length < 3}
		<fieldset class="mt-3 space-y-1" data-testid="upload-sharing" disabled={busy}>
			<legend class="text-xs font-medium text-stone-700 dark:text-gray-200">When this photo is added</legend>
			<label class="flex items-start gap-2 text-xs text-stone-700 dark:text-gray-200">
				<input type="checkbox" class="mt-0.5" data-testid="upload-share-gallery" bind:checked={uploadGallery} />
				{SHARE_GALLERY_LABEL}
			</label>
			<p class="text-xs leading-snug text-stone-600 dark:text-gray-300">{GALLERY_SHARE_COPY}</p>
			<label class="flex items-start gap-2 text-xs text-stone-700 dark:text-gray-200">
				<input type="checkbox" class="mt-0.5" data-testid="upload-share-stats" bind:checked={uploadStats} />
				{SHARE_STATS_LABEL}
			</label>
			<p class="text-xs leading-snug text-stone-600 dark:text-gray-300">{STATS_SHARE_COPY}</p>
		</fieldset>
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
		<p class="mt-1 text-xs text-stone-500 dark:text-gray-400">Up to 3 photos on this vehicle. They are resized before upload. Removing one leaves it in My Photos.</p>
		<button
			type="button"
			class="mt-2 text-sm text-amber-800 underline dark:text-amber-200"
			data-testid="choose-library-photo"
			disabled={busy}
			on:click={() => (showLibrary = !showLibrary)}
		>
			Choose from My Photos
		</button>
		{#if showLibrary}
			<ul class="mt-2 space-y-2" data-testid="library-picker">
				{#if library.length === 0}
					<li class="text-xs text-stone-600 dark:text-gray-300">No other photos are in My Photos.</li>
				{/if}
				{#each library as item (item.photoId)}
					<li class="flex items-center gap-2">
						{#if item.url}
							<img src={item.url} alt="" class="h-12 w-12 rounded object-cover" />
						{/if}
						<button type="button" class="text-sm text-amber-800 underline dark:text-amber-200" data-testid="library-pick" disabled={busy} on:click={() => attach(item)}>
							Use this photo
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{:else if photos.length >= 3 && !playMode}
		<p class="mt-3 text-sm text-stone-700 dark:text-gray-200">This vehicle already has 3 photos. Detach one to add another.</p>
	{/if}
	{/if}
</details>
{/if}
