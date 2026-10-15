import type { Draft } from '$lib/validate/model';

export interface UpgradeGrant {
	id: string;
	perks?: string[];
}

export type ImportedVehicle = Draft['vehicles'][number];

/**
 * Copy vehicles from a shared draft and add perks granted by installed upgrades.
 * URL imports and pasted build codes both use this so the two paths stay in sync.
 */
export function withUpgradePerks(
	vehicles: ImportedVehicle[] | undefined,
	upgrades: UpgradeGrant[]
): ImportedVehicle[] {
	return (vehicles ?? []).map((vehicle) => {
		const weapons = Array.isArray(vehicle.weapons) ? [...vehicle.weapons] : [];
		const vehicleUpgrades = Array.isArray(vehicle.upgrades) ? [...vehicle.upgrades] : [];
		const perks = Array.isArray(vehicle.perks) ? [...vehicle.perks] : [];

		for (const upgradeId of vehicleUpgrades) {
			const upgrade = upgrades.find((item) => item.id === upgradeId);
			for (const perkId of upgrade?.perks ?? []) {
				if (!perks.includes(perkId)) perks.push(perkId);
			}
		}

		return {
			...vehicle,
			name: vehicle.name || 'Vehicle',
			weapons,
			upgrades: vehicleUpgrades,
			perks
		};
	});
}

type IncomingDraft = {
	sponsor?: string;
	sponsorId?: string;
	teamName?: string;
	maxCans?: number;
	darkMode?: boolean;
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
		darkMode: source.darkMode
	};
}
