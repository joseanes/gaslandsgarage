<script lang="ts">
	import { dev } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import LibraryPhotoEditor from '$lib/components/LibraryPhotoEditor.svelte';
	import ShareCar from '$lib/components/ShareCar.svelte';
	import { user } from '$lib/firebase';
	import { BUDDY_FALLBACK_NAME, publicDisplayName } from '$lib/buddies/model';
	import {
		attachmentVehicleTypes,
		matchesVehicleType,
		ownCarName,
		parsePhotoBrowser,
		photoBrowserSearch,
		sortPhotos,
		typeChoices,
		type PhotoBrowserState,
		type PhotoSort,
		type PhotoView,
		type SavedCar
	} from '$lib/photos/browser';
	import { carLabel, statRows } from '$lib/photos/carPage';
	import { MAX_PHOTOS_PER_ACCOUNT } from '$lib/photos/model';
	import { vehicleTypeLabel } from '$lib/photos/share';
	import { listGalleryPhotos, listGalleryPhotosByPlayer, loadPublicCar, reportSharedPhoto, type GalleryPhoto } from '$lib/services/photoShare';
	import { getUserTeams } from '$lib/services/team';
	import {
		cleanupMyPhotoOrphans,
		listMyPhotos,
		migrateMyPhotoLibrary,
		uploadVehiclePhoto,
		type VehiclePhoto
	} from '$lib/services/vehiclePhotos';

	let status: 'loading' | 'ready' | 'signed-out' | 'error' = 'loading';
	let publicPhotos: GalleryPhoto[] = [];
	let library: VehiclePhoto[] = [];
	let cars: SavedCar[] = [];
	let publishedIds = new Set<string>();
	let knownNames: string[] = [];
	let nameDraft = '';
	let seenName = '';
	let open: GalleryPhoto | null = null;
	let notice = '';
	let noticeError = false;
	let busy = false;
	let uploadCaption = '';
	let appliedKey = '';
	let ticket = 0;
	let keepNotice = false;

	const fieldClass =
		'rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

	$: state = parsePhotoBrowser($page.url.searchParams);
	$: if (state.playerName !== seenName) {
		seenName = state.playerName;
		nameDraft = state.playerName;
	}
	$: loadKey = `${$user?.uid ?? 'anon'}|${state.view}|${state.playerName}|${dev && $page.url.searchParams.get('fixture') === '1' ? '1' : '0'}`;
	$: if (loadKey !== appliedKey) {
		appliedKey = loadKey;
		void load(false);
	}

	function requestSignIn() {
		window.dispatchEvent(new CustomEvent('gaslands-request-sign-in'));
	}

	function notify(message: string, error: boolean) {
		notice = message;
		noticeError = error;
	}

	function setBusy(value: boolean) {
		busy = value;
	}

	function setState(patch: Partial<PhotoBrowserState>) {
		const next = { ...parsePhotoBrowser($page.url.searchParams), ...patch };
		const search = photoBrowserSearch(next, $page.url.searchParams);
		void goto(`/gallery${search}`, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function commitName(value: string) {
		const safe = publicDisplayName(value) ?? '';
		if (value.trim() && !safe) {
			nameDraft = '';
			keepNotice = true;
			notify('That name cannot be used here.', true);
			setState({ view: 'player', playerName: '' });
			return;
		}
		notify('', false);
		setState({ view: 'player', playerName: safe });
	}

	function rememberNames(photos: GalleryPhoto[]) {
		const next = new Set(knownNames);
		for (const photo of photos) {
			const name = publicDisplayName(photo.displayName);
			if (name && name !== BUDDY_FALLBACK_NAME) next.add(name);
		}
		knownNames = [...next].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
	}

	async function loadCars(): Promise<SavedCar[]> {
		const teams = await getUserTeams();
		const found: SavedCar[] = [];
		if (!teams.success || !teams.teams) return found;
		for (const team of teams.teams) {
			const vehicles = team?.teamData?.vehicles;
			if (!Array.isArray(vehicles)) continue;
			const teamName = typeof team.teamName === 'string' && team.teamName.trim() ? team.teamName.trim() : 'Saved team';
			for (const vehicle of vehicles) {
				if (!vehicle || typeof vehicle.id !== 'string') continue;
				const named = typeof vehicle.name === 'string' ? vehicle.name.trim() : '';
				const vehicleType = vehicleTypeLabel(vehicle.type);
				const carName = named || vehicleType;
				found.push({
					teamId: String(team.id),
					vehicleId: vehicle.id,
					label: `${teamName}: ${carName}`,
					vehicleType,
					carName
				});
			}
		}
		return found;
	}

	async function publishedShareIds(photos: VehiclePhoto[]): Promise<Set<string>> {
		const ids = photos.filter((photo) => photo.showInGallery).map((photo) => photo.photoId);
		const found = await Promise.all(
			ids.map(async (id) => {
				try {
					return (await loadPublicCar(id)) ? id : '';
				} catch {
					return '';
				}
			})
		);
		return new Set(found.filter((id) => id.length > 0));
	}

	async function load(quiet: boolean) {
		const current = ++ticket;
		const browserState = parsePhotoBrowser($page.url.searchParams);
		const fixture = dev && $page.url.searchParams.get('fixture') === '1';
		const signedIn = Boolean($user);
		const preserveNotice = keepNotice;
		keepNotice = false;
		if (!quiet && !preserveNotice) notice = '';
		if (browserState.view === 'mine' && !signedIn) {
			if (current !== ticket) return;
			publicPhotos = [];
			library = [];
			cars = [];
			publishedIds = new Set();
			open = null;
			status = 'signed-out';
			return;
		}
		if (!quiet) status = 'loading';
		try {
			let nextPublic: GalleryPhoto[] = [];
			let nextLibrary: VehiclePhoto[] = [];
			let nextCars: SavedCar[] = [];
			let nextPublished = new Set<string>();
			if (browserState.view === 'mine') {
				await migrateMyPhotoLibrary().catch(() => undefined);
				await cleanupMyPhotoOrphans().catch(() => undefined);
				if (current !== ticket) return;
				nextLibrary = await listMyPhotos();
				nextCars = await loadCars();
				nextPublished = await publishedShareIds(nextLibrary);
			} else if (fixture) {
				const sample = (await import('$lib/photos/carPageFixture')).sampleGalleryPhoto();
				const named = browserState.view === 'player' ? browserState.playerName : '';
				nextPublic = browserState.view === 'player' && (!named || sample.displayName !== named) ? [] : [sample];
				rememberNames([sample]);
				nextPublished = new Set(nextPublic.map((photo) => photo.photoId));
			} else if (browserState.view === 'player') {
				const [matched, recent] = await Promise.all([
					browserState.playerName ? listGalleryPhotosByPlayer(browserState.playerName) : Promise.resolve([]),
					listGalleryPhotos()
				]);
				if (current !== ticket) return;
				nextPublic = matched;
				rememberNames(recent);
				rememberNames(matched);
				const ownedPhotos = await ownedLibrary();
				nextLibrary = ownedPhotos.photos;
				nextCars = ownedPhotos.saved;
				nextPublished = new Set(nextPublic.map((photo) => photo.photoId));
			} else {
				nextPublic = await listGalleryPhotos();
				if (current !== ticket) return;
				rememberNames(nextPublic);
				const ownedPhotos = await ownedLibrary();
				nextLibrary = ownedPhotos.photos;
				nextCars = ownedPhotos.saved;
				nextPublished = new Set(nextPublic.map((photo) => photo.photoId));
			}
			if (current !== ticket) return;
			publicPhotos = nextPublic;
			library = nextLibrary;
			cars = nextCars;
			publishedIds = nextPublished;
			if (open && !publicPhotos.some((photo) => photo.photoId === open?.photoId)) open = null;
			status = 'ready';
		} catch (error) {
			console.error('Could not load photos', error);
			if (current !== ticket) return;
			status = 'error';
		}
	}

	async function ownedLibrary(): Promise<{ photos: VehiclePhoto[]; saved: SavedCar[] }> {
		if (!$user) return { photos: [], saved: [] };
		try {
			const photos = await listMyPhotos();
			const saved = photos.length > 0 ? await loadCars() : [];
			return { photos, saved };
		} catch {
			return { photos: [], saved: [] };
		}
	}

	function carHref(photoId: string): string {
		const preview = dev && $page.url.searchParams.get('fixture') === '1' ? '?fixture=1' : '';
		return `/car/${photoId}${preview}`;
	}

	function publicCarName(photo: GalleryPhoto): string {
		return carLabel({ vehicleType: photo.vehicleType, vehicleStats: photo.vehicleStats });
	}

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
				publicPhotos = publicPhotos.filter((item) => item.photoId !== photo.photoId);
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

	async function onUpload(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		const file = input.files?.[0];
		input.value = '';
		if (!file || busy) return;
		const caption = uploadCaption;
		busy = true;
		notify('Uploading photo...', false);
		try {
			await uploadVehiclePhoto({ file, caption });
			uploadCaption = '';
			notify('', false);
			await load(true);
		} catch (error) {
			notify(error instanceof Error ? error.message : 'That photo could not be uploaded.', true);
		} finally {
			busy = false;
		}
	}

	function owned(photoId: string): VehiclePhoto | undefined {
		return library.find((photo) => photo.photoId === photoId);
	}

	$: libraryRows = sortPhotos(
		library.filter((photo) => matchesVehicleType(attachmentVehicleTypes(photo.attachments, cars), state.vehicleType)),
		state.sort,
		(photo) => ({
			createdAt: photo.createdAt,
			carName: ownCarName(photo.attachments, cars),
			usedCount: photo.attachments.length
		})
	);
	$: publicRows = sortPhotos(
		publicPhotos.filter((photo) => matchesVehicleType([photo.vehicleType], state.vehicleType)),
		state.sort,
		(photo) => ({ createdAt: photo.createdAt, carName: publicCarName(photo), usedCount: 0 })
	);
	$: typeOptions = typeChoices(
		state.view === 'mine'
			? library.flatMap((photo) => attachmentVehicleTypes(photo.attachments, cars))
			: publicPhotos.map((photo) => photo.vehicleType),
		state.vehicleType
	);
	$: showingMine = state.view === 'mine';
	$: visibleCount = showingMine ? libraryRows.length : publicRows.length;
	$: sourceCount = showingMine ? library.length : publicPhotos.length;
</script>

<svelte:head>
	<title>Photos - Gaslands Garage</title>
	<meta name="description" content="Photos of painted Gaslands cars. Your photos, or the ones players published to the Gallery." />
</svelte:head>

<section class="mx-auto max-w-6xl px-2 py-8 text-stone-800 dark:text-gray-100" data-testid="gallery-page">
	<h1 class="mb-2 text-3xl font-bold">Photos</h1>
	<p class="mb-6 max-w-2xl text-stone-600 dark:text-gray-300">
		Painted cars. My photos lists the pictures on your account. Anyone else only sees photos a player published to the Gallery, with their Gaslands display name.
	</p>

	<div class="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
		<label class="text-sm">
			Show
			<select
				class="{fieldClass} ml-2"
				data-testid="photo-view"
				value={state.view}
				on:change={(event) => {
					const view = event.currentTarget instanceof HTMLSelectElement ? (event.currentTarget.value as PhotoView) : 'all';
					setState({ view, playerName: view === 'player' ? state.playerName : '' });
				}}
			>
				<option value="all">All photos</option>
				<option value="mine">My photos</option>
				<option value="player">One player</option>
			</select>
		</label>
		{#if state.view === 'player'}
			<label class="text-sm">
				Player
				<input
					class="{fieldClass} ml-2"
					data-testid="player-name"
					list="player-names"
					placeholder="Gaslands display name"
					value={nameDraft}
					on:input={(event) => {
						nameDraft = event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : '';
					}}
					on:change={(event) => {
						if (event.currentTarget instanceof HTMLInputElement) commitName(event.currentTarget.value);
					}}
					on:keydown={(event) => {
						if (event.key === 'Enter' && event.currentTarget instanceof HTMLInputElement) {
							event.preventDefault();
							commitName(event.currentTarget.value);
						}
					}}
				/>
			</label>
			<datalist id="player-names">
				{#each knownNames as name}
					<option value={name}></option>
				{/each}
			</datalist>
		{/if}
		<label class="text-sm">
			Vehicle type
			<select
				class="{fieldClass} ml-2"
				data-testid="gallery-type-filter"
				value={state.vehicleType}
				on:change={(event) => {
					const vehicleType = event.currentTarget instanceof HTMLSelectElement ? event.currentTarget.value : 'All';
					setState({ vehicleType });
				}}
			>
				{#each typeOptions as type}
					<option value={type}>{type}</option>
				{/each}
			</select>
		</label>
		<label class="text-sm">
			Sort
			<select
				class="{fieldClass} ml-2"
				data-testid="gallery-sort"
				value={state.sort}
				on:change={(event) => {
					const sort = event.currentTarget instanceof HTMLSelectElement ? (event.currentTarget.value as PhotoSort) : 'newest';
					setState({ sort });
				}}
			>
				<option value="newest">Newest</option>
				<option value="oldest">Oldest</option>
				<option value="car">Car name</option>
				<option value="used">Most used</option>
			</select>
		</label>
	</div>

	{#if notice}
		<p role={noticeError ? 'alert' : 'status'} class="mb-4 rounded-lg border px-3 py-2 {noticeError ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100' : 'border-stone-300 bg-white dark:border-gray-600 dark:bg-gray-800'}">{notice}</p>
	{/if}

	{#if status === 'signed-out'}
		<button type="button" class="rounded-md px-3 py-2 text-sm amber-button" on:click={requestSignIn}>Sign in to see your photos</button>
	{:else if status === 'loading'}
		<p>Loading photos…</p>
	{:else if status === 'error'}
		<p role="alert">{showingMine ? 'Photos could not be loaded.' : 'The gallery could not be loaded.'}</p>
	{:else}
		{#if showingMine}
			<p class="mb-4 text-sm font-medium" data-testid="photo-usage">{library.length} of {MAX_PHOTOS_PER_ACCOUNT} used</p>
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
		{/if}

		{#if sourceCount === 0}
			{#if showingMine}
				<p data-testid="photo-library-empty">No photos yet.</p>
			{:else if state.view === 'player' && !state.playerName}
				<p>Choose a Gaslands display name.</p>
			{:else if state.view === 'player'}
				<p>No shared photos for that player.</p>
			{:else}
				<p data-testid="gallery-empty">No shared photos yet.</p>
			{/if}
		{:else if visibleCount === 0}
			<p>No photos of that vehicle type.</p>
		{:else}
			<ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid={showingMine ? 'photo-library' : 'gallery-grid'}>
				{#if showingMine}
					{#each libraryRows as photo (photo.photoId)}
						<li>
							<LibraryPhotoEditor
								{photo}
								{cars}
								{busy}
								{setBusy}
								{notify}
								reload={() => load(true)}
								showShare={publishedIds.has(photo.photoId)}
								shareCarName={ownCarName(photo.attachments, cars)}
								carPageHref={publishedIds.has(photo.photoId) ? carHref(photo.photoId) : ''}
							/>
						</li>
					{/each}
				{:else}
					{#each publicRows as photo (photo.photoId)}
						{@const mine = owned(photo.photoId)}
						<li class="rounded-lg border border-stone-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
							{#if mine}
								<LibraryPhotoEditor
									photo={mine}
									{cars}
									{busy}
									{setBusy}
									{notify}
									reload={() => load(true)}
									showShare={true}
									shareCarName={publicCarName(photo)}
									carPageHref={carHref(photo.photoId)}
								/>
							{:else}
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
									<ShareCar shareId={photo.photoId} carName={publicCarName(photo)} compact />
									<a class="mt-1 inline-block text-xs font-medium text-amber-800 underline dark:text-amber-300" href={carHref(photo.photoId)} data-testid="car-page-link">Car page</a>
								</div>
							{/if}
						</li>
					{/each}
				{/if}
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
				<ShareCar shareId={open.photoId} carName={publicCarName(open)} />
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
