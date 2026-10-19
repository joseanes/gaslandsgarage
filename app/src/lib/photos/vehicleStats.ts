/**
 * Snapshot of the build the Gallery shows with a photo.
 * Copied on the server from the saved team. The browser does not send these numbers.
 */

import vehiclesJson from '../../data/rules/vehicles.json';
import weaponsJson from '../../data/rules/weapons.json';
import upgradesJson from '../../data/rules/upgrades.json';
import perksJson from '../../data/rules/perks.json';
import { loadV3Catalog } from '../../data/rules/v3';
import type { V3Perk, V3Upgrade, V3Vehicle, V3Weapon } from '../../data/rules/v3/types';
import { resolveById } from '../validate/v3/lookup';
import { v3BuildSlots } from '../validate/v3/slots';
import { effectiveStats } from '../validate/v3/stats';
import { vehicleTypeLabel, type VehicleStatsSnapshot } from './share';

interface Named {
	id: string;
	name: string;
	cost?: number;
	slots?: number;
	baseCost?: number;
	maxHull?: number;
	handling?: number;
	crew?: number;
	maxGear?: number;
	buildSlots?: number;
	hull?: number;
	gear?: number;
	weight?: string | number;
	armour?: string | number;
	hullModifier?: number;
	handlingModifier?: number;
	crewModifier?: number;
	gearModifier?: number;
}

const v2Vehicles = vehiclesJson as Named[];
const v2Weapons = weaponsJson as Named[];
const v2Upgrades = upgradesJson as Named[];
const v2Perks = perksJson as Named[];

/** Refuelled weapons and upgrades the builder does not charge a build slot for. */
const V2_FREE_SLOTS = new Set(['handgun', 'molotov', 'grenades', 'ram', 'oil_slick', 'smokescreen']);

function ids(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 24);
}

function text(value: unknown): string {
	if (typeof value !== 'string') return '';
	const cleaned = value.replace(/[\u0000-\u001f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 80);
	return cleaned.includes('@') ? '' : cleaned;
}

function num(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function bonus(item: Named | undefined, field: 'hull' | 'handling' | 'crew' | 'gear'): number {
	if (!item) return 0;
	const modifier = item[`${field}Modifier` as keyof Named];
	return num(item[field]) + num(modifier);
}

function listNames<T extends { name: string }>(items: T[]): string[] {
	return items.map((item) => text(item.name)).filter((name) => name.length > 0);
}

function v2Snapshot(vehicle: Record<string, unknown>): VehicleStatsSnapshot {
	const type = v2Vehicles.find((entry) => entry.id === vehicle.type);
	const weapons = ids(vehicle.weapons)
		.map((id) => resolveById(v2Weapons, id))
		.filter((item): item is Named => !!item);
	const upgrades = ids(vehicle.upgrades)
		.map((id) => v2Upgrades.find((entry) => entry.id === id))
		.filter((item): item is Named => !!item);
	const perks = ids(vehicle.perks)
		.map((id) => v2Perks.find((entry) => entry.id === id))
		.filter((item): item is Named => !!item);
	let cans = num(type?.baseCost);
	let used = 0;
	for (const weapon of weapons) {
		cans += num(weapon.cost);
		if (!V2_FREE_SLOTS.has(weapon.id)) used += num(weapon.slots);
	}
	for (const upgrade of upgrades) {
		cans += num(upgrade.cost);
		if (!V2_FREE_SLOTS.has(upgrade.id)) used += num(upgrade.slots);
	}
	for (const perk of perks) cans += num(perk.cost);
	const capacity = num(type?.buildSlots) || 2;
	return {
		type: text(type?.name) || vehicleTypeLabel(vehicle.type),
		name: text(vehicle.name),
		hull: num(type?.maxHull) + upgrades.reduce((sum, item) => sum + bonus(item, 'hull'), 0),
		handling: num(type?.handling) + upgrades.reduce((sum, item) => sum + bonus(item, 'handling'), 0),
		crew: num(type?.crew) + upgrades.reduce((sum, item) => sum + bonus(item, 'crew'), 0),
		gear: num(type?.maxGear) + upgrades.reduce((sum, item) => sum + bonus(item, 'gear'), 0),
		cans,
		weapons: listNames(weapons),
		upgrades: listNames(upgrades),
		perks: listNames(perks),
		slots: `${used}/${capacity}`,
		weight: text(type?.weight == null ? '' : String(type.weight)),
		armour: text(type?.armour == null ? '' : String(type.armour)),
		driver: ''
	};
}

function v3Snapshot(vehicle: Record<string, unknown>): VehicleStatsSnapshot {
	const catalog = loadV3Catalog();
	const type = catalog.vehicleTypes.find((entry) => entry.id === vehicle.type);
	const weapons = ids(vehicle.weapons)
		.map((id) => resolveById(catalog.weapons, id))
		.filter((item): item is V3Weapon => !!item);
	const upgrades = ids(vehicle.upgrades)
		.map((id) => catalog.upgrades.find((entry) => entry.id === id))
		.filter((item): item is V3Upgrade => !!item);
	const perks = ids(vehicle.perks)
		.map((id) => catalog.perks.find((entry) => entry.id === id))
		.filter((item): item is V3Perk => !!item);
	const blank: V3Vehicle = {
		id: 'vehicle',
		name: 'Vehicle',
		rarity: 'common',
		maxGear: 0,
		handling: 0,
		crew: 0,
		weight: 0,
		armour: 0,
		maxHull: 0,
		buildSlots: 0,
		baseCost: 0,
		specialRules: ''
	};
	const base = type ?? blank;
	const stats = effectiveStats(base, upgrades, perks);
	const slots = v3BuildSlots(base, weapons, upgrades);
	let cans = base.baseCost;
	for (const weapon of weapons) cans += weapon.cost;
	for (const upgrade of upgrades) cans += upgrade.cost;
	for (const perk of perks) cans += perk.cost;
	const turretId = typeof vehicle.turretWeaponId === 'string' ? vehicle.turretWeaponId : '';
	const turret = turretId ? resolveById(catalog.weapons, turretId) : undefined;
	const weaponNames = listNames(weapons);
	if (turret && upgrades.some((upgrade) => upgrade.addsWeaponCost)) {
		cans += turret.cost;
		const turretName = text(turret.name);
		if (turretName && !weaponNames.includes(turretName)) weaponNames.push(turretName);
	}
	const driver = catalog.drivers.find((entry) => entry.id === vehicle.driverArchetype);
	const driverName = text(vehicle.driverName);
	const driverLabel = driver ? `${driver.name}${driverName ? ` (${driverName})` : ''}` : driverName;
	return {
		type: text(base.name) || vehicleTypeLabel(vehicle.type),
		name: text(vehicle.name),
		hull: stats.hull,
		handling: stats.handling,
		crew: stats.crew,
		gear: stats.gear,
		cans,
		weapons: weaponNames,
		upgrades: listNames(upgrades),
		perks: listNames(perks),
		slots: `${slots.used}/${slots.capacity}`,
		weight: String(stats.weight),
		armour: String(stats.armour),
		driver: text(driverLabel)
	};
}

/** The stats the builder shows for this saved vehicle. */
export function vehicleStatsSnapshot(vehicle: unknown, rulesVersion: unknown): VehicleStatsSnapshot {
	const row = vehicle && typeof vehicle === 'object' && !Array.isArray(vehicle) ? (vehicle as Record<string, unknown>) : {};
	return rulesVersion === 3 ? v3Snapshot(row) : v2Snapshot(row);
}
