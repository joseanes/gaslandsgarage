import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	attachmentVehicleTypes,
	comparePhotos,
	matchesVehicleType,
	ownCarName,
	parsePhotoBrowser,
	photoBrowserSearch,
	sortPhotos,
	typeChoices,
	type SavedCar
} from './browser';

const cars: SavedCar[] = [
	{ teamId: 'team1', vehicleId: 'car1', label: 'Rust Runners: Rust Rocket', vehicleType: 'Performance Car', carName: 'Rust Rocket' },
	{ teamId: 'team1', vehicleId: 'car2', label: 'Rust Runners: Hauler', vehicleType: 'Truck', carName: 'Hauler' }
];

describe('photo browser', () => {
	it('reads the Photos filters from the query string', () => {
		expect(parsePhotoBrowser(new URLSearchParams())).toEqual({
			view: 'all',
			playerName: '',
			vehicleType: 'All',
			sort: 'newest'
		});
		expect(parsePhotoBrowser(new URLSearchParams('view=mine&sort=used&type=Buggy'))).toEqual({
			view: 'mine',
			playerName: '',
			vehicleType: 'Buggy',
			sort: 'used'
		});
		expect(parsePhotoBrowser(new URLSearchParams('view=player&name=Casey&sort=car'))).toMatchObject({
			view: 'player',
			playerName: 'Casey',
			sort: 'car'
		});
		expect(parsePhotoBrowser(new URLSearchParams('view=player&name=casey@example.com')).playerName).toBe('');
		expect(parsePhotoBrowser(new URLSearchParams('view=nope&sort=sideways')).sort).toBe('newest');
	});

	it('keeps a local preview flag and drops default filters', () => {
		const current = new URLSearchParams('fixture=1');
		expect(photoBrowserSearch({ view: 'all', playerName: '', vehicleType: 'All', sort: 'newest' }, current)).toBe('?fixture=1');
		expect(
			photoBrowserSearch({ view: 'player', playerName: 'Casey', vehicleType: 'Truck', sort: 'oldest' }, current)
		).toBe('?fixture=1&view=player&name=Casey&type=Truck&sort=oldest');
		expect(photoBrowserSearch({ view: 'mine', playerName: 'Casey', vehicleType: 'All', sort: 'newest' })).toBe('?view=mine');
	});

	it('sorts by newest, oldest, car name, and how many cars use the photo', () => {
		const photos = [
			{ id: 'old', createdAt: '2026-01-01T00:00:00.000Z', carName: 'Zig', usedCount: 1 },
			{ id: 'new', createdAt: '2026-06-01T00:00:00.000Z', carName: 'alpha', usedCount: 0 },
			{ id: 'busy', createdAt: '2026-03-01T00:00:00.000Z', carName: 'Mid', usedCount: 3 }
		];
		expect(sortPhotos(photos, 'newest', (photo) => photo).map((photo) => photo.id)).toEqual(['new', 'busy', 'old']);
		expect(sortPhotos(photos, 'oldest', (photo) => photo).map((photo) => photo.id)).toEqual(['old', 'busy', 'new']);
		expect(sortPhotos(photos, 'car', (photo) => photo).map((photo) => photo.id)).toEqual(['new', 'busy', 'old']);
		expect(sortPhotos(photos, 'used', (photo) => photo).map((photo) => photo.id)).toEqual(['busy', 'old', 'new']);
		expect(comparePhotos('used', photos[1], photos[0])).toBeGreaterThan(0);
	});

	it('filters by vehicle type and names an owned car from its first attachment', () => {
		expect(matchesVehicleType(['Truck'], 'All')).toBe(true);
		expect(matchesVehicleType(['Truck'], 'Truck')).toBe(true);
		expect(matchesVehicleType([], 'Truck')).toBe(false);
		expect(typeChoices(['Truck', 'Performance Car', 'Truck'], 'Buggy')).toEqual(['All', 'Performance Car', 'Truck', 'Buggy']);
		expect(attachmentVehicleTypes([{ teamId: 'team1', vehicleId: 'car2' }], cars)).toEqual(['Truck']);
		expect(ownCarName([{ teamId: 'team1', vehicleId: 'car1' }], cars)).toBe('Rust Rocket');
		expect(ownCarName([], cars)).toBe('Car');
	});

	it('adds the player-name index and leaves the full Gallery index in place', () => {
		const indexes = JSON.parse(readFileSync(resolve(process.cwd(), '../firestore.indexes.json'), 'utf8')) as {
			indexes: { collectionGroup: string; fields: { fieldPath: string; order?: string }[] }[];
		};
		const shared = indexes.indexes.filter((index) => index.collectionGroup === 'sharedPhotos');
		const fields = shared.map((index) => index.fields.map((field) => `${field.fieldPath}:${field.order}`).join(','));
		expect(fields).toContain('showInGallery:ASCENDING,hidden:ASCENDING,published:ASCENDING,createdAt:DESCENDING');
		expect(fields).toContain(
			'showInGallery:ASCENDING,hidden:ASCENDING,published:ASCENDING,displayName:ASCENDING,createdAt:DESCENDING'
		);
	});
});
