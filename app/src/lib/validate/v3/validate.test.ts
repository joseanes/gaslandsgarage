import { describe, expect, it } from 'vitest';
import type { Draft, DraftVehicle } from '../model';
import { validateDraft } from '../index';
import { validateDraftV3 } from './index';
import { v3BuildSlots } from './slots';

function vehicle(partial: Partial<DraftVehicle> & Pick<DraftVehicle, 'id' | 'type'>): DraftVehicle {
	return {
		name: partial.name ?? partial.type,
		weapons: [],
		upgrades: [],
		perks: [],
		weaponFacings: {},
		...partial
	};
}

function team(partial: Partial<Draft> & { vehicles: DraftVehicle[] }): Draft {
	return {
		sponsor: 'no_sponsor',
		rulesVersion: 3,
		maxCans: 50,
		...partial
	};
}

function errorsOf(result: { errors: string[]; vehicleReports: { errors: string[] }[] }) {
	return [...result.errors, ...result.vehicleReports.flatMap((report) => report.errors)];
}

describe('validateDraftV3', () => {
	it('accepts a legal 50-can team', () => {
		const result = validateDraftV3(
			team({
				vehicles: [
					vehicle({
						id: 'a',
						type: 'hot_rod',
						driverArchetype: 'speed_demon',
						weapons: ['machine_gun_aa'],
						weaponFacings: { machine_gun_aa: 'front' }
					}),
					vehicle({
						id: 'b',
						type: 'passenger_car',
						driverArchetype: 'brawler',
						driverName: 'Ada',
						secondPerkClass: 'daring',
						perks: ['battlehammer', 'barrel_roll']
					})
				]
			})
		);
		expect(errorsOf(result)).toEqual([]);
		expect(result.cans).toBe(12 + 1 + 15 + 6 + 1);
	});

	it('routes rulesVersion 3 through the v3 checker and leaves unversioned drafts on v2', async () => {
		const v3 = await validateDraft(
			team({
				vehicles: [vehicle({ id: 'a', type: 'car' })]
			})
		);
		expect(v3.vehicleReports[0].errors.join(' ')).toContain('Unknown vehicle type');

		const v2 = await validateDraft({
			sponsor: 'no_sponsor',
			vehicles: []
		});
		expect(v2.errors).not.toEqual(expect.arrayContaining([expect.stringContaining('Unknown vehicle')]));
	});

	it('caps counted vehicles at one per 20 cans and ignores the first bike', () => {
		const twoCars = validateDraftV3(
			team({
				maxCans: 25,
				vehicles: [vehicle({ id: 'a', type: 'hot_rod' }), vehicle({ id: 'b', type: 'buggy' })]
			})
		);
		expect(twoCars.errors.join(' ')).toContain('Too many vehicles');

		const bikePlusCar = validateDraftV3(
			team({
				maxCans: 25,
				vehicles: [vehicle({ id: 'a', type: 'bike' }), vehicle({ id: 'b', type: 'hot_rod' })]
			})
		);
		expect(bikePlusCar.errors.join(' ')).not.toContain('Too many vehicles');

		const threeOnFifty = validateDraftV3(
			team({
				vehicles: [
					vehicle({ id: 'a', type: 'hot_rod' }),
					vehicle({ id: 'b', type: 'buggy' }),
					vehicle({ id: 'c', type: 'pickup' })
				]
			})
		);
		expect(threeOnFifty.errors.join(' ')).toContain('limit of 2');

		const threeOnSixty = validateDraftV3(
			team({
				maxCans: 60,
				vehicles: [
					vehicle({ id: 'a', type: 'hot_rod' }),
					vehicle({ id: 'b', type: 'buggy' }),
					vehicle({ id: 'c', type: 'pickup' })
				]
			})
		);
		expect(threeOnSixty.errors.join(' ')).not.toContain('Too many vehicles');

		const fourOnAHundred = validateDraftV3(
			team({
				maxCans: 100,
				vehicles: [
					vehicle({ id: 'a', type: 'hot_rod' }),
					vehicle({ id: 'b', type: 'buggy' }),
					vehicle({ id: 'c', type: 'pickup' }),
					vehicle({ id: 'd', type: 'passenger_car' })
				]
			})
		);
		expect(fourOnAHundred.errors.join(' ')).toContain('limit of 3');
	});

	it('allows a second bike but not a third, and only one of any other rare type', () => {
		const twoBikes = validateDraftV3(
			team({
				maxCans: 60,
				vehicles: [vehicle({ id: 'a', type: 'bike' }), vehicle({ id: 'b', type: 'bike' })]
			})
		);
		expect(twoBikes.errors.join(' ')).not.toContain('Only one Bike');

		const threeBikes = validateDraftV3(
			team({
				maxCans: 60,
				vehicles: [
					vehicle({ id: 'a', type: 'bike' }),
					vehicle({ id: 'b', type: 'bike' }),
					vehicle({ id: 'c', type: 'bike' })
				]
			})
		);
		expect(threeBikes.errors.join(' ')).toContain('Only one Bike');

		const twoTanks = validateDraftV3(
			team({
				maxCans: 100,
				vehicles: [vehicle({ id: 'a', type: 'tank' }), vehicle({ id: 'b', type: 'tank' })]
			})
		);
		expect(twoTanks.errors.join(' ')).toContain('Only one Tank');
	});

	it('keeps driver archetypes unique and gates perk classes', () => {
		const dupes = validateDraftV3(
			team({
				vehicles: [
					vehicle({ id: 'a', type: 'hot_rod', driverArchetype: 'spark' }),
					vehicle({ id: 'b', type: 'buggy', driverArchetype: 'spark' })
				]
			})
		);
		expect(errorsOf(dupes).join(' ')).toContain('already used');

		const locked = validateDraftV3(
			team({
				vehicles: [vehicle({ id: 'a', type: 'hot_rod', perks: ['battlehammer'] })]
			})
		);
		expect(errorsOf(locked).join(' ')).toContain('not in an unlocked perk class');

		const named = validateDraftV3(
			team({
				vehicles: [
					vehicle({
						id: 'a',
						type: 'hot_rod',
						driverArchetype: 'brawler',
						driverName: 'Jo',
						secondPerkClass: 'speed',
						perks: ['battlehammer', 'floor_it']
					})
				]
			})
		);
		expect(errorsOf(named)).toEqual([]);

		const unnamedSecond = validateDraftV3(
			team({
				vehicles: [
					vehicle({
						id: 'a',
						type: 'hot_rod',
						driverArchetype: 'brawler',
						secondPerkClass: 'speed',
						perks: ['floor_it']
					})
				]
			})
		);
		expect(errorsOf(unnamedSecond).join(' ')).toContain('named driver');

		const twice = validateDraftV3(
			team({
				vehicles: [
					vehicle({
						id: 'a',
						type: 'hot_rod',
						driverArchetype: 'brawler',
						perks: ['battlehammer', 'battlehammer']
					})
				]
			})
		);
		expect(errorsOf(twice).join(' ')).toContain('Duplicate perk');
	});

	it('locks electrical gear unless a van or a Spark is on the team', () => {
		const blocked = validateDraftV3(
			team({
				vehicles: [
					vehicle({
						id: 'a',
						type: 'hot_rod',
						weapons: ['combat_laser_aa'],
						weaponFacings: { combat_laser_aa: 'front' }
					})
				]
			})
		);
		expect(errorsOf(blocked).join(' ')).toContain('electrical');

		const van = validateDraftV3(
			team({
				vehicles: [
					vehicle({
						id: 'a',
						type: 'van',
						weapons: ['combat_laser_aa'],
						weaponFacings: { combat_laser_aa: 'front' }
					})
				]
			})
		);
		expect(errorsOf(van).join(' ')).not.toContain('electrical');

		const sparkTeam = validateDraftV3(
			team({
				vehicles: [
					vehicle({ id: 'a', type: 'buggy', driverArchetype: 'spark' }),
					vehicle({
						id: 'b',
						type: 'hot_rod',
						upgrades: ['magnetic_jammer']
					})
				]
			})
		);
		expect(errorsOf(sparkTeam).join(' ')).not.toContain('electrical');
	});

	it('enforces build slots, van discounts, tank turrets, and trailers', () => {
		expect(
			v3BuildSlots(
				{ buildSlots: 3, utility: true },
				[],
				[
					{ id: 'extra_armour', slots: 1 },
					{ id: 'heavy_frame', slots: 1 },
					{ id: 'roll_cage', slots: 1 },
					{ id: 'ram', slots: 1 },
					{ id: 'ramshackle_hull_plating', slots: 1 },
					{ id: 'tank_tracks', slots: 1 }
				]
			)
		).toEqual({ used: 3, capacity: 3 });

		const over = validateDraftV3(
			team({
				vehicles: [
					vehicle({
						id: 'a',
						type: 'hot_rod',
						weapons: ['mini_gun_aa', 'mortar_bb'],
						weaponFacings: { mini_gun_aa: 'front', mortar_bb: 'front' }
					})
				]
			})
		);
		expect(errorsOf(over).join(' ')).toContain('Too many build slots: 5/2');

		const vanOk = validateDraftV3(
			team({
				vehicles: [
					vehicle({
						id: 'a',
						type: 'van',
						upgrades: ['extra_armour', 'heavy_frame', 'roll_cage', 'ram', 'ramshackle_hull_plating', 'tank_tracks'],
						upgradeFacings: { ram: 'front' }
					})
				]
			})
		);
		expect(errorsOf(vanOk).join(' ')).not.toContain('build slots');

		const tank = validateDraftV3(
			team({
				maxCans: 60,
				vehicles: [
					vehicle({
						id: 'a',
						type: 'tank',
						weapons: ['bfg_aa'],
						weaponFacings: { bfg_aa: 'front' },
						upgrades: ['turret_mount'],
						turretWeaponId: 'bfg_aa'
					})
				]
			})
		);
		expect(errorsOf(tank)).toEqual([]);
		expect(tank.cans).toBe(36 + 5 + 2 + 5);

		const trailer = validateDraftV3(
			team({
				vehicles: [
					vehicle({
						id: 'a',
						type: 'buggy',
						upgrades: ['trailer_lightweight'],
						weapons: ['machine_gun_a', 'heavy_machine_gun_b', 'scrap_cannon_c'],
						weaponFacings: {
							machine_gun_a: 'front',
							heavy_machine_gun_b: 'side',
							scrap_cannon_c: 'rear'
						}
					})
				]
			})
		);
		expect(errorsOf(trailer)).toEqual([]);

		const flying = validateDraftV3(
			team({
				vehicles: [vehicle({ id: 'a', type: 'gyrocopter', upgrades: ['trailer_lightweight'] })]
			})
		);
		expect(errorsOf(flying).join(' ')).toContain('cannot take a trailer');

		const lightTrailer = validateDraftV3(
			team({
				vehicles: [vehicle({ id: 'a', type: 'hot_rod', upgrades: ['trailer_middleweight'] })]
			})
		);
		expect(errorsOf(lightTrailer).join(' ')).toContain('weight 2+');

		const framed = validateDraftV3(
			team({
				vehicles: [vehicle({ id: 'a', type: 'hot_rod', upgrades: ['heavy_frame', 'trailer_middleweight'] })]
			})
		);
		expect(errorsOf(framed).join(' ')).not.toContain('weight 2+');
	});

	it('limits dropped weapons, common upgrades, and rare gear', () => {
		const drops = validateDraftV3(
			team({
				vehicles: [
					vehicle({
						id: 'a',
						type: 'pickup',
						weapons: ['oil_slick_dropper_a', 'oil_slick_dropper_b']
					})
				]
			})
		);
		expect(errorsOf(drops).join(' ')).toContain('Duplicate dropped weapon');

		const dupUpgrade = validateDraftV3(
			team({
				vehicles: [vehicle({ id: 'a', type: 'pickup', upgrades: ['siren', 'siren'] })]
			})
		);
		expect(errorsOf(dupUpgrade).join(' ')).toContain('Duplicate upgrade');

		const twoLasers = validateDraftV3(
			team({
				vehicles: [
					vehicle({
						id: 'a',
						type: 'van',
						weapons: ['combat_laser_a'],
						weaponFacings: { combat_laser_a: 'front' }
					}),
					vehicle({
						id: 'b',
						type: 'van',
						weapons: ['combat_laser_b'],
						weaponFacings: { combat_laser_b: 'side' }
					})
				]
			})
		);
		expect(twoLasers.errors.join(' ')).toContain('Rare weapon Combat Laser');
	});

	it('requires facings on fixed weapons and rams, not on dropped or 360 weapons', () => {
		const missing = validateDraftV3(
			team({
				vehicles: [vehicle({ id: 'a', type: 'hot_rod', weapons: ['machine_gun_a'], upgrades: ['ram'] })]
			})
		);
		expect(errorsOf(missing).join(' ')).toContain('Machine Gun needs a front');
		expect(errorsOf(missing).join(' ')).toContain('Ram needs a front');

		const freeArc = validateDraftV3(
			team({
				vehicles: [
					vehicle({
						id: 'a',
						type: 'hot_rod',
						weapons: ['handgun_a', 'oil_slick_dropper_b']
					})
				]
			})
		);
		expect(errorsOf(freeArc)).toEqual([]);
	});

	it('checks sponsor requirements against the finished build', () => {
		const chivoFail = validateDraftV3(
			team({
				sponsor: 'chivo',
				vehicles: [vehicle({ id: 'a', type: 'hot_rod' })]
			})
		);
		expect(chivoFail.errors.join(' ')).toContain('Chivo');

		const chivoOk = validateDraftV3(
			team({
				sponsor: 'chivo',
				maxCans: 60,
				vehicles: [
					vehicle({
						id: 'a',
						type: 'war_rig',
						weapons: ['machine_gun_a'],
						weaponFacings: { machine_gun_a: 'front' }
					})
				]
			})
		);
		expect(chivoOk.cans).toBe(41);
		expect(chivoOk.errors).toEqual([]);

		const idris = validateDraftV3(
			team({
				sponsor: 'idris',
				vehicles: [
					vehicle({ id: 'a', type: 'monster_truck', upgrades: ['v10_engine'] }),
					vehicle({ id: 'b', type: 'sports_car' })
				]
			})
		);
		expect(idris.errors).toEqual([]);

		const warden = validateDraftV3(
			team({
				sponsor: 'warden',
				vehicles: [vehicle({ id: 'a', type: 'buggy', upgrades: ['ramshackle_hull_plating'] })]
			})
		);
		expect(warden.errors).toEqual([]);

		const beverly = validateDraftV3(
			team({
				sponsor: 'beverly',
				vehicles: [vehicle({ id: 'a', type: 'pickup' }), vehicle({ id: 'b', type: 'buggy' })]
			})
		);
		expect(beverly.errors).toEqual([]);

		const inferno = validateDraftV3(
			team({
				sponsor: 'order_of_the_inferno',
				maxCans: 60,
				vehicles: [
					vehicle({
						id: 'a',
						type: 'pickup',
						weapons: ['flamethrower_a', 'molotov_cocktails_b', 'napalm_dropper_c'],
						weaponFacings: { flamethrower_a: 'front' }
					})
				]
			})
		);
		expect(inferno.errors).toEqual([]);

		const rutherford = validateDraftV3(
			team({
				sponsor: 'rutherford',
				vehicles: [
					vehicle({
						id: 'a',
						type: 'pickup',
						weapons: ['handgun_a', 'handgun_b', 'machine_gun_c', 'machine_gun_d', 'machine_gun_e', 'machine_gun_f'],
						weaponFacings: {
							machine_gun_c: 'front',
							machine_gun_d: 'front',
							machine_gun_e: 'side',
							machine_gun_f: 'rear'
						}
					})
				]
			})
		);
		expect(rutherford.errors.join(' ')).toContain('Rutherford');
	});

	it('flags a team that spends past its budget', () => {
		const result = validateDraftV3(
			team({
				maxCans: 15,
				vehicles: [vehicle({ id: 'a', type: 'sports_car' })]
			})
		);
		expect(result.errors.join(' ')).toContain('exceeds 15 cans');
	});
});
