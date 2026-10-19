import { describe, expect, it } from 'vitest';
import { v3Vehicles } from '../../data/rules/v3/vehicles';
import v2Raw from '../../data/rules/vehicles.json';
import {
	EMPTY_NEXT_VEHICLE_MESSAGE,
	recommendNextVehicles,
	type NextVehicleCatalogEntry,
	type NextVehicleRequest
} from './nextVehicle';

const FORBIDDEN_PROSE = ['Ludicrous', 'Every vehicle', 'Roll Cage', 'Vengeful', 'Pyromania', 'perkText'];

function v2Catalog(): NextVehicleCatalogEntry[] {
	return v2Raw.map((vehicle) => ({
		id: vehicle.id,
		name: vehicle.name,
		baseCost: vehicle.baseCost,
		maxGear: vehicle.maxGear,
		maxHull: vehicle.maxHull,
		handling: vehicle.handling,
		crew: vehicle.crew,
		weight: vehicle.weight,
		advanced: vehicle.advanced,
		sponsors: 'sponsors' in vehicle ? vehicle.sponsors : undefined,
		buildSlots: vehicle.buildSlots
	}));
}

const v2 = v2Catalog();

function ask(partial: Partial<NextVehicleRequest> & Pick<NextVehicleRequest, 'rulesVersion' | 'sponsorId'>): ReturnType<typeof recommendNextVehicles> {
	return recommendNextVehicles({
		catalog: partial.rulesVersion === 3 ? v3Vehicles : v2,
		team: [],
		totalCans: 0,
		maxCans: 50,
		includeAdvanced: true,
		...partial
	});
}

function expectPlainReasons(suggestions: { name: string; reason: string; perCan: number; cost: number }[]) {
	expect(suggestions.length).toBeLessThanOrEqual(3);
	for (const suggestion of suggestions) {
		expect(suggestion.reason.length).toBeGreaterThan(20);
		expect(suggestion.reason).toMatch(/cans left after/);
		for (const phrase of FORBIDDEN_PROSE) {
			expect(suggestion.reason).not.toContain(phrase);
			expect(suggestion.name).not.toContain(phrase);
		}
	}
	for (let index = 1; index < suggestions.length; index += 1) {
		expect(suggestions[index - 1].perCan).toBeGreaterThanOrEqual(suggestions[index].perCan);
	}
}

describe('recommendNextVehicles v2', () => {
	it('ranks Rutherford additions by score gain per can', () => {
		const suggestions = ask({
			rulesVersion: 2,
			sponsorId: 'rutherford',
			team: [{ type: 'car' }],
			totalCans: 12,
			maxCans: 60
		});

		expectPlainReasons(suggestions);
		expect(suggestions[0]?.perCan).toBeGreaterThan(0);
		expect(suggestions[0]?.id).not.toBe('tank');
		expect(suggestions.every((suggestion) => suggestion.cost <= 48)).toBe(true);
	});

	it('names sponsor synergy when the only legal add is a Rutherford tank', () => {
		const suggestions = ask({
			rulesVersion: 2,
			sponsorId: 'rutherford',
			catalog: v2.filter((vehicle) => vehicle.id === 'car' || vehicle.id === 'tank'),
			team: [{ type: 'car' }],
			totalCans: 12,
			maxCans: 60
		});
		expectPlainReasons(suggestions);
		expect(suggestions.map((suggestion) => suggestion.id)).toContain('tank');
		expect(suggestions.find((suggestion) => suggestion.id === 'tank')?.reason.toLowerCase()).toContain('sponsor');
	});

	it('keeps Rutherford-only vehicles off other sponsors', () => {
		for (const sponsorId of ['no_sponsor', 'mishkin', 'scarlett']) {
			const suggestions = ask({
				rulesVersion: 2,
				sponsorId,
				team: [{ type: 'car' }],
				totalCans: 12,
				maxCans: 80
			});
			expectPlainReasons(suggestions);
			expect(suggestions.map((suggestion) => suggestion.id)).not.toContain('tank');
			expect(suggestions.map((suggestion) => suggestion.id)).not.toContain('helicopter');
		}
	});

	it('allows a vehicle that costs exactly the remaining cans and rejects one can less', () => {
		const exact = ask({
			rulesVersion: 2,
			sponsorId: 'no_sponsor',
			catalog: v2.filter((vehicle) => vehicle.id === 'car' || vehicle.id === 'truck'),
			team: [],
			totalCans: 0,
			maxCans: 12
		});
		expect(exact.map((suggestion) => suggestion.id)).toEqual(['car']);
		expect(exact[0]?.reason).toMatch(/cans left after/);

		const short = ask({
			rulesVersion: 2,
			sponsorId: 'no_sponsor',
			catalog: v2.filter((vehicle) => vehicle.id === 'car' || vehicle.id === 'truck'),
			team: [],
			totalCans: 0,
			maxCans: 11
		});
		expect(short).toEqual([]);
	});

	it('returns nothing when the leftover cans cannot buy the cheapest legal vehicle', () => {
		const suggestions = ask({
			rulesVersion: 2,
			sponsorId: 'no_sponsor',
			team: [{ type: 'car' }],
			totalCans: 12,
			maxCans: 16
		});
		expect(suggestions).toEqual([]);
	});

	it('hides advanced vehicles when that option is off', () => {
		const suggestions = ask({
			rulesVersion: 2,
			sponsorId: 'rutherford',
			team: [{ type: 'car' }],
			totalCans: 12,
			maxCans: 100,
			includeAdvanced: false
		});
		expectPlainReasons(suggestions);
		expect(suggestions.map((suggestion) => suggestion.id)).not.toContain('tank');
		expect(suggestions.map((suggestion) => suggestion.id)).not.toContain('helicopter');
		expect(suggestions.map((suggestion) => suggestion.id)).not.toContain('drag_racer');
		expect(suggestions.every((suggestion) => suggestion.cost <= 88)).toBe(true);
	});

	it('offers a fast flanker when the team is only a heavy truck', () => {
		const suggestions = ask({
			rulesVersion: 2,
			sponsorId: 'no_sponsor',
			team: [{ type: 'heavy_truck' }],
			totalCans: 25,
			maxCans: 50
		});
		expectPlainReasons(suggestions);
		expect(suggestions[0]?.id).toBe('bike');
		expect(suggestions[0]?.reason).toMatch(/Mobility/);
		expect(suggestions[0]?.reason).toMatch(/flanker/);
		expect(suggestions.every((suggestion) => suggestion.cost <= 25)).toBe(true);
	});

	it('explains a bike as the best mobility gain per can for a slow car', () => {
		const suggestions = ask({
			rulesVersion: 2,
			sponsorId: 'no_sponsor',
			team: [{ type: 'car' }],
			totalCans: 12,
			maxCans: 50
		});
		expectPlainReasons(suggestions);
		expect(suggestions[0]).toMatchObject({ id: 'bike', cost: 5 });
		expect(suggestions[0]?.reason).toContain('Mobility 4.2 → 4.9');
		expect(suggestions[0]?.reason).toContain('your team is slow (avg gear 5)');
		expect(suggestions[0]?.reason).toContain('a bike adds a gear-6 flanker');
		expect(suggestions[0]?.reason).toContain('33 cans left after');
	});
});

describe('recommendNextVehicles v3', () => {
	it('only suggests gear 6 chassis for Idris', () => {
		const gear6 = new Set(['hot_rod', 'muscle_car', 'sports_car', 'bike']);
		const suggestions = ask({
			rulesVersion: 3,
			sponsorId: 'idris',
			team: [{ type: 'hot_rod' }],
			totalCans: 12,
			maxCans: 50
		});
		expectPlainReasons(suggestions);
		expect(suggestions.length).toBeGreaterThan(0);
		expect(suggestions.every((suggestion) => gear6.has(suggestion.id))).toBe(true);
		expect(suggestions.some((suggestion) => /sponsor/i.test(suggestion.reason))).toBe(true);
		expect(suggestions.map((suggestion) => suggestion.id)).not.toContain('buggy');
	});

	it('only suggests weight 4+ chassis for Jumbo', () => {
		const heavy = new Set(['monster_truck', 'van', 'heavy_truck', 'bus', 'tank', 'war_rig']);
		const suggestions = ask({
			rulesVersion: 3,
			sponsorId: 'jumbo',
			team: [{ type: 'van' }],
			totalCans: 18,
			maxCans: 50
		});
		expectPlainReasons(suggestions);
		expect(suggestions.every((suggestion) => heavy.has(suggestion.id))).toBe(true);
		expect(suggestions.map((suggestion) => suggestion.id)).not.toContain('buggy');
		expect(suggestions.map((suggestion) => suggestion.id)).not.toContain('hot_rod');
	});

	it('keeps heavy chassis off Maxxine and fragile chassis off the Warden', () => {
		const maxxine = ask({
			rulesVersion: 3,
			sponsorId: 'maxxine',
			team: [{ type: 'buggy' }],
			totalCans: 13,
			maxCans: 50
		});
		expectPlainReasons(maxxine);
		expect(maxxine.map((suggestion) => suggestion.id)).not.toContain('monster_truck');
		expect(maxxine.map((suggestion) => suggestion.id)).not.toContain('war_rig');

		const warden = ask({
			rulesVersion: 3,
			sponsorId: 'warden',
			team: [{ type: 'pickup' }],
			totalCans: 16,
			maxCans: 50
		});
		expectPlainReasons(warden);
		expect(warden.map((suggestion) => suggestion.id)).not.toContain('buggy');
		expect(warden.map((suggestion) => suggestion.id)).not.toContain('hot_rod');
		expect(warden.every((suggestion) => (v3Vehicles.find((vehicle) => vehicle.id === suggestion.id)?.maxHull ?? 0) >= 10)).toBe(true);
	});

	it('suggests a tougher chassis for Beverly when the team is already fast', () => {
		const open = ask({
			rulesVersion: 3,
			sponsorId: 'beverly',
			team: [{ type: 'sports_car' }],
			totalCans: 20,
			maxCans: 50
		});
		expectPlainReasons(open);
		expect(open[0]?.reason).toMatch(/Survivability/);
		expect(
			open.some((suggestion) => (v3Vehicles.find((vehicle) => vehicle.id === suggestion.id)?.maxHull ?? 0) >= 12)
		).toBe(true);

		const filled = ask({
			rulesVersion: 3,
			sponsorId: 'beverly',
			team: [{ type: 'pickup' }],
			totalCans: 16,
			maxCans: 50
		});
		expectPlainReasons(filled);
		expect(
			filled.every((suggestion) => (v3Vehicles.find((vehicle) => vehicle.id === suggestion.id)?.maxHull ?? 99) < 12)
		).toBe(true);
	});

	it('does not ban a cheap chassis just because a sponsor wants purchased gear', () => {
		const suggestions = ask({
			rulesVersion: 3,
			sponsorId: 'chivo',
			team: [{ type: 'hot_rod' }],
			totalCans: 12,
			maxCans: 50
		});
		expectPlainReasons(suggestions);
		expect(suggestions.some((suggestion) => suggestion.cost < 25)).toBe(true);
	});

	it('at the counted limit only offers the free first bike, and nothing once that bike is taken', () => {
		const bikeOnly = ask({
			rulesVersion: 3,
			sponsorId: 'no_sponsor',
			team: [
				{ type: 'buggy' },
				{ type: 'buggy' }
			],
			totalCans: 26,
			maxCans: 50
		});
		expect(bikeOnly.map((suggestion) => suggestion.id)).toEqual(['bike']);
		expect(bikeOnly[0]?.cost).toBe(12);

		const closed = ask({
			rulesVersion: 3,
			sponsorId: 'no_sponsor',
			team: [
				{ type: 'bike' },
				{ type: 'buggy' },
				{ type: 'buggy' }
			],
			totalCans: 38,
			maxCans: 50
		});
		expect(closed).toEqual([]);
	});

	it('treats a 25-can budget as one counted vehicle plus an exactly affordable bike', () => {
		const exactBike = ask({
			rulesVersion: 3,
			sponsorId: 'no_sponsor',
			team: [{ type: 'buggy' }],
			totalCans: 13,
			maxCans: 25
		});
		expect(exactBike.map((suggestion) => suggestion.id)).toEqual(['bike']);

		const oneShort = ask({
			rulesVersion: 3,
			sponsorId: 'no_sponsor',
			team: [{ type: 'buggy' }],
			totalCans: 13,
			maxCans: 24
		});
		expect(oneShort).toEqual([]);
	});

	it('does not suggest a second war rig', () => {
		const suggestions = ask({
			rulesVersion: 3,
			sponsorId: 'no_sponsor',
			team: [{ type: 'war_rig' }],
			totalCans: 40,
			maxCans: 100
		});
		expectPlainReasons(suggestions);
		expect(suggestions.map((suggestion) => suggestion.id)).not.toContain('war_rig');
		expect(suggestions.length).toBeGreaterThan(0);
	});

	it('does not suggest a third bike', () => {
		const suggestions = ask({
			rulesVersion: 3,
			sponsorId: 'no_sponsor',
			team: [
				{ type: 'bike' },
				{ type: 'bike' }
			],
			totalCans: 24,
			maxCans: 60
		});
		expect(suggestions.map((suggestion) => suggestion.id)).not.toContain('bike');
	});

	it('adds a fast flanker when the team is only a pickup', () => {
		const suggestions = ask({
			rulesVersion: 3,
			sponsorId: 'no_sponsor',
			team: [{ type: 'pickup' }],
			totalCans: 16,
			maxCans: 50
		});
		expectPlainReasons(suggestions);
		expect(suggestions.some((suggestion) => /Mobility|flanker/.test(suggestion.reason))).toBe(true);
	});
});

describe('empty next-vehicle message', () => {
	it('is a short friendly sentence with no rules text', () => {
		expect(EMPTY_NEXT_VEHICLE_MESSAGE.length).toBeGreaterThan(20);
		expect(EMPTY_NEXT_VEHICLE_MESSAGE).not.toMatch(/Ludicrous|Every vehicle|Roll Cage/);
	});
});
