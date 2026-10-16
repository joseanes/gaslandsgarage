import { countedVehicleTotal, maxCountedVehicles, type RulesVersion } from '$lib/rules/version';

/** A vehicle the builder can actually add. Stats only — no rules prose. */
export interface NextVehicleCatalogEntry {
	id: string;
	name: string;
	baseCost: number;
	maxGear: number;
	maxHull: number;
	handling?: number;
	crew?: number;
	weight?: string | number;
	advanced?: boolean;
	sponsors?: string[];
	rarity?: 'common' | 'rare';
	mob?: boolean;
}

export interface NextVehicleTeamMember {
	type: string;
}

export interface NextVehicleRequest {
	rulesVersion: RulesVersion;
	sponsorId: string;
	catalog: readonly NextVehicleCatalogEntry[];
	team: readonly NextVehicleTeamMember[];
	totalCans: number;
	maxCans: number;
	includeAdvanced?: boolean;
}

export interface NextVehicleSuggestion {
	id: string;
	name: string;
	cost: number;
	reason: string;
}

export const NEXT_VEHICLE_REASONS = {
	cans: 'fits the remaining cans',
	fast: 'adds a fast flanker',
	heavy: 'adds a heavier vehicle',
	light: 'adds a lighter vehicle',
	synergy: 'sponsor synergy'
} as const;

export const EMPTY_NEXT_VEHICLE_MESSAGE =
	'No other vehicle fits this sponsor, the team limit, and the cans you have left.';

const MAX_SUGGESTIONS = 3;

const WEIGHT_CLASS_RANK: Record<string, number> = {
	Lightweight: 1,
	Middleweight: 2,
	Heavyweight: 3,
	Massive: 4
};

function weightRank(vehicle: NextVehicleCatalogEntry): number {
	if (typeof vehicle.weight === 'number') return vehicle.weight;
	if (typeof vehicle.weight === 'string') return WEIGHT_CLASS_RANK[vehicle.weight] ?? 2;
	return 2;
}

function isLight(vehicle: NextVehicleCatalogEntry, version: RulesVersion): boolean {
	if (version === 3) return typeof vehicle.weight === 'number' && vehicle.weight <= 2;
	return vehicle.weight === 'Lightweight';
}

function isHeavy(vehicle: NextVehicleCatalogEntry, version: RulesVersion): boolean {
	if (version === 3) return typeof vehicle.weight === 'number' && vehicle.weight >= 4;
	return vehicle.weight === 'Heavyweight' || vehicle.weight === 'Massive';
}

function isFast(vehicle: NextVehicleCatalogEntry, version: RulesVersion): boolean {
	if ((vehicle.handling ?? 0) >= 4) return true;
	return vehicle.maxGear >= 6 && isLight(vehicle, version);
}

function sponsorAllowsChassis(
	version: RulesVersion,
	sponsorId: string,
	vehicle: NextVehicleCatalogEntry,
	anchorTaken: boolean
): boolean {
	if (version !== 3) {
		if (!vehicle.sponsors || vehicle.sponsors.length === 0) return true;
		return vehicle.sponsors.includes(sponsorId);
	}

	switch (sponsorId) {
		case 'idris':
			return vehicle.maxGear >= 6;
		case 'jumbo':
			return typeof vehicle.weight === 'number' && vehicle.weight >= 4;
		case 'maxxine':
			return typeof vehicle.weight === 'number' && vehicle.weight <= 3;
		case 'warden':
			return vehicle.maxHull >= 10;
		case 'beverly':
			return anchorTaken ? vehicle.maxHull < 12 : true;
		default:
			return true;
	}
}

function isSponsorSynergy(
	version: RulesVersion,
	sponsorId: string,
	vehicle: NextVehicleCatalogEntry,
	anchorTaken: boolean
): boolean {
	if (version !== 3) {
		const sponsors = vehicle.sponsors ?? [];
		return sponsors.length > 0 && sponsors.length <= 2 && sponsors.includes(sponsorId);
	}

	switch (sponsorId) {
		case 'idris':
			return vehicle.maxGear >= 6;
		case 'jumbo':
			return typeof vehicle.weight === 'number' && vehicle.weight >= 4;
		case 'maxxine':
			return typeof vehicle.weight === 'number' && vehicle.weight <= 3;
		case 'warden':
			return vehicle.maxHull >= 10;
		case 'beverly':
			return !anchorTaken && vehicle.maxHull >= 12;
		default:
			return false;
	}
}

function rareTypeBlocked(candidate: NextVehicleCatalogEntry, teamTypes: readonly string[]): boolean {
	if (candidate.rarity !== 'rare') return false;
	const owned = teamTypes.filter((type) => type === candidate.id).length;
	if (candidate.mob) return owned >= 2;
	return owned >= 1;
}

function compareName(a: NextVehicleCatalogEntry, b: NextVehicleCatalogEntry): number {
	return a.name.localeCompare(b.name);
}

function preferNewType(teamTypes: readonly string[]) {
	return (a: NextVehicleCatalogEntry, b: NextVehicleCatalogEntry) => {
		const aOwned = teamTypes.includes(a.id) ? 1 : 0;
		const bOwned = teamTypes.includes(b.id) ? 1 : 0;
		return aOwned - bOwned;
	};
}

/**
 * Up to three vehicles the team can legally add next.
 * Reasons are short phrases from NEXT_VEHICLE_REASONS. Catalog prose is never copied.
 */
export function recommendNextVehicles(request: NextVehicleRequest): NextVehicleSuggestion[] {
	const version = request.rulesVersion;
	const sponsorId = request.sponsorId || 'no_sponsor';
	const includeAdvanced = request.includeAdvanced !== false;
	const remaining = Math.max(0, request.maxCans - request.totalCans);
	const teamTypes = request.team.map((vehicle) => vehicle.type);
	const owned = teamTypes
		.map((type) => request.catalog.find((vehicle) => vehicle.id === type))
		.filter((vehicle): vehicle is NextVehicleCatalogEntry => Boolean(vehicle));
	const anchorTaken = owned.some((vehicle) => vehicle.maxHull >= 12);

	const legal = request.catalog.filter((vehicle) => {
		if (!includeAdvanced && vehicle.advanced) return false;
		if (vehicle.baseCost > remaining) return false;
		if (!sponsorAllowsChassis(version, sponsorId, vehicle, anchorTaken)) return false;
		if (version === 3) {
			if (rareTypeBlocked(vehicle, teamTypes)) return false;
			const counted = countedVehicleTotal([...teamTypes, vehicle.id]);
			if (counted > maxCountedVehicles(request.maxCans)) return false;
		}
		return true;
	});

	if (legal.length === 0) return [];

	const chosen: NextVehicleSuggestion[] = [];
	const used = new Set<string>();
	const freshFirst = preferNewType(teamTypes);

	function take(
		pool: NextVehicleCatalogEntry[],
		reason: string,
		compare: (a: NextVehicleCatalogEntry, b: NextVehicleCatalogEntry) => number
	) {
		if (chosen.length >= MAX_SUGGESTIONS) return;
		const pick = pool.filter((vehicle) => !used.has(vehicle.id)).sort(compare)[0];
		if (!pick) return;
		used.add(pick.id);
		chosen.push({ id: pick.id, name: pick.name, cost: pick.baseCost, reason });
	}

	take(
		legal.filter((vehicle) => isSponsorSynergy(version, sponsorId, vehicle, anchorTaken)),
		NEXT_VEHICLE_REASONS.synergy,
		(a, b) => freshFirst(a, b) || b.baseCost - a.baseCost || compareName(a, b)
	);

	if (!owned.some((vehicle) => isFast(vehicle, version))) {
		take(
			legal.filter((vehicle) => isFast(vehicle, version)),
			NEXT_VEHICLE_REASONS.fast,
			(a, b) =>
				freshFirst(a, b) ||
				(b.handling ?? 0) - (a.handling ?? 0) ||
				b.maxGear - a.maxGear ||
				a.baseCost - b.baseCost ||
				compareName(a, b)
		);
	}

	if (!owned.some((vehicle) => isHeavy(vehicle, version))) {
		take(
			legal.filter((vehicle) => isHeavy(vehicle, version)),
			NEXT_VEHICLE_REASONS.heavy,
			(a, b) =>
				freshFirst(a, b) ||
				weightRank(b) - weightRank(a) ||
				b.maxHull - a.maxHull ||
				a.baseCost - b.baseCost ||
				compareName(a, b)
		);
	}

	if (!owned.some((vehicle) => isLight(vehicle, version))) {
		take(
			legal.filter((vehicle) => isLight(vehicle, version)),
			NEXT_VEHICLE_REASONS.light,
			(a, b) =>
				freshFirst(a, b) || weightRank(a) - weightRank(b) || a.baseCost - b.baseCost || compareName(a, b)
		);
	}

	const fillers = legal
		.filter((vehicle) => !used.has(vehicle.id))
		.sort((a, b) => freshFirst(a, b) || a.baseCost - b.baseCost || compareName(a, b));
	for (const vehicle of fillers) {
		if (chosen.length >= MAX_SUGGESTIONS) break;
		chosen.push({
			id: vehicle.id,
			name: vehicle.name,
			cost: vehicle.baseCost,
			reason: NEXT_VEHICLE_REASONS.cans
		});
	}

	return chosen;
}
