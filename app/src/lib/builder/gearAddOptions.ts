import type { AddOption, AddOptionFact } from '$lib/components/addCombobox';
import { v3BuildSlots, type SlotUpgrade, type SlotVehicle, type SlotWeapon } from '$lib/validate/v3/slots';

/** Fields the adder reads. Catalog rows keep any extra rules data they already have. */
export interface GearRecord {
	id: string;
	name: string;
	cost?: number;
	slots?: number;
	range?: string;
	attackDice?: number | string;
	electrical?: boolean;
	specialRules?: string;
	keywords?: string[];
	category?: string;
	class?: string;
	trailer?: boolean | string;
	isTrailer?: boolean;
	bonusSlots?: number;
}

export interface SlotContext {
	rulesVersion: 2 | 3;
	vehicleType: SlotVehicle | undefined;
	maxBuildSlots: number;
	usedBuildSlots: number;
	resolvedWeapons: SlotWeapon[];
	resolvedUpgrades: SlotUpgrade[];
	capacity: number | null;
}

const INSUFFICIENT_SLOTS = 'Insufficient slots';

export function aliasesFor(name: string, id: string): string[] {
	const aliases = new Set<string>([id, id.replace(/_/g, ' ')]);
	const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
	if (words.length >= 2) aliases.add(words.map((word) => word[0].toLowerCase()).join(''));
	return [...aliases];
}

export function keywordsFor(item: GearRecord): string[] {
	const words = new Set<string>();
	for (const keyword of item.keywords ?? []) {
		if (keyword) words.add(keyword);
	}
	if (item.range) words.add(item.range);
	if (item.category) words.add(item.category);
	if (item.class) words.add(item.class);
	if (item.electrical) words.add('electrical');
	if (item.trailer === true || item.trailer === 'true' || item.isTrailer) words.add('trailer');
	if (item.specialRules) {
		for (const part of item.specialRules.split(/[,;/]+/)) {
			const trimmed = part.trim();
			if (trimmed) words.add(trimmed);
		}
	}
	return [...words];
}

/** Same order as the old weapon menu: 3rd-edition Machine Gun first, then A to Z. */
export function orderLikeWeaponMenu<T extends { id: string; name: string }>(items: T[]): T[] {
	const pinned = items.find((item) => item.id === 'machine_gun');
	const rest = items
		.filter((item) => item !== pinned)
		.slice()
		.sort((a, b) => a.name.localeCompare(b.name));
	return pinned ? [pinned, ...rest] : rest;
}

export function orderByName<T extends { name: string }>(items: T[]): T[] {
	return items.slice().sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Same slot gate the old weapon `<select>` used.
 * A zero-slot weapon still fits when the vehicle is full.
 */
export function fitsAnotherWeapon(weapon: { slots: number }, ctx: SlotContext): boolean {
	if (ctx.rulesVersion === 3) {
		const next = v3BuildSlots(
			ctx.vehicleType || { buildSlots: ctx.maxBuildSlots },
			[...ctx.resolvedWeapons, weapon],
			ctx.resolvedUpgrades
		);
		return next.used <= (ctx.capacity ?? ctx.maxBuildSlots);
	}
	return weapon.slots === 0 || ctx.usedBuildSlots + weapon.slots <= ctx.maxBuildSlots;
}

/** Same slot gate the old upgrade `<select>` used. */
export function fitsAnotherUpgrade(upgrade: SlotUpgrade, ctx: SlotContext): boolean {
	if (ctx.rulesVersion === 3) {
		const next = v3BuildSlots(
			ctx.vehicleType || { buildSlots: ctx.maxBuildSlots },
			ctx.resolvedWeapons,
			[...ctx.resolvedUpgrades, upgrade]
		);
		return next.used <= (ctx.capacity ?? ctx.maxBuildSlots);
	}
	return upgrade.slots === 0 || ctx.usedBuildSlots + upgrade.slots <= ctx.maxBuildSlots;
}

export function weaponAddOptions(weapons: GearRecord[], ctx: SlotContext): AddOption[] {
	return orderLikeWeaponMenu(weapons).map((weapon) => {
		const slots = weapon.slots ?? 0;
		const ok = fitsAnotherWeapon({ slots }, ctx);
		const facts: AddOptionFact[] = [];
		if (weapon.range) facts.push({ text: weapon.range, tone: 'neutral' });
		if (weapon.attackDice) facts.push({ text: `🎲 ${weapon.attackDice}`, tone: 'dice' });
		if (weapon.electrical) facts.push({ text: '⚡ Electrical', tone: 'electric' });
		facts.push(slotsFact(slots));
		const cost = costFact(weapon.cost);
		if (cost) facts.push(cost);
		return {
			id: weapon.id,
			name: weapon.name,
			aliases: aliasesFor(weapon.name, weapon.id),
			keywords: keywordsFor(weapon),
			disabled: !ok,
			reason: ok ? undefined : INSUFFICIENT_SLOTS,
			facts
		};
	});
}

export function upgradeAddOptions(upgrades: GearRecord[], ctx: SlotContext): AddOption[] {
	return orderByName(upgrades).map((upgrade) => {
		const slots = upgrade.slots ?? 0;
		const ok = fitsAnotherUpgrade(
			{ id: upgrade.id, slots, isTrailer: upgrade.isTrailer, bonusSlots: upgrade.bonusSlots },
			ctx
		);
		const facts: AddOptionFact[] = [];
		if (upgrade.electrical) facts.push({ text: '⚡ Electrical', tone: 'electric' });
		if (upgrade.trailer === true || upgrade.trailer === 'true' || upgrade.isTrailer) {
			facts.push({ text: '🚚 Trailer', tone: 'trailer' });
		}
		facts.push(slotsFact(slots));
		const cost = costFact(upgrade.cost);
		if (cost) facts.push(cost);
		return {
			id: upgrade.id,
			name: upgrade.name,
			aliases: aliasesFor(upgrade.name, upgrade.id),
			keywords: keywordsFor(upgrade),
			disabled: !ok,
			reason: ok ? undefined : INSUFFICIENT_SLOTS,
			facts
		};
	});
}

export function perkAddOptions(perks: GearRecord[]): AddOption[] {
	return orderByName(perks).map((perk) => {
		const facts: AddOptionFact[] = [];
		if (perk.electrical) facts.push({ text: '⚡ Electrical', tone: 'electric' });
		const cost = costFact(perk.cost);
		if (cost) facts.push(cost);
		return {
			id: perk.id,
			name: perk.name,
			aliases: aliasesFor(perk.name, perk.id),
			keywords: keywordsFor(perk),
			disabled: false,
			facts
		};
	});
}

function slotsFact(slots: number): AddOptionFact {
	if (slots === 0) return { text: '0 slots', tone: 'muted' };
	const plural = Math.abs(slots) === 1 ? 'slot' : 'slots';
	return { text: `${slots} ${plural}`, tone: 'neutral' };
}

function costFact(cost: number | undefined): AddOptionFact | null {
	if (!cost) return null;
	return { text: `${cost} cans`, tone: 'neutral' };
}
