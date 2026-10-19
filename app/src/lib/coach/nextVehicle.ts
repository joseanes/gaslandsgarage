import { countedVehicleTotal, maxCountedVehicles, type RulesVersion } from '$lib/rules/version';
import {
	gainsForAddition,
	metricValue,
	scoresFromSnapshot,
	snapshotFromChassis,
	statusesFor,
	withChassis,
	type ChassisStats,
	type ScoreCard,
	type ScoreSnapshot
} from './score';
import { METRICS, STATUS_LABEL, formatAbout, type MetricId } from './thresholds';

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
	armour?: number;
	buildSlots?: number;
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
	/**
	 * Scores of the team as it stands, including weapons and upgrades.
	 * When omitted, the coach treats the team as bare chassis and uses totalCans as given.
	 */
	snapshot?: ScoreSnapshot;
}

export interface NextVehicleSuggestion {
	id: string;
	name: string;
	cost: number;
	/** Why this chassis, tied to the score it moves and the cans left after. */
	reason: string;
	/** Score the row is ranked on. */
	metric: MetricId;
	/** Scaled score change per can. Higher is a better buy. May be negative. */
	perCan: number;
	cansLeftAfter: number;
	/** Score card if this chassis were added with no extra weapons. */
	after: ScoreCard;
	gains: Record<'combat' | 'survivability' | 'mobility' | 'slots', number>;
}

/**
 * Short labels for the kind of gap a chassis used to fill.
 * The coach now writes a full sentence (score, before, after, cans left)
 * instead of showing only these phrases.
 */
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

function withArticle(name: string): string {
	const lower = name.toLowerCase();
	const article = /^[aeiou]/i.test(lower) ? 'an' : 'a';
	return `${article} ${lower}`;
}

const ARROW_LABEL: Record<'combat' | 'survivability' | 'mobility' | 'slots', string> = {
	combat: 'Combat',
	survivability: 'Survivability',
	mobility: 'Mobility',
	slots: 'Slots'
};

function vehicleClause(version: RulesVersion, vehicle: ChassisStats, metric: MetricId, delta: number): string {
	const named = withArticle(vehicle.name);
	if (metric === 'mobility' && delta > 0 && vehicle.maxGear >= 6) {
		return `${named} adds a gear-${vehicle.maxGear} flanker`;
	}
	if (metric === 'survivability') {
		const armour = version === 3 ? vehicle.armour ?? 0 : 0;
		const hull = `${named} adds ${vehicle.maxHull} hull`;
		return armour > 0 ? `${hull} and ${armour} armour` : hull;
	}
	if (metric === 'combat') return `${named} adds no attack dice`;
	if (metric === 'slots') return `${named} adds ${vehicle.buildSlots ?? 0} empty build slots`;
	return `${named} adds gear ${vehicle.maxGear}`;
}

function gapClause(metric: MetricId, statusLabel: string, delta: number, avgGear: number): string {
	if (metric === 'mobility') {
		const gear = formatAbout(avgGear, METRICS.gear.decimals);
		if (delta > 0 && statusLabel === 'Low') return `your team is slow (avg gear ${gear})`;
		if (delta > 0 && statusLabel === 'Average') return `your team is only average (avg gear ${gear})`;
		if (delta > 0) return `your team is already quick (avg gear ${gear})`;
		return `your team stays at avg gear ${gear}`;
	}
	const current = statusLabel.toLowerCase();
	if (delta > 0) return `this score is ${current}`;
	if (delta < 0) return 'this lowers it';
	return 'this leaves it unchanged';
}

function describeAddition(
	version: RulesVersion,
	vehicle: ChassisStats,
	before: ScoreCard,
	after: ScoreCard,
	metric: MetricId,
	cansLeftAfter: number,
	synergy: boolean,
	emptyTeam: boolean
): string {
	const scoredMetric = metric as 'combat' | 'survivability' | 'mobility' | 'slots';
	const band = METRICS[scoredMetric];
	const beforeValue = metricValue(before, scoredMetric);
	const afterValue = metricValue(after, scoredMetric);
	const delta = roundDelta(afterValue - beforeValue);
	const shownBefore = formatAbout(beforeValue, band.decimals);
	const shownAfter = formatAbout(afterValue, band.decimals);
	const left = `${cansLeftAfter} cans left after`;
	const sponsor = synergy ? ' Sponsor synergy.' : '';
	const status = STATUS_LABEL[statusesFor(before)[scoredMetric]];
	const arrow = ARROW_LABEL[scoredMetric];

	if (emptyTeam) {
		const start =
			metric === 'mobility' && vehicle.maxGear >= 6
				? `${withArticle(vehicle.name)} starts the list as a gear-${vehicle.maxGear} flanker`
				: `${withArticle(vehicle.name)} starts the list`;
		return `${arrow} ${shownAfter}: ${start}.${sponsor} ${left}.`;
	}

	const gap = gapClause(metric, status, delta, before.avgGear);
	const what = vehicleClause(version, vehicle, metric, delta);
	return `${arrow} ${shownBefore} → ${shownAfter}: ${gap}, ${what}.${sponsor} ${left}.`;
}

function roundDelta(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function currentSnapshot(request: NextVehicleRequest, owned: readonly NextVehicleCatalogEntry[]): ScoreSnapshot {
	const base =
		request.snapshot ??
		snapshotFromChassis(owned, request.rulesVersion, request.totalCans, request.maxCans);
	return {
		...base,
		totalCans: request.totalCans,
		maxCans: request.maxCans,
		rulesVersion: request.rulesVersion
	};
}

export function rankAdditions(request: NextVehicleRequest): NextVehicleSuggestion[] {
	const version = request.rulesVersion;
	const sponsorId = request.sponsorId || 'no_sponsor';
	const includeAdvanced = request.includeAdvanced !== false;
	const remaining = Math.max(0, request.maxCans - request.totalCans);
	const teamTypes = request.team.map((vehicle) => vehicle.type);
	const owned = teamTypes
		.map((type) => request.catalog.find((vehicle) => vehicle.id === type))
		.filter((vehicle): vehicle is NextVehicleCatalogEntry => Boolean(vehicle));
	const anchorTaken = owned.some((vehicle) => vehicle.maxHull >= 12);
	const beforeSnapshot = currentSnapshot(request, owned);
	const before = scoresFromSnapshot(beforeSnapshot);

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

	const ranked = legal.map((vehicle) => {
		const afterSnapshot = withChassis(beforeSnapshot, vehicle);
		const after = scoresFromSnapshot(afterSnapshot);
		const gains = gainsForAddition(before, after, vehicle.baseCost);
		const best = (Object.keys(gains) as (keyof typeof gains)[]).reduce((top, key) =>
			gains[key] > gains[top] ? key : top
		);
		const cansLeftAfter = Math.max(0, request.maxCans - request.totalCans - vehicle.baseCost);
		const synergy = isSponsorSynergy(version, sponsorId, vehicle, anchorTaken);
		const ownedAlready = teamTypes.includes(vehicle.id);
		return {
			id: vehicle.id,
			name: vehicle.name,
			cost: vehicle.baseCost,
			reason: describeAddition(version, vehicle, before, after, best, cansLeftAfter, synergy, beforeSnapshot.count === 0),
			metric: best,
			perCan: gains[best],
			cansLeftAfter,
			after,
			gains,
			ownedAlready
		};
	});

	ranked.sort(
		(a, b) =>
			b.perCan - a.perCan ||
			a.cost - b.cost ||
			Number(a.ownedAlready) - Number(b.ownedAlready) ||
			a.name.localeCompare(b.name)
	);
	return ranked.map(({ ownedAlready: _owned, ...suggestion }) => suggestion);
}

/**
 * Up to three vehicles the team can legally add next.
 * Ranked by how much they move the weakest useful score, per can.
 * The reason names that score, the before and after, and the cans left.
 * Catalog prose is never copied.
 */
export function recommendNextVehicles(request: NextVehicleRequest): NextVehicleSuggestion[] {
	return rankAdditions(request).slice(0, MAX_SUGGESTIONS);
}
