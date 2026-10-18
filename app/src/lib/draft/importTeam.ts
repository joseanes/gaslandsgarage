import { normalizeRulesVersion } from '$lib/rules/version';
import type { Draft } from '$lib/validate/model';

export interface UpgradeGrant {
	id: string;
	perks?: string[];
}

export type ImportedVehicle = Draft['vehicles'][number];

export type LoadedVehicle = Omit<ImportedVehicle, 'weapons' | 'upgrades' | 'perks'> & {
	weapons: string[];
	upgrades: string[];
	perks: string[];
	weaponFacings: Record<string, string>;
};

function gearList(value: unknown): { ids: string[]; facings: Record<string, string> } {
	const ids: string[] = [];
	const facings: Record<string, string> = {};
	if (!Array.isArray(value)) return { ids, facings };
	for (const item of value) {
		if (typeof item === 'string') {
			const id = item.trim();
			if (id) ids.push(id);
			continue;
		}
		if (item && typeof item === 'object') {
			const record = item as { id?: unknown; facing?: unknown };
			if (typeof record.id !== 'string') continue;
			const id = record.id.trim();
			if (!id) continue;
			ids.push(id);
			if (typeof record.facing === 'string' && record.facing.trim()) facings[id] = record.facing;
		}
	}
	return { ids, facings };
}

function facingMap(value: unknown): Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const facings: Record<string, string> = {};
	for (const [key, facing] of Object.entries(value as Record<string, unknown>)) {
		if (typeof facing === 'string') facings[key] = facing;
	}
	return facings;
}

/** Missing and repeated ids both break a keyed `{#each}` and drop the card. */
function uniqueVehicleId(raw: unknown, index: number, used: Set<string>): string {
	const base = typeof raw === 'string' && raw.trim() ? raw.trim() : `vehicle-${index + 1}`;
	if (!used.has(base)) {
		used.add(base);
		return base;
	}
	let n = 2;
	let id = `${base}-${n}`;
	while (used.has(id)) {
		n += 1;
		id = `${base}-${n}`;
	}
	used.add(id);
	return id;
}

/**
 * Copy vehicles from a shared draft and add perks granted by installed upgrades.
 * URL imports and pasted build codes both use this so the two paths stay in sync.
 * Every saved entry is returned, with a unique id and string gear lists, so the
 * builder can render it even when the rules list has no matching type.
 */
export function withUpgradePerks(
	vehicles: ImportedVehicle[] | undefined,
	upgrades: UpgradeGrant[]
): LoadedVehicle[] {
	const used = new Set<string>();
	return (vehicles ?? []).map((vehicle, index) => {
		const source = vehicle && typeof vehicle === 'object' ? vehicle : ({} as ImportedVehicle);
		const weapons = gearList(source.weapons);
		const vehicleUpgrades = gearList(source.upgrades);
		const perks = gearList(source.perks);
		for (const upgradeId of vehicleUpgrades.ids) {
			const upgrade = upgrades.find((item) => item.id === upgradeId);
			for (const perkId of upgrade?.perks ?? []) {
				if (!perks.ids.includes(perkId)) perks.ids.push(perkId);
			}
		}

		return {
			...source,
			id: uniqueVehicleId(source.id, index, used),
			type: typeof source.type === 'string' ? source.type : '',
			name: typeof source.name === 'string' && source.name.trim() ? source.name : 'Vehicle',
			weapons: weapons.ids,
			upgrades: vehicleUpgrades.ids,
			perks: perks.ids,
			weaponFacings: { ...facingMap(source.weaponFacings), ...weapons.facings }
		};
	});
}

type IncomingDraft = {
	sponsor?: string;
	sponsorId?: string;
	teamName?: string;
	maxCans?: number;
	darkMode?: boolean;
	rulesVersion?: unknown;
	vehicles?: ImportedVehicle[];
	teamData?: IncomingDraft;
};

/** Accept a raw draft, a saved-team wrapper, or a legacy sponsorId field. */
export function normalizeIncomingDraft(raw: unknown): Draft | null {
	if (!raw || typeof raw !== 'object') return null;
	const record = raw as IncomingDraft;
	const source = record.teamData && typeof record.teamData === 'object' ? record.teamData : record;
	const sponsor = typeof source.sponsor === 'string' ? source.sponsor : source.sponsorId;
	if (typeof sponsor !== 'string' || !Array.isArray(source.vehicles)) return null;

	return {
		sponsor,
		vehicles: source.vehicles,
		teamName: source.teamName,
		maxCans: source.maxCans,
		darkMode: source.darkMode,
		rulesVersion: normalizeRulesVersion(source.rulesVersion)
	};
}
