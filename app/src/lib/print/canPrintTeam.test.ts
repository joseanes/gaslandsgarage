import { describe, expect, it } from 'vitest';
import { teamHasVehicles, teamVehicles } from './canPrintTeam';

const unnamedCar = {
	id: 'new',
	type: 'car',
	name: '',
	weapons: ['bazooka_front'],
	weaponFacings: { bazooka_front: 'front' },
	upgrades: [],
	perks: []
};

describe('team print guard', () => {
	it('rejects a version 2 team with no vehicles', () => {
		expect(teamHasVehicles({ rulesVersion: 2, sponsor: 'maxxine', vehicles: [] })).toBe(false);
	});

	it('accepts a version 2 team with one vehicle', () => {
		expect(
			teamHasVehicles({
				rulesVersion: 2,
				sponsor: 'maxxine',
				vehicles: [{ ...unnamedCar, name: 'Lead' }]
			})
		).toBe(true);
	});

	it('accepts a version 3 team with one vehicle and rejects an empty one', () => {
		expect(
			teamHasVehicles({
				rulesVersion: 3,
				sponsor: 'idris',
				vehicles: [{ ...unnamedCar, type: 'buggy', driverArchetype: 'spark' }]
			})
		).toBe(true);
		expect(teamHasVehicles({ rulesVersion: 3, sponsor: 'idris', vehicles: [] })).toBe(false);
	});

	it('counts an unnamed vehicle', () => {
		const team = { rulesVersion: 2, vehicles: [unnamedCar] };
		expect(teamVehicles(team)).toHaveLength(1);
		expect(teamHasVehicles(team)).toBe(true);
		expect(teamHasVehicles({ rulesVersion: 2, vehicles: [{ type: 'car' }] })).toBe(true);
	});

	it('uses the unsaved in-editor team, not a saved team stored beside it', () => {
		const unsaved = {
			sponsor: 'maxxine',
			teamName: 'My Gaslands Tear',
			maxCans: 50,
			rulesVersion: 2,
			vehicles: [unnamedCar]
		};
		expect(teamHasVehicles(unsaved)).toBe(true);

		// A present vehicles array is the editor. An empty one must not fall
		// through to a nested saved list, or a cleared team would still print.
		expect(
			teamHasVehicles({
				vehicles: [],
				teamData: { vehicles: [{ type: 'car', name: 'Saved' }] }
			})
		).toBe(false);
	});

	it('reads a saved wrapper only when the editor list is absent, signed-out or not', () => {
		expect(
			teamHasVehicles({
				teamName: 'Stored',
				teamData: { rulesVersion: 2, vehicles: [unnamedCar] }
			})
		).toBe(true);
		expect(teamHasVehicles({ teamData: { vehicles: [] } })).toBe(false);
		expect(teamHasVehicles(null)).toBe(false);
		expect(teamHasVehicles({ vehicles: [null, 'car'] })).toBe(false);
	});
});
