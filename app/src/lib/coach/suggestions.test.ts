import { describe, expect, it } from 'vitest';
import { buildCoachSuggestions } from './suggestions';
import { evaluateTeam, type ChassisStats, type ScoreWeapon } from './score';
import type { NextVehicleCatalogEntry } from './nextVehicle';

const heavy: ChassisStats = {
	id: 'heavy_truck',
	name: 'Heavy Truck',
	baseCost: 25,
	maxGear: 3,
	maxHull: 14,
	handling: 2,
	buildSlots: 5,
	weight: 'Heavyweight'
};

const bike: ChassisStats = {
	id: 'bike',
	name: 'Bike',
	baseCost: 5,
	maxGear: 6,
	maxHull: 4,
	handling: 5,
	buildSlots: 1,
	weight: 'Lightweight'
};

const hmg: ScoreWeapon = {
	id: 'hmg',
	name: 'Heavy Machine Gun',
	cost: 3,
	slots: 1,
	attackDice: 3,
	range: 'Double'
};

const bfg: ScoreWeapon = {
	id: 'bfg',
	name: 'BFG',
	cost: 1,
	slots: 3,
	attackDice: 10,
	range: 'Double',
	advanced: true
};

function catalog(vehicle: ChassisStats, advanced?: boolean): NextVehicleCatalogEntry {
	return {
		id: vehicle.id,
		name: vehicle.name,
		baseCost: vehicle.baseCost,
		maxGear: vehicle.maxGear,
		maxHull: vehicle.maxHull,
		handling: vehicle.handling,
		weight: vehicle.weight,
		buildSlots: vehicle.buildSlots,
		advanced
	};
}

describe('coach suggestions', () => {
	it('tells a naked heavy truck how many cans are left and which gun fixes combat', () => {
		const vehicles = [{ id: 'h1', type: 'heavy_truck', name: 'Lugger' }];
		const evaluation = evaluateTeam({
			vehicles,
			vehicleTypes: [heavy, bike],
			weapons: [hmg, bfg],
			upgrades: [],
			rulesVersion: 2,
			totalCans: 25,
			maxCans: 50
		});
		const suggestions = buildCoachSuggestions({
			rulesVersion: 2,
			vehicles,
			vehicleTypes: [heavy, bike],
			weapons: [hmg, bfg],
			upgrades: [],
			evaluation,
			sponsor: { id: 'no_sponsor', name: 'No Sponsor' },
			drivers: [],
			includeAdvanced: true,
			catalog: [catalog(heavy), catalog(bike, true)],
			teamTypes: [{ type: 'heavy_truck' }]
		});

		expect(suggestions[0]?.lead).toBe('You have 25 cans left of 50.');
		const combat = suggestions.find((item) => item.id === 'combat');
		expect(combat?.lead).toContain('Combat is Low');
		expect(combat?.lead).toContain('Heavy Machine Gun');
		expect(combat?.lead).not.toContain('BFG');
		expect(combat?.href).toBe('#vehicle-h1');
		expect(combat?.linkLabel).toContain('Heavy Truck');
		expect(combat?.tail).toContain('→');
		expect(combat?.tail).toMatch(/cans left after/);

		const mobility = suggestions.find((item) => item.id === 'mobility');
		expect(mobility?.linkLabel).toBe('Bike');
		expect(mobility?.href).toBe('#coach-add-bike');
		expect(mobility?.tail).toContain('best gain per can');
		expect(mobility?.lead).toContain('avg gear 3');
		const slots = suggestions.find((item) => item.id === 'slots');
		expect(slots?.tail).toContain('5 of 5 build slots open');
		expect(slots?.tail).not.toContain('→');
	});

	it('does not call a gun line low on combat', () => {
		const buggy: ChassisStats = {
			id: 'buggy',
			name: 'Buggy',
			baseCost: 6,
			maxGear: 6,
			maxHull: 6,
			handling: 4,
			buildSlots: 2,
			weight: 'Lightweight'
		};
		const vehicles = [
			{ id: 'b1', type: 'buggy', weapons: ['hmg_a'] },
			{ id: 'b2', type: 'buggy', weapons: ['hmg_b'] },
			{ id: 'b3', type: 'buggy', weapons: ['hmg_c'] }
		];
		const evaluation = evaluateTeam({
			vehicles,
			vehicleTypes: [buggy],
			weapons: [hmg],
			upgrades: [],
			rulesVersion: 2,
			totalCans: 27,
			maxCans: 50
		});
		expect(evaluation.statuses.combat).not.toBe('weak');
		const suggestions = buildCoachSuggestions({
			rulesVersion: 2,
			vehicles,
			vehicleTypes: [buggy],
			weapons: [hmg],
			upgrades: [],
			evaluation,
			sponsor: null,
			drivers: [],
			includeAdvanced: true,
			catalog: [catalog(buggy)],
			teamTypes: vehicles.map((vehicle) => ({ type: vehicle.type }))
		});
		expect(suggestions.some((item) => item.id === 'combat' && item.lead.includes('Low'))).toBe(false);
		expect(suggestions[0]?.lead).toContain('cans left');
	});
});
