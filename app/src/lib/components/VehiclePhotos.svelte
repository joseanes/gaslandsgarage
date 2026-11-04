<script lang="ts">
	import { getContext, onDestroy, onMount, tick } from 'svelte';
	import SharingControl from '$lib/components/SharingControl.svelte';
	import { user } from '$lib/firebase';
	import { PHOTO_SAVE_GATE, type PhotoAttachRequest, type PhotoSaveGate } from '$lib/photos/photoSaveGate';
	import { PHOTO_PRIVACY_SHORT, TEAM_ID_PATTERN, VEHICLE_ID_PATTERN } from '$lib/photos/model';
	import { shareEverywhere, type ShareFlags } from '$lib/photos/share';
	import { paintingGuideLink } from '$lib/photos/link';
	import { setPhotoPaintingUrl, setPhotoSharing } from '$lib/services/photoShare';
	import { myProfileWebsite } from '$lib/services/playerProfile';
	import {
		attachLibraryPhoto,
		detachLibraryPhoto,
		listMyPhotos,
		photoOnVehicle,
		renameLibraryPhoto,
		replaceLibraryPhoto,
		uploadVehiclePhoto,
		type VehiclePhoto
	} from '$lib/services/vehiclePhotos';

	export let teamId: string | null = null;
	export let vehicleId: string;
	export let playMode = false;
	export let viewOnly = false;
	export let viewPhotos: { photoId: string; url: string; caption: string; vehicleType: string }[] = [];
	/**
	 * Optional saver used outside the builder. The builder photo-save gate is the
	 * guard for every add and attach path. When both are absent, an unsaved team
	 * keeps the "Save the team to add photos" prompt and does not render a file input.
	 */
	export let ensureSavedTeam: (() => Promise<string | null>) | null = null;

	const photoSaveGate = getContext<PhotoSaveGate | undefined>(PHOTO_SAVE_GATE);

	let photos: VehiclePhoto[] = [];
	let caption = '';
	let paintingUrl = '';
	let profileWebsite = '';
	let paintingDraft = '';
	let uploadFlags: ShareFlags = shareEverywhere(false);
	let showLibrary = false;
	let library: VehiclePhoto[] = [];
	let loading = false;
	let busy = false;
	let error = '';
	let status = '';
	let pendingFile: File | null = null;
	let pendingPreview = '';
	let showUpload = false;
	let savedTeamOverride: string | null = null;
	let editingId: string | null = null;
	let captionDraft = '';
	let fileInput: HTMLInputElement | undefined;

	function photosCanBeStored(id: string | null, vehicle: string) {
		return typeof id === 'string' && TEAM_ID_PATTERN.test(id) && typeof vehicle === 'string' && VEHICLE_ID_PATTERN.test(vehicle);
	}

	function storedTeamId() {
		if (photosCanBeStored(teamId, vehicleId)) return teamId;
		if (photosCanBeStored(savedTeamOverride, vehicleId)) return savedTeamOverride;
		return null;
	}

	async function refresh() {
		const id = storedTeamId();
		if (viewOnly || !$user || !id || !photosCanBeStored(id, vehicleId)) {
			photos = [];
			library = [];
			editingId = null;
			return;
		}
		loading = true;
		error = '';
		try {
			const all = await listMyPhotos();
			photos = all.filter((photo) => photoOnVehicle(photo, id, vehicleId));
			library = all.filter((photo) => !photoOnVehicle(photo, id, vehicleId));
			if (editingId && !photos.some((photo) => photo.photoId === editingId)) editingId = null;
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
		const stopResume = photoSaveGate?.listen(vehicleId, resumePhoto) ?? (() => {});
		return () => {
			stop();
			stopResume();
		};
	});

	onDestroy(() => {
		if (pendingPreview) URL.revokeObjectURL(pendingPreview);
	});

	$: if (photosCanBeStored(teamId, vehicleId)) void refresh();
	// Name teamId in this statement. A helper call in the markup does not subscribe to it.
	$: photoTeamId = photosCanBeStored(teamId, vehicleId)
		? teamId
		: photosCanBeStored(savedTeamOverride, vehicleId)
			? savedTeamOverride
			: null;
	$: editing = photos.find((photo) => photo.photoId === editingId) ?? null;
	$: canAdd = Boolean($user) && !playMode && photos.length < 3 && (Boolean(photoTeamId) || ensureSavedTeam !== null);

	function requestSignIn() {
		window.dispatchEvent(new CustomEvent('gaslands-request-sign-in'));
	}

	async function readyTeam(): Promise<string | null> {
		if (photosCanBeStored(teamId, vehicleId)) return teamId;
		if (!ensureSavedTeam) return null;
		const saved = await ensureSavedTeam();
		if (!photosCanBeStored(saved, vehicleId)) return null;
		savedTeamOverride = saved;
		return saved;
	}

	function deferPhoto(intent: PhotoAttachRequest['intent'], extra: Partial<PhotoAttachRequest> = {}): boolean {
		if (!photoSaveGate?.reason(vehicleId)) return false;
		photoSaveGate.request({ vehicleId, intent, ...extra });
		return true;
	}

	function askToSaveFirst(intent: PhotoAttachRequest['intent']) {
		photoSaveGate?.request({ vehicleId, intent });
	}

	async function resumePhoto(request: PhotoAttachRequest) {
		if (request.vehicleId !== vehicleId) return;
		await tick();
		if (request.intent === 'library') {
			if (request.photoId) {
				await refresh();
				const match = library.find((item) => item.photoId === request.photoId);
				if (match) {
					await attachSaved(match);
					return;
				}
			}
			showLibrary = true;
			await refresh();
			return;
		}
		if (request.file) {
			await uploadChosen(request.file, {
				caption: request.caption ?? '',
				flags: request.uploadFlags ?? shareEverywhere(false),
				paintingUrl: request.paintingUrl ?? ''
			});
			return;
		}
		await tick();
		fileInput?.click();
	}

	async function startUpload() {
		if (busy) return;
		if (deferPhoto('file')) return;
		const id = await readyTeam();
		if (!id) return;
		fileInput?.click();
	}

	async function onFile(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		const file = input.files?.[0];
		input.value = '';
		if (!file || busy) return;
		if (deferPhoto('file', { file, caption: '', uploadGallery: false, uploadStats: false })) return;
		if (!storedTeamId()) return;
		if (pendingPreview) URL.revokeObjectURL(pendingPreview);
		pendingFile = file;
		pendingPreview = URL.createObjectURL(file);
		caption = '';
		uploadFlags = shareEverywhere(false);
		profileWebsite = await myProfileWebsite();
		paintingUrl = profileWebsite;
		showUpload = true;
		error = '';
		status = '';
	}

	function closeUpload() {
		if (pendingPreview) URL.revokeObjectURL(pendingPreview);
		pendingPreview = '';
		pendingFile = null;
		caption = '';
		paintingUrl = '';
		uploadFlags = shareEverywhere(false);
		showUpload = false;
	}

	async function confirmUpload() {
		const file = pendingFile;
		if (!file || busy) return;
		const chosenLink = paintingUrl.trim();
		if (chosenLink && !paintingGuideLink(chosenLink)) {
			error = 'Use a full http or https link, up to 300 characters.';
			return;
		}
		if (
			deferPhoto('file', {
				file,
				caption,
				uploadGallery: uploadFlags.showInGallery,
				uploadStats: uploadFlags.shareVehicleStats,
				uploadFlags,
				paintingUrl
			})
		) {
			return;
		}
		await uploadChosen(file);
	}

	async function uploadChosen(
		file: File,
		sharing?: { caption?: string; flags?: ShareFlags; paintingUrl?: string }
	) {
		const id = storedTeamId() ?? (await tick().then(() => storedTeamId()));
		if (!file || !id || busy) return;
		const nextCaption = sharing?.caption ?? caption;
		const chosen = sharing?.flags ?? uploadFlags;
		const chosenLink = (sharing?.paintingUrl ?? paintingUrl).trim();
		if (chosenLink && !paintingGuideLink(chosenLink)) {
			error = 'Use a full http or https link, up to 300 characters.';
			return;
		}
		busy = true;
		error = '';
		status = 'Uploading photo...';
		try {
			const uploaded = await uploadVehiclePhoto({ teamId: id, vehicleId, file, caption: nextCaption });
			if (chosenLink) await setPhotoPaintingUrl(uploaded.photoId, chosenLink);
			if (chosen.showToBuddies || chosen.showOnShareLink || chosen.showInGallery || chosen.shareVehicleStats) {
				status = 'Saving sharing...';
				await setPhotoSharing(uploaded.photoId, chosen, { teamId: id, vehicleId });
			}
			status = '';
			closeUpload();
			await refresh();
		} catch (caught) {
			status = '';
			error = caught instanceof Error ? caught.message : 'That photo could not be uploaded.';
		} finally {
			busy = false;
		}
	}

	function shareSource(photo: VehiclePhoto): { teamId: string; vehicleId: string } {
		const id = storedTeamId();
		const chosen = photo.attachments.find((item) => item.teamId === photo.shareTeamId && item.vehicleId === photo.shareVehicleId);
		if (chosen) return chosen;
		const here = photo.attachments.find((item) => item.teamId === id && item.vehicleId === vehicleId);
		return here ?? photo.attachments[0] ?? { teamId: id ?? '', vehicleId };
	}

	function openEditor(photo: VehiclePhoto) {
		if (playMode) return;
		editingId = photo.photoId;
		captionDraft = photo.caption;
		paintingDraft = photo.paintingUrl;
		error = '';
		status = '';
		void myProfileWebsite().then((site) => {
			profileWebsite = site;
		});
	}

	function closeEditor() {
		editingId = null;
		captionDraft = '';
	}

	async function remove(photo: VehiclePhoto) {
		const id = storedTeamId();
		if (busy || playMode || !id) return;
		if (!confirm('Remove this photo from this car? It stays in My Photos.')) return;
		busy = true;
		error = '';
		status = 'Removing photo from this car...';
		try {
			await detachLibraryPhoto(photo.photoId, id, vehicleId);
			status = '';
			if (editingId === photo.photoId) closeEditor();
			await refresh();
		} catch (caught) {
			status = '';
			error = caught instanceof Error ? caught.message : 'That photo could not be removed from this car.';
		} finally {
			busy = false;
		}
	}

	async function openLibrary() {
		if (busy) return;
		if (deferPhoto('library')) return;
		const id = await readyTeam();
		if (!id) return;
		showLibrary = !showLibrary;
	}

	async function attach(photo: VehiclePhoto) {
		if (busy) return;
		if (deferPhoto('library', { photoId: photo.photoId })) return;
		await attachSaved(photo);
	}

	async function attachSaved(photo: VehiclePhoto) {
		const id = storedTeamId() ?? (await tick().then(() => storedTeamId()));
		if (busy || !id) return;
		busy = true;
		error = '';
		status = 'Attaching photo...';
		try {
			await attachLibraryPhoto(photo.photoId, id, vehicleId);
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
			await setPhotoSharing(photo.photoId, photoFlags(photo), source);
			status = '';
			await refresh();
		} catch (caught) {
			status = '';
			error = caught instanceof Error ? caught.message : 'That sharing choice could not be saved.';
		} finally {
			busy = false;
		}
	}

	function photoFlags(photo: VehiclePhoto): ShareFlags {
		return {
			showToBuddies: photo.showToBuddies,
			showOnShareLink: photo.showOnShareLink,
			showInGallery: photo.showInGallery,
			shareVehicleStats: photo.shareVehicleStats
		};
	}

	async function saveFlags(photo: VehiclePhoto, next: ShareFlags) {
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

	async function savePainting(photo: VehiclePhoto, next: string) {
		paintingDraft = next;
		if (busy || next.trim() === photo.paintingUrl) return;
		if (next.trim() && !paintingGuideLink(next)) return;
		busy = true;
		error = '';
		status = 'Saving link...';
		try {
			await setPhotoPaintingUrl(photo.photoId, next.trim());
			status = '';
			await refresh();
		} catch (caught) {
			status = '';
			error = caught instanceof Error ? caught.message : 'That link could not be saved.';
		} finally {
			busy = false;
		}
	}

	async function saveCaption(photo: VehiclePhoto) {
		const next = captionDraft.trim();
		if (busy || next === photo.caption) return;
		busy = true;
		error = '';
		status = 'Saving caption...';
		try {
			await renameLibraryPhoto(photo.photoId, next);
			status = '';
			await refresh();
		} catch (caught) {
			status = '';
			error = caught instanceof Error ? caught.message : 'That caption could not be saved.';
		} finally {
			busy = false;
		}
	}

	async function onReplace(photo: VehiclePhoto, event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		const file = input.files?.[0];
		input.value = '';
		if (!file || busy) return;
		busy = true;
		error = '';
		status = 'Replacing photo...';
		try {
			await replaceLibraryPhoto(photo, file);
			status = '';
			await refresh();
		} catch (caught) {
			status = '';
			error = caught instanceof Error ? caught.message : 'That photo could not be replaced.';
		} finally {
			busy = false;
		}
	}

	function isPrivate(photo: VehiclePhoto) {
		return !photo.showToBuddies && !photo.showOnShareLink && !photo.showInGallery;
	}

	function shareStatusLabel(photo: VehiclePhoto) {
		if (isPrivate(photo)) return 'Private';
		const parts = [
			photo.showToBuddies ? 'Gaming Buddies' : '',
			photo.showOnShareLink ? 'Team link' : '',
			photo.showInGallery ? 'Gallery' : '',
			photo.shareVehicleStats ? 'Stats' : ''
		].filter(Boolean);
		return `Shared: ${parts.join(', ')}`;
	}
</script>

{#if !viewOnly || viewPhotos.length > 0}
<div class="mt-2" data-testid="vehicle-photos">
<details class="rounded-md border border-stone-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-900">
	<summary class="cursor-pointer text-xs font-semibold uppercase tracking-wide text-stone-800 dark:text-gray-100">
		Painted car{#if viewOnly ? viewPhotos.length > 0 : photos.length > 0}
			<span class="font-normal normal-case">({viewOnly ? viewPhotos.length : photos.length}/3)</span>
		{/if}
		{#if !viewOnly && $user && !photoTeamId && !ensureSavedTeam}
			<span class="ml-2 font-normal normal-case" data-testid="photos-need-save">Save the team to add photos</span>
		{/if}
	</summary>
	{#if viewOnly}
		{#if viewPhotos.length > 0}
			<ul class="mt-2 grid grid-cols-3 gap-2" data-testid="shared-link-photos">
				{#each viewPhotos as photo (photo.photoId)}
					<li class="min-w-0">
						<img src={photo.url} alt={photo.caption || photo.vehicleType} class="h-16 w-full rounded object-cover bg-stone-100" />
						<p class="mt-1 truncate text-[11px] text-stone-700 dark:text-gray-200">{photo.vehicleType}</p>
						{#if photo.caption}
							<p class="truncate text-[11px] text-stone-600 dark:text-gray-300">{photo.caption}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{:else}
	<p class="mt-1 text-[11px] leading-snug text-stone-600 dark:text-gray-300" data-testid="photo-privacy">
		{PHOTO_PRIVACY_SHORT}
		<a href="/privacy#photos" class="text-amber-800 underline dark:text-amber-200">Learn more</a>
	</p>

	{#if loading}
		<p class="mt-2 text-xs text-stone-600 dark:text-gray-300" role="status">Loading photos...</p>
	{/if}

	<section class="mt-2" data-testid="car-photos">
		<h3 class="text-[11px] font-semibold uppercase tracking-wide text-stone-700 dark:text-gray-200">Photos on this car ({photos.length}/3)</h3>
		{#if photos.length === 0}
			<p class="mt-1 text-[11px] text-stone-500 dark:text-gray-400">No photos on this car yet.</p>
		{:else}
			<ul class="mt-1.5 flex flex-wrap gap-1.5">
				{#each photos as photo (photo.photoId)}
					<li>
						{#if playMode}
							<div class="relative h-14 w-14 overflow-hidden rounded border border-stone-300 bg-stone-100 dark:border-gray-600">
								{#if photo.url}
									<img src={photo.url} alt={photo.caption || 'Painted car'} class="h-full w-full object-cover" />
								{/if}
								<span class="absolute inset-x-0 bottom-0 truncate bg-stone-950/80 px-0.5 text-center text-[9px] font-medium text-white" data-testid="share-status">{shareStatusLabel(photo)}</span>
							</div>
						{:else}
							<button
								type="button"
								class="relative h-14 w-14 overflow-hidden rounded border border-stone-300 bg-stone-100 dark:border-gray-600"
								data-testid="car-photo-thumb"
								aria-label={photo.caption ? `Edit photo: ${photo.caption}` : 'Edit photo'}
								disabled={busy}
								on:click={() => openEditor(photo)}
							>
								{#if photo.url}
									<img src={photo.url} alt={photo.caption || 'Painted car'} class="h-full w-full object-cover" />
								{:else}
									<span class="flex h-full items-center justify-center px-1 text-[9px] text-stone-600">Saved</span>
								{/if}
								<span class="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-stone-950/80 px-0.5 text-[9px] font-medium text-white" data-testid="share-status" aria-label={shareStatusLabel(photo)}>
									{#if isPrivate(photo)}
										Private
									{:else}
										{#if photo.showToBuddies}
											<svg viewBox="0 0 16 16" class="h-2.5 w-2.5" aria-hidden="true"><path fill="currentColor" d="M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm4.5 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM6 8c-2 0-4 1-4 2.5V12h8v-1.5C10 9 8 8 6 8Zm4.2.1c.5.1 1 .3 1.4.6 1 .7 1.4 1.6 1.4 2.3V12H16v-.5c0-1.3-1.5-2.3-3.3-2.4-.5-.3-1.4-.6-2.5 0Z"/></svg>
										{/if}
										{#if photo.showOnShareLink}
											<svg viewBox="0 0 16 16" class="h-2.5 w-2.5" aria-hidden="true"><path fill="currentColor" d="M6.7 9.3a2.5 2.5 0 0 0 3.5.1l1.5-1.5a2.5 2.5 0 0 0-3.5-3.5l-.8.8.9.9.8-.8a1.2 1.2 0 0 1 1.7 1.7L9.3 8.5a1.2 1.2 0 0 1-1.7-.1l-.9.9Zm2.6-2.6a2.5 2.5 0 0 0-3.5-.1L4.3 8.1a2.5 2.5 0 1 0 3.5 3.5l.8-.8-.9-.9-.8.8a1.2 1.2 0 0 1-1.7-1.7l1.5-1.5a1.2 1.2 0 0 1 1.7.1l.9-.9Z"/></svg>
										{/if}
										{#if photo.showInGallery}
											<svg viewBox="0 0 16 16" class="h-2.5 w-2.5" aria-hidden="true"><path fill="currentColor" d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9ZM4 11l2.2-2.8 1.6 1.8L10 7l2 4H4Z"/></svg>
										{/if}
										{#if photo.shareVehicleStats}
											<svg viewBox="0 0 16 16" class="h-2.5 w-2.5" aria-hidden="true"><path fill="currentColor" d="M2 13h12v1H2v-1Zm1-2h2V7H3v4Zm4 0h2V4H7v7Zm4 0h2V6h-2v5Z"/></svg>
										{/if}
									{/if}
								</span>
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if status && !showUpload && !editing}
		<p class="mt-2 text-xs text-stone-700 dark:text-gray-200" role="status">{status}</p>
	{/if}
	{#if error && !showUpload && !editing}
		<p class="mt-2 text-xs text-red-800 dark:text-red-200" role="alert">{error}</p>
	{/if}

	{#if !$user}
		<button type="button" class="mt-2 rounded-md px-2 py-1 text-xs amber-button" on:click={requestSignIn}>
			Sign in to add photos
		</button>
	{:else if !photoTeamId && !ensureSavedTeam}
		<p class="mt-2 text-xs text-stone-700 dark:text-gray-200" data-testid="photos-need-save">Save the team to add photos</p>
		{#if !playMode}
			<div class="mt-2 flex flex-col items-start gap-2">
				<button
					type="button"
					class="inline-flex min-h-11 items-center rounded-md px-3 text-xs amber-button"
					data-testid="add-photo-needs-save"
					on:click={() => askToSaveFirst('file')}
				>
					Add a photo
				</button>
				<button
					type="button"
					class="min-h-11 text-left text-xs text-amber-800 underline dark:text-amber-200"
					data-testid="choose-library-needs-save"
					on:click={() => askToSaveFirst('library')}
				>
					Choose from My Photos
				</button>
			</div>
		{/if}
	{:else if canAdd}
		<section class="mt-3 border-t border-stone-200 pt-2 dark:border-gray-700" data-testid="add-car-photo">
			<h3 class="text-[11px] font-semibold uppercase tracking-wide text-stone-700 dark:text-gray-200">Add a photo</h3>
			<div class="mt-1.5 flex flex-wrap gap-2">
				<button type="button" class="rounded-md px-2 py-1 text-xs amber-button" disabled={busy} on:click={startUpload}>Upload</button>
				<button
					type="button"
					class="rounded-md border border-stone-300 px-2 py-1 text-xs text-amber-900 underline dark:border-gray-600 dark:text-amber-200"
					data-testid="choose-library-photo"
					disabled={busy}
					on:click={openLibrary}
				>
					Choose from My Photos
				</button>
			</div>
			<input
				bind:this={fileInput}
				type="file"
				accept="image/*"
				capture="environment"
				class="sr-only"
				data-testid="vehicle-photo-input"
				disabled={busy}
				on:change={onFile}
			/>
			<p class="mt-1 text-[11px] text-stone-500 dark:text-gray-400">Up to 3 photos. Sharing is chosen after you pick a file. Removing one leaves it in My Photos.</p>
			{#if showLibrary}
				<ul class="mt-2 space-y-2" data-testid="library-picker">
					{#if library.length === 0}
						<li class="text-[11px] text-stone-600 dark:text-gray-300">No other photos are in My Photos.</li>
					{/if}
					{#each library as item (item.photoId)}
						<li class="flex items-center gap-2">
							{#if item.url}
								<img src={item.url} alt="" class="h-10 w-10 rounded object-cover" />
							{/if}
							<button type="button" class="text-xs text-amber-800 underline dark:text-amber-200" data-testid="library-pick" disabled={busy} on:click={() => attach(item)}>
								Use this photo
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{:else if photos.length >= 3 && !playMode}
		<p class="mt-2 text-xs text-stone-700 dark:text-gray-200">This vehicle already has 3 photos. Detach one to add another.</p>
	{/if}
	{/if}
</details>

{#if showUpload && pendingFile}
	<div class="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/60 p-3 sm:items-center">
		<div
			class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-stone-300 bg-white p-4 shadow-xl dark:border-gray-600 dark:bg-gray-900"
			role="dialog"
			aria-modal="true"
			aria-labelledby="car-upload-title"
			data-testid="car-upload-dialog"
		>
			<h2 id="car-upload-title" class="text-sm font-semibold text-stone-900 dark:text-gray-100">Add a photo</h2>
			<img src={pendingPreview} alt={pendingFile.name || 'Preview'} class="mt-3 h-36 w-full rounded object-cover bg-stone-100" />
			<label class="mt-3 block text-xs text-stone-700 dark:text-gray-200">
				Caption
				<input
					type="text"
					maxlength="140"
					bind:value={caption}
					placeholder="Caption (optional)"
					aria-label="Photo caption"
					class="mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-2 text-sm text-stone-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
				/>
			</label>
			<div class="mt-3">
				<SharingControl
					flags={uploadFlags}
					disabled={busy}
					everywhereTestId="upload-share-everywhere"
					customizeTestId="upload-customize-sharing"
					buddiesTestId="upload-share-buddies"
					linkTestId="upload-share-link"
					galleryTestId="upload-share-gallery"
					statsTestId="upload-share-stats"
					paintingUrl={paintingUrl}
					{profileWebsite}
					paintingDisabled={busy}
					paintingTestId="upload-painting-link"
					useWebsiteTestId="upload-use-profile-website"
					onChange={(next) => (uploadFlags = next)}
					onPaintingUrl={(next) => (paintingUrl = next)}
					onPaintingCommit={(next) => (paintingUrl = next)}
				/>
			</div>
			{#if status}
				<p class="mt-2 text-xs text-stone-700 dark:text-gray-200" role="status">{status}</p>
			{/if}
			{#if error}
				<p class="mt-2 text-xs text-red-800 dark:text-red-200" role="alert">{error}</p>
			{/if}
			<div class="mt-4 flex justify-end gap-2">
				<button type="button" class="rounded-md border border-stone-300 px-3 py-1.5 text-xs dark:border-gray-600" disabled={busy} on:click={closeUpload}>Cancel</button>
				<button type="button" class="rounded-md px-3 py-1.5 text-xs amber-button" data-testid="confirm-car-upload" disabled={busy} on:click={confirmUpload}>
					{busy ? 'Adding...' : 'Add to this car'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if editing}
	<div class="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/60 p-3 sm:items-center">
		<div
			class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-stone-300 bg-white p-4 shadow-xl dark:border-gray-600 dark:bg-gray-900"
			role="dialog"
			aria-modal="true"
			aria-labelledby="car-photo-editor-title"
			data-testid="car-photo-editor"
		>
			<div class="flex items-start justify-between gap-3">
				<h2 id="car-photo-editor-title" class="text-sm font-semibold text-stone-900 dark:text-gray-100">Edit photo</h2>
				<button type="button" class="text-xs text-stone-600 underline dark:text-gray-300" on:click={closeEditor}>Close</button>
			</div>
			{#if editing.url}
				<img src={editing.url} alt={editing.caption || 'Selected photo'} class="mt-3 h-36 w-full rounded object-cover bg-stone-100" />
			{/if}
			<label class="mt-3 block text-xs text-stone-700 dark:text-gray-200">
				Caption
				<input
					type="text"
					maxlength="140"
					bind:value={captionDraft}
					aria-label="Photo caption"
					data-testid="car-photo-caption"
					class="mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-2 text-sm text-stone-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
					disabled={busy}
					on:change={() => editing && saveCaption(editing)}
				/>
			</label>
			{#if editing.attachments.length > 1}
				<label class="mt-3 block text-xs text-stone-700 dark:text-gray-200">
					Share this photo from
					<select
						class="mt-1 block w-full rounded border border-stone-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
						data-testid="share-from-car"
						value="{shareSource(editing).teamId}/{shareSource(editing).vehicleId}"
						on:change={(event) => {
							const value = event.currentTarget instanceof HTMLSelectElement ? event.currentTarget.value : '';
							const [nextTeam, nextVehicle] = value.split('/');
							const match = editing?.attachments.find((item) => item.teamId === nextTeam && item.vehicleId === nextVehicle);
							if (!match || !editing) return;
							editing.shareTeamId = match.teamId;
							editing.shareVehicleId = match.vehicleId;
							photos = photos;
							if (editing.showToBuddies || editing.showOnShareLink || editing.showInGallery) {
								void changeShareCar(editing, match);
							}
						}}
					>
						{#each editing.attachments as attachment (attachment.teamId + attachment.vehicleId)}
							<option value="{attachment.teamId}/{attachment.vehicleId}">
								{attachment.teamId === photoTeamId && attachment.vehicleId === vehicleId ? 'This car' : attachment.vehicleId}
							</option>
						{/each}
					</select>
				</label>
			{/if}
			<div class="mt-3">
				<SharingControl
					flags={photoFlags(editing)}
					disabled={busy}
					paintingUrl={paintingDraft}
					{profileWebsite}
					paintingDisabled={busy}
					onChange={(next) => editing && saveFlags(editing, next)}
					onPaintingUrl={(next) => (paintingDraft = next)}
					onPaintingCommit={(next) => editing && savePainting(editing, next)}
				/>
			</div>
			{#if status}
				<p class="mt-2 text-xs text-stone-700 dark:text-gray-200" role="status">{status}</p>
			{/if}
			{#if error}
				<p class="mt-2 text-xs text-red-800 dark:text-red-200" role="alert">{error}</p>
			{/if}
			<div class="mt-4 flex flex-wrap items-center justify-between gap-2">
				<button
					type="button"
					class="text-xs text-red-800 underline dark:text-red-200"
					aria-label="Remove from this car"
					disabled={busy}
					on:click={() => editing && remove(editing)}
				>
					Remove from this car
				</button>
				<label class="cursor-pointer text-xs text-amber-800 underline dark:text-amber-200 {busy ? 'pointer-events-none opacity-60' : ''}">
					Replace
					<input
						type="file"
						accept="image/*"
						capture="environment"
						class="sr-only"
						data-testid="car-photo-replace"
						disabled={busy}
						on:change={(event) => editing && onReplace(editing, event)}
					/>
				</label>
			</div>
		</div>
	</div>
{/if}
</div>
{/if}
