/**
 * Score bands for the Gaslands Coach.
 *
 * Every colored number on the coach uses these cutoffs. Change a threshold
 * here and the tile, the analysis value, the tooltip, and the suggestion
 * copy all move together.
 *
 * Status words (never color alone):
 * - good  → Strong  (green)
 * - ok    → Average (amber)
 * - weak  → Low     (red)
 *
 * A value at `lowBelow` is Average. A value at `strongAt` is Strong.
 * Anything under `lowBelow` is Low. Higher is always better.
 *
 * `typical` is where a finished list of this can budget usually lands.
 * It sits inside Average on purpose, so an ordinary team is not marked Low.
 * Per-can bands do not change with the budget. The expected total does:
 * typical hull on a 50-can list is `typical * 50`.
 */

export type ScoreStatus = 'good' | 'ok' | 'weak';

export const STATUS_LABEL: Record<ScoreStatus, 'Strong' | 'Average' | 'Low'> = {
	good: 'Strong',
	ok: 'Average',
	weak: 'Low'
};

export type MetricId = 'combat' | 'survivability' | 'mobility' | 'slots' | 'gear' | 'handling';

export interface MetricBand {
	id: MetricId;
	/** Tile or row title. */
	title: string;
	/** Noun in "Hull per can 0.59 vs about 0.5 typical". */
	phrase: string;
	/** Short unit shown next to a per-can number. */
	unit: string;
	/**
	 * Where a normal finished list lands. Kept inside Average
	 * (`lowBelow` <= typical < `strongAt`).
	 */
	typical: number;
	/** Under this is Low. This value itself is Average. */
	lowBelow: number;
	/** This value and above is Strong. */
	strongAt: number;
	decimals: number;
	suffix: string;
	/**
	 * True when the number is already divided by cans.
	 * The typical total then scales with the team's can budget.
	 */
	perCan: boolean;
	/** Why the cutoffs sit where they do. Shown in the tooltip. */
	why: string;
}

export const METRICS = {
	/**
	 * Attack dice divided by cans spent.
	 * Chassis buy hull, not dice, so a large share of every list scores zero
	 * dice. A heavy machine gun is 1 die per can of weapon cost. Once the
	 * chassis is paid for, a plainly armed team lands near 0.30 dice per can.
	 * Under 0.20 means token guns or none. 0.45 or more is a gun-heavy list
	 * (about half the cans on efficient weapons).
	 */
	combat: {
		id: 'combat',
		title: 'Combat Effectiveness',
		phrase: 'Dice per can',
		unit: 'dice per can',
		typical: 0.3,
		lowBelow: 0.2,
		strongAt: 0.45,
		decimals: 2,
		suffix: '',
		perCan: true,
		why: 'Attack dice per can. Chassis add no dice, so a normal armed list is near 0.3. Under 0.2 is barely armed. 0.45 or more is a gun-heavy list.'
	},
	/**
	 * Hull per can, plus armour in 3rd edition.
	 * A bare car is often 0.7–1.0 hull per can. Weapons and perks spend cans
	 * without adding hull, so a finished list settles near 0.5. That is the
	 * "about 0.5 typical" comparison. Under 0.4 is fragile or perk-heavy.
	 * 0.7 or more is a tough list that has not spent the budget on guns.
	 */
	survivability: {
		id: 'survivability',
		title: 'Survivability',
		phrase: 'Hull per can',
		unit: 'hull per can',
		typical: 0.5,
		lowBelow: 0.4,
		strongAt: 0.7,
		decimals: 2,
		suffix: '',
		perCan: true,
		why: 'Hull per can (armour is included in 3rd edition). A finished list settles near 0.5 once weapons are paid for. Under 0.4 is fragile. 0.7 or more is a tough list.'
	},
	/**
	 * 60% average max gear + 40% average handling, rounded to one decimal.
	 * A car (gear 5, handling 3) scores 4.2. A buggy (gear 6, handling 4)
	 * scores 5.2. A heavy truck (gear 3, handling 2) scores 2.6.
	 * The blend tops out near 5.6 (gear 6 and handling 5). It is not a
	 * score out of 10. The old "aim for 6+" line described a different scale.
	 * Under 4.5 is slower than a mixed car list, which is why a lone car
	 * (4.2, average gear 5) is called slow. 5.2 or more is flanker territory.
	 */
	mobility: {
		id: 'mobility',
		title: 'Mobility',
		phrase: 'Mobility',
		unit: 'gear and handling blend',
		typical: 4.6,
		lowBelow: 4.5,
		strongAt: 5.2,
		decimals: 1,
		suffix: '',
		perCan: false,
		why: '60% average max gear plus 40% average handling. A car scores 4.2, which is under 4.5 and slow. A buggy scores 5.2. The blend tops out near 5.6, so it is not a score out of 10.'
	},
	/**
	 * Share of build slots that are filled.
	 * An empty chassis is 0%. 70% means the list is mostly equipped.
	 * 90% or more is essentially full. Trailers and other negative-slot
	 * upgrades raise the capacity before the percentage is taken.
	 */
	slots: {
		id: 'slots',
		title: 'Slot Efficiency',
		phrase: 'Slots',
		unit: 'of build slots used',
		typical: 75,
		lowBelow: 70,
		strongAt: 90,
		decimals: 0,
		suffix: '%',
		perCan: false,
		why: 'Percent of build slots filled. Under 70% is leaving hardware at home. 90% or more is essentially full.'
	},
	/**
	 * Average printed max gear. Gear 5 is a car. Under 4.5 means the list
	 * is truck-slow. 5.5 or more means most of the team can run at gear 6.
	 */
	gear: {
		id: 'gear',
		title: 'Average gear',
		phrase: 'Average gear',
		unit: 'average max gear',
		typical: 5,
		lowBelow: 4.5,
		strongAt: 5.5,
		decimals: 1,
		suffix: '',
		perCan: false,
		why: 'Average printed max gear. A car is gear 5. Under 4.5 is truck-slow. 5.5 or more means the list is mostly gear 6.'
	},
	/**
	 * Average handling after handling upgrades. 3 is a stock car and the
	 * bottom of Average. Trucks at 2 are Low. 4 or more is a nimble list.
	 */
	handling: {
		id: 'handling',
		title: 'Average handling',
		phrase: 'Average handling',
		unit: 'average handling',
		typical: 3,
		lowBelow: 3,
		strongAt: 4,
		decimals: 1,
		suffix: '',
		perCan: false,
		why: 'Average handling, including handling upgrades. 3 is a stock car. Under 3 is Low. 4 or more is nimble.'
	}
} as const satisfies Record<MetricId, MetricBand>;

export const TILE_METRICS: readonly MetricBand[] = [
	METRICS.combat,
	METRICS.survivability,
	METRICS.mobility,
	METRICS.slots
];

const SCORE_METRICS: readonly MetricBand[] = [METRICS.combat, METRICS.survivability, METRICS.mobility, METRICS.slots];

export function roundTo(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

export function rateScore(value: number, band: Pick<MetricBand, 'lowBelow' | 'strongAt'>): ScoreStatus {
	if (value >= band.strongAt) return 'good';
	if (value >= band.lowBelow) return 'ok';
	return 'weak';
}

/** Dashboard number, with a fixed width so 0.50 and 4.2 line up. */
export function formatFixed(value: number, band: Pick<MetricBand, 'decimals' | 'suffix'>): string {
	return `${value.toFixed(band.decimals)}${band.suffix}`;
}

/** Prose number: 0.50 is written "0.5", 4.2 stays "4.2". */
export function formatAbout(value: number, decimals: number): string {
	const rounded = roundTo(value, decimals);
	if (Object.is(rounded, -0)) return '0';
	return rounded.toString();
}

/**
 * "Hull per can 0.59 vs about 0.5 typical on a 50-can list".
 * Per-can metrics also name the total a full budget would buy.
 */
export function comparisonSentence(value: number, band: MetricBand, maxCans: number): string {
	const yours = `${formatAbout(value, band.decimals)}${band.suffix}`;
	const typical = `${formatAbout(band.typical, band.decimals)}${band.suffix}`;
	const budget = ` on a ${maxCans}-can list`;
	if (!band.perCan) return `${band.phrase} ${yours} vs about ${typical} typical${budget}`;
	const expected = Math.round(band.typical * Math.max(0, maxCans));
	const noun = band.id === 'combat' ? 'attack dice' : 'hull';
	return `${band.phrase} ${yours} vs about ${typical} typical${budget} (about ${expected} ${noun})`;
}

export function thresholdTooltip(band: MetricBand, value?: number, maxCans?: number): string {
	const low = `${formatAbout(band.lowBelow, band.decimals)}${band.suffix}`;
	const strong = `${formatAbout(band.strongAt, band.decimals)}${band.suffix}`;
	const typical = `${formatAbout(band.typical, band.decimals)}${band.suffix}`;
	const yours =
		value === undefined || maxCans === undefined ? '' : `<p>${comparisonSentence(value, band, maxCans)}</p>`;
	return `<strong>${band.title}</strong><p>${band.why}</p>${yours}<p>Low is under ${low}. Average is ${low} or more, under ${strong}. Strong is ${strong} or more. A typical list is about ${typical}.</p>`;
}

/** One line under the tiles: what a full budget usually buys. */
export function typicalBudgetLine(maxCans: number): string {
	const budget = Math.max(0, maxCans);
	const dice = Math.round(METRICS.combat.typical * budget);
	const hull = Math.round(METRICS.survivability.typical * budget);
	return `A typical ${budget}-can list has about ${dice} attack dice and ${hull} hull.`;
}

/**
 * How far a change moves a score, divided by what it costs.
 * The span between Low and Strong makes a 0.7 mobility jump comparable
 * to a 0.25 dice-per-can jump. Positive means the score got better.
 */
export function gainPerCan(
	before: number,
	after: number,
	band: Pick<MetricBand, 'lowBelow' | 'strongAt'>,
	cost: number
): number {
	const span = band.strongAt - band.lowBelow;
	if (span <= 0 || cost <= 0) return 0;
	return (after - before) / span / cost;
}

export function bestGainPerCan(
	before: { combat: number; survivability: number; mobility: number; slotEfficiency: number },
	after: { combat: number; survivability: number; mobility: number; slotEfficiency: number },
	cost: number
): { metric: MetricBand; perCan: number } {
	const pairs: [MetricBand, number, number][] = [
		[METRICS.combat, before.combat, after.combat],
		[METRICS.survivability, before.survivability, after.survivability],
		[METRICS.mobility, before.mobility, after.mobility],
		[METRICS.slots, before.slotEfficiency, after.slotEfficiency]
	];
	let winner = pairs[0];
	let winnerGain = gainPerCan(winner[1], winner[2], winner[0], cost);
	for (const pair of pairs.slice(1)) {
		const gain = gainPerCan(pair[1], pair[2], pair[0], cost);
		if (gain > winnerGain) {
			winner = pair;
			winnerGain = gain;
		}
	}
	return { metric: winner[0], perCan: winnerGain };
}

export function scoreBands(): readonly MetricBand[] {
	return SCORE_METRICS;
}
