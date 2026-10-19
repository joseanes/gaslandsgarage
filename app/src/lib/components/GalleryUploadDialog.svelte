<script lang="ts">
	import { getContext, onDestroy, onMount } from 'svelte';
	import SharingControl from '$lib/components/SharingControl.svelte';
	import { PHOTO_SAVE_GATE, type PhotoSaveGate } from '$lib/photos/photoSaveGate';
	import { reasonVehicleNotOnSavedTeam } from '$lib/photos/saveBeforePhoto';
	import { galleryVehicleTypes } from '$lib/photos/galleryQuery';
	import { MAX_CAPTION_LENGTH, MAX_PHOTOS_PER_ACCOUNT, quotaMessage } from '$lib/photos/model';
	import { SHARE_FLAG_KEYS, anyShareFlag, vehicleTypeLabel, type ShareFlagKey, type ShareFlags } from '$lib/photos/share';
	import { paintingGuideLink } from '$lib/photos/link';
	import { setPhotoPaintingUrl, setPhotoSharing } from '$lib/services/photoShare';
	import { myProfileWebsite } from '$lib/services/playerProfile';
	import { getUserTeams } from '$lib/services/team';
	import { listMyPhotos, uploadVehiclePhoto } from '$lib/services/vehiclePhotos';

	export let onClose: () => void = () => undefined;
	export let onSaved: (message: string) => void = () => undefined;

	interface UploadCar {
		teamId: string;
		teamName: string;
		vehicleId: string;
		vehicleType: string;
		carName: string;
	}

	const galleryOnly: readonly ShareFlagKey[] = ['showInGallery'];
	const fieldClass =
		'w-full rounded-lg border border-orange-900/70 bg-stone-950 px-3 py-2 text-sm text-orange-50';

	let cars: UploadCar[] = [];
	let used = 0;
	let loading = true;
	let busy = false;
	let error = '';
	let dragging = false;
	let file: File | null = null;
	let preview = '';
	let caption = '';
	let paintingUrl = '';
	let profileWebsite = '';
	let vehicleType = '';
	let teamId = '';
	let vehicleId = '';
	let fileInput: HTMLInputElement | null = null;
	let cameraInput: HTMLInputElement | null = null;
	let flags: ShareFlags = galleryFlags();
	let listenedVehicle = '';
	let stopGate = () => {};

	const photoSaveGate = getContext<PhotoSaveGate | undefined>(PHOTO_SAVE_GATE);

	$: types = galleryVehicleTypes();
	$: teams = teamChoices(cars);
	$: teamCars = cars.filter((car) => car.teamId === teamId);
	$: linkedCar = teamCars.find((car) => car.vehicleId === vehicleId) ?? null;
	$: if (linkedCar && vehicleType !== linkedCar.vehicleType) vehicleType = linkedCar.vehicleType;
	$: activeKeys = linkedCar ? SHARE_FLAG_KEYS : galleryOnly;
	$: full = quotaMessage(used, 0);

	onMount(() => {
		void refresh();
	});

	onDestroy(() => {
		stopGate();
		if (preview) URL.revokeObjectURL(preview);
	});

	function watchGate(id: string) {
		if (id === listenedVehicle) return;
		stopGate();
		listenedVehicle = id;
		stopGate =
			photoSaveGate?.listen(id, (request) => {
				if (request.vehicleId !== id || request.intent !== 'file') return;
				void submit();
			}) ?? (() => {});
	}

	$: watchGate(vehicleId);

	function galleryFlags(): ShareFlags {
		return { showToBuddies: false, showOnShareLink: false, showInGallery: true, shareVehicleStats: false };
	}

	function teamChoices(rows: UploadCar[]): { id: string; name: string }[] {
		const seen = new Map<string, string>();
		for (const car of rows) {
			if (!seen.has(car.teamId)) seen.set(car.teamId, car.teamName);
		}
		return [...seen.entries()].map(([id, name]) => ({ id, name }));
	}

	function dropCarFlags() {
		flags = { ...flags, showToBuddies: false, showOnShareLink: false, shareVehicleStats: false };
	}

	function chooseTeam(value: string) {
		teamId = value;
		vehicleId = '';
		dropCarFlags();
	}

	function chooseCar(value: string) {
		vehicleId = value;
		if (!value) dropCarFlags();
	}

	function isImage(next: File): boolean {
		return next.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(next.name);
	}

	function chooseFile(next: File | null | undefined) {
		if (!next) return;
		if (!isImage(next)) {
			error = 'Choose a photo.';
			return;
		}
		error = '';
		if (preview) URL.revokeObjectURL(preview);
		file = next;
		preview = URL.createObjectURL(next);
	}

	function onFileInput(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		chooseFile(input.files?.[0]);
		input.value = '';
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		chooseFile(event.dataTransfer?.files?.[0]);
	}

	async function refresh() {
		loading = true;
		error = '';
		try {
			const [photos, teamsResult] = await Promise.all([listMyPhotos(), getUserTeams()]);
			used = photos.length;
			profileWebsite = await myProfileWebsite();
			if (!paintingUrl) paintingUrl = profileWebsite;
			const found: UploadCar[] = [];
			if (teamsResult.success && teamsResult.teams) {
				for (const team of teamsResult.teams) {
					const vehicles = team?.teamData?.vehicles;
					if (!Array.isArray(vehicles)) continue;
					const teamName = typeof team.teamName === 'string' && team.teamName.trim() ? team.teamName.trim() : 'Saved team';
					for (const vehicle of vehicles) {
						if (!vehicle || typeof vehicle.id !== 'string') continue;
						const named = typeof vehicle.name === 'string' ? vehicle.name.trim() : '';
						const type = vehicleTypeLabel(vehicle.type);
						found.push({
							teamId: String(team.id),
							teamName,
							vehicleId: vehicle.id,
							vehicleType: type,
							carName: named || type
						});
					}
				}
			}
			cars = found;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Your photos could not be loaded.';
		} finally {
			loading = false;
		}
	}

	async function submit() {
		if (busy || loading) return;
		if (!file) {
			error = 'Choose a photo.';
			return;
		}
		if (!vehicleType) {
			error = 'Choose a vehicle type.';
			return;
		}
		if (teamId && !vehicleId) {
			error = 'Choose a car on that team, or leave the link empty.';
			return;
		}
		if (full) {
			error = full;
			return;
		}
		const chosenLink = paintingUrl.trim();
		if (chosenLink && !paintingGuideLink(chosenLink)) {
			error = 'Use a full http or https link, up to 300 characters.';
			return;
		}
		const linked = Boolean(linkedCar);
		if (linked && photoSaveGate?.reason(vehicleId)) {
			photoSaveGate.request({
				vehicleId,
				intent: 'file',
				file,
				caption,
				uploadGallery: flags.showInGallery,
				uploadStats: flags.shareVehicleStats,
				uploadFlags: flags,
				paintingUrl
			});
			return;
		}
		if (
			linked &&
			reasonVehicleNotOnSavedTeam({
				savedTeamId: teamId,
				vehicleId,
				savedVehicleIds: teamCars.map((car) => car.vehicleId)
			})
		) {
			error = 'Save your team to add photos';
			return;
		}
		const nextFlags: ShareFlags = linked
			? flags
			: { ...flags, showToBuddies: false, showOnShareLink: false, shareVehicleStats: false };
		busy = true;
		error = '';
		try {
			const uploaded = await uploadVehiclePhoto({
				file,
				caption,
				teamId: linked ? teamId : undefined,
				vehicleId: linked ? vehicleId : undefined
			});
			if (chosenLink) await setPhotoPaintingUrl(uploaded.photoId, chosenLink);
			let message = 'Saved to your photos.';
			if (anyShareFlag(nextFlags)) {
				const result = await setPhotoSharing(
					uploaded.photoId,
					nextFlags,
					linked ? { teamId, vehicleId } : undefined,
					linked ? undefined : vehicleType
				);
				if (nextFlags.showInGallery && result.published) message = 'Your photo is in the Gallery.';
				else if (nextFlags.showInGallery) message = 'Saved. It will appear in the Gallery after an administrator approves it.';
			}
			onSaved(message);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'That photo could not be uploaded.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/80 p-3 sm:items-center" role="presentation">
	<div
		class="max-h-full w-full max-w-lg overflow-auto rounded-2xl border border-orange-900/70 bg-stone-950 p-5 text-orange-50 shadow-2xl shadow-black/50"
		role="dialog"
		aria-modal="true"
		aria-labelledby="add-photo-title"
		data-testid="add-photo-dialog"
	>
		<div class="mb-4 flex items-start justify-between gap-3">
			<div>
				<p class="text-xs font-bold uppercase tracking-[0.18em] text-orange-300">Your library</p>
				<h2 id="add-photo-title" class="text-2xl font-black tracking-tight">Add a photo</h2>
			</div>
			<button type="button" class="rounded-md border border-orange-800 px-3 py-1.5 text-sm text-orange-100" on:click={onClose}>Close</button>
		</div>
		<p class="mb-4 text-sm text-orange-100/80" data-testid="add-photo-usage">
			{loading ? 'Checking your photo space…' : `${used} of ${MAX_PHOTOS_PER_ACCOUNT} used`}
		</p>
		{#if error}
			<p role="alert" class="mb-4 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-100" data-testid="add-photo-error">{error}</p>
		{/if}
		<form class="space-y-4" on:submit|preventDefault={submit}>
			<div
				class="rounded-xl border border-dashed px-4 py-5 text-center {dragging ? 'border-orange-400 bg-orange-950/40' : 'border-orange-800 bg-stone-900/80'}"
				data-testid="add-photo-drop"
				role="button"
				tabindex="0"
				on:click={() => fileInput?.click()}
				on:keydown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						fileInput?.click();
					}
				}}
				on:dragover|preventDefault={() => (dragging = true)}
				on:dragleave={() => (dragging = false)}
				on:drop={onDrop}
			>
				{#if preview}
					<img src={preview} alt={file?.name || 'Preview'} class="mx-auto mb-3 max-h-40 rounded-lg object-contain" data-testid="add-photo-preview" />
				{/if}
				<p class="text-sm font-semibold">{file ? file.name : 'Drop a photo here'}</p>
				<p class="mt-1 text-xs text-orange-200/80">or choose one from your device</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<button type="button" class="rounded-md border border-orange-700 px-3 py-2 text-sm" on:click={() => fileInput?.click()}>Choose a photo</button>
				<button type="button" class="rounded-md border border-orange-700 px-3 py-2 text-sm" data-testid="add-photo-camera-button" on:click={() => cameraInput?.click()}>
					Take a photo
				</button>
			</div>
			<input bind:this={fileInput} type="file" accept="image/*" class="sr-only" data-testid="add-photo-file" on:change={onFileInput} />
			<input
				bind:this={cameraInput}
				type="file"
				accept="image/*"
				capture="environment"
				class="sr-only"
				data-testid="add-photo-camera"
				on:change={onFileInput}
			/>
			<label class="block text-sm">
				Caption
				<input
					class="{fieldClass} mt-1"
					data-testid="add-photo-caption"
					maxlength={MAX_CAPTION_LENGTH}
					placeholder="Optional"
					bind:value={caption}
				/>
			</label>
			<label class="block text-sm">
				Vehicle type
				<select class="{fieldClass} mt-1" data-testid="add-photo-type" required disabled={Boolean(linkedCar)} bind:value={vehicleType}>
					<option value="">Choose a type</option>
					{#each types as type}
						<option value={type}>{type}</option>
					{/each}
				</select>
			</label>
			<fieldset class="space-y-2">
				<legend class="text-sm font-semibold">Link to one of my cars</legend>
				<p class="text-xs leading-snug text-orange-200/80" data-testid="add-photo-link-note">
					Optional. Linking attaches this photo to that car and lets you share its stats. The Gallery is on because you are adding it here.
				</p>
				{#if !loading && cars.length === 0}
					<p class="text-xs text-orange-200/80" data-testid="add-photo-no-cars">You have no saved cars to link.</p>
				{/if}
				<label class="block text-sm">
					Team
					<select
						class="{fieldClass} mt-1"
						data-testid="add-photo-team"
						value={teamId}
						on:change={(event) => chooseTeam(event.currentTarget instanceof HTMLSelectElement ? event.currentTarget.value : '')}
					>
						<option value="">Don't link a car</option>
						{#each teams as team}
							<option value={team.id}>{team.name}</option>
						{/each}
					</select>
				</label>
				{#if teamId}
					<label class="block text-sm">
						Car
						<select
							class="{fieldClass} mt-1"
							data-testid="add-photo-car"
							value={vehicleId}
							on:change={(event) => chooseCar(event.currentTarget instanceof HTMLSelectElement ? event.currentTarget.value : '')}
						>
							<option value="">Choose a car</option>
							{#each teamCars as car}
								<option value={car.vehicleId}>{car.carName}</option>
							{/each}
						</select>
					</label>
				{/if}
			</fieldset>
			<SharingControl
				{flags}
				{activeKeys}
				everywhereTestId="add-share-everywhere"
				customizeTestId="add-customize-sharing"
				buddiesTestId="add-share-buddies"
				linkTestId="add-share-link"
				galleryTestId="add-share-gallery"
				statsTestId="add-share-stats"
				{paintingUrl}
				{profileWebsite}
				paintingTestId="add-painting-link"
				useWebsiteTestId="add-use-profile-website"
				onChange={(next) => (flags = next)}
				onPaintingUrl={(next) => (paintingUrl = next)}
				onPaintingCommit={(next) => (paintingUrl = next)}
			/>
			<div class="flex flex-wrap justify-end gap-2">
				<button type="button" class="rounded-md border border-orange-800 px-3 py-2 text-sm" data-testid="add-photo-cancel" on:click={onClose}>Cancel</button>
				<button
					type="submit"
					class="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-stone-950 disabled:opacity-50"
					data-testid="add-photo-submit"
					disabled={busy || loading || Boolean(full)}
				>
					{busy ? 'Adding…' : 'Add photo'}
				</button>
			</div>
		</form>
	</div>
</div>
