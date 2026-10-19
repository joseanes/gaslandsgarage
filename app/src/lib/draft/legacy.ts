import type { RulesVersion } from '$lib/rules/version';
import vehiclesV2 from '../../data/rules/vehicles.json';
import weaponsV2 from '../../data/rules/weapons.json';
import upgradesV2 from '../../data/rules/upgrades.json';
import perksV2 from '../../data/rules/perks.json';
import { v3Perks } from '../../data/rules/v3/perks';
import { v3Sponsors } from '../../data/rules/v3/sponsors';
import { v3Upgrades } from '../../data/rules/v3/upgrades';
import { v3Vehicles } from '../../data/rules/v3/vehicles';
import { v3Weapons } from '../../data/rules/v3/weapons';

type Named = { id?: string; name?: string };

/** Only applied when the active catalog has no such id. Shared ids stay put. */
const V3_FROM_V2: Record<string, string> = {
	car: 'passenger_car',
	performance_car: 'sports_car',
	truck: 'pickup',
	drag_racer: 'hot_rod',
	bike_with_sidecar: 'bike',
	ice_cream_truck: 'van',
	ambulance: 'van'
};

const V2_FROM_V3: Record<string, string> = {
	passenger_car: 'car',
	sports_car: 'performance_car',
	muscle_car: 'car',
	hot_rod: 'performance_car',
	pickup: 'truck',
	van: 'truck'
};

type SponsorAlias = { 2?: string; 3?: string; any?: string };

/** Short ids and renamed sponsors from older saves. Edition picks the live id. */
const SPONSOR_ALIASES: Record<string, SponsorAlias> = {
	ber: { any: 'beverly' },
	idr: { any: 'idris' },
	max: { any: 'maxxine' },
	mis: { any: 'mishkin' },
	msh: { any: 'mishkin' },
	miy: { any: 'miyazaki' },
	myz: { any: 'miyazaki' },
	rut: { any: 'rutherford' },
	san: { any: 'scarlett' },
	sca: { any: 'scarlett' },
	sli: { any: 'slime' },
	slm: { any: 'slime' },
	thp: { any: 'highway_patrol' },
	ver: { any: 'verney' },
	war: { any: 'warden' },
	rus: { 2: 'rustys', 3: 'rusty' },
	rustys: { 3: 'rusty' },
	rusty: { 2: 'rustys' },
	rusty_s_bootleggers: { 2: 'rustys', 3: 'rusty' },
	scarlett_annie: { any: 'scarlett' },
	the_highway_patrol: { any: 'highway_patrol' },
	inferno: { 3: 'order_of_the_inferno' },
	order_of_the_inferno: { 2: 'inferno' }
};

const FACING_360 = new Set(['any', '360', '360°', 'full', 'turret', 'all']);

type GearIndex = {
	ids: Set<string>;
	byLower: Map<string, string>;
	bySlug: Map<string, string>;
	byName: Map<string, string>;
};

export function slug(name: string): string {
	return name
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '');
}

function gearIndex(items: Named[]): GearIndex {
	const ids = new Set<string>();
	const byLower = new Map<string, string>();
	const bySlug = new Map<string, string>();
	const byName = new Map<string, string>();
	for (const item of items) {
		if (!item?.id) continue;
		ids.add(item.id);
		byLower.set(item.id.toLowerCase(), item.id);
		bySlug.set(slug(item.id), item.id);
		if (item.name) {
			byName.set(item.name.trim().toLowerCase(), item.id);
			bySlug.set(slug(item.name), item.id);
		}
	}
	return { ids, byLower, bySlug, byName };
}

const sponsorFiles = import.meta.glob('../../data/rules/sponsors/*.json', {
	eager: true
}) as Record<string, { default: Named }>;

const v2SponsorIndex = gearIndex(Object.values(sponsorFiles).map((file) => file.default));
const v3SponsorIndex = gearIndex(v3Sponsors);
const v2VehicleIndex = gearIndex(vehiclesV2 as Named[]);
const v3VehicleIndex = gearIndex(v3Vehicles);
const weaponIndexes = { 2: gearIndex(weaponsV2 as Named[]), 3: gearIndex(v3Weapons) };
const upgradeIndexes = { 2: gearIndex(upgradesV2 as Named[]), 3: gearIndex(v3Upgrades) };
const perkIndexes = { 2: gearIndex(perksV2 as Named[]), 3: gearIndex(v3Perks) };

function matchNamed(value: string, index: GearIndex): string | undefined {
	if (index.ids.has(value)) return value;
	const lower = value.toLowerCase();
	const byLower = index.byLower.get(lower);
	if (byLower) return byLower;
	const byName = index.byName.get(lower);
	if (byName) return byName;
	const slugged = slug(value);
	if (index.ids.has(slugged)) return slugged;
	return index.bySlug.get(slugged);
}

function matchBase(value: string, index: GearIndex): string | undefined {
	return matchNamed(value, index);
}

export function canonicalGearId(raw: string, index: GearIndex): string {
	const trimmed = raw.trim();
	if (!trimmed) return '';
	const direct = matchNamed(trimmed, index);
	if (direct) return direct;
	const parts = trimmed.split('_');
	for (let i = parts.length - 1; i >= 1; i -= 1) {
		const base = matchBase(parts.slice(0, i).join('_'), index);
		if (!base) continue;
		const suffix = parts.slice(i).join('_');
		return suffix ? `${base}_${suffix}` : base;
	}
	return trimmed;
}

export function canonicalFacing(raw: string): string {
	const trimmed = raw.trim();
	const key = trimmed.toLowerCase();
	if (FACING_360.has(key)) return '360';
	if (key === 'front' || key === 'side' || key === 'rear') return key;
	if (key === 'hull') return 'front';
	return trimmed;
}

export function canonicalType(raw: string, rulesVersion: RulesVersion): string {
	const trimmed = raw.trim();
	if (!trimmed) return '';
	const index = rulesVersion === 3 ? v3VehicleIndex : v2VehicleIndex;
	const direct = matchNamed(trimmed, index);
	if (direct) return direct;
	const slugged = slug(trimmed);
	const fromSlug = matchNamed(slugged, index);
	if (fromSlug) return fromSlug;
	const table = rulesVersion === 3 ? V3_FROM_V2 : V2_FROM_V3;
	const mapped = table[slugged] || table[trimmed.toLowerCase()];
	if (mapped && index.ids.has(mapped)) return mapped;
	return trimmed;
}

export function canonicalSponsor(raw: string, rulesVersion: RulesVersion): string {
	const trimmed = raw.trim();
	if (!trimmed) return trimmed;
	const index = rulesVersion === 3 ? v3SponsorIndex : v2SponsorIndex;
	const direct = matchNamed(trimmed, index);
	if (direct) return direct;
	const alias = SPONSOR_ALIASES[slug(trimmed)] ?? SPONSOR_ALIASES[trimmed.toLowerCase()];
	const mapped = alias?.[rulesVersion] ?? alias?.any;
	if (mapped && index.ids.has(mapped)) return mapped;
	return trimmed;
}

const TYPE_KEYS = ['type', 'vehicleType', 'vehicle_type', 'typeId', 'typeName'] as const;

function rawType(record: Record<string, unknown>): string {
	for (const key of TYPE_KEYS) {
		const value = record[key];
		if (typeof value === 'string' && value.trim()) return value;
	}
	return '';
}

type GearPiece = { id: string; facing?: string };

function isFacingWord(value: string): boolean {
	const key = value.trim().toLowerCase();
	return FACING_360.has(key) || key === 'front' || key === 'side' || key === 'rear' || key === 'hull';
}

function pieceFromUnknown(value: unknown, fallbackId?: string): GearPiece | null {
	if (typeof value === 'string') {
		const id = value.trim();
		return id ? { id } : null;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const rawId = [record.id, record.weaponId, record.upgradeId, record.perkId, record.name, fallbackId].find(
		(item): item is string => typeof item === 'string' && item.trim().length > 0
	);
	if (!rawId) return null;
	const facing = typeof record.facing === 'string' ? record.facing : undefined;
	return { id: rawId.trim(), facing };
}

/** Arrays, comma lists, and the object maps older saves used instead of arrays. */
export function asGearPieces(value: unknown): GearPiece[] {
	if (value == null) return [];
	if (Array.isArray(value)) {
		return value.map((item) => pieceFromUnknown(item)).filter((item): item is GearPiece => !!item);
	}
	if (typeof value === 'string') {
		return value
			.split(',')
			.map((part) => pieceFromUnknown(part))
			.filter((item): item is GearPiece => !!item);
	}
	if (typeof value !== 'object') return [];
	const entries = Object.entries(value as Record<string, unknown>);
	const numeric = entries.length > 0 && entries.every(([key]) => /^\d+$/.test(key));
	const ordered = numeric ? [...entries].sort((a, b) => Number(a[0]) - Number(b[0])) : entries;
	const pieces: GearPiece[] = [];
	for (const [key, entry] of ordered) {
		if (numeric) {
			const piece = pieceFromUnknown(entry);
			if (piece) pieces.push(piece);
			continue;
		}
		if (typeof entry === 'boolean') {
			if (entry) pieces.push({ id: key });
			continue;
		}
		if (typeof entry === 'string' && isFacingWord(entry)) {
			pieces.push({ id: key, facing: entry });
			continue;
		}
		const piece = pieceFromUnknown(entry, key);
		if (piece) pieces.push(piece);
	}
	return pieces;
}

function gearCatalog(kind: 'weapons' | 'upgrades' | 'perks', rulesVersion: RulesVersion): GearIndex {
	if (kind === 'weapons') return weaponIndexes[rulesVersion];
	if (kind === 'upgrades') return upgradeIndexes[rulesVersion];
	return perkIndexes[rulesVersion];
}

function canonicalPieces(pieces: GearPiece[], index: GearIndex): { ids: string[]; facings: Record<string, string> } {
	const ids: string[] = [];
	const facings: Record<string, string> = {};
	for (const piece of pieces) {
		const id = canonicalGearId(piece.id, index);
		if (!id) continue;
		ids.push(id);
		if (piece.facing && piece.facing.trim()) facings[id] = canonicalFacing(piece.facing);
	}
	return { ids, facings };
}

function canonicalFacingMap(value: unknown, index: GearIndex): Record<string, string> {
	const facings: Record<string, string> = {};
	if (!value || typeof value !== 'object' || Array.isArray(value)) return facings;
	for (const [key, facing] of Object.entries(value as Record<string, unknown>)) {
		if (typeof facing !== 'string') continue;
		const id = canonicalGearId(key, index);
		if (!id) continue;
		facings[id] = canonicalFacing(facing);
	}
	return facings;
}

export type LegacyVehicleFields = {
	type: string;
	name: string;
	weapons: string[];
	upgrades: string[];
	perks: string[];
	weaponFacings: Record<string, string>;
};

export function legacyVehicleFields(source: unknown, rulesVersion: RulesVersion): LegacyVehicleFields {
	const record = source && typeof source === 'object' ? (source as Record<string, unknown>) : {};
	const weaponIndex = gearCatalog('weapons', rulesVersion);
	const weapons = canonicalPieces(asGearPieces(record.weapons), weaponIndex);
	const upgrades = canonicalPieces(asGearPieces(record.upgrades), gearCatalog('upgrades', rulesVersion));
	const perks = canonicalPieces(asGearPieces(record.perks), gearCatalog('perks', rulesVersion));
	return {
		type: canonicalType(rawType(record), rulesVersion),
		name: typeof record.name === 'string' && record.name.trim() ? record.name : 'Vehicle',
		weapons: weapons.ids,
		upgrades: upgrades.ids,
		perks: perks.ids,
		weaponFacings: { ...canonicalFacingMap(record.weaponFacings, weaponIndex), ...weapons.facings }
	};
}
