import { describe, expect, it } from 'vitest';
import { withoutDisallowedGear, type GearVehicle } from './stripGear';

const catalogs = {
	vehicleTypes: [
		{ id: 'car' },
		{ id: 'tank', advanced: true }
	],
	weapons: [
		{ id: 'machine_gun' },
		{ id: 'bfg', advanced: true }
	],
	upgrades: [
		{ id: 'ram' },
		{ id: 'teleporter', advanced: true }
	]
};

function car(partial: Partial<GearVehicle> = {}): GearVehicle {
	return {
		type: 'car',
		weapons: ['machine_gun_abc'],
		upgrades: ['ram'],
		perks: ['powder_keg'],
		weaponFacings: { machine_gun_abc: 'front' },
		...partial
	};
}

describe('withoutDisallowedGear', () => {
	it('returns the same array when the settings still allow the list', () => {
		const vehicles = [car()];
		const next = withoutDisallowedGear(vehicles, { includeAdvanced: true, clearPerks: false, ...catalogs });
		expect(next).toBe(vehicles);
	});

	it('returns the same array when advanced gear is off but nothing advanced is present', () => {
		const vehicles = [car()];
		const next = withoutDisallowedGear(vehicles, { includeAdvanced: false, clearPerks: false, ...catalogs });
		expect(next).toBe(vehicles);
		expect(withoutDisallowedGear(next, { includeAdvanced: false, clearPerks: false, ...catalogs })).toBe(next);
	});

	it('keeps a vehicle the catalog cannot resolve', () => {
		const vehicles = [car({ type: 'ghost_rider', weapons: [], upgrades: [], perks: [] })];
		const next = withoutDisallowedGear(vehicles, { includeAdvanced: false, clearPerks: false, ...catalogs });
		expect(next).toBe(vehicles);
		expect(next[0].type).toBe('ghost_rider');
	});

	it('drops an advanced vehicle once and then stays stable', () => {
		const vehicles = [car(), car({ type: 'tank', weapons: [], upgrades: [], perks: [] })];
		const next = withoutDisallowedGear(vehicles, { includeAdvanced: false, clearPerks: false, ...catalogs });
		expect(next).not.toBe(vehicles);
		expect(next.map((vehicle) => vehicle.type)).toEqual(['car']);
		expect(withoutDisallowedGear(next, { includeAdvanced: false, clearPerks: false, ...catalogs })).toBe(next);
	});

	it('drops an advanced weapon and its facing without touching the other gear', () => {
		const vehicles = [car({ weapons: ['machine_gun_abc', 'bfg_xyz'], weaponFacings: { machine_gun_abc: 'front', bfg_xyz: 'rear' } })];
		const next = withoutDisallowedGear(vehicles, { includeAdvanced: false, clearPerks: false, ...catalogs });
		expect(next[0].weapons).toEqual(['machine_gun_abc']);
		expect(next[0].weaponFacings).toEqual({ machine_gun_abc: 'front' });
		expect(next[0].upgrades).toBe(vehicles[0].upgrades);
		expect(withoutDisallowedGear(next, { includeAdvanced: false, clearPerks: false, ...catalogs })).toBe(next);
	});

	it('treats missing gear lists as empty instead of throwing', () => {
		const vehicles = [{ type: 'car' } as GearVehicle];
		const next = withoutDisallowedGear(vehicles, { includeAdvanced: false, clearPerks: true, ...catalogs });
		expect(next[0].weapons).toEqual([]);
		expect(next[0].upgrades).toEqual([]);
		expect(next[0].perks).toEqual([]);
	});

	it('clears perks once when sponsorships are off and then stays stable', () => {
		const vehicles = [car()];
		const next = withoutDisallowedGear(vehicles, { includeAdvanced: true, clearPerks: true, ...catalogs });
		expect(next[0].perks).toEqual([]);
		expect(next[0].weapons).toBe(vehicles[0].weapons);
		expect(withoutDisallowedGear(next, { includeAdvanced: true, clearPerks: true, ...catalogs })).toBe(next);
	});
});
