import { describe, it, expect } from 'vitest';
import { normalizeIncomingDraft, readSavedTeamId, withUpgradePerks, type ImportedVehicle } from './importTeam';

describe('withUpgradePerks', () => {
	it('adds perks granted by upgrades without duplicating existing perks', () => {
		const vehicles = withUpgradePerks(
			[
				{
					id: 'v1',
					type: 'car',
					name: 'Lead',
					weapons: ['handgun_ab'],
					upgrades: ['extra_crew'],
					perks: ['powder_keg']
				}
			],
			[{ id: 'extra_crew', perks: ['powder_keg', 'expert_driver'] }]
		);

		expect(vehicles[0].perks).toEqual(['powder_keg', 'expert_driver']);
		expect(vehicles[0].weapons).toEqual(['handgun_ab']);
	});

	it('fills missing weapon, upgrade, and perk arrays', () => {
		const vehicles = withUpgradePerks(
			[{ id: 'v1', type: 'car', name: '', weapons: undefined as unknown as string[], perks: undefined as unknown as string[] }],
			[]
		);
		expect(vehicles[0].name).toBe('Vehicle');
		expect(vehicles[0].weapons).toEqual([]);
		expect(vehicles[0].upgrades).toEqual([]);
		expect(vehicles[0].perks).toEqual([]);
	});
});

describe('normalizeIncomingDraft', () => {
	it('unwraps saved teams and maps sponsorId onto sponsor', () => {
		const draft = normalizeIncomingDraft({
			teamData: {
				sponsorId: 'idris',
				teamName: 'Orange',
				maxCans: 42,
				vehicles: [{ id: 'v1', type: 'car', name: 'Lead', weapons: [], perks: [] }]
			}
		});
		expect(draft?.sponsor).toBe('idris');
		expect(draft?.teamName).toBe('Orange');
		expect(draft?.maxCans).toBe(42);
	});

	it('keeps a version 3 team on version 3 and treats a missing version as 2', () => {
		const versioned = normalizeIncomingDraft({
			sponsor: 'idris',
			rulesVersion: 3,
			vehicles: [{ id: 'v1', type: 'sports_car', name: 'Zap', weapons: [], perks: [], driverName: 'Zap' }]
		});
		expect(versioned?.rulesVersion).toBe(3);
		expect(versioned?.vehicles[0].driverName).toBe('Zap');

		const legacy = normalizeIncomingDraft({
			sponsor: 'miyazaki',
			vehicles: [{ id: 'v1', type: 'car', name: 'Old', weapons: [], perks: [] }]
		});
		expect(legacy?.rulesVersion).toBe(2);
	});

	it('returns null when the payload has no vehicles', () => {
		expect(normalizeIncomingDraft({ sponsor: 'idris' })).toBeNull();
		expect(normalizeIncomingDraft(null)).toBeNull();
	});
});

describe('saved vehicles stay renderable', () => {
	it('gives a version 3 Beverly vehicle a unique id and string gear lists', () => {
		const vehicles = withUpgradePerks(
			[
				{
					id: 'anchor',
					type: 'war_rig',
					name: 'My Gaslands Team 2',
					weapons: [{ id: 'bfg', facing: 'front' }, 'machine_gun_abc'] as unknown as string[],
					upgrades: ['extra_armour'],
					perks: []
				},
				{
					id: 'anchor',
					type: 'ghost_rider',
					name: '',
					weapons: [],
					perks: []
				} as ImportedVehicle,
				null as unknown as ImportedVehicle
			],
			[],
			3
		);

		expect(vehicles).toHaveLength(3);
		expect(vehicles.map((vehicle) => vehicle.id)).toEqual(['anchor', 'anchor-2', 'vehicle-3']);
		expect(vehicles[0].weapons).toEqual(['bfg', 'machine_gun_abc']);
		expect(vehicles[0].weaponFacings).toEqual({ bfg: 'front' });
		expect(vehicles[1].type).toBe('ghost_rider');
		expect(vehicles[1].name).toBe('Vehicle');
		expect(vehicles[2].type).toBe('');
		expect(vehicles[2].weapons).toEqual([]);
	});

	it('is stable when the same vehicle is normalized twice', () => {
		const once = withUpgradePerks(
			[{ id: 'v1', type: 'Tank', name: 'Lead', weapons: ['Machine_Gun_UZI5'], perks: ['Battlehammer'], upgrades: ['Big Tyres'] } as ImportedVehicle],
			[],
			3
		);
		const twice = withUpgradePerks(once, [], 3);
		expect(twice).toEqual(once);
	});
});

describe('legacy saved vehicles', () => {
	const beverlyLegacy = {
		teamName: 'My Gaslands Team 2',
		sponsorId: 'ber',
		maxCans: 50,
		rulesVersion: 3,
		vehicles: [
			{
				id: 'FxwR9U',
				vehicleType: 'Tank',
				name: 'New Vehicle',
				weapons: [
					{ weaponId: 'Machine_Gun_UZI5', facing: 'Front' },
					{ id: 'machine_gun_lkhF', facing: 'any' }
				],
				upgrades: { 0: 'Big Tyres' },
				perks: 'Battlehammer',
				driverArchetype: 'arsonist',
				driverName: 'Foo',
				secondPerkClass: 'aggression'
			},
			{ id: 'uYK5nm', type: 'Bike', name: 'New Vehicle' }
		]
	};

	it('turns the Beverly screenshot save into current version 3 ids', () => {
		const draft = normalizeIncomingDraft(beverlyLegacy);
		expect(draft?.sponsor).toBe('beverly');
		expect(draft?.rulesVersion).toBe(3);
		const vehicles = withUpgradePerks(draft?.vehicles, [], 3);
		expect(vehicles[0]).toMatchObject({
			id: 'FxwR9U',
			type: 'tank',
			name: 'New Vehicle',
			weapons: ['machine_gun_UZI5', 'machine_gun_lkhF'],
			upgrades: ['big_tyres'],
			perks: ['battlehammer'],
			weaponFacings: { machine_gun_UZI5: 'front', machine_gun_lkhF: '360' },
			driverArchetype: 'arsonist',
			driverName: 'Foo',
			secondPerkClass: 'aggression'
		});
		expect(vehicles[1]).toMatchObject({ id: 'uYK5nm', type: 'bike', weapons: [], upgrades: [], perks: [] });
	});

	it('fills null gear lists and reads a comma-separated perk string', () => {
		const vehicles = withUpgradePerks(
			[
				{
					id: 'v1',
					type: 'car',
					name: 'Lead',
					weapons: null,
					upgrades: null,
					perks: 'Powder Keg, Expert Driver'
				} as unknown as ImportedVehicle
			],
			[]
		);
		expect(vehicles[0].weapons).toEqual([]);
		expect(vehicles[0].upgrades).toEqual([]);
		expect(vehicles[0].perks).toEqual(['powder_keg', 'Expert Driver']);
	});

	it('reads weaponId, upgradeId, perkId, and name keys plus an id-to-facing map', () => {
		const vehicles = withUpgradePerks(
			[
				{
					id: 'v1',
					type: 'car',
					name: 'Lead',
					weapons: { handgun_ab: 'side' },
					upgrades: [{ upgradeId: 'Ram' }],
					perks: [{ perkId: 'Powder Keg' }, { name: 'Not A Real Perk' }]
				} as unknown as ImportedVehicle
			],
			[]
		);
		expect(vehicles[0].weapons).toEqual(['handgun_ab']);
		expect(vehicles[0].weaponFacings).toEqual({ handgun_ab: 'side' });
		expect(vehicles[0].upgrades).toEqual(['ram']);
		expect(vehicles[0].perks).toEqual(['powder_keg', 'Not A Real Perk']);
	});

	it('maps old facing words and leaves an unknown facing alone', () => {
		const vehicles = withUpgradePerks(
			[
				{
					id: 'v1',
					type: 'car',
					name: 'Lead',
					weapons: [
						{ id: 'handgun_a', facing: 'turret' },
						{ id: 'handgun_b', facing: 'hull' },
						{ id: 'handgun_c', facing: 'SIDE' }
					],
					weaponFacings: { handgun_d: 'full', handgun_e: 'port' },
					perks: []
				} as unknown as ImportedVehicle
			],
			[]
		);
		expect(vehicles[0].weaponFacings).toMatchObject({
			handgun_a: '360',
			handgun_b: 'front',
			handgun_c: 'side',
			handgun_d: '360',
			handgun_e: 'port'
		});
	});

	it('keeps a type the active catalog does not know', () => {
		const vehicles = withUpgradePerks(
			[{ id: 'spirit', type: 'ghost_rider', name: 'Spirit', weapons: [], perks: [] }],
			[],
			3
		);
		expect(vehicles[0].type).toBe('ghost_rider');
	});

	it('maps version 2-only types onto version 3 when that id is missing', () => {
		const vehicles = withUpgradePerks(
			[
				{ id: 'a', type: 'car', name: 'A', weapons: [], perks: [] },
				{ id: 'b', type: 'Performance Car', name: 'B', weapons: [], perks: [] },
				{ id: 'c', type: 'truck', name: 'C', weapons: [], perks: [] },
				{ id: 'd', type: 'drag_racer', name: 'D', weapons: [], perks: [] },
				{ id: 'e', type: 'bike_with_sidecar', name: 'E', weapons: [], perks: [] },
				{ id: 'f', type: 'ice_cream_truck', name: 'F', weapons: [], perks: [] },
				{ id: 'g', type: 'ambulance', name: 'G', weapons: [], perks: [] },
				{ id: 'h', type: 'tank', name: 'H', weapons: [], perks: [] }
			],
			[],
			3
		);
		expect(vehicles.map((vehicle) => vehicle.type)).toEqual([
			'passenger_car',
			'sports_car',
			'pickup',
			'hot_rod',
			'bike',
			'van',
			'van',
			'tank'
		]);
	});

	it('maps version 3-only types onto Refuelled when that id is missing', () => {
		const vehicles = withUpgradePerks(
			[
				{ id: 'a', type: 'passenger_car', name: 'A', weapons: [], perks: [] },
				{ id: 'b', type: 'sports_car', name: 'B', weapons: [], perks: [] },
				{ id: 'c', type: 'muscle_car', name: 'C', weapons: [], perks: [] },
				{ id: 'd', type: 'hot_rod', name: 'D', weapons: [], perks: [] },
				{ id: 'e', type: 'pickup', name: 'E', weapons: [], perks: [] },
				{ id: 'f', type: 'van', name: 'F', weapons: [], perks: [] },
				{ id: 'g', type: 'bike', name: 'G', weapons: [], perks: [] }
			],
			[],
			2
		);
		expect(vehicles.map((vehicle) => vehicle.type)).toEqual([
			'car',
			'performance_car',
			'car',
			'performance_car',
			'truck',
			'truck',
			'bike'
		]);
	});

	it('maps sponsor short ids and edition renames, and leaves removed ids alone', () => {
		expect(normalizeIncomingDraft({ sponsorId: 'ber', rulesVersion: 3, vehicles: [] })?.sponsor).toBe('beverly');
		expect(normalizeIncomingDraft({ sponsor: 'rus', vehicles: [] })?.sponsor).toBe('rustys');
		expect(normalizeIncomingDraft({ sponsor: 'rus', rulesVersion: 3, vehicles: [] })?.sponsor).toBe('rusty');
		expect(normalizeIncomingDraft({ sponsor: 'rustys', rulesVersion: 3, vehicles: [] })?.sponsor).toBe('rusty');
		expect(normalizeIncomingDraft({ sponsor: 'rusty', vehicles: [] })?.sponsor).toBe('rustys');
		expect(normalizeIncomingDraft({ sponsor: 'inferno', rulesVersion: 3, vehicles: [] })?.sponsor).toBe(
			'order_of_the_inferno'
		);
		expect(normalizeIncomingDraft({ sponsor: 'order_of_the_inferno', vehicles: [] })?.sponsor).toBe('inferno');
		expect(normalizeIncomingDraft({ sponsor: 'idr', vehicles: [] })?.sponsor).toBe('idris');
		expect(normalizeIncomingDraft({ sponsor: 'thp', vehicles: [] })?.sponsor).toBe('highway_patrol');
		expect(normalizeIncomingDraft({ sponsor: 'the_highway_patrol', vehicles: [] })?.sponsor).toBe('highway_patrol');
		expect(normalizeIncomingDraft({ sponsor: 'scarlett_annie', vehicles: [] })?.sponsor).toBe('scarlett');
		expect(normalizeIncomingDraft({ sponsor: 'rusty_s_bootleggers', rulesVersion: 3, vehicles: [] })?.sponsor).toBe(
			'rusty'
		);
		expect(normalizeIncomingDraft({ sponsor: 'chivo', vehicles: [] })?.sponsor).toBe('chivo');
		expect(normalizeIncomingDraft({ sponsor: 'ald', rulesVersion: 3, vehicles: [] })?.sponsor).toBe('ald');
		expect(normalizeIncomingDraft({ sponsor: 'Beverly', rulesVersion: 3, vehicles: [] })?.sponsor).toBe('beverly');
	});
});

describe('readSavedTeamId', () => {
	it('reads only an explicit top-level savedTeamId', () => {
		expect(readSavedTeamId({ savedTeamId: ' team-1 ' })).toBe('team-1');
		expect(readSavedTeamId({ id: 'doc', teamData: { savedTeamId: 'nested' } })).toBeNull();
		expect(readSavedTeamId({ savedTeamId: '' })).toBeNull();
		expect(readSavedTeamId(null)).toBeNull();
	});
});
