import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	displacedVehicleLabel,
	displacedVehicles,
	photoSaveReason,
	readQuickSaveOptions,
	vehicleIdentityList
} from './saveBeforePhoto';

const car = { id: 'car-1', type: 'car', name: 'Rusty', weapons: ['mg'], upgrades: [], perks: [] };
const buggy = { id: 'bug-1', type: 'buggy', name: 'New Vehicle', weapons: [], upgrades: [], perks: [] };

describe('photo save reason', () => {
	it('asks for a first save when the team has never been saved', () => {
		expect(photoSaveReason({ savedTeamId: null, vehicleId: 'car-1', dirty: true, savedVehicleIds: null })).toBe('new-team');
		expect(photoSaveReason({ savedTeamId: '  ', vehicleId: 'car-1', dirty: false, savedVehicleIds: [] })).toBe('new-team');
	});

	it('blocks a car that is not on the saved team, and any unsaved edit', () => {
		expect(
			photoSaveReason({
				savedTeamId: 'team-1',
				vehicleId: 'bug-1',
				dirty: true,
				savedVehicleIds: ['car-1']
			})
		).toBe('vehicle-not-saved');
		expect(
			photoSaveReason({
				savedTeamId: 'team-1',
				vehicleId: 'car-1',
				dirty: true,
				savedVehicleIds: ['car-1']
			})
		).toBe('unsaved-changes');
	});

	it('lets a photo through once the saved team already has this car', () => {
		expect(
			photoSaveReason({
				savedTeamId: 'team-1',
				vehicleId: 'car-1',
				dirty: false,
				savedVehicleIds: ['car-1']
			})
		).toBeNull();
		expect(
			photoSaveReason({
				savedTeamId: 'team-1',
				vehicleId: 'car-1',
				dirty: false,
				savedVehicleIds: []
			})
		).toBeNull();
	});
});

describe('vehicles a save would drop', () => {
	it('stays quiet when the change only adds a car', () => {
		expect(displacedVehicles([car], [car, buggy])).toEqual([]);
		expect(displacedVehicles([car], [{ ...car, name: 'Renamed', weapons: ['cannon'] }, buggy])).toEqual([]);
	});

	it('lists a saved car that would be removed or swapped for another type', () => {
		expect(displacedVehicles([car, buggy], [car])).toEqual([
			{ id: 'bug-1', name: 'New Vehicle', change: 'removed', hasPhotos: false }
		]);
		expect(displacedVehicles([car], [{ ...car, type: 'buggy' }], new Set(['car-1']))).toEqual([
			{ id: 'car-1', name: 'Rusty', change: 'replaced', hasPhotos: true }
		]);
	});

	it('names the car, including when it has photos', () => {
		const removed = displacedVehicles([car], [], new Set(['car-1']))[0];
		expect(displacedVehicleLabel(removed)).toBe('Rusty will be removed. It has photos attached.');
		expect(displacedVehicleLabel({ id: 'x', name: 'Buggy', change: 'replaced', hasPhotos: false })).toBe(
			'Buggy will be replaced.'
		);
	});

	it('reads ids from a saved team document and ignores a blank name', () => {
		expect(vehicleIdentityList({ vehicles: [car] })).toEqual([]);
		expect(vehicleIdentityList([{ id: 'car-1', type: 'car', name: '  ' }])).toEqual([
			{ id: 'car-1', name: '', type: 'car' }
		]);
		expect(displacedVehicles([{ id: 'car-1', type: 'car' }], [])[0].name).toBe('Unnamed vehicle');
	});
});

describe('quick save options', () => {
	it('ignores the click event from the header button', () => {
		expect(readQuickSaveOptions(new Event('click'))).toEqual({
			asNew: false,
			force: false,
			quiet: false,
			resumePhoto: false
		});
		expect(readQuickSaveOptions({ force: true, quiet: true, resumePhoto: true, name: 'Copy' })).toEqual({
			asNew: false,
			force: true,
			quiet: true,
			resumePhoto: true,
			name: 'Copy'
		});
	});
});

describe('save-before-photo wiring', () => {
	it('guards the attach path and keeps the save modal copy', () => {
		const photos = readFileSync(resolve(process.cwd(), 'src/lib/components/VehiclePhotos.svelte'), 'utf8');
		const page = readFileSync(resolve(process.cwd(), 'src/routes/builder/+page.svelte'), 'utf8');
		const modal = readFileSync(resolve(process.cwd(), 'src/lib/components/SaveForPhotosModal.svelte'), 'utf8');
		const onFile = photos.slice(photos.indexOf('async function onFile'), photos.indexOf('function shareSource'));
		expect(photos).toContain('PHOTO_SAVE_GATE');
		expect(onFile).toContain('deferPhoto');
		expect(onFile.indexOf('deferPhoto')).toBeLessThan(onFile.indexOf('uploadChosen'));
		expect(photos).toContain("deferPhoto('library'");
		expect(page).toContain('SaveForPhotosModal');
		expect(page).toContain('displacedVehicles');
		expect(modal).toContain('Save your team to add photos');
		expect(modal).toContain('Save the team first');
		expect(modal).toContain('Save anyway');
		expect(modal).toContain('Save as new team');
		expect(modal).toContain('min-h-11');
	});
});
