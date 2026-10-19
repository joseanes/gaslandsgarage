import { canonicalSponsor, legacyVehicleFields } from '$lib/draft/legacy';
import { normalizeRulesVersion, type RulesVersion } from '$lib/rules/version';
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
	upgrades: UpgradeGrant[],
	rulesVersion: RulesVersion = 2
): LoadedVehicle[] {
	const used = new Set<string>();
	return (vehicles ?? []).map((vehicle, index) => {
		const source = vehicle && typeof vehicle === 'object' ? vehicle : ({} as ImportedVehicle);
		const fields = legacyVehicleFields(source, rulesVersion);
		for (const upgradeId of fields.upgrades) {
			const upgrade = upgrades.find((item) => item.id.toLowerCase() === upgradeId.toLowerCase());
			for (const perkId of upgrade?.perks ?? []) {
				if (!fields.perks.includes(perkId)) fields.perks.push(perkId);
			}
		}

		return {
			...source,
			...fields,
			id: uniqueVehicleId(source.id, index, used)
		};
	});
}

/** Firestore document ids stay off the draft unless the loader set savedTeamId. */
export function readSavedTeamId(raw: unknown): string | null {
	if (!raw || typeof raw !== 'object') return null;
	const id = (raw as { savedTeamId?: unknown }).savedTeamId;
	if (typeof id !== 'string') return null;
	const trimmed = id.trim();
	return trimmed || null;
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
	const rulesVersion = normalizeRulesVersion(source.rulesVersion);

	return {
		sponsor: canonicalSponsor(sponsor, rulesVersion),
		vehicles: source.vehicles,
		teamName: source.teamName,
		maxCans: source.maxCans,
		darkMode: source.darkMode,
		rulesVersion
	};
}
