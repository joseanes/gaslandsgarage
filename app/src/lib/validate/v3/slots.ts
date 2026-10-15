export interface SlotWeapon {
	slots: number;
}

export interface SlotUpgrade {
	id: string;
	slots: number;
	isTrailer?: boolean;
	bonusSlots?: number;
}

export interface SlotVehicle {
	buildSlots: number;
	utility?: boolean;
	turretFree?: boolean;
}

export interface SlotState {
	used: number;
	capacity: number;
}

/**
 * Build-slot usage for a 3rd Edition vehicle.
 * Trailers add capacity. A tank's turret mount is free.
 * A van may reduce up to three upgrades by one slot (minimum zero),
 * applied to the most expensive slots first.
 */
export function v3BuildSlots(
	vehicle: SlotVehicle,
	weapons: SlotWeapon[],
	upgrades: SlotUpgrade[]
): SlotState {
	let capacity = vehicle.buildSlots;
	let used = 0;
	for (const weapon of weapons) {
		used += Math.max(0, weapon.slots || 0);
	}

	const upgradeCosts: number[] = [];
	for (const upgrade of upgrades) {
		if (upgrade.isTrailer) {
			capacity += upgrade.bonusSlots || 0;
			continue;
		}
		let slots = upgrade.slots || 0;
		if (upgrade.id === 'turret_mount' && vehicle.turretFree) slots = 0;
		upgradeCosts.push(Math.max(0, slots));
	}

	if (vehicle.utility) {
		const reducible = upgradeCosts
			.map((slots, index) => ({ slots, index }))
			.filter((entry) => entry.slots > 0)
			.sort((a, b) => b.slots - a.slots)
			.slice(0, 3);
		for (const entry of reducible) {
			upgradeCosts[entry.index] -= 1;
		}
	}

	used += upgradeCosts.reduce((sum, slots) => sum + slots, 0);
	return { used, capacity };
}
