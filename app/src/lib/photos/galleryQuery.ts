/**
 * Public Gallery query. Equality filters and one keyword stay on the server.
 * A page is 24 photos plus a cursor. My photos is a separate, capped library.
 */

import legacyVehicles from '../../data/rules/vehicles.json';
import { v3Vehicles } from '../../data/rules/v3/vehicles';
import { publicDisplayName } from '../buddies/model';
import { GALLERY_PAGE_SIZE, galleryKeywords, gallerySearchToken, vehicleTypeLabel, type VehicleStatsSnapshot } from './share';

export type GallerySort = 'newest' | 'oldest' | 'cans-high' | 'cans-low';

export interface GalleryListRequest {
	sort: GallerySort;
	vehicleType: string;
	displayName: string;
	search: string;
}

export interface GalleryQueryClause {
	kind: 'eq' | 'contains' | 'order';
	field: string;
	value?: string | boolean;
	direction?: 'asc' | 'desc';
}

export interface GalleryIndexField {
	fieldPath: string;
	order?: 'ASCENDING' | 'DESCENDING';
	arrayConfig?: 'CONTAINS';
}

export interface GalleryListItem {
	photoId: string;
	displayName: string;
	vehicleType: string;
	caption: string;
	createdAt: string;
	vehicleStats: Pick<VehicleStatsSnapshot, 'name' | 'cans' | 'weapons'> | null;
}

const SORTS: { sort: GallerySort; field: string; direction: 'asc' | 'desc'; order: 'ASCENDING' | 'DESCENDING' }[] = [
	{ sort: 'newest', field: 'createdAt', direction: 'desc', order: 'DESCENDING' },
	{ sort: 'oldest', field: 'createdAt', direction: 'asc', order: 'ASCENDING' },
	{ sort: 'cans-high', field: 'cans', direction: 'desc', order: 'DESCENDING' },
	{ sort: 'cans-low', field: 'cans', direction: 'asc', order: 'ASCENDING' }
];

export function galleryVehicleTypes(): string[] {
	const labels = new Set<string>();
	for (const vehicle of legacyVehicles) {
		if (vehicle.name) labels.add(vehicle.name);
		labels.add(vehicleTypeLabel(vehicle.id));
	}
	for (const vehicle of v3Vehicles) {
		if (vehicle.name) labels.add(vehicle.name);
		labels.add(vehicleTypeLabel(vehicle.id));
	}
	return [...labels].filter((label) => label && label !== 'Vehicle').sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function galleryCarName(photo: { vehicleType: string; caption: string; vehicleStats: { name?: string } | null }): string {
	const named = photo.vehicleStats?.name?.trim();
	if (named) return named;
	const caption = photo.caption.trim();
	if (caption) return caption;
	return photo.vehicleType || 'Car';
}

export function emptyGalleryRequest(): GalleryListRequest {
	return { sort: 'newest', vehicleType: '', displayName: '', search: '' };
}

/** Server constraints in index order. An unusable name or search word yields no query. */
export function galleryQueryPlan(request: GalleryListRequest): GalleryQueryClause[] | null {
	const displayName = request.displayName ? publicDisplayName(request.displayName) : '';
	if (request.displayName && !displayName) return null;
	const token = request.search ? gallerySearchToken(request.search) : '';
	if (request.search.trim() && !token) return null;
	const sort = SORTS.find((item) => item.sort === request.sort) ?? SORTS[0];
	const vehicleType = request.vehicleType.trim();
	const clauses: GalleryQueryClause[] = [
		{ kind: 'eq', field: 'showInGallery', value: true },
		{ kind: 'eq', field: 'hidden', value: false },
		{ kind: 'eq', field: 'published', value: true }
	];
	if (vehicleType && vehicleType !== 'All') clauses.push({ kind: 'eq', field: 'vehicleType', value: vehicleType });
	if (displayName) clauses.push({ kind: 'eq', field: 'displayName', value: displayName });
	if (token) clauses.push({ kind: 'contains', field: 'keywords', value: token });
	clauses.push({ kind: 'order', field: sort.field, direction: sort.direction });
	return clauses;
}

function equalityExtras(vehicleType: boolean, displayName: boolean, keyword: boolean): GalleryIndexField[] {
	const fields: GalleryIndexField[] = [];
	if (vehicleType) fields.push({ fieldPath: 'vehicleType', order: 'ASCENDING' });
	if (displayName) fields.push({ fieldPath: 'displayName', order: 'ASCENDING' });
	if (keyword) fields.push({ fieldPath: 'keywords', arrayConfig: 'CONTAINS' });
	return fields;
}

/** Every composite index the Gallery query can use. Equality fields, then the keyword, then the sort. */
export function requiredSharedPhotoIndexes(): GalleryIndexField[][] {
	const base: GalleryIndexField[] = [
		{ fieldPath: 'showInGallery', order: 'ASCENDING' },
		{ fieldPath: 'hidden', order: 'ASCENDING' },
		{ fieldPath: 'published', order: 'ASCENDING' }
	];
	const filters = [
		{ vehicleType: false, displayName: false, keyword: false },
		{ vehicleType: true, displayName: false, keyword: false },
		{ vehicleType: false, displayName: true, keyword: false },
		{ vehicleType: true, displayName: true, keyword: false },
		{ vehicleType: false, displayName: false, keyword: true },
		{ vehicleType: true, displayName: false, keyword: true },
		{ vehicleType: false, displayName: true, keyword: true },
		{ vehicleType: true, displayName: true, keyword: true }
	];
	const indexes: GalleryIndexField[][] = [];
	for (const filter of filters) {
		for (const sort of SORTS) {
			indexes.push([
				...base,
				...equalityExtras(filter.vehicleType, filter.displayName, filter.keyword),
				{ fieldPath: sort.field, order: sort.order }
			]);
		}
	}
	return indexes;
}

function matchesRequest(photo: GalleryListItem, request: GalleryListRequest): boolean {
	const plan = galleryQueryPlan(request);
	if (!plan) return false;
	const vehicleType = request.vehicleType.trim();
	if (vehicleType && vehicleType !== 'All' && photo.vehicleType !== vehicleType) return false;
	if (request.displayName && photo.displayName !== publicDisplayName(request.displayName)) return false;
	const token = request.search ? gallerySearchToken(request.search) : '';
	if (request.search.trim()) {
		const keywords = galleryKeywords({
			caption: photo.caption,
			carName: photo.vehicleStats?.name ?? '',
			vehicleType: photo.vehicleType,
			weapons: photo.vehicleStats?.weapons ?? [],
			displayName: photo.displayName
		});
		if (!token || !keywords.includes(token)) return false;
	}
	if ((request.sort === 'cans-high' || request.sort === 'cans-low') && !photo.vehicleStats) return false;
	return true;
}

function compareGallery(sort: GallerySort, a: GalleryListItem, b: GalleryListItem): number {
	const byTime = b.createdAt.localeCompare(a.createdAt) || b.photoId.localeCompare(a.photoId);
	if (sort === 'oldest') return -byTime;
	if (sort === 'cans-high' || sort === 'cans-low') {
		const delta = (a.vehicleStats?.cans ?? 0) - (b.vehicleStats?.cans ?? 0);
		if (sort === 'cans-high') return -delta || byTime;
		return delta || -byTime;
	}
	return byTime;
}

/** Same filter and sort as the Firestore query, paged in memory for the local preview. */
export function selectGalleryPage<T extends GalleryListItem>(
	photos: T[],
	request: GalleryListRequest,
	page: number
): { photos: T[]; hasMore: boolean } {
	const matched = photos.filter((photo) => matchesRequest(photo, request));
	matched.sort((a, b) => compareGallery(request.sort, a, b));
	const start = Math.max(0, page) * GALLERY_PAGE_SIZE;
	const slice = matched.slice(start, start + GALLERY_PAGE_SIZE);
	return { photos: slice, hasMore: start + GALLERY_PAGE_SIZE < matched.length };
}
