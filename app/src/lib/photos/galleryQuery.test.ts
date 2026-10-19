import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GALLERY_PAGE_SIZE } from './share';
import {
	galleryCarName,
	galleryQueryPlan,
	galleryVehicleTypes,
	requiredSharedPhotoIndexes,
	selectGalleryPage,
	type GalleryIndexField,
	type GalleryListItem
} from './galleryQuery';

function card(partial: Partial<GalleryListItem> & Pick<GalleryListItem, 'photoId' | 'createdAt'>): GalleryListItem {
	return {
		displayName: 'Casey',
		vehicleType: 'Performance Car',
		caption: '',
		vehicleStats: { name: partial.photoId, cans: 10, weapons: ['Machine Gun'] },
		...partial
	};
}

describe('gallery query', () => {
	it('pages published cars on the server and refuses an unsafe search', () => {
		expect(GALLERY_PAGE_SIZE).toBe(24);
		expect(galleryQueryPlan({ sort: 'newest', vehicleType: 'All', displayName: '', search: '' })).toEqual([
			{ kind: 'eq', field: 'showInGallery', value: true },
			{ kind: 'eq', field: 'hidden', value: false },
			{ kind: 'eq', field: 'published', value: true },
			{ kind: 'order', field: 'createdAt', direction: 'desc' }
		]);
		expect(
			galleryQueryPlan({ sort: 'cans-low', vehicleType: 'Truck', displayName: 'Casey', search: 'rust rocket' })
		).toEqual([
			{ kind: 'eq', field: 'showInGallery', value: true },
			{ kind: 'eq', field: 'hidden', value: false },
			{ kind: 'eq', field: 'published', value: true },
			{ kind: 'eq', field: 'vehicleType', value: 'Truck' },
			{ kind: 'eq', field: 'displayName', value: 'Casey' },
			{ kind: 'contains', field: 'keywords', value: 'rocket' },
			{ kind: 'order', field: 'cans', direction: 'asc' }
		]);
		expect(galleryQueryPlan({ sort: 'newest', vehicleType: '', displayName: 'casey@example.com', search: '' })).toBeNull();
		expect(galleryQueryPlan({ sort: 'oldest', vehicleType: '', displayName: '', search: '@' })).toBeNull();
	});

	it('returns 24 cards at a time and drops photo-only cars from a cans sort', () => {
		const photos = Array.from({ length: 30 }, (_, index) =>
			card({
				photoId: `card${String(index).padStart(4, '0')}`,
				createdAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
				displayName: index === 29 || index % 2 === 0 ? 'Casey' : 'Riley',
				vehicleType: index === 29 || index % 3 === 0 ? 'Truck' : 'Buggy',
				caption: index === 29 ? 'Rust Rocket' : 'Dust',
				vehicleStats: index !== 29 && index % 5 === 4 ? null : { name: index === 29 ? 'Rust Rocket' : `Car ${index}`, cans: index, weapons: ['Ram'] }
			})
		);
		const first = selectGalleryPage(photos, { sort: 'newest', vehicleType: 'All', displayName: '', search: '' }, 0);
		expect(first.photos).toHaveLength(24);
		expect(first.hasMore).toBe(true);
		expect(first.photos[0]?.photoId).toBe('card0029');
		const second = selectGalleryPage(photos, { sort: 'newest', vehicleType: 'All', displayName: '', search: '' }, 1);
		expect(second.photos).toHaveLength(6);
		expect(second.hasMore).toBe(false);
		const costly = selectGalleryPage(photos, { sort: 'cans-high', vehicleType: '', displayName: '', search: '' }, 0);
		expect(costly.photos.every((photo) => photo.vehicleStats)).toBe(true);
		expect(costly.photos[0]?.vehicleStats?.cans).toBeGreaterThan(costly.photos[1]?.vehicleStats?.cans ?? 0);
		const casey = selectGalleryPage(photos, { sort: 'oldest', vehicleType: 'Truck', displayName: 'Casey', search: 'rocket' }, 0);
		expect(casey.photos.map((photo) => photo.photoId)).toEqual(['card0029']);
		expect(galleryCarName(casey.photos[0])).toBe('Rust Rocket');
		expect(galleryCarName({ vehicleType: 'Bike', caption: '', vehicleStats: null })).toBe('Bike');
		expect(galleryVehicleTypes()).toContain('Performance Car');
		expect(galleryVehicleTypes()).toContain('War Rig');
	});

	it('lists every sharedPhotos composite index the paged query needs', () => {
		const required = requiredSharedPhotoIndexes();
		expect(required).toHaveLength(32);
		const file = JSON.parse(readFileSync(resolve(process.cwd(), '../firestore.indexes.json'), 'utf8')) as {
			indexes: { collectionGroup: string; queryScope: string; fields: GalleryIndexField[] }[];
		};
		const key = (fields: GalleryIndexField[]) =>
			fields.map((field) => (field.arrayConfig ? `${field.fieldPath}:CONTAINS` : `${field.fieldPath}:${field.order}`)).join('|');
		const shared = file.indexes.filter((index) => index.collectionGroup === 'sharedPhotos');
		expect(shared.map((index) => key(index.fields)).sort()).toEqual(required.map((fields) => key(fields)).sort());
		expect(shared.every((index) => index.queryScope === 'COLLECTION')).toBe(true);
		expect(file.indexes.some((index) => index.collectionGroup === 'teams')).toBe(true);
		expect(file.indexes.some((index) => index.collectionGroup === 'buddies')).toBe(true);
	});
});
