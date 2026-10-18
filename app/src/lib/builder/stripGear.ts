export type GearVehicle = {
	type: string;
	weapons: string[];
	upgrades: string[];
	perks: string[];
	weaponFacings?: Record<string, string>;
};

type CatalogItem = { id: string; advanced?: boolean };

export type StripGearOptions = {
	includeAdvanced: boolean;
	clearPerks: boolean;
	vehicleTypes: CatalogItem[];
	weapons: CatalogItem[];
	upgrades: CatalogItem[];
};

function baseWeaponId(instanceId: string): string {
	const lastUnderscoreIndex = instanceId.lastIndexOf('_');
	return lastUnderscoreIndex !== -1 ? instanceId.substring(0, lastUnderscoreIndex) : instanceId;
}

function keepWeapon(instanceId: string, weapons: CatalogItem[]): boolean {
	const weapon = weapons.find((entry) => entry.id === baseWeaponId(instanceId));
	return !!weapon && !weapon.advanced;
}

/**
 * Drops gear the current settings disallow.
 * Returns the same array when nothing changes so a reactive caller can assign
 * it without scheduling itself again.
 */
export function withoutDisallowedGear<T extends GearVehicle>(vehicles: T[], options: StripGearOptions): T[] {
	if (options.includeAdvanced && !options.clearPerks) return vehicles;

	let changed = false;
	const next: T[] = [];
	for (const vehicle of vehicles) {
		if (!options.includeAdvanced) {
			const type = options.vehicleTypes.find((entry) => entry.id === vehicle.type);
			if (!type || type.advanced) {
				changed = true;
				continue;
			}
		}

		let weapons = vehicle.weapons;
		let upgrades = vehicle.upgrades;
		let perks = vehicle.perks;
		let facings = vehicle.weaponFacings;

		if (!options.includeAdvanced) {
			const filteredWeapons = weapons.filter((id) => keepWeapon(id, options.weapons));
			if (filteredWeapons.length !== weapons.length) {
				weapons = filteredWeapons;
				if (facings) {
					facings = Object.fromEntries(
						Object.entries(facings).filter(([id]) => keepWeapon(id, options.weapons))
					);
				}
			}
			const filteredUpgrades = upgrades.filter((id) => {
				const upgrade = options.upgrades.find((entry) => entry.id === id);
				return !!upgrade && !upgrade.advanced;
			});
			if (filteredUpgrades.length !== upgrades.length) upgrades = filteredUpgrades;
		}

		if (options.clearPerks && perks.length > 0) perks = [];

		if (
			weapons !== vehicle.weapons ||
			upgrades !== vehicle.upgrades ||
			perks !== vehicle.perks ||
			facings !== vehicle.weaponFacings
		) {
			changed = true;
			next.push({ ...vehicle, weapons, upgrades, perks, weaponFacings: facings });
		} else {
			next.push(vehicle);
		}
	}

	return changed ? next : vehicles;
}
