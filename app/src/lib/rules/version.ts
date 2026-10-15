/** Ruleset version stored on a team. Missing values are Refuelled (v2). */
export type RulesVersion = 2 | 3;

/**
 * Instant when new teams default to 3rd Edition.
 * 1 January 2027, 00:00, America/New_York (EST, UTC−5).
 * This is the only cutover constant.
 */
export const RULESET_V3_CUTOVER_ISO = '2027-01-01T00:00:00-05:00';

export const V3_DEFAULT_BUDGET = 50;

/** Hard cap on vehicles that count toward the G3E team-size limit. */
export const V3_MAX_COUNTED_VEHICLES = 3;

/** One counted vehicle per full block of this many cans. */
export const V3_CANS_PER_COUNTED_VEHICLE = 20;

export function rulesetCutover(): Date {
	return new Date(RULESET_V3_CUTOVER_ISO);
}

/** New teams use v2 before the cutover and v3 from that instant onward. */
export function defaultRulesVersion(now: Date = new Date()): RulesVersion {
	return now.getTime() >= rulesetCutover().getTime() ? 3 : 2;
}

/** Codes and saves with no version, or any value other than 3, stay on v2. */
export function normalizeRulesVersion(value: unknown): RulesVersion {
	if (value === 3 || value === '3') return 3;
	return 2;
}

/**
 * How many vehicles count toward the G3E size limit for a budget.
 * Matches the worked examples 25→1, 50→2, 60→3, and never exceeds 3.
 * Callers exclude the first bike before comparing.
 */
export function maxCountedVehicles(budgetCans: number): number {
	const full = Math.floor(Math.max(0, budgetCans) / V3_CANS_PER_COUNTED_VEHICLE);
	return Math.min(V3_MAX_COUNTED_VEHICLES, full);
}

/** Vehicles that count toward the size limit. The first bike does not. */
export function countedVehicleTotal(types: readonly string[]): number {
	let skippedBike = false;
	let counted = 0;
	for (const type of types) {
		if (type === 'bike' && !skippedBike) {
			skippedBike = true;
			continue;
		}
		counted += 1;
	}
	return counted;
}
