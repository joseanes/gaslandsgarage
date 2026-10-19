import { describe, expect, it } from 'vitest';
import { rulesVersionLabel, summarizeVehicle, type TeamCatalogs } from './teamView';

const catalogs: TeamCatalogs = {
	vehicles: [{ id: 'car', name: 'Car', baseCost: 12, buildSlots: 2 }],
	weapons: [{ id: 'mg', name: 'Machine Gun', cost: 2, slots: 1 }],
	upgrades: [{ id: 'ram', name: 'Ram', cost: 4, slots: 1 }],
	perks: [{ id: 'powder_keg', name: 'Powder Keg', cost: 1 }]
};

describe('summarizeVehicle', () => {
	it('names loadout pieces and adds cans and slots', () => {
		const summary = summarizeVehicle(
			{
				id: 'v1',
				type: 'car',
				name: 'Hauler',
				weapons: ['mg_instance'],
				upgrades: ['ram'],
				perks: ['powder_keg'],
				driverName: 'Brick'
			},
			catalogs
		);
		expect(summary).toMatchObject({
			name: 'Hauler',
			typeName: 'Car',
			driverName: 'Brick',
			cans: 19,
			usedSlots: 2,
			maxSlots: 2,
			weapons: ['Machine Gun'],
			upgrades: ['Ram'],
			perks: ['Powder Keg']
		});
	});

	it('labels a missing rules version as Refuelled', () => {
		expect(rulesVersionLabel(undefined)).toBe('Version 2 — Refuelled');
		expect(rulesVersionLabel(3)).toBe('Version 3');
	});

	it('summarizes a legacy vehicle that has no gear arrays', () => {
		const summary = summarizeVehicle(
			{ id: 'v1', type: 'car', name: '', weapons: undefined as unknown as string[], upgrades: undefined as unknown as string[], perks: undefined as unknown as string[] },
			catalogs
		);
		expect(summary.weapons).toEqual([]);
		expect(summary.upgrades).toEqual([]);
		expect(summary.perks).toEqual([]);
		expect(summary.cans).toBe(12);
	});
});
