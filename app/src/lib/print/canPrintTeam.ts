/**
 * Whether a team has anything to print.
 *
 * The print sheet is built from the team object the builder passes in (the
 * in-editor draft). A saved-team wrapper only counts when that object has no
 * `vehicles` array of its own. An empty name still counts: the sheet prints
 * it as an unnamed car.
 */
export function teamVehicles(team: unknown): unknown[] {
	if (!team || typeof team !== 'object') return [];
	const record = team as { vehicles?: unknown; teamData?: unknown };
	const direct = vehicleList(record.vehicles);
	if (direct) return direct;
	if (record.teamData && typeof record.teamData === 'object') {
		const nested = vehicleList((record.teamData as { vehicles?: unknown }).vehicles);
		if (nested) return nested;
	}
	return [];
}

export function teamHasVehicles(team: unknown): boolean {
	return teamVehicles(team).length > 0;
}

function vehicleList(value: unknown): unknown[] | null {
	if (!Array.isArray(value)) return null;
	return value.filter((vehicle) => vehicle !== null && typeof vehicle === 'object');
}
