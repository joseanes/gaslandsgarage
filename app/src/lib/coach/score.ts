import { v3BuildSlots } from '$lib/validate/v3/slots';
import {
	METRICS,
	gainPerCan,
	rateScore,
	roundTo,
	type MetricId,
	type ScoreStatus
} from './thresholds';

export interface ChassisStats {
	id: string;
	name: string;
	baseCost: number;
	maxGear: number;
	maxHull: number;
	handling?: number;
	armour?: number;
	buildSlots?: number;
	weight?: string | number;
	specialRules?: string;
	/** 3rd edition van: discounts upgrade slots. */
	utility?: boolean;
	/** 3rd edition tank: turret mount is free. */
	turretFree?: boolean;
}

export interface ScoreWeapon {
	id: string;
	name?: string;
	cost?: number;
	slots?: number;
	attackDice?: number | string;
	range?: string;
	electrical?: boolean;
	advanced?: boolean;
	crewFired?: boolean;
	dropped?: boolean;
}

export interface ScoreUpgrade {
	id: string;
	name?: string;
	cost?: number;
	slots?: number;
	hull?: number;
	armour?: number;
	handling?: number;
	handlingModifier?: number;
	advanced?: boolean;
	electrical?: boolean;
	isTrailer?: boolean;
	bonusSlots?: number;
	utility?: boolean;
	turretFree?: boolean;
}

export interface ScoreVehicle {
	id: string;
	type: string;
	name?: string;
	weapons?: string[];
	upgrades?: string[];
	perks?: string[];
	driverArchetype?: string;
}

export interface ScoreRule {
	id: string;
	ruleName: string;
}

export interface ScoreSnapshot {
	attackDice: number;
	hull: number;
	durability: number;
	gearSum: number;
	handlingSum: number;
	count: number;
	slotsUsed: number;
	slotsCapacity: number;
	totalCans: number;
	maxCans: number;
	rulesVersion: 2 | 3;
}

export interface ScoreCard {
	combat: number;
	survivability: number;
	mobility: number;
	slotEfficiency: number;
	avgGear: number;
	avgHandling: number;
}

export type RangeCounts = {
	short: number;
	medium: number;
	long: number;
	double: number;
	template: number;
	dropped: number;
	burst: number;
};

export type WeightClass = 'Lightweight' | 'Middleweight' | 'Heavyweight' | 'Massive' | 'Other';

export interface TeamEvaluation {
	snapshot: ScoreSnapshot;
	scores: ScoreCard;
	statuses: Record<MetricId, ScoreStatus>;
	weaponCount: number;
	ranges: RangeCounts;
	electrical: number;
	nonElectrical: number;
	weights: Record<WeightClass, number>;
	specialRules: string[];
	cansLeft: number;
}

const WEIGHT_CLASSES: readonly WeightClass[] = ['Lightweight', 'Middleweight', 'Heavyweight', 'Massive', 'Other'];

/**
 * Crew weapons and a few zero-slot tricks do not spend a build slot.
 * Kept in step with the coach's previous slot math.
 */
const FREE_SLOT_WEAPONS = new Set(['handgun', 'molotov', 'grenades', 'ram', 'oil_slick', 'smokescreen']);

export function numericDice(weapon: { attackDice?: number | string } | undefined): number {
	if (!weapon || typeof weapon.attackDice !== 'number') return 0;
	return weapon.attackDice;
}

export function findBaseWeaponId(weaponInstanceId: string, weapons: readonly { id: string }[]): string {
	const parts = weaponInstanceId.split('_');
	if (parts.length === 1) return weaponInstanceId;
	for (let i = parts.length - 1; i >= 1; i--) {
		const potential = parts.slice(0, i).join('_');
		if (weapons.some((weapon) => weapon.id === potential)) return potential;
	}
	return parts.slice(0, -1).join('_');
}

export function chassisHandling(vehicle: { handling?: number }): number {
	return vehicle.handling ?? 4;
}

export function emptyRanges(): RangeCounts {
	return { short: 0, medium: 0, long: 0, double: 0, template: 0, dropped: 0, burst: 0 };
}

export function scoresFromSnapshot(snapshot: ScoreSnapshot): ScoreCard {
	const count = snapshot.count;
	const avgGear = count ? snapshot.gearSum / count : 0;
	const avgHandling = count ? snapshot.handlingSum / count : 0;
	const cans = snapshot.totalCans;
	return {
		combat: cans ? roundTo(snapshot.attackDice / cans, 2) : 0,
		survivability: cans ? roundTo(snapshot.durability / cans, 2) : 0,
		mobility: count ? roundTo(avgGear * 0.6 + avgHandling * 0.4, 1) : 0,
		slotEfficiency:
			snapshot.slotsCapacity > 0 ? Math.round((snapshot.slotsUsed / snapshot.slotsCapacity) * 100) : 0,
		avgGear: count ? roundTo(avgGear, 1) : 0,
		avgHandling: count ? roundTo(avgHandling, 1) : 0
	};
}

export function statusesFor(scores: ScoreCard): Record<MetricId, ScoreStatus> {
	return {
		combat: rateScore(scores.combat, METRICS.combat),
		survivability: rateScore(scores.survivability, METRICS.survivability),
		mobility: rateScore(scores.mobility, METRICS.mobility),
		slots: rateScore(scores.slotEfficiency, METRICS.slots),
		gear: rateScore(scores.avgGear, METRICS.gear),
		handling: rateScore(scores.avgHandling, METRICS.handling)
	};
}

function isWeightClass(value: string): value is WeightClass {
	return (WEIGHT_CLASSES as readonly string[]).includes(value);
}

export function slotUsageForVehicle(
	vehicle: ScoreVehicle,
	vehicleType: ChassisStats | undefined,
	weapons: readonly ScoreWeapon[],
	upgrades: readonly ScoreUpgrade[],
	rulesVersion: 2 | 3
): { used: number; capacity: number } {
	if (!vehicleType) return { used: 0, capacity: 0 };

	const weaponLoad = (vehicle.weapons ?? [])
		.map((id) => weapons.find((weapon) => weapon.id === findBaseWeaponId(id, weapons)))
		.filter((weapon): weapon is ScoreWeapon => !!weapon);
	const upgradeLoad = (vehicle.upgrades ?? [])
		.map((id) => upgrades.find((upgrade) => upgrade.id === id))
		.filter((upgrade): upgrade is ScoreUpgrade => !!upgrade);

	if (rulesVersion === 3) {
		return v3BuildSlots(
			{
				buildSlots: vehicleType.buildSlots ?? 0,
				utility: vehicleType.utility,
				turretFree: vehicleType.turretFree
			},
			weaponLoad.map((weapon) => ({ slots: weapon.slots ?? 0 })),
			upgradeLoad.map((upgrade) => ({
				id: upgrade.id,
				slots: upgrade.slots ?? 0,
				isTrailer: upgrade.isTrailer,
				bonusSlots: upgrade.bonusSlots
			}))
		);
	}

	let used = 0;
	let extra = 0;
	for (const weapon of weaponLoad) {
		if (FREE_SLOT_WEAPONS.has(weapon.id)) continue;
		if (weapon.slots) used += weapon.slots;
	}
	for (const upgrade of upgradeLoad) {
		if (upgrade.id === 'grenades') continue;
		if (!upgrade.slots) continue;
		if (upgrade.slots < 0) extra += Math.abs(upgrade.slots);
		else used += upgrade.slots;
	}
	return { used, capacity: (vehicleType.buildSlots ?? 0) + extra };
}

function vehicleHull(vehicle: ScoreVehicle, vehicleType: ChassisStats | undefined, upgrades: readonly ScoreUpgrade[]): number {
	if (!vehicleType) return 0;
	let hull = vehicleType.maxHull || 0;
	for (const upgradeId of vehicle.upgrades ?? []) {
		const upgrade = upgrades.find((item) => item.id === upgradeId);
		if (upgrade?.hull) hull += upgrade.hull;
		else if (upgradeId === 'armor') hull += 1;
	}
	return hull;
}

function vehicleArmour(vehicle: ScoreVehicle, vehicleType: ChassisStats | undefined, upgrades: readonly ScoreUpgrade[]): number {
	let armour = vehicleType?.armour ?? 0;
	for (const upgradeId of vehicle.upgrades ?? []) {
		const upgrade = upgrades.find((item) => item.id === upgradeId);
		if (upgrade?.armour) armour += upgrade.armour;
	}
	return armour;
}

function vehicleHandling(vehicle: ScoreVehicle, vehicleType: ChassisStats | undefined, upgrades: readonly ScoreUpgrade[]): number {
	if (!vehicleType) return 0;
	let handling = chassisHandling(vehicleType);
	for (const upgradeId of vehicle.upgrades ?? []) {
		const upgrade = upgrades.find((item) => item.id === upgradeId);
		if (upgrade?.handling) handling += upgrade.handling;
		else if (upgrade?.handlingModifier) handling += upgrade.handlingModifier;
	}
	return handling;
}

function classifyRange(range: string | undefined, counts: RangeCounts) {
	if (!range) return;
	if (range.includes('Template')) counts.template += 1;
	else if (range.includes('Dropped')) counts.dropped += 1;
	else if (range.includes('Burst')) counts.burst += 1;
	else if (range.includes('Short')) counts.short += 1;
	else if (range.includes('Medium')) counts.medium += 1;
	else if (range.includes('Long')) counts.long += 1;
	else if (range.includes('Double')) counts.double += 1;
}

function weightBucket(weight: string | number | undefined, rulesVersion: 2 | 3): WeightClass {
	if (typeof weight === 'string') return isWeightClass(weight) ? weight : 'Other';
	if (typeof weight === 'number') {
		if (rulesVersion === 3) {
			if (weight <= 2) return 'Lightweight';
			if (weight <= 3) return 'Middleweight';
			if (weight <= 4) return 'Heavyweight';
			return 'Massive';
		}
		if (weight === 0) return 'Lightweight';
		if (weight === 1) return 'Middleweight';
		if (weight === 2) return 'Heavyweight';
		if (weight === 3) return 'Massive';
	}
	return 'Other';
}

export function evaluateTeam(input: {
	vehicles: readonly ScoreVehicle[];
	vehicleTypes: readonly ChassisStats[];
	weapons: readonly ScoreWeapon[];
	upgrades: readonly ScoreUpgrade[];
	vehicleRules?: readonly ScoreRule[];
	rulesVersion: 2 | 3;
	totalCans: number;
	maxCans: number;
}): TeamEvaluation {
	const ranges = emptyRanges();
	let attackDice = 0;
	let weaponCount = 0;
	let hull = 0;
	let durability = 0;
	let gearSum = 0;
	let handlingSum = 0;
	let slotsUsed = 0;
	let slotsCapacity = 0;
	let electrical = 0;
	let nonElectrical = 0;
	const weights: Record<WeightClass, number> = {
		Lightweight: 0,
		Middleweight: 0,
		Heavyweight: 0,
		Massive: 0,
		Other: 0
	};
	const specialRules = new Map<string, string>();

	for (const vehicle of input.vehicles) {
		const vehicleType = input.vehicleTypes.find((type) => type.id === vehicle.type);
		const vehicleHullPoints = vehicleHull(vehicle, vehicleType, input.upgrades);
		hull += vehicleHullPoints;
		durability += vehicleHullPoints;
		if (input.rulesVersion === 3) durability += vehicleArmour(vehicle, vehicleType, input.upgrades);
		gearSum += vehicleType?.maxGear ?? 0;
		handlingSum += vehicleHandling(vehicle, vehicleType, input.upgrades);
		const slots = slotUsageForVehicle(vehicle, vehicleType, input.weapons, input.upgrades, input.rulesVersion);
		slotsUsed += slots.used;
		slotsCapacity += slots.capacity;
		weights[weightBucket(vehicleType?.weight, input.rulesVersion)] += 1;

		if (vehicleType?.specialRules) {
			for (const ruleId of vehicleType.specialRules.split(',')) {
				const trimmed = ruleId.trim();
				if (!trimmed) continue;
				const named = input.vehicleRules?.find((rule) => rule.id === trimmed);
				specialRules.set(trimmed, named?.ruleName ?? trimmed);
			}
		}

		for (const weaponId of vehicle.weapons ?? []) {
			weaponCount += 1;
			const weapon = input.weapons.find((item) => item.id === findBaseWeaponId(weaponId, input.weapons));
			if (!weapon) continue;
			attackDice += numericDice(weapon);
			if (weapon.electrical) electrical += 1;
			else nonElectrical += 1;
			classifyRange(weapon.range, ranges);
		}
	}

	const snapshot: ScoreSnapshot = {
		attackDice,
		hull,
		durability,
		gearSum,
		handlingSum,
		count: input.vehicles.length,
		slotsUsed,
		slotsCapacity,
		totalCans: input.totalCans,
		maxCans: input.maxCans,
		rulesVersion: input.rulesVersion
	};
	const scores = scoresFromSnapshot(snapshot);
	const cansLeft = Math.max(0, input.maxCans - input.totalCans);
	return {
		snapshot,
		scores,
		statuses: statusesFor(scores),
		weaponCount,
		ranges,
		electrical,
		nonElectrical,
		weights,
		specialRules: Array.from(specialRules.values()),
		cansLeft
	};
}

/** Bare chassis the team already owns. Weapons are unknown, so dice stay at 0. */
export function snapshotFromChassis(
	owned: readonly ChassisStats[],
	rulesVersion: 2 | 3,
	totalCans: number,
	maxCans: number
): ScoreSnapshot {
	let hull = 0;
	let durability = 0;
	let gearSum = 0;
	let handlingSum = 0;
	let slotsCapacity = 0;
	for (const vehicle of owned) {
		hull += vehicle.maxHull;
		durability += vehicle.maxHull + (rulesVersion === 3 ? vehicle.armour ?? 0 : 0);
		gearSum += vehicle.maxGear;
		handlingSum += chassisHandling(vehicle);
		slotsCapacity += vehicle.buildSlots ?? 0;
	}
	return {
		attackDice: 0,
		hull,
		durability,
		gearSum,
		handlingSum,
		count: owned.length,
		slotsUsed: 0,
		slotsCapacity,
		totalCans,
		maxCans,
		rulesVersion
	};
}

export function withChassis(snapshot: ScoreSnapshot, vehicle: ChassisStats): ScoreSnapshot {
	const armour = snapshot.rulesVersion === 3 ? vehicle.armour ?? 0 : 0;
	return {
		...snapshot,
		hull: snapshot.hull + vehicle.maxHull,
		durability: snapshot.durability + vehicle.maxHull + armour,
		gearSum: snapshot.gearSum + vehicle.maxGear,
		handlingSum: snapshot.handlingSum + chassisHandling(vehicle),
		count: snapshot.count + 1,
		slotsCapacity: snapshot.slotsCapacity + (vehicle.buildSlots ?? 0),
		totalCans: snapshot.totalCans + vehicle.baseCost
	};
}

export function metricValue(scores: ScoreCard, metric: MetricId): number {
	switch (metric) {
		case 'combat':
			return scores.combat;
		case 'survivability':
			return scores.survivability;
		case 'mobility':
			return scores.mobility;
		case 'slots':
			return scores.slotEfficiency;
		case 'gear':
			return scores.avgGear;
		case 'handling':
			return scores.avgHandling;
	}
}

export function gainsForAddition(
	before: ScoreCard,
	after: ScoreCard,
	cost: number
): Record<'combat' | 'survivability' | 'mobility' | 'slots', number> {
	return {
		combat: gainPerCan(before.combat, after.combat, METRICS.combat, cost),
		survivability: gainPerCan(before.survivability, after.survivability, METRICS.survivability, cost),
		mobility: gainPerCan(before.mobility, after.mobility, METRICS.mobility, cost),
		slots: gainPerCan(before.slotEfficiency, after.slotEfficiency, METRICS.slots, cost)
	};
}
