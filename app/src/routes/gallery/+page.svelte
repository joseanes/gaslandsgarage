<script lang="ts">
	import { onMount } from 'svelte';
	import { dev } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import GalleryBuddyButton from '$lib/components/GalleryBuddyButton.svelte';
	import GalleryCardFace from '$lib/components/GalleryCardFace.svelte';
	import GalleryUploadDialog from '$lib/components/GalleryUploadDialog.svelte';
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
	import { galleryCarName, galleryVehicleTypes, selectGalleryPage, type GalleryListRequest } from '$lib/photos/galleryQuery';
	import { MAX_PHOTOS_PER_ACCOUNT, PHOTO_ID_PATTERN } from '$lib/photos/model';
	import { galleryKeywords, gallerySearchToken, vehicleTypeLabel } from '$lib/photos/share';
	import { listGalleryPhotosPage, loadPublicCar, reportSharedPhoto, type GalleryPhoto } from '$lib/services/photoShare';
	import { getUserTeams } from '$lib/services/team';
	import {
		cleanupMyPhotoOrphans,
		listMyPhotos,
		migrateMyPhotoLibrary,
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
	let searchDraft = '';
	let seenSearch = '';
	let open: GalleryPhoto | null = null;
	let notice = '';
	let noticeError = false;
	let busy = false;
	let paging = false;
	let hasMore = false;
	let pageCursor: unknown = null;
	let fixturePage = 0;
	let fixtureDeck: GalleryPhoto[] | null = null;
	let appliedKey = '';
	let addOpen = false;
	let ticket = 0;
	let keepNotice = false;
	let density: 'photos' | 'details' = 'details';
	let revealedId = '';
	let openedPhoto = '';

	const DENSITY_KEY = 'gaslands-gallery-density';

	const fieldClass =
		'rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

	$: state = parsePhotoBrowser($page.url.searchParams);
	$: if (state.playerName !== seenName) {
		seenName = state.playerName;
		nameDraft = state.playerName;
	}
	$: if (state.search !== seenSearch) {
		seenSearch = state.search;
		searchDraft = state.search;
	}
	$: fixtureOn = dev && $page.url.searchParams.get('fixture') === '1';
	$: loadKey = `${$user?.uid ?? 'anon'}|${state.view}|${state.playerName}|${state.vehicleType}|${state.sort}|${state.search}|${fixtureOn ? '1' : '0'}`;
	$: if (loadKey !== appliedKey) {
		appliedKey = loadKey;
		void load(false);
	}
	$: photoLink = $page.url.searchParams.get('photo') ?? '';
	$: if (status !== 'loading' && photoLink && photoLink !== openedPhoto && PHOTO_ID_PATTERN.test(photoLink)) {
		openedPhoto = photoLink;
		void openSharedPhoto(photoLink);
	}
	$: showingMine = state.view === 'mine';
	$: sortShown = shownSort(state.sort, showingMine);

	onMount(() => {
		try {
			const saved = localStorage.getItem(DENSITY_KEY);
			if (saved === 'photos' || saved === 'details') density = saved;
		} catch {
			/* private browsing */
		}
	});

	function chooseDensity(next: 'photos' | 'details') {
		density = next;
		revealedId = '';
		try {
			localStorage.setItem(DENSITY_KEY, next);
		} catch {
			/* private browsing */
		}
	}

	function photoFromCar(car: NonNullable<Awaited<ReturnType<typeof loadPublicCar>>>): GalleryPhoto {
		return {
			photoId: car.shareId,
			displayName: car.displayName,
			vehicleType: car.vehicleType,
			teamName: car.teamName,
			caption: car.caption,
			createdAt: '',
			url: car.imageUrl,
			vehicleStats: car.vehicleStats,
			paintingUrl: car.paintingUrl
		};
	}

	async function openSharedPhoto(id: string) {
		const found = publicPhotos.find((photo) => photo.photoId === id);
		if (found) {
			open = found;
			return;
		}
		try {
			const car = await loadPublicCar(id);
			if (car) open = photoFromCar(car);
		} catch {
			/* the card stays closed when the photo is not public */
		}
	}

	function openPhoto(photo: GalleryPhoto, event: MouseEvent) {
		const fromKeyboard = event.detail === 0;
		const coarse = window.matchMedia('(hover: none)').matches;
		if (!fromKeyboard && density === 'photos' && coarse && revealedId !== photo.photoId) {
			revealedId = photo.photoId;
			return;
		}
		open = photo;
	}

	/** Cards are links to the car page so they keep their size (global button rules clamp buttons to 32px). A plain click opens the lightbox; modified clicks open the car page. */
	function openCard(photo: GalleryPhoto, event: MouseEvent) {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
		event.preventDefault();
		openPhoto(photo, event);
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

	function shownSort(sort: PhotoSort, mine: boolean): PhotoSort {
		if (mine) return sort === 'oldest' || sort === 'used' ? sort : 'newest';
		return sort === 'oldest' || sort === 'cans-high' || sort === 'cans-low' ? sort : 'newest';
	}

	function galleryRequest(browserState: PhotoBrowserState): GalleryListRequest {
		const sort = shownSort(browserState.sort, false);
		return {
			sort: sort === 'oldest' || sort === 'cans-high' || sort === 'cans-low' ? sort : 'newest',
			vehicleType: browserState.vehicleType,
			displayName: browserState.view === 'player' ? browserState.playerName : '',
			search: browserState.search
		};
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

	function commitSearch(value: string) {
		notify('', false);
		setState({ search: value.trim().replace(/\s+/g, ' ').slice(0, 40) });
	}

	function closeOnEscape(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		if (addOpen) {
			addOpen = false;
			return;
		}
		if (open) open = null;
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

	function applyFixture(browserState: PhotoBrowserState, pageIndex: number, append: boolean) {
		if (!fixtureDeck) return;
		const result = selectGalleryPage(fixtureDeck, galleryRequest(browserState), pageIndex);
		publicPhotos = append ? [...publicPhotos, ...result.photos] : result.photos;
		fixturePage = pageIndex + 1;
		hasMore = result.hasMore;
		pageCursor = null;
		rememberNames(fixtureDeck);
	}

	async function load(quiet: boolean) {
		const current = ++ticket;
		const browserState = parsePhotoBrowser($page.url.searchParams);
		const fixture = dev && $page.url.searchParams.get('fixture') === '1';
		const signedIn = Boolean($user);
		const preserveNotice = keepNotice;
		keepNotice = false;
		if (!quiet && !preserveNotice) notice = '';
		pageCursor = null;
		fixturePage = 0;
		hasMore = false;
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
		if (browserState.view === 'player' && !browserState.playerName) {
			if (current !== ticket) return;
			publicPhotos = [];
			open = null;
			status = 'ready';
			return;
		}
		if (!quiet) status = 'loading';
		try {
			if (browserState.view === 'mine') {
				await migrateMyPhotoLibrary().catch(() => undefined);
				await cleanupMyPhotoOrphans().catch(() => undefined);
				if (current !== ticket) return;
				library = await listMyPhotos();
				cars = await loadCars();
				publishedIds = await publishedShareIds(library);
				publicPhotos = [];
			} else if (fixture) {
				if (!fixtureDeck) fixtureDeck = (await import('$lib/photos/carPageFixture')).sampleGalleryDeck();
				if (current !== ticket) return;
				applyFixture(browserState, 0, false);
			} else {
				const pageResult = await listGalleryPhotosPage(galleryRequest(browserState));
				if (current !== ticket) return;
				publicPhotos = pageResult.photos;
				pageCursor = pageResult.cursor;
				hasMore = pageResult.hasMore;
				rememberNames(pageResult.photos);
			}
			if (current !== ticket) return;
			if (open && !publicPhotos.some((photo) => photo.photoId === open?.photoId)) open = null;
			status = 'ready';
		} catch (error) {
			console.error('Could not load photos', error);
			if (current !== ticket) return;
			status = 'error';
		}
	}

	async function loadMore() {
		if (!hasMore || paging || showingMine) return;
		const current = ticket;
		const browserState = parsePhotoBrowser($page.url.searchParams);
		paging = true;
		try {
			if (dev && $page.url.searchParams.get('fixture') === '1') {
				applyFixture(browserState, fixturePage, true);
			} else {
				const pageResult = await listGalleryPhotosPage(galleryRequest(browserState), pageCursor);
				if (current !== ticket) return;
				const seen = new Set(publicPhotos.map((photo) => photo.photoId));
				publicPhotos = [...publicPhotos, ...pageResult.photos.filter((photo) => !seen.has(photo.photoId))];
				pageCursor = pageResult.cursor;
				hasMore = pageResult.hasMore;
				rememberNames(pageResult.photos);
			}
		} catch (error) {
			if (current !== ticket) return;
			notify(error instanceof Error ? error.message : 'More photos could not be loaded.', true);
		} finally {
			if (current === ticket) paging = false;
		}
	}

	function carHref(photoId: string): string {
		const preview = dev && $page.url.searchParams.get('fixture') === '1' ? '?fixture=1' : '';
		return `/car/${photoId}${preview}`;
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

	function libraryMatches(photo: VehiclePhoto): boolean {
		const types = attachmentVehicleTypes(photo.attachments, cars);
		if (!matchesVehicleType(types, state.vehicleType)) return false;
		if (!state.search.trim()) return true;
		const token = gallerySearchToken(state.search);
		if (!token) return false;
		const keywords = galleryKeywords({
			caption: photo.caption,
			carName: ownCarName(photo.attachments, cars),
			vehicleType: types.join(' '),
			displayName: ''
		});
		return keywords.includes(token);
	}

	$: libraryRows = sortPhotos(
		library.filter((photo) => libraryMatches(photo)),
		shownSort(state.sort, true),
		(photo) => ({
			createdAt: photo.createdAt,
			carName: ownCarName(photo.attachments, cars),
			usedCount: photo.attachments.length
		})
	);
	$: typeOptions = typeChoices(
		showingMine
			? [...galleryVehicleTypes(), ...library.flatMap((photo) => attachmentVehicleTypes(photo.attachments, cars))]
			: galleryVehicleTypes(),
		state.vehicleType
	);
	$: visibleCount = showingMine ? libraryRows.length : publicPhotos.length;
	$: sourceCount = showingMine ? library.length : publicPhotos.length;
</script>

<svelte:head>
	<title>Photos - Gaslands Garage</title>
	<meta name="description" content="Photos of painted Gaslands cars. Your photos, or the ones players published to the Gallery." />
</svelte:head>

<svelte:window on:keydown={closeOnEscape} />

<section class="mx-auto max-w-[90rem] px-3 py-8 text-stone-800 dark:text-gray-100" data-testid="gallery-page">
	<div class="relative mb-5 overflow-hidden rounded-2xl border border-orange-900/60 bg-stone-950 px-5 py-6 text-orange-50 shadow-xl shadow-orange-950/20">
		<div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(234,88,12,0.42),transparent_46%),radial-gradient(circle_at_bottom_right,rgba(120,53,15,0.55),transparent_42%)]"></div>
		<div class="pointer-events-none absolute inset-0 opacity-30 [background-image:repeating-linear-gradient(135deg,rgba(255,255,255,0.05)_0_1px,transparent_1px_8px)]"></div>
			<div class="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<p class="text-xs font-bold uppercase tracking-[0.22em] text-orange-300">The wastes</p>
				<h1 class="text-4xl font-black tracking-tight">Photos</h1>
				<p class="mt-2 max-w-xl text-sm text-orange-100/85">
					Painted cars from the wastes. My photos is your own stack. Anyone else only sees a car a player published to the Gallery.
				</p>
			</div>
			<div class="flex shrink-0 flex-col items-start gap-3 sm:items-end">
				{#if $user}
					<button
						type="button"
						class="rounded-full bg-orange-500 px-5 py-2.5 text-sm font-black uppercase tracking-wide text-stone-950 shadow-lg shadow-orange-950/40"
						data-testid="add-photo"
						on:click={() => {
							open = null;
							addOpen = true;
						}}
					>
						Add photo
					</button>
				{:else}
					<button
						type="button"
						class="rounded-full border border-orange-300 bg-stone-950/80 px-5 py-2.5 text-sm font-bold text-orange-50"
						data-testid="add-photo-sign-in"
						on:click={requestSignIn}
					>
						Sign in to add a photo
					</button>
				{/if}
				{#if !showingMine}
				<div class="inline-flex shrink-0 rounded-full border border-orange-800/80 bg-stone-950/80 p-1" role="group" aria-label="Gallery layout" data-testid="gallery-density">
					<button
						type="button"
						class="rounded-full px-3 py-1.5 text-sm font-semibold {density === 'photos' ? 'bg-orange-500 text-stone-950' : 'text-orange-100'}"
						aria-pressed={density === 'photos'}
						data-testid="gallery-photos-only"
						on:click={() => chooseDensity('photos')}
					>
						Photos only
					</button>
					<button
						type="button"
						class="rounded-full px-3 py-1.5 text-sm font-semibold {density === 'details' ? 'bg-orange-500 text-stone-950' : 'text-orange-100'}"
						aria-pressed={density === 'details'}
						data-testid="gallery-with-details"
						on:click={() => chooseDensity('details')}
					>
						With details
					</button>
				</div>
				{/if}
			</div>
		</div>
	</div>
	<p class="mb-4 max-w-2xl text-xs text-stone-500 dark:text-gray-400">
		Search matches one word. Cars shared before that word list existed still appear here, and join search or a cans sort the next time they are saved.
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
				value={sortShown}
				on:change={(event) => {
					const sort = event.currentTarget instanceof HTMLSelectElement ? (event.currentTarget.value as PhotoSort) : 'newest';
					setState({ sort });
				}}
			>
				<option value="newest">Newest</option>
				<option value="oldest">Oldest</option>
				{#if showingMine}
					<option value="used">Most used</option>
				{:else}
					<option value="cans-high">Cans, high</option>
					<option value="cans-low">Cans, low</option>
				{/if}
			</select>
		</label>
		<label class="text-sm">
			Search
			<input
				class="{fieldClass} ml-2"
				data-testid="gallery-search"
				placeholder="One word"
				aria-label="Search photos"
				value={searchDraft}
				on:input={(event) => {
					searchDraft = event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : '';
				}}
				on:change={(event) => {
					if (event.currentTarget instanceof HTMLInputElement) commitSearch(event.currentTarget.value);
				}}
				on:keydown={(event) => {
					if (event.key === 'Enter' && event.currentTarget instanceof HTMLInputElement) {
						event.preventDefault();
						commitSearch(event.currentTarget.value);
					}
				}}
			/>
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
		{/if}

		{#if sourceCount === 0}
			{#if showingMine}
				<p data-testid="photo-library-empty">No photos yet.</p>
			{:else if state.view === 'player' && !state.playerName}
				<p>Choose a Gaslands display name.</p>
			{:else if state.search.trim()}
				<p>No photos match that search.</p>
			{:else if state.vehicleType !== 'All'}
				<p>No photos of that vehicle type.</p>
			{:else if state.view === 'player'}
				<p>No shared photos for that player.</p>
			{:else}
				<p data-testid="gallery-empty">No shared photos yet.</p>
			{/if}
		{:else if visibleCount === 0}
			<p>{state.search.trim() ? 'No photos match that search.' : 'No photos of that vehicle type.'}</p>
		{:else if showingMine}
			<ul class="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="photo-library">
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
			</ul>
		{:else}
			<ul
				class={density === 'photos'
					? 'grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
					: 'grid grid-cols-1 items-start gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5'}
				data-testid="gallery-grid"
				data-density={density}
			>
				{#each publicPhotos as photo (photo.photoId)}
					<li class="gallery-tile" class:is-revealed={density === 'photos' && revealedId === photo.photoId}>
						{#if density === 'photos'}
							<div class="photo-only-hit">
								<a
									href={carHref(photo.photoId)}
									class="photo-hit absolute inset-0 z-0 block h-full w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
									class:is-revealed={revealedId === photo.photoId}
									data-testid="gallery-card"
									aria-label="Open {galleryCarName(photo)} by {photo.displayName}"
									on:click={(event) => openCard(photo, event)}
								>
									<GalleryCardFace {photo} photosOnly />
								</a>
							</div>
						{:else}
							<a
								href={carHref(photo.photoId)}
								class="photo-hit group block h-full w-full rounded-xl text-left transition duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-orange-950/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
								data-testid="gallery-card"
								aria-label="Open {galleryCarName(photo)} by {photo.displayName}"
								on:click={(event) => openCard(photo, event)}
							>
								<GalleryCardFace {photo} />
							</a>
						{/if}
					</li>
				{/each}
			</ul>
			{#if hasMore}
				<div class="mt-6 flex justify-center">
					<button type="button" class="rounded-md px-4 py-2 text-sm amber-button" data-testid="gallery-load-more" disabled={paging} on:click={() => void loadMore()}>
						{paging ? 'Loading…' : 'Load more'}
					</button>
				</div>
			{/if}
		{/if}
	{/if}
</section>

<style>
	.gallery-tile {
		position: relative;
	}
	.photo-only-hit {
		position: relative;
		width: 100%;
		aspect-ratio: 1 / 1;
		overflow: hidden;
		border-radius: 6px;
		background: #1c1917;
	}
	.photo-only-hit :global(.photo-frame) {
		position: absolute;
		inset: 0;
		height: 100%;
	}
	.gallery-tile :global(.photo-meta) {
		opacity: 0;
		transition: opacity 160ms ease;
	}
	.gallery-tile:hover :global(.photo-meta),
	.gallery-tile:focus-within :global(.photo-meta),
	.gallery-tile.is-revealed :global(.photo-meta) {
		opacity: 1;
	}
</style>

{#if addOpen}
	<GalleryUploadDialog
		onClose={() => (addOpen = false)}
		onSaved={(message) => {
			addOpen = false;
			notify(message, false);
			void load(true);
		}}
	/>
{/if}

{#if open}
	<div class="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/80 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Shared photo" data-testid="gallery-lightbox">
		<div class="max-h-full w-full max-w-xl overflow-auto">
			<GalleryCardFace photo={open} layout="detail" />
			<div class="mt-3 rounded-xl border border-orange-900/60 bg-stone-950 p-4 text-orange-50">
				<ShareCar shareId={open.photoId} carName={galleryCarName(open)} imageUrl={open.url} />
				<div class="mt-4 flex flex-wrap gap-2">
					<a class="rounded-md border border-orange-800 px-3 py-2 text-sm text-orange-100" href={carHref(open.photoId)} data-testid="car-page-link">Car page</a>
					<GalleryBuddyButton photoId={open.photoId} />
					<button type="button" class="rounded-md px-3 py-2 text-sm amber-button" data-testid="report-photo" disabled={busy} on:click={() => open && report(open)}>
						{$user ? 'Report photo' : 'Sign in to report'}
					</button>
					<button type="button" class="rounded-md border border-orange-800 px-3 py-2 text-sm text-orange-100" on:click={() => (open = null)}>
						Close
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
