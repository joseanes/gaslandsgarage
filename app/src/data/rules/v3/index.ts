import { v3Drivers, v3PerkClasses } from './drivers';
import { v3Perks } from './perks';
import { v3Sponsors } from './sponsors';
import type { V3Catalog } from './types';
import { v3Upgrades } from './upgrades';
import { v3VehicleRules, v3Vehicles } from './vehicles';
import { v3Weapons } from './weapons';

export function loadV3Catalog(): V3Catalog {
	return {
		sponsors: v3Sponsors,
		vehicleTypes: v3Vehicles,
		weapons: v3Weapons,
		upgrades: v3Upgrades,
		perks: v3Perks,
		vehicleRules: v3VehicleRules,
		drivers: v3Drivers,
		perkClasses: v3PerkClasses
	};
}

export type { V3Catalog, V3Driver, V3Perk, V3Sponsor, V3Upgrade, V3Vehicle, V3Weapon } from './types';
