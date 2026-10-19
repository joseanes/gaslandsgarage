<script lang="ts">
	import ShareCar from '$lib/components/ShareCar.svelte';
	import { ownCarName, type SavedCar } from '$lib/photos/browser';
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
	import {
		attachLibraryPhoto,
		deleteVehiclePhoto,
		detachLibraryPhoto,
		renameLibraryPhoto,
		replaceLibraryPhoto,
		type VehiclePhoto
	} from '$lib/services/vehiclePhotos';

	export let photo: VehiclePhoto;
	export let cars: SavedCar[] = [];
	export let busy = false;
	export let showShare = false;
	export let shareCarName = 'Car';
	export let carPageHref = '';
	export let setBusy: (value: boolean) => void = () => undefined;
	export let notify: (message: string, error: boolean) => void = () => undefined;
	export let reload: () => Promise<void> = async () => undefined;

	let sharePick: Record<string, string> = {};
	let attachPick: Record<string, string> = {};

	const fieldClass =
		'mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm text-stone-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

	function pair(teamId: string, vehicleId: string): string {
		return `${teamId}/${vehicleId}`;
	}

	function carLabel(teamId: string, vehicleId: string): string {
		return cars.find((car) => car.teamId === teamId && car.vehicleId === vehicleId)?.label ?? 'Saved car';
	}

	function usedBy(item: VehiclePhoto): string {
		if (item.attachments.length === 0) return 'no cars';
		return item.attachments.map((attachment) => carLabel(attachment.teamId, attachment.vehicleId)).join(', ');
	}

	function availableCars(item: VehiclePhoto): SavedCar[] {
		return cars.filter((car) => !item.attachments.some((attachment) => attachment.teamId === car.teamId && attachment.vehicleId === car.vehicleId));
	}

	function selectedShare(item: VehiclePhoto): string {
		const chosen = sharePick[item.photoId] || pair(item.shareTeamId, item.shareVehicleId);
		return item.attachments.some((attachment) => pair(attachment.teamId, attachment.vehicleId) === chosen) ? chosen : '';
	}

	function sourceFor(item: VehiclePhoto): { teamId: string; vehicleId: string } | null {
		if (item.attachments.length === 0) return null;
		if (item.attachments.length === 1) return item.attachments[0];
		const chosen = selectedShare(item);
		if (!chosen) return null;
		const [teamId, vehicleId] = chosen.split('/');
		return item.attachments.find((attachment) => attachment.teamId === teamId && attachment.vehicleId === vehicleId) ?? null;
	}

	async function run(task: () => Promise<void>, pending: string, fallback: string) {
		if (busy) return;
		setBusy(true);
		notify(pending, false);
		try {
			await task();
			notify('', false);
			await reload();
		} catch (error) {
			notify(error instanceof Error ? error.message : fallback, true);
		} finally {
			setBusy(false);
		}
	}

	async function saveCaption(caption: string) {
		await run(() => renameLibraryPhoto(photo.photoId, caption), 'Saving caption...', 'That caption could not be saved.');
	}

	async function saveFlags(patch: Partial<ShareFlags>) {
		const source = sourceFor(photo);
		if (!source) {
			notify('Attach this photo to a car before sharing it.', true);
			return;
		}
		const next: ShareFlags = {
			showToBuddies: photo.showToBuddies,
			showOnShareLink: photo.showOnShareLink,
			showInGallery: photo.showInGallery,
			shareVehicleStats: photo.shareVehicleStats,
			...patch
		};
		await run(() => setPhotoSharing(photo.photoId, next, source), 'Saving sharing...', 'That sharing choice could not be saved.');
	}

	async function changeShareCar(value: string) {
		sharePick = { ...sharePick, [photo.photoId]: value };
		if (!(photo.showToBuddies || photo.showOnShareLink || photo.showInGallery)) return;
		const [teamId, vehicleId] = value.split('/');
		const source = photo.attachments.find((attachment) => attachment.teamId === teamId && attachment.vehicleId === vehicleId);
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

	async function attach() {
		const value = attachPick[photo.photoId] ?? '';
		const [teamId, vehicleId] = value.split('/');
		if (!teamId || !vehicleId) {
			notify('Choose a car to attach this photo to.', true);
			return;
		}
		await run(() => attachLibraryPhoto(photo.photoId, teamId, vehicleId), 'Attaching photo...', 'That photo could not be attached.');
	}

	async function detach(teamId: string, vehicleId: string) {
		await run(
			() => detachLibraryPhoto(photo.photoId, teamId, vehicleId),
			'Removing photo from that car...',
			'That photo could not be removed from that car.'
		);
	}

	async function replace(file: File) {
		await run(() => replaceLibraryPhoto(photo, file), 'Replacing photo...', 'That photo could not be replaced.');
	}

	async function remove() {
		if (busy) return;
		const names = usedBy(photo);
		if (!confirm(`Delete this photo? It is on: ${names}. The file and every shared copy will be removed.`)) return;
		await run(() => deleteVehiclePhoto(photo), 'Deleting photo...', 'That photo could not be deleted.');
	}

	function checked(event: Event): boolean {
		return event.currentTarget instanceof HTMLInputElement && event.currentTarget.checked;
	}
</script>

<article class="rounded-lg border border-stone-300 bg-white p-3 dark:border-gray-600 dark:bg-gray-900" data-testid="library-photo">
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
				void saveCaption(value);
			}}
		/>
	</label>
	<p class="mt-2 text-xs text-stone-600 dark:text-gray-300" data-testid="photo-used-by">On: {usedBy(photo)}</p>
	<ul class="mt-1 space-y-1">
		{#each photo.attachments as attachment (attachment.teamId + attachment.vehicleId)}
			<li class="flex items-center justify-between gap-2 text-xs">
				<span>{carLabel(attachment.teamId, attachment.vehicleId)}</span>
				<button type="button" class="text-amber-800 underline dark:text-amber-200" data-testid="detach-photo" disabled={busy} on:click={() => detach(attachment.teamId, attachment.vehicleId)}>
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
						void changeShareCar(value);
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
				<input type="checkbox" class="mt-0.5" data-testid="share-buddies" checked={photo.showToBuddies} on:change={(event) => saveFlags({ showToBuddies: checked(event) })} />
				{SHARE_BUDDIES_LABEL}
			</label>
			<label class="flex items-start gap-2 text-xs">
				<input type="checkbox" class="mt-0.5" data-testid="library-share-link" checked={photo.showOnShareLink} on:change={(event) => saveFlags({ showOnShareLink: checked(event) })} />
				{SHARE_LINK_LABEL}
			</label>
			<label class="flex items-start gap-2 text-xs">
				<input type="checkbox" class="mt-0.5" data-testid="share-gallery" checked={photo.showInGallery} on:change={(event) => saveFlags({ showInGallery: checked(event) })} />
				{SHARE_GALLERY_LABEL}
			</label>
			<p class="text-xs leading-snug text-stone-600 dark:text-gray-300">{GALLERY_SHARE_COPY}</p>
			<label class="flex items-start gap-2 text-xs">
				<input type="checkbox" class="mt-0.5" data-testid="share-stats" checked={photo.shareVehicleStats} on:change={(event) => saveFlags({ shareVehicleStats: checked(event) })} />
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
			<button type="button" class="rounded-md px-3 py-2 text-sm amber-button" data-testid="attach-photo" disabled={busy} on:click={attach}>Attach</button>
		</div>
	{/if}

	{#if showShare}
		<div class="mt-3">
			<ShareCar shareId={photo.photoId} carName={shareCarName || ownCarName(photo.attachments, cars)} compact />
			{#if carPageHref}
				<a class="mt-1 inline-block text-xs font-medium text-amber-800 underline dark:text-amber-300" href={carPageHref} data-testid="car-page-link">Car page</a>
			{/if}
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
				if (file) void replace(file);
			}}
		/>
	</label>
	<button type="button" class="mt-2 block text-xs text-red-800 underline dark:text-red-200" data-testid="delete-library-photo" disabled={busy} on:click={remove}>
		Delete photo
	</button>
</article>
