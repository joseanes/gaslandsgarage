import type { V3Perk, V3Upgrade, V3Vehicle } from '../../../data/rules/v3/types';

export interface EffectiveStats {
	hull: number;
	gear: number;
	handling: number;
	crew: number;
	weight: number;
	armour: number;
}

/** Final build stats used for sponsor and trailer checks. */
export function effectiveStats(
	vehicle: V3Vehicle,
	upgrades: V3Upgrade[],
	perks: V3Perk[]
): EffectiveStats {
	const stats: EffectiveStats = {
		hull: vehicle.maxHull,
		gear: vehicle.maxGear,
		handling: vehicle.handling,
		crew: vehicle.crew,
		weight: vehicle.weight,
		armour: vehicle.armour
	};
	let hasV10 = false;
	for (const upgrade of upgrades) {
		if (upgrade.hull) stats.hull += upgrade.hull;
		if (upgrade.gear) stats.gear += upgrade.gear;
		if (upgrade.handling) stats.handling += upgrade.handling;
		if (upgrade.crew) stats.crew += upgrade.crew;
		if (upgrade.weight) stats.weight += upgrade.weight;
		if (upgrade.armour) stats.armour += upgrade.armour;
		if (upgrade.id === 'v10_engine') hasV10 = true;
	}
	for (const perk of perks) {
		if (perk.crew) stats.crew += perk.crew;
	}
	if (hasV10) stats.gear = Math.min(stats.gear, 6);
	return stats;
}
