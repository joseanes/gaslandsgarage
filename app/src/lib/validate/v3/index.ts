import { loadV3Catalog } from '../../../data/rules/v3';
import type { V3Catalog, V3Perk, V3Upgrade, V3Vehicle, V3Weapon } from '../../../data/rules/v3/types';
import {
	V3_DEFAULT_BUDGET,
	countedVehicleTotal,
	maxCountedVehicles
} from '$lib/rules/version';
import type { Draft, Validation, VehicleReport } from '../model';
import { resolveById } from './lookup';
import { v3BuildSlots } from './slots';
import { effectiveStats } from './stats';

const FACINGS = new Set(['front', 'side', 'rear']);

interface Hydrated {
	instance: Draft['vehicles'][number];
	vehicle: V3Vehicle;
	weapons: V3Weapon[];
	upgrades: V3Upgrade[];
	perks: V3Perk[];
	cans: number;
	stats: ReturnType<typeof effectiveStats>;
}

function teamHasSpark(rows: Hydrated[], catalog: V3Catalog): boolean {
	return rows.some((row) => {
		const driver = catalog.drivers.find((entry) => entry.id === row.instance.driverArchetype);
		return driver?.unlocksElectrical === true;
	});
}

function unlockedClasses(instance: Draft['vehicles'][number], catalog: V3Catalog): string[] {
	const classes: string[] = [];
	const driver = catalog.drivers.find((entry) => entry.id === instance.driverArchetype);
	if (driver) classes.push(driver.perkClass);
	const named = (instance.driverName ?? '').trim().length > 0;
	const second = instance.secondPerkClass;
	if (named && second && catalog.perkClasses.some((entry) => entry.id === second) && !classes.includes(second)) {
		classes.push(second);
	}
	return classes;
}

function vehicleCost(
	vehicle: V3Vehicle,
	weapons: V3Weapon[],
	upgrades: V3Upgrade[],
	perks: V3Perk[],
	turretWeapon: V3Weapon | undefined
): number {
	let total = vehicle.baseCost;
	for (const weapon of weapons) total += weapon.cost;
	for (const upgrade of upgrades) total += upgrade.cost;
	for (const perk of perks) total += perk.cost;
	if (turretWeapon && upgrades.some((upgrade) => upgrade.addsWeaponCost)) {
		total += turretWeapon.cost;
	}
	return total;
}

export function validateDraftV3(draft: Draft, catalog: V3Catalog = loadV3Catalog()): Validation {
	const budget = draft.maxCans || V3_DEFAULT_BUDGET;
	const errors: string[] = [];
	const vehicleReports: VehicleReport[] = [];

	const sponsorId = draft.sponsor || 'no_sponsor';
	const sponsor = catalog.sponsors.find((entry) => entry.id === sponsorId);
	if (!sponsor) {
		return { cans: 0, errors: ['Unknown sponsor'], vehicleReports: [] };
	}

	const hydrated: Hydrated[] = [];
	const seenArchetypes = new Map<string, string>();

	for (const instance of draft.vehicles) {
		const report: VehicleReport = { vehicleId: instance.id, cans: 0, errors: [] };
		const vehicle = catalog.vehicleTypes.find((entry) => entry.id === instance.type);
		if (!vehicle) {
			report.errors.push(`Unknown vehicle type: ${instance.type}`);
			vehicleReports.push(report);
			continue;
		}

		const weapons: V3Weapon[] = [];
		for (const weaponId of instance.weapons) {
			const weapon = resolveById(catalog.weapons, weaponId);
			if (!weapon) report.errors.push(`Unknown weapon: ${weaponId}`);
			else weapons.push(weapon);
		}
		const upgrades: V3Upgrade[] = [];
		for (const upgradeId of instance.upgrades ?? []) {
			const upgrade = catalog.upgrades.find((entry) => entry.id === upgradeId);
			if (!upgrade) report.errors.push(`Unknown upgrade: ${upgradeId}`);
			else upgrades.push(upgrade);
		}
		const perks: V3Perk[] = [];
		for (const perkId of instance.perks) {
			const perk = catalog.perks.find((entry) => entry.id === perkId);
			if (!perk) report.errors.push(`Unknown perk: ${perkId}`);
			else perks.push(perk);
		}

		const turret = upgrades.find((upgrade) => upgrade.addsWeaponCost);
		let turretWeapon: V3Weapon | undefined;
		if (turret) {
			const selected = instance.turretWeaponId
				? resolveById(catalog.weapons, instance.turretWeaponId)
				: undefined;
			const equipped = selected && weapons.some((weapon) => weapon.id === selected.id);
			if (!selected || !equipped || selected.category === 'dropped') {
				report.errors.push('Turret Mount needs one of this vehicle’s shooting weapons');
			} else {
				turretWeapon = selected;
			}
		}

		const cans = vehicleCost(vehicle, weapons, upgrades, perks, turretWeapon);
		report.cans = cans;
		const stats = effectiveStats(vehicle, upgrades, perks);

		checkVehicleBuild(instance, vehicle, weapons, upgrades, perks, catalog, report);

		const archetype = instance.driverArchetype;
		if (archetype) {
			const driver = catalog.drivers.find((entry) => entry.id === archetype);
			if (!driver) {
				report.errors.push(`Unknown driver: ${archetype}`);
			} else if (seenArchetypes.has(archetype)) {
				report.errors.push(`Driver archetype ${driver.name} is already used on this team`);
			} else {
				seenArchetypes.set(archetype, instance.id);
			}
		}
		if ((instance.secondPerkClass ?? '').length > 0 && !(instance.driverName ?? '').trim()) {
			report.errors.push('A second perk class requires a named driver');
		} else if (
			instance.secondPerkClass &&
			!catalog.perkClasses.some((entry) => entry.id === instance.secondPerkClass)
		) {
			report.errors.push(`Unknown perk class: ${instance.secondPerkClass}`);
		}

		hydrated.push({ instance, vehicle, weapons, upgrades, perks, cans, stats });
		vehicleReports.push(report);
	}

	const electrical = teamHasSpark(hydrated, catalog);
	for (const row of hydrated) {
		const report = vehicleReports.find((entry) => entry.vehicleId === row.instance.id);
		if (!report) continue;
		const allowed = electrical || row.vehicle.utility === true;
		if (!allowed) {
			for (const weapon of row.weapons) {
				if (weapon.electrical) report.errors.push(`${weapon.name} is electrical and this team has not unlocked it`);
			}
			for (const upgrade of row.upgrades) {
				if (upgrade.electrical) report.errors.push(`${upgrade.name} is electrical and this team has not unlocked it`);
			}
		}
	}

	checkTeamLimits(hydrated, budget, errors);
	checkRareItems(hydrated, errors);
	if (sponsor.id !== 'no_sponsor') {
		const sponsorError = sponsorRequirement(sponsor.id, hydrated);
		if (sponsorError) errors.push(sponsorError);
	}

	const cans = vehicleReports.reduce((sum, report) => sum + report.cans, 0);
	if (cans > budget) {
		errors.push(`Team exceeds ${budget} cans (currently ${cans})`);
	}

	return { cans, errors, vehicleReports };
}

function checkVehicleBuild(
	instance: Draft['vehicles'][number],
	vehicle: V3Vehicle,
	weapons: V3Weapon[],
	upgrades: V3Upgrade[],
	perks: V3Perk[],
	catalog: V3Catalog,
	report: VehicleReport
) {
	const slots = v3BuildSlots(vehicle, weapons, upgrades);
	if (slots.used > slots.capacity) {
		report.errors.push(`Too many build slots: ${slots.used}/${slots.capacity}`);
	}

	const upgradeCounts = new Map<string, number>();
	const droppedCounts = new Map<string, number>();
	let trailers = 0;
	for (const upgrade of upgrades) {
		upgradeCounts.set(upgrade.id, (upgradeCounts.get(upgrade.id) ?? 0) + 1);
		if (upgrade.category === 'common' && (upgradeCounts.get(upgrade.id) ?? 0) > 1) {
			report.errors.push(`Duplicate upgrade: ${upgrade.name}`);
		}
		if (upgrade.isTrailer) {
			trailers += 1;
			if (vehicle.airborne) report.errors.push(`${vehicle.name} cannot take a trailer`);
			if (upgrade.minWeight && effectiveStats(vehicle, upgrades, perks).weight < upgrade.minWeight) {
				report.errors.push(`${upgrade.name} needs weight ${upgrade.minWeight}+`);
			}
		}
		if (upgrade.needsFacing) {
			const facing = instance.upgradeFacings?.[upgrade.id];
			if (!facing || !FACINGS.has(facing)) {
				report.errors.push(`${upgrade.name} needs a front, side, or rear facing`);
			}
		}
	}
	if (trailers > 1) report.errors.push('Only one trailer per vehicle');

	for (const weaponId of instance.weapons) {
		const weapon = resolveById(catalog.weapons, weaponId);
		if (!weapon) continue;
		if (weapon.category === 'dropped') {
			droppedCounts.set(weapon.id, (droppedCounts.get(weapon.id) ?? 0) + 1);
			if ((droppedCounts.get(weapon.id) ?? 0) > 1) {
				report.errors.push(`Duplicate dropped weapon: ${weapon.name}`);
			}
		}
		if (weapon.arc === 'facing') {
			const facing = instance.weaponFacings?.[weaponId];
			if (!facing || !FACINGS.has(facing)) {
				report.errors.push(`${weapon.name} needs a front, side, or rear facing`);
			}
		}
	}

	const classes = unlockedClasses(instance, catalog);
	const perkCounts = new Map<string, number>();
	for (const perk of perks) {
		perkCounts.set(perk.id, (perkCounts.get(perk.id) ?? 0) + 1);
		if ((perkCounts.get(perk.id) ?? 0) > 1) {
			report.errors.push(`Duplicate perk: ${perk.name}`);
		}
		if (!classes.includes(perk.class)) {
			report.errors.push(`${perk.name} is not in an unlocked perk class`);
		}
	}
}

function checkTeamLimits(rows: Hydrated[], budget: number, errors: string[]) {
	const counted = countedVehicleTotal(rows.map((row) => row.vehicle.id));
	const allowed = maxCountedVehicles(budget);
	if (counted > allowed) {
		errors.push(
			`Too many vehicles: ${counted} count toward the limit of ${allowed} (one per full 20 cans, maximum 3; the first bike is not counted)`
		);
	}

	const rareCounts = new Map<string, number>();
	let skippedBike = false;
	for (const row of rows) {
		if (row.vehicle.rarity !== 'rare') continue;
		if (row.vehicle.mob && !skippedBike) {
			skippedBike = true;
			continue;
		}
		rareCounts.set(row.vehicle.id, (rareCounts.get(row.vehicle.id) ?? 0) + 1);
	}
	for (const [id, count] of rareCounts) {
		if (count > 1) {
			const name = rows.find((row) => row.vehicle.id === id)?.vehicle.name ?? id;
			errors.push(`Only one ${name} per team`);
		}
	}
}

function checkRareItems(rows: Hydrated[], errors: string[]) {
	const rareWeapons = new Map<string, string>();
	const rareUpgrades = new Map<string, string>();
	for (const row of rows) {
		for (const weapon of row.weapons) {
			if (weapon.category !== 'rare') continue;
			if (rareWeapons.has(weapon.id)) errors.push(`Rare weapon ${weapon.name} can only be taken once per team`);
			else rareWeapons.set(weapon.id, row.instance.id);
		}
		for (const upgrade of row.upgrades) {
			if (upgrade.category !== 'rare') continue;
			if (rareUpgrades.has(upgrade.id)) errors.push(`Rare upgrade ${upgrade.name} can only be taken once per team`);
			else rareUpgrades.set(upgrade.id, row.instance.id);
		}
	}
}

function sponsorRequirement(id: string, rows: Hydrated[]): string | null {
	if (rows.length === 0) return 'A sponsor requires at least one vehicle';
	const fail = (message: string) => message;

	switch (id) {
		case 'chivo':
			return rows.every((row) => row.cans >= 25) ? null : fail('Chivo requires every vehicle to cost at least 25 cans');
		case 'highway_patrol':
			return rows.every((row) => row.upgrades.some((upgrade) => upgrade.id === 'siren'))
				? null
				: fail('Highway Patrol requires a Siren on every vehicle');
		case 'idris':
			return rows.every((row) => row.stats.gear >= 6) ? null : fail('Idris requires Max Gear 6 on every vehicle');
		case 'jumbo':
			return rows.every((row) => row.stats.weight >= 4) ? null : fail('Jumbo requires weight 4+ on every vehicle');
		case 'miyazaki':
			return rows.every((row) => row.perks.length >= 2) ? null : fail('Miyazaki requires 2+ perks on every vehicle');
		case 'mishkin':
			return rows.every(
				(row) =>
					row.weapons.some((weapon) => weapon.category === 'rare' || weapon.electrical) ||
					row.upgrades.some((upgrade) => upgrade.category === 'rare' || upgrade.electrical)
			)
				? null
				: fail('Mishkin requires a rare or electrical weapon or upgrade on every vehicle');
		case 'maxxine':
			return rows.every((row) => row.stats.weight <= 3) ? null : fail('Maxxine requires weight 3 or less on every vehicle');
		case 'order_of_the_inferno': {
			const pyros = rows.reduce((sum, row) => sum + row.perks.filter((perk) => perk.class === 'pyromania').length, 0);
			const fires = rows.reduce(
				(sum, row) => sum + row.weapons.filter((weapon) => weapon.keywords.includes('fire')).length,
				0
			);
			return pyros + fires >= 3 ? null : fail('Order of the Inferno requires 3+ Pyromania perks and/or Fire weapons');
		}
		case 'rusty':
			return rows.reduce((sum, row) => sum + row.upgrades.length, 0) >= 5
				? null
				: fail('Rusty requires 5+ upgrades on the team');
		case 'rutherford':
			return rows.reduce((sum, row) => sum + row.weapons.filter((weapon) => weapon.countsAsShooting).length, 0) >= 5
				? null
				: fail('Rutherford requires 5+ shooting weapons, ignoring handguns');
		case 'scarlett': {
			const crew = rows.reduce((sum, row) => sum + row.stats.crew, 0);
			const weight = rows.reduce((sum, row) => sum + row.stats.weight, 0);
			return crew > weight ? null : fail('Scarlett requires total crew greater than total weight');
		}
		case 'slime':
			return rows.every((row) => row.upgrades.length >= 1) ? null : fail('Slime requires an upgrade on every vehicle');
		case 'verney':
			return rows.every((row) => new Set(row.weapons.filter((weapon) => weapon.category === 'dropped').map((weapon) => weapon.id)).size >= 2)
				? null
				: fail('Verney requires 2+ different dropped weapons on every vehicle');
		case 'warden':
			return rows.every((row) => row.stats.hull >= 10) ? null : fail('The Warden requires hull 10+ on every vehicle');
		case 'beverly':
			return rows.filter((row) => row.stats.hull >= 12).length === 1
				? null
				: fail('Beverly requires exactly one vehicle with hull 12+');
		default:
			return fail('Unknown sponsor');
	}
}
