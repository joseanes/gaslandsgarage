/** Decide when a painted-car photo has to wait for a save, and which saved cars a save would drop. */

export type PhotoSaveReason = 'new-team' | 'unsaved-changes' | 'vehicle-not-saved';

export type VehicleIdentity = {
	id: string;
	name: string;
	type: string;
};

export type DisplacedVehicle = {
	id: string;
	name: string;
	change: 'removed' | 'replaced';
	hasPhotos: boolean;
};

export type QuickSaveOptions = {
	asNew: boolean;
	force: boolean;
	quiet: boolean;
	resumePhoto: boolean;
	name?: string;
};

export function photoSaveReason(input: {
	savedTeamId: string | null | undefined;
	vehicleId: string;
	dirty: boolean;
	/** Empty or null means this session does not yet know the saved ids. */
	savedVehicleIds: readonly string[] | null;
}): PhotoSaveReason | null {
	const teamId = typeof input.savedTeamId === 'string' ? input.savedTeamId.trim() : '';
	if (!teamId) return 'new-team';
	const known = input.savedVehicleIds ?? [];
	if (known.length > 0 && !known.includes(input.vehicleId)) return 'vehicle-not-saved';
	if (input.dirty) return 'unsaved-changes';
	return null;
}

export function vehicleIdentityList(raw: unknown): VehicleIdentity[] {
	if (!Array.isArray(raw)) return [];
	const vehicles: VehicleIdentity[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue;
		const id = 'id' in entry && typeof entry.id === 'string' ? entry.id : '';
		if (!id) continue;
		const name = 'name' in entry && typeof entry.name === 'string' ? entry.name.trim() : '';
		const type = 'type' in entry && typeof entry.type === 'string' ? entry.type : '';
		vehicles.push({ id, name, type });
	}
	return vehicles;
}

/**
 * Cars on the saved team that this save would drop.
 * A new car, a renamed car, or a loadout edit is not a removal or a replacement.
 */
export function displacedVehicles(
	saved: unknown,
	next: unknown,
	photoVehicleIds: ReadonlySet<string> = new Set()
): DisplacedVehicle[] {
	const nextById = new Map(vehicleIdentityList(next).map((vehicle) => [vehicle.id, vehicle]));
	const seen = new Set<string>();
	const displaced: DisplacedVehicle[] = [];
	for (const vehicle of vehicleIdentityList(saved)) {
		if (seen.has(vehicle.id)) continue;
		seen.add(vehicle.id);
		const current = nextById.get(vehicle.id);
		const change = !current ? 'removed' : vehicle.type && current.type && vehicle.type !== current.type ? 'replaced' : null;
		if (!change) continue;
		displaced.push({
			id: vehicle.id,
			name: vehicle.name || 'Unnamed vehicle',
			change,
			hasPhotos: photoVehicleIds.has(vehicle.id)
		});
	}
	return displaced;
}

export function displacedVehicleLabel(vehicle: DisplacedVehicle): string {
	const action = vehicle.change === 'removed' ? 'will be removed' : 'will be replaced';
	const photos = vehicle.hasPhotos ? ' It has photos attached.' : '';
	return `${vehicle.name} ${action}.${photos}`;
}

/** Header Quick Save passes the click event. Only an explicit options object changes the save. */
export function readQuickSaveOptions(value: unknown): QuickSaveOptions {
	const empty: QuickSaveOptions = { asNew: false, force: false, quiet: false, resumePhoto: false };
	if (!value || typeof value !== 'object' || value instanceof Event) return empty;
	const record = value as Record<string, unknown>;
	if (!('asNew' in record || 'force' in record || 'quiet' in record || 'resumePhoto' in record || 'name' in record)) {
		return empty;
	}
	return {
		asNew: record.asNew === true,
		force: record.force === true,
		quiet: record.quiet === true,
		resumePhoto: record.resumePhoto === true,
		name: typeof record.name === 'string' ? record.name : undefined
	};
}
