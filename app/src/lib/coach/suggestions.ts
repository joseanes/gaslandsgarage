import { countedVehicleTotal, maxCountedVehicles } from '$lib/rules/version';
import {
	rankAdditions,
	type NextVehicleCatalogEntry,
	type NextVehicleSuggestion
} from './nextVehicle';
import {
	metricValue,
	numericDice,
	scoresFromSnapshot,
	slotUsageForVehicle,
	type ChassisStats,
	type ScoreUpgrade,
	type ScoreVehicle,
	type ScoreWeapon,
	type TeamEvaluation
} from './score';
import { METRICS, STATUS_LABEL, formatAbout, formatFixed } from './thresholds';

export interface CoachSuggestion {
	id: string;
	lead: string;
	tail: string;
	linkLabel?: string;
	href?: string;
	addType?: string;
	addName?: string;
}

export interface SuggestionSponsor {
	id: string;
	name: string;
	electrical?: boolean;
	requirement?: string;
}

const MAX_SUGGESTIONS = 5;
const GAP_ORDER: readonly ('combat' | 'survivability' | 'mobility' | 'slots')[] = [
	'combat',
	'survivability',
	'mobility',
	'slots'
];

function vehicleLabel(vehicle: ScoreVehicle, types: readonly ChassisStats[]): string {
	const typeName = types.find((type) => type.id === vehicle.type)?.name || vehicle.type;
	return vehicle.name ? `${typeName} (${vehicle.name})` : typeName;
}

function budgetLine(evaluation: TeamEvaluation): CoachSuggestion {
	const { maxCans, totalCans, cansLeft } = {
		maxCans: evaluation.snapshot.maxCans,
		totalCans: evaluation.snapshot.totalCans,
		cansLeft: evaluation.cansLeft
	};
	if (totalCans > maxCans) {
		return {
			id: 'budget',
			lead: `This list is ${totalCans - maxCans} cans over the ${maxCans}-can limit.`,
			tail: ''
		};
	}
	if (cansLeft === 0) {
		return { id: 'budget', lead: `The ${maxCans}-can budget is fully spent.`, tail: '' };
	}
	return { id: 'budget', lead: `You have ${cansLeft} cans left of ${maxCans}.`, tail: '' };
}

function weaponTier(weapon: ScoreWeapon): number {
	const dropped = weapon.dropped || (weapon.range ?? '').includes('Dropped');
	const crew = weapon.crewFired || (weapon.range ?? '').includes('Crew');
	if (!weapon.advanced && (weapon.slots ?? 0) > 0 && !dropped && !crew) return 0;
	if (!weapon.advanced) return 1;
	return 2;
}

function bestWeapon(
	weapons: readonly ScoreWeapon[],
	freeSlots: number,
	cansLeft: number,
	evaluation: TeamEvaluation,
	includeAdvanced: boolean,
	sponsorElectrical: boolean
): { weapon: ScoreWeapon; after: number; gain: number } | null {
	const before = evaluation.scores.combat;
	const dice = evaluation.snapshot.attackDice;
	const cans = evaluation.snapshot.totalCans;
	let best: { weapon: ScoreWeapon; after: number; gain: number; tier: number } | null = null;

	for (const weapon of weapons) {
		const attack = numericDice(weapon);
		const cost = weapon.cost ?? 0;
		const slots = weapon.slots ?? 0;
		if (attack <= 0 || cost <= 0 || cost > cansLeft) continue;
		if (slots > freeSlots) continue;
		if (weapon.electrical && !sponsorElectrical) continue;
		const tier = weaponTier(weapon);
		if (tier === 2 && !includeAdvanced) continue;
		const after = scoresFromSnapshot({
			...evaluation.snapshot,
			attackDice: dice + attack,
			totalCans: cans + cost
		}).combat;
		const gain = (after - before) / Math.max(cost, 1);
		if (
			!best ||
			tier < best.tier ||
			(tier === best.tier && (gain > best.gain || (gain === best.gain && attack > numericDice(best.weapon))))
		) {
			best = { weapon, after, gain, tier };
		}
	}
	return best;
}

function combatSuggestion(
	input: SuggestionInput,
	evaluation: TeamEvaluation
): CoachSuggestion | null {
	const rooms = input.vehicles
		.map((vehicle) => {
			const type = input.vehicleTypes.find((item) => item.id === vehicle.type);
			const slots = slotUsageForVehicle(vehicle, type, input.weapons, input.upgrades, input.rulesVersion);
			return { vehicle, free: Math.max(0, slots.capacity - slots.used) };
		})
		.sort((a, b) => b.free - a.free);
	const roomiest = rooms[0];
	if (!roomiest) return null;
	const pick = bestWeapon(
		input.weapons,
		roomiest.free,
		evaluation.cansLeft,
		evaluation,
		input.includeAdvanced,
		Boolean(input.sponsor?.electrical)
	);
	const band = METRICS.combat;
	const current = formatFixed(evaluation.scores.combat, band);
	const status = STATUS_LABEL[evaluation.statuses.combat];
	const typical = formatAbout(band.typical, band.decimals);
	const aside = `about ${typical} typical on a ${evaluation.snapshot.maxCans}-can list`;
	if (!pick || formatFixed(pick.after, band) === current) {
		return {
			id: 'combat',
			lead: `Combat is ${status} at ${current} dice per can (${aside}).`,
			tail: ''
		};
	}
	const shownAfter = formatFixed(pick.after, band);
	const left = Math.max(0, evaluation.cansLeft - (pick.weapon.cost ?? 0));
	const range = pick.weapon.range ? ` (${pick.weapon.range.toLowerCase()} range)` : '';
	return {
		id: 'combat',
		lead: `Combat is ${status} at ${current} dice per can (${aside}). ${pick.weapon.name ?? 'A weapon'}${range} on the `,
		linkLabel: vehicleLabel(roomiest.vehicle, input.vehicleTypes),
		href: `#vehicle-${roomiest.vehicle.id}`,
		tail: ` takes it ${current} → ${shownAfter} for ${pick.weapon.cost} cans. ${left} cans left after.`
	};
}

function openSlots(input: SuggestionInput): { vehicle: ScoreVehicle; free: number; capacity: number } | null {
	let best: { vehicle: ScoreVehicle; free: number; capacity: number } | null = null;
	for (const vehicle of input.vehicles) {
		const type = input.vehicleTypes.find((item) => item.id === vehicle.type);
		const slots = slotUsageForVehicle(vehicle, type, input.weapons, input.upgrades, input.rulesVersion);
		const free = Math.max(0, slots.capacity - slots.used);
		if (!best || free > best.free) best = { vehicle, free, capacity: slots.capacity };
	}
	return best;
}

function slotsSuggestion(input: SuggestionInput, evaluation: TeamEvaluation): CoachSuggestion {
	const band = METRICS.slots;
	const before = evaluation.scores.slotEfficiency;
	const status = STATUS_LABEL[evaluation.statuses.slots];
	const typical = `${formatAbout(band.typical, band.decimals)}${band.suffix}`;
	const aside = `about ${typical} typical on a ${evaluation.snapshot.maxCans}-can list`;
	const room = openSlots(input);
	if (!room || room.free === 0) {
		return { id: 'slots', lead: `Slots are ${status} at ${formatFixed(before, band)} (${aside}).`, tail: '' };
	}
	return {
		id: 'slots',
		lead: `Slots are ${status} at ${formatFixed(before, band)} (${aside}). `,
		linkLabel: vehicleLabel(room.vehicle, input.vehicleTypes),
		href: `#vehicle-${room.vehicle.id}`,
		tail: ` has ${room.free} of ${room.capacity} build slots open.`
	};
}

function additionSuggestion(
	metric: 'survivability' | 'mobility',
	evaluation: TeamEvaluation,
	ranked: readonly NextVehicleSuggestion[],
	shownIds: ReadonlySet<string>
): CoachSuggestion | null {
	const improving = ranked.filter((item) => item.gains[metric] > 0);
	improving.sort((a, b) => b.gains[metric] - a.gains[metric] || a.cost - b.cost);
	const best = improving[0];
	const band = METRICS[metric];
	const before = metricValue(evaluation.scores, metric);
	const status = STATUS_LABEL[evaluation.statuses[metric]];
	const typical = `${formatAbout(band.typical, band.decimals)}${band.suffix}`;
	const gear =
		metric === 'mobility' ? `avg gear ${formatAbout(evaluation.scores.avgGear, METRICS.gear.decimals)}, ` : '';
	const aside = `${gear}about ${typical} typical on a ${evaluation.snapshot.maxCans}-can list`;
	const summary = `${band.title} is ${status} at ${formatFixed(before, band)} (${aside}).`;
	if (!best) return { id: metric, lead: summary, tail: '' };
	const after = metricValue(best.after, metric);
	if (formatFixed(before, band) === formatFixed(after, band)) return { id: metric, lead: summary, tail: '' };
	const linked = shownIds.has(best.id);
	return {
		id: metric,
		lead: `${summary} `,
		linkLabel: best.name,
		href: linked ? `#coach-add-${best.id}` : undefined,
		addType: linked ? undefined : best.id,
		addName: linked ? undefined : best.name,
		tail: linked
			? ' is the best gain per can in the list above.'
			: ` takes it ${formatFixed(before, band)} → ${formatFixed(after, band)} for ${best.cost} cans. ${best.cansLeftAfter} cans left after.`
	};
}

function rulesSuggestions(input: SuggestionInput, evaluation: TeamEvaluation): CoachSuggestion[] {
	if (input.rulesVersion !== 3) return [];
	const notes: CoachSuggestion[] = [];
	const missing = input.vehicles.filter((vehicle) => !vehicle.driverArchetype);
	if (missing[0]) {
		notes.push({
			id: 'driver',
			lead: '',
			linkLabel: vehicleLabel(missing[0], input.vehicleTypes),
			href: `#vehicle-${missing[0].id}`,
			tail:
				missing.length === 1
					? ' has no driver. Drivers are free, and each archetype can be used once.'
					: ` and ${missing.length - 1} more have no driver. Drivers are free, and each archetype can be used once.`
		});
	}
	const seen = new Set<string>();
	for (const vehicle of input.vehicles) {
		const archetype = vehicle.driverArchetype;
		if (!archetype) continue;
		if (seen.has(archetype)) {
			const name = input.drivers.find((driver) => driver.id === archetype)?.name || archetype;
			notes.push({
				id: `driver-${archetype}`,
				lead: `${name} is already driving another vehicle. Pick a different archetype on the `,
				linkLabel: vehicleLabel(vehicle, input.vehicleTypes),
				href: `#vehicle-${vehicle.id}`,
				tail: '.'
			});
			break;
		}
		seen.add(archetype);
	}
	const allowance = maxCountedVehicles(evaluation.snapshot.maxCans);
	const counted = countedVehicleTotal(input.vehicles.map((vehicle) => vehicle.type));
	if (counted >= allowance) {
		notes.push({
			id: 'counted',
			lead: `Version 3: ${counted} of ${allowance} counted vehicles are used. The first bike is free.`,
			tail: ''
		});
	}
	if (evaluation.electrical > 0) {
		const spark = input.vehicles.some((vehicle) => vehicle.driverArchetype === 'spark');
		const van = input.vehicles.some((vehicle) => vehicle.type === 'van');
		if (!spark && !van) {
			notes.push({
				id: 'electrical',
				lead: 'Electrical weapons need a Spark driver on the team, or a van for that vehicle.',
				tail: ''
			});
		}
	}
	return notes;
}

export interface SuggestionInput {
	rulesVersion: 2 | 3;
	vehicles: readonly ScoreVehicle[];
	vehicleTypes: readonly ChassisStats[];
	weapons: readonly ScoreWeapon[];
	upgrades: readonly ScoreUpgrade[];
	evaluation: TeamEvaluation;
	sponsor: SuggestionSponsor | null;
	drivers: readonly { id: string; name: string; perkClass?: string }[];
	includeAdvanced: boolean;
	catalog: readonly NextVehicleCatalogEntry[];
	teamTypes: readonly { type: string }[];
}

export function buildCoachSuggestions(input: SuggestionInput): CoachSuggestion[] {
	const ranked = rankAdditions({
		rulesVersion: input.rulesVersion,
		sponsorId: input.sponsor?.id ?? 'no_sponsor',
		catalog: input.catalog,
		team: input.teamTypes,
		totalCans: input.evaluation.snapshot.totalCans,
		maxCans: input.evaluation.snapshot.maxCans,
		includeAdvanced: input.includeAdvanced,
		snapshot: input.evaluation.snapshot
	});
	const shown = recommendShown(ranked);
	const suggestions: CoachSuggestion[] = [budgetLine(input.evaluation)];

	const weak = GAP_ORDER.filter((metric) => input.evaluation.statuses[metric] === 'weak');
	const average = GAP_ORDER.filter((metric) => input.evaluation.statuses[metric] === 'ok');
	const gaps = weak.length >= 2 ? weak : [...weak, ...average];

	for (const metric of gaps) {
		if (suggestions.length >= MAX_SUGGESTIONS) break;
		const line =
			metric === 'combat'
				? combatSuggestion(input, input.evaluation)
				: metric === 'slots'
					? slotsSuggestion(input, input.evaluation)
					: additionSuggestion(metric, input.evaluation, ranked, shown);
		if (line) suggestions.push(line);
	}

	if (input.sponsor && input.sponsor.id !== 'no_sponsor' && input.sponsor.requirement && suggestions.length < MAX_SUGGESTIONS) {
		suggestions.push({
			id: 'sponsor',
			lead: `Sponsor requirement: ${input.sponsor.requirement}`,
			tail: ''
		});
	}

	for (const note of rulesSuggestions(input, input.evaluation)) {
		if (suggestions.length >= MAX_SUGGESTIONS) break;
		suggestions.push(note);
	}
	return suggestions;
}

function recommendShown(ranked: readonly NextVehicleSuggestion[]): Set<string> {
	return new Set(ranked.slice(0, 3).map((item) => item.id));
}
