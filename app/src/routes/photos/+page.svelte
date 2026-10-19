<script lang="ts">
	import { onMount } from 'svelte';
	import { user } from '$lib/firebase';
	import { MAX_PHOTOS_PER_ACCOUNT } from '$lib/photos/model';
	import {
		GALLERY_SHARE_COPY,
		SHARE_BUDDIES_LABEL,
		SHARE_GALLERY_LABEL,
		SHARE_LINK_LABEL,
		SHARE_STATS_LABEL,
		STATS_SHARE_COPY,
		vehicleTypeLabel,
		type ShareFlags
	} from '$lib/photos/share';
	import { setPhotoSharing } from '$lib/services/photoShare';
	import { getUserTeams } from '$lib/services/team';
	import {
		attachLibraryPhoto,
		cleanupMyPhotoOrphans,
		deleteVehiclePhoto,
		detachLibraryPhoto,
		listMyPhotos,
		migrateMyPhotoLibrary,
		renameLibraryPhoto,
		replaceLibraryPhoto,
		uploadVehiclePhoto,
		type VehiclePhoto
	} from '$lib/services/vehiclePhotos';

	interface SavedCar {
		teamId: string;
		vehicleId: string;
		label: string;
	}

	let photos: VehiclePhoto[] = [];
	let cars: SavedCar[] = [];
	let status: 'loading' | 'ready' | 'signed-out' | 'error' = 'loading';
	let busy = false;
	let notice = '';
	let noticeError = false;
	let uploadCaption = '';
	let sharePick: Record<string, string> = {};
	let attachPick: Record<string, string> = {};

	const fieldClass =
		'mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm text-stone-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

	function requestSignIn() {
		window.dispatchEvent(new CustomEvent('gaslands-request-sign-in'));
	}

	function pair(teamId: string, vehicleId: string): string {
		return `${teamId}/${vehicleId}`;
	}

	async function load() {
		if (!$user) {
			photos = [];
			cars = [];
			status = 'signed-out';
			return;
		}
		status = 'loading';
		notice = '';
		try {
			await migrateMyPhotoLibrary().catch(() => undefined);
			await cleanupMyPhotoOrphans().catch(() => undefined);
			photos = await listMyPhotos();
			const teams = await getUserTeams();
			cars = [];
			if (teams.success && teams.teams) {
				for (const team of teams.teams) {
					const vehicles = team?.teamData?.vehicles;
					if (!Array.isArray(vehicles)) continue;
					const teamName = typeof team.teamName === 'string' && team.teamName.trim() ? team.teamName.trim() : 'Saved team';
					for (const vehicle of vehicles) {
						if (!vehicle || typeof vehicle.id !== 'string') continue;
						const named = typeof vehicle.name === 'string' ? vehicle.name.trim() : '';
						const name = named || vehicleTypeLabel(vehicle.type);
						cars.push({ teamId: String(team.id), vehicleId: vehicle.id, label: `${teamName}: ${name}` });
					}
				}
			}
			status = 'ready';
		} catch (error) {
			status = 'error';
			noticeError = true;
			notice = error instanceof Error ? error.message : 'Photos could not be loaded.';
		}
	}

	onMount(() => {
		const stop = user.subscribe(() => {
			void load();
		});
		return stop;
	});

	function carLabel(teamId: string, vehicleId: string): string {
		return cars.find((car) => car.teamId === teamId && car.vehicleId === vehicleId)?.label ?? 'Saved car';
	}

	function usedBy(photo: VehiclePhoto): string {
		if (photo.attachments.length === 0) return 'no cars';
		return photo.attachments.map((item) => carLabel(item.teamId, item.vehicleId)).join(', ');
	}

	function availableCars(photo: VehiclePhoto): SavedCar[] {
		return cars.filter((car) => !photo.attachments.some((item) => item.teamId === car.teamId && item.vehicleId === car.vehicleId));
	}

	function selectedShare(photo: VehiclePhoto): string {
		const chosen = sharePick[photo.photoId] || pair(photo.shareTeamId, photo.shareVehicleId);
		return photo.attachments.some((item) => pair(item.teamId, item.vehicleId) === chosen) ? chosen : '';
	}

	function sourceFor(photo: VehiclePhoto): { teamId: string; vehicleId: string } | null {
		if (photo.attachments.length === 0) return null;
		if (photo.attachments.length === 1) return photo.attachments[0];
		const chosen = selectedShare(photo);
		if (!chosen) return null;
		const [teamId, vehicleId] = chosen.split('/');
		return photo.attachments.find((item) => item.teamId === teamId && item.vehicleId === vehicleId) ?? null;
	}

	async function run(task: () => Promise<void>, pending: string, fallback: string) {
		if (busy) return;
		busy = true;
		notice = '';
		noticeError = false;
		notice = pending;
		try {
			await task();
			notice = '';
			await load();
		} catch (error) {
			noticeError = true;
			notice = error instanceof Error ? error.message : fallback;
		} finally {
			busy = false;
		}
	}

	async function saveCaption(photo: VehiclePhoto, caption: string) {
		await run(() => renameLibraryPhoto(photo.photoId, caption), 'Saving caption...', 'That caption could not be saved.');
	}

	async function saveFlags(photo: VehiclePhoto, patch: Partial<ShareFlags>) {
		const source = sourceFor(photo);
		if (!source) {
			noticeError = true;
			notice = 'Attach this photo to a car before sharing it.';
			return;
		}
		const next: ShareFlags = {
			showToBuddies: photo.showToBuddies,
			showOnShareLink: photo.showOnShareLink,
			showInGallery: photo.showInGallery,
			shareVehicleStats: photo.shareVehicleStats,
			...patch
		};
		await run(
			() => setPhotoSharing(photo.photoId, next, source),
			'Saving sharing...',
			'That sharing choice could not be saved.'
		);
	}

	async function changeShareCar(photo: VehiclePhoto, value: string) {
		sharePick = { ...sharePick, [photo.photoId]: value };
		if (!(photo.showToBuddies || photo.showOnShareLink || photo.showInGallery)) return;
		const [teamId, vehicleId] = value.split('/');
		const source = photo.attachments.find((item) => item.teamId === teamId && item.vehicleId === vehicleId);
		if (!source) return;
		await run(
			() =>
				setPhotoSharing(
					photo.photoId,
					{
						showToBuddies: photo.showToBuddies,
						showOnShareLink: photo.showOnShareLink,
						showInGallery: photo.showInGallery,
						shareVehicleStats: photo.shareVehicleStats
					},
					source
				),
			'Saving sharing...',
			'That sharing choice could not be saved.'
		);
	}

	async function attach(photo: VehiclePhoto) {
		const value = attachPick[photo.photoId] ?? '';
		const [teamId, vehicleId] = value.split('/');
		if (!teamId || !vehicleId) {
			noticeError = true;
			notice = 'Choose a car to attach this photo to.';
			return;
		}
		await run(() => attachLibraryPhoto(photo.photoId, teamId, vehicleId), 'Attaching photo...', 'That photo could not be attached.');
	}

	async function detach(photo: VehiclePhoto, teamId: string, vehicleId: string) {
		await run(
			() => detachLibraryPhoto(photo.photoId, teamId, vehicleId),
			'Removing photo from that car...',
			'That photo could not be removed from that car.'
		);
	}

	async function replace(photo: VehiclePhoto, file: File) {
		await run(() => replaceLibraryPhoto(photo, file), 'Replacing photo...', 'That photo could not be replaced.');
	}

	async function remove(photo: VehiclePhoto) {
		if (busy) return;
		const names = usedBy(photo);
		if (!confirm(`Delete this photo? It is on: ${names}. The file and every shared copy will be removed.`)) return;
		await run(() => deleteVehiclePhoto(photo), 'Deleting photo...', 'That photo could not be deleted.');
	}

	async function onUpload(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		const caption = uploadCaption;
		await run(async () => {
			await uploadVehiclePhoto({ file, caption });
			uploadCaption = '';
		}, 'Uploading photo...', 'That photo could not be uploaded.');
	}
</script>

<svelte:head>
	<title>My Photos - Gaslands Garage</title>
	<meta name="description" content="Photos of your painted Gaslands cars. Attach a photo to any of your cars." />
</svelte:head>

<section class="mx-auto max-w-6xl px-2 py-8 text-stone-800 dark:text-gray-100" data-testid="my-photos-page">
	<h1 class="mb-2 text-3xl font-bold">My Photos</h1>
	<p class="mb-4 max-w-2xl text-stone-600 dark:text-gray-300">
		These photos belong to your account. A car can show up to 3 of them. Removing a car or a team leaves the photo here.
	</p>

	{#if notice}
		<p role={noticeError ? 'alert' : 'status'} class="mb-4 rounded-lg border px-3 py-2 {noticeError ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100' : 'border-stone-300 bg-white dark:border-gray-600 dark:bg-gray-800'}">{notice}</p>
	{/if}

	{#if status === 'signed-out'}
		<button type="button" class="rounded-md px-3 py-2 text-sm amber-button" on:click={requestSignIn}>Sign in to see your photos</button>
	{:else if status === 'loading'}
		<p>Loading photos…</p>
	{:else if status === 'error'}
		<p role="alert">Photos could not be loaded.</p>
	{:else}
		<p class="mb-4 text-sm font-medium" data-testid="photo-usage">{photos.length} of {MAX_PHOTOS_PER_ACCOUNT} used</p>

		<div class="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end">
			<label class="inline-flex cursor-pointer items-center justify-center rounded-md px-3 py-2 text-sm amber-button {busy ? 'pointer-events-none opacity-60' : ''}">
				Upload a photo
				<input type="file" accept="image/*" class="sr-only" data-testid="library-upload" disabled={busy} on:change={onUpload} />
			</label>
			<input
				type="text"
				maxlength="140"
				bind:value={uploadCaption}
				placeholder="Caption (optional)"
				aria-label="Caption for a new photo"
				class="w-full rounded-md border border-stone-300 bg-white px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 sm:max-w-xs"
			/>
		</div>

		{#if photos.length === 0}
			<p data-testid="photo-library-empty">No photos yet.</p>
		{:else}
			<ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="photo-library">
				{#each photos as photo (photo.photoId)}
					<li class="rounded-lg border border-stone-300 bg-white p-3 dark:border-gray-600 dark:bg-gray-900" data-testid="library-photo">
						{#if photo.url}
							<img src={photo.url} alt={photo.caption || 'Painted car'} class="h-40 w-full rounded-lg bg-stone-100 object-cover" />
						{:else}
							<div class="flex h-40 items-center justify-center rounded-lg bg-stone-100 text-sm text-stone-600">Photo saved</div>
						{/if}
						<label class="mt-3 block text-xs text-stone-700 dark:text-gray-200">
							Caption
							<input
								type="text"
								maxlength="140"
								class={fieldClass}
								data-testid="photo-caption"
								value={photo.caption}
								disabled={busy}
								on:change={(event) => {
									const value = event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : photo.caption;
									void saveCaption(photo, value);
								}}
							/>
						</label>
						<p class="mt-2 text-xs text-stone-600 dark:text-gray-300" data-testid="photo-used-by">On: {usedBy(photo)}</p>
						<ul class="mt-1 space-y-1">
							{#each photo.attachments as attachment (attachment.teamId + attachment.vehicleId)}
								<li class="flex items-center justify-between gap-2 text-xs">
									<span>{carLabel(attachment.teamId, attachment.vehicleId)}</span>
									<button type="button" class="text-amber-800 underline dark:text-amber-200" data-testid="detach-photo" disabled={busy} on:click={() => detach(photo, attachment.teamId, attachment.vehicleId)}>
										Detach
									</button>
								</li>
							{/each}
						</ul>

						{#if photo.attachments.length === 0}
							<p class="mt-2 text-xs text-stone-600 dark:text-gray-300">Attach this photo to a car before sharing it.</p>
						{:else}
							{#if photo.attachments.length > 1}
								<label class="mt-2 block text-xs text-stone-700 dark:text-gray-200">
									Share this photo from
									<select
										class={fieldClass}
										data-testid="library-share-from"
										disabled={busy}
										value={selectedShare(photo)}
										on:change={(event) => {
											const value = event.currentTarget instanceof HTMLSelectElement ? event.currentTarget.value : '';
											void changeShareCar(photo, value);
										}}
									>
										<option value="">Choose a car</option>
										{#each photo.attachments as attachment (attachment.teamId + attachment.vehicleId)}
											<option value={pair(attachment.teamId, attachment.vehicleId)}>{carLabel(attachment.teamId, attachment.vehicleId)}</option>
										{/each}
									</select>
								</label>
							{/if}
							<fieldset class="mt-2 space-y-1" disabled={busy || !sourceFor(photo)}>
								<legend class="sr-only">Sharing for this photo</legend>
								<label class="flex items-start gap-2 text-xs">
									<input type="checkbox" class="mt-0.5" data-testid="share-buddies" checked={photo.showToBuddies} on:change={(event) => event.currentTarget instanceof HTMLInputElement && saveFlags(photo, { showToBuddies: event.currentTarget.checked })} />
									{SHARE_BUDDIES_LABEL}
								</label>
								<label class="flex items-start gap-2 text-xs">
									<input type="checkbox" class="mt-0.5" data-testid="share-link" checked={photo.showOnShareLink} on:change={(event) => event.currentTarget instanceof HTMLInputElement && saveFlags(photo, { showOnShareLink: event.currentTarget.checked })} />
									{SHARE_LINK_LABEL}
								</label>
								<label class="flex items-start gap-2 text-xs">
									<input type="checkbox" class="mt-0.5" data-testid="share-gallery" checked={photo.showInGallery} on:change={(event) => event.currentTarget instanceof HTMLInputElement && saveFlags(photo, { showInGallery: event.currentTarget.checked })} />
									{SHARE_GALLERY_LABEL}
								</label>
								<p class="text-xs leading-snug text-stone-600 dark:text-gray-300">{GALLERY_SHARE_COPY}</p>
								<label class="flex items-start gap-2 text-xs">
									<input type="checkbox" class="mt-0.5" data-testid="share-stats" checked={photo.shareVehicleStats} on:change={(event) => event.currentTarget instanceof HTMLInputElement && saveFlags(photo, { shareVehicleStats: event.currentTarget.checked })} />
									{SHARE_STATS_LABEL}
								</label>
								<p class="text-xs leading-snug text-stone-600 dark:text-gray-300">{STATS_SHARE_COPY}</p>
							</fieldset>
						{/if}

						{#if availableCars(photo).length > 0}
							<div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
								<label class="min-w-0 flex-1 text-xs text-stone-700 dark:text-gray-200">
									Attach to another car
									<select
										class={fieldClass}
										data-testid="attach-car"
										disabled={busy}
										value={attachPick[photo.photoId] ?? ''}
										on:change={(event) => {
											const value = event.currentTarget instanceof HTMLSelectElement ? event.currentTarget.value : '';
											attachPick = { ...attachPick, [photo.photoId]: value };
										}}
									>
										<option value="">Choose a car</option>
										{#each availableCars(photo) as car (car.teamId + car.vehicleId)}
											<option value={pair(car.teamId, car.vehicleId)}>{car.label}</option>
										{/each}
									</select>
								</label>
								<button type="button" class="rounded-md px-3 py-2 text-sm amber-button" data-testid="attach-photo" disabled={busy} on:click={() => attach(photo)}>Attach</button>
							</div>
						{/if}

						<label class="mt-3 inline-flex cursor-pointer text-xs text-amber-800 underline dark:text-amber-200 {busy ? 'pointer-events-none opacity-60' : ''}">
							Replace photo
							<input
								type="file"
								accept="image/*"
								class="sr-only"
								data-testid="replace-photo"
								disabled={busy}
								on:change={(event) => {
									const input = event.currentTarget;
									if (!(input instanceof HTMLInputElement)) return;
									const file = input.files?.[0];
									input.value = '';
									if (file) void replace(photo, file);
								}}
							/>
						</label>
						<button type="button" class="mt-2 block text-xs text-red-800 underline dark:text-red-200" data-testid="delete-library-photo" disabled={busy} on:click={() => remove(photo)}>
							Delete photo
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>
