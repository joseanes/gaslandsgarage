import { describe, expect, it } from 'vitest';
import { METRICS, rateScore } from './thresholds';
import {
	evaluateTeam,
	scoresFromSnapshot,
	slotUsageForVehicle,
	snapshotFromChassis,
	withChassis,
	type ChassisStats,
	type ScoreWeapon
} from './score';

const car: ChassisStats = {
	id: 'car',
	name: 'Car',
	baseCost: 12,
	maxGear: 5,
	maxHull: 10,
	handling: 3,
	buildSlots: 2,
	weight: 'Middleweight'
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

const hmg: ScoreWeapon = { id: 'hmg', name: 'Heavy Machine Gun', cost: 3, slots: 1, attackDice: 3, range: 'Double' };
const handgun: ScoreWeapon = { id: 'handgun', name: 'Handgun', cost: 0, slots: 0, attackDice: 1, range: 'Short', crewFired: true };

describe('team scores', () => {
	it('scores a lone car as slow mobility and strong hull per can', () => {
		const report = evaluateTeam({
			vehicles: [{ id: 'c1', type: 'car' }],
			vehicleTypes: [car],
			weapons: [],
			upgrades: [],
			rulesVersion: 2,
			totalCans: 12,
			maxCans: 50
		});
		expect(report.scores.mobility).toBe(4.2);
		expect(report.scores.avgGear).toBe(5);
		expect(report.scores.survivability).toBeCloseTo(0.83, 2);
		expect(report.scores.combat).toBe(0);
		expect(report.statuses.mobility).toBe('weak');
		expect(report.statuses.survivability).toBe('good');
		expect(report.statuses.combat).toBe('weak');
		expect(report.cansLeft).toBe(38);
	});

	it('moves mobility from 4.2 to 4.9 when a bike is added to a car', () => {
		const before = snapshotFromChassis([car], 2, 12, 50);
		expect(scoresFromSnapshot(before).mobility).toBe(4.2);
		const after = scoresFromSnapshot(withChassis(before, bike));
		expect(after.mobility).toBe(4.9);
		expect(after.avgGear).toBe(5.5);
	});

	it('counts attack dice per can and ignores a free handgun slot', () => {
		const report = evaluateTeam({
			vehicles: [{ id: 'c1', type: 'car', weapons: ['hmg_aa', 'handgun_bb'] }],
			vehicleTypes: [car],
			weapons: [hmg, handgun],
			upgrades: [],
			rulesVersion: 2,
			totalCans: 15,
			maxCans: 50
		});
		expect(report.snapshot.attackDice).toBe(4);
		expect(report.scores.combat).toBeCloseTo(0.27, 2);
		expect(report.statuses.combat).toBe(rateScore(0.27, METRICS.combat));
		expect(
			slotUsageForVehicle({ id: 'c1', type: 'car', weapons: ['hmg_aa', 'handgun_bb'] }, car, [hmg, handgun], [], 2)
		).toEqual({ used: 1, capacity: 2 });
		expect(report.scores.slotEfficiency).toBe(50);
		expect(report.statuses.slots).toBe('weak');
	});

	it('includes 3rd edition armour in survivability and not in the hull total', () => {
		const buggy: ChassisStats = {
			id: 'pickup',
			name: 'Pickup',
			baseCost: 16,
			maxGear: 4,
			maxHull: 14,
			handling: 3,
			armour: 1,
			buildSlots: 4,
			weight: 3
		};
		const report = evaluateTeam({
			vehicles: [{ id: 'p1', type: 'pickup' }],
			vehicleTypes: [buggy],
			weapons: [],
			upgrades: [],
			rulesVersion: 3,
			totalCans: 16,
			maxCans: 50
		});
		expect(report.snapshot.hull).toBe(14);
		expect(report.snapshot.durability).toBe(15);
		expect(report.scores.survivability).toBeCloseTo(0.94, 2);
		expect(report.weights.Middleweight).toBe(1);
	});

	it('marks a naked heavy truck as weak on combat, mobility, and slots', () => {
		const report = evaluateTeam({
			vehicles: [{ id: 'h1', type: 'heavy_truck' }],
			vehicleTypes: [heavy],
			weapons: [],
			upgrades: [],
			rulesVersion: 2,
			totalCans: 25,
			maxCans: 50
		});
		expect(report.scores.mobility).toBe(2.6);
		expect(report.scores.survivability).toBeCloseTo(0.56, 2);
		expect(report.statuses.mobility).toBe('weak');
		expect(report.statuses.combat).toBe('weak');
		expect(report.statuses.slots).toBe('weak');
		expect(report.statuses.survivability).toBe('ok');
		expect(report.cansLeft).toBe(25);
	});
});
