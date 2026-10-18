import { perkCost } from '$lib/validate/calc';

export type CatalogItem = {
	id: string;
	name: string;
	cost?: number;
	slots?: number;
	baseCost?: number;
	buildSlots?: number;
	level?: number;
};

export type ViewVehicle = {
	id: string;
	type: string;
	name: string;
	weapons: string[];
	upgrades: string[];
	perks: string[];
	driverName?: string;
};

export type VehicleSummary = {
	id: string;
	name: string;
	typeName: string;
	driverName: string;
	cans: number;
	usedSlots: number;
	maxSlots: number;
	weapons: string[];
	upgrades: string[];
	perks: string[];
};

export type TeamCatalogs = {
	vehicles: CatalogItem[];
	weapons: CatalogItem[];
	upgrades: CatalogItem[];
	perks: CatalogItem[];
};

function findItem(items: CatalogItem[], id: string): CatalogItem | undefined {
	const direct = items.find((item) => item.id === id);
	if (direct) return direct;
	const parts = id.split('_');
	for (let length = parts.length - 1; length >= 1; length -= 1) {
		const candidate = parts.slice(0, length).join('_');
		const match = items.find((item) => item.id === candidate);
		if (match) return match;
	}
	return undefined;
}

function names(ids: string[], items: CatalogItem[]): string[] {
	return ids.map((id) => findItem(items, id)?.name || id);
}

export function summarizeVehicle(vehicle: ViewVehicle, catalogs: TeamCatalogs): VehicleSummary {
	const type = findItem(catalogs.vehicles, vehicle.type);
	let cans = type?.baseCost ?? 0;
	let usedSlots = 0;
	for (const id of vehicle.weapons) {
		const weapon = findItem(catalogs.weapons, id);
		cans += weapon?.cost ?? 0;
		usedSlots += weapon?.slots ?? 0;
	}
	for (const id of vehicle.upgrades) {
		const upgrade = findItem(catalogs.upgrades, id);
		cans += upgrade?.cost ?? 0;
		usedSlots += upgrade?.slots ?? 0;
	}
	for (const id of vehicle.perks) {
		cans += perkCost(findItem(catalogs.perks, id));
	}
	return {
		id: vehicle.id,
		name: vehicle.name || 'Unnamed',
		typeName: type?.name || vehicle.type || 'Vehicle',
		driverName: vehicle.driverName?.trim() || '',
		cans,
		usedSlots,
		maxSlots: type?.buildSlots ?? 0,
		weapons: names(vehicle.weapons, catalogs.weapons),
		upgrades: names(vehicle.upgrades, catalogs.upgrades),
		perks: names(vehicle.perks, catalogs.perks)
	};
}

export function rulesVersionLabel(version: 2 | 3 | null | undefined): string {
	return version === 3 ? 'Version 3' : 'Version 2 — Refuelled';
}
