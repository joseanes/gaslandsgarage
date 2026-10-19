/**
 * Photos page filters. The Gallery and My Photos are one page.
 * A player filter accepts a Gaslands display name only.
 */

import { publicDisplayName } from '../buddies/model';

export type PhotoView = 'all' | 'mine' | 'player';
export type PhotoSort = 'newest' | 'oldest' | 'cans-high' | 'cans-low' | 'used';

export interface PhotoBrowserState {
	view: PhotoView;
	playerName: string;
	vehicleType: string;
	sort: PhotoSort;
	search: string;
}

export interface SortablePhoto {
	createdAt: string;
	carName: string;
	usedCount: number;
}

export interface SavedCar {
	teamId: string;
	vehicleId: string;
	label: string;
	vehicleType: string;
	carName: string;
}

const SORTS: PhotoSort[] = ['newest', 'oldest', 'cans-high', 'cans-low', 'used'];

export function parsePhotoBrowser(params: URLSearchParams): PhotoBrowserState {
	const viewRaw = params.get('view');
	const view: PhotoView = viewRaw === 'mine' ? 'mine' : viewRaw === 'player' ? 'player' : 'all';
	const sortRaw = params.get('sort');
	const sort: PhotoSort = SORTS.includes(sortRaw as PhotoSort) ? (sortRaw as PhotoSort) : 'newest';
	const type = (params.get('type') ?? 'All').trim().replace(/\s+/g, ' ');
	const search = (params.get('q') ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
	return {
		view,
		playerName: view === 'player' ? (publicDisplayName(params.get('name')) ?? '') : '',
		vehicleType: type.length > 0 ? type.slice(0, 80) : 'All',
		sort,
		search
	};
}

/** Query string for the Photos page. Defaults stay off the URL. `fixture=1` is kept for local previews. */
export function photoBrowserSearch(state: PhotoBrowserState, current?: URLSearchParams): string {
	const params = new URLSearchParams();
	if (current?.get('fixture') === '1') params.set('fixture', '1');
	if (state.view !== 'all') params.set('view', state.view);
	if (state.view === 'player' && state.playerName) params.set('name', state.playerName);
	if (state.vehicleType && state.vehicleType !== 'All') params.set('type', state.vehicleType);
	if (state.sort !== 'newest') params.set('sort', state.sort);
	if (state.search) params.set('q', state.search);
	const query = params.toString();
	return query ? `?${query}` : '';
}

export function comparePhotos(sort: PhotoSort, a: SortablePhoto, b: SortablePhoto): number {
	const byTime = b.createdAt.localeCompare(a.createdAt);
	const byName = a.carName.localeCompare(b.carName, undefined, { sensitivity: 'base' });
	if (sort === 'oldest') return -byTime || byName;
	if (sort === 'used') return b.usedCount - a.usedCount || byTime || byName;
	return byTime || byName;
}

export function sortPhotos<T>(items: T[], sort: PhotoSort, key: (item: T) => SortablePhoto): T[] {
	return items.slice().sort((a, b) => comparePhotos(sort, key(a), key(b)));
}

export function matchesVehicleType(types: string[], selected: string): boolean {
	if (!selected || selected === 'All') return true;
	return types.includes(selected);
}

export function typeChoices(types: string[], selected: string): string[] {
	const unique = Array.from(new Set(types.filter((type) => type.trim().length > 0))).sort((a, b) =>
		a.localeCompare(b, undefined, { sensitivity: 'base' })
	);
	if (selected !== 'All' && selected.length > 0 && !unique.includes(selected)) unique.push(selected);
	return ['All', ...unique];
}

export function attachmentVehicleTypes(
	attachments: { teamId: string; vehicleId: string }[],
	cars: SavedCar[]
): string[] {
	const types: string[] = [];
	for (const item of attachments) {
		const car = cars.find((candidate) => candidate.teamId === item.teamId && candidate.vehicleId === item.vehicleId);
		if (car?.vehicleType) types.push(car.vehicleType);
	}
	return types;
}

export function ownCarName(attachments: { teamId: string; vehicleId: string }[], cars: SavedCar[]): string {
	const first = attachments[0];
	if (!first) return 'Car';
	const car = cars.find((candidate) => candidate.teamId === first.teamId && candidate.vehicleId === first.vehicleId);
	return car?.carName || car?.vehicleType || 'Car';
}
