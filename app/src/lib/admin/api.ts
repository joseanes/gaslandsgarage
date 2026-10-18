import { projectPlayerProfile, projectUserSettings, type AdminAccountSettings, type AdminProfileView } from '$lib/admin/accountSettings';
import { db, initializeFirebase } from '$lib/firebase';
import {
	ACCOUNT_CONTROL_COLLECTION,
	DELETE_LATER_REASON,
	ROLES_COLLECTION,
	USERS_COLLECTION,
	planDeleteAuthUser,
	planSetDisabled,
	planSetRole,
	type AccountOperation
} from '$lib/admin/accountActions';
import type { ViewVehicle } from '$lib/admin/teamView';

export type DirectoryUser = {
	uid: string;
	email: string;
	displayName: string;
	createdAt: string;
	lastSignInAt: string;
	teamCount: number;
	role: string | null;
	disabled: boolean;
	disabledAt: string | null;
	disabledBy: string | null;
};

export type DirectoryTeam = {
	id: string;
	teamName: string;
	sponsorId: string;
	rulesVersion: 2 | 3 | null;
	maxCans: number | null;
	vehicles: ViewVehicle[];
};

export type Directory = {
	users: DirectoryUser[];
	teamsByUser: Map<string, DirectoryTeam[]>;
	settingsByUser: Map<string, AdminAccountSettings> | null;
	profilesByUser: Map<string, AdminProfileView> | null;
};

type Result = { success: true } | { success: false; error: string };

function asString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function asStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === 'string');
}

function permissionMessage(error: unknown): string {
	if (error && typeof error === 'object' && 'code' in error && error.code === 'permission-denied') {
		return 'Missing or insufficient permissions.';
	}
	return error instanceof Error ? error.message : 'Request failed';
}

function isPermissionDenied(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'permission-denied');
}

async function database() {
	const init = await initializeFirebase();
	if (!init.success || !db) throw new Error('Database not initialized');
	const api = await import('firebase/firestore');
	return { ...api, db };
}

export async function readOwnAccess(uid: string): Promise<{ disabled: boolean; role: string | null }> {
	const init = await initializeFirebase();
	if (!init.success || !db) return { disabled: false, role: null };
	const { doc, getDoc } = await import('firebase/firestore');
	const [controlResult, roleResult] = await Promise.all([
		getDoc(doc(db, ACCOUNT_CONTROL_COLLECTION, uid)).then(
			(snap) => snap,
			(error: unknown) => error
		),
		getDoc(doc(db, ROLES_COLLECTION, uid)).then(
			(snap) => snap,
			(error: unknown) => error
		)
	]);

	if (controlResult instanceof Error || isFailure(controlResult)) {
		if (!isPermissionDenied(controlResult)) throw controlResult;
	}
	if (roleResult instanceof Error || isFailure(roleResult)) {
		if (!isPermissionDenied(roleResult)) throw roleResult;
	}

	const disabled =
		isSnapshot(controlResult) && controlResult.exists() && controlResult.data().disabled === true;
	const roleValue = isSnapshot(roleResult) && roleResult.exists() ? roleResult.data().role : null;
	return { disabled, role: typeof roleValue === 'string' ? roleValue : null };
}

function isSnapshot(value: unknown): value is { exists: () => boolean; data: () => Record<string, unknown> } {
	return Boolean(value && typeof value === 'object' && 'exists' in value && typeof (value as { exists: unknown }).exists === 'function');
}

function isFailure(value: unknown): value is unknown {
	return !isSnapshot(value);
}

function vehiclesFrom(value: unknown): ViewVehicle[] {
	if (!Array.isArray(value)) return [];
	return value.map((entry, index) => {
		const vehicle = (entry ?? {}) as Record<string, unknown>;
		return {
			id: asString(vehicle.id) || `vehicle-${index}`,
			type: asString(vehicle.type),
			name: asString(vehicle.name),
			weapons: asStringList(vehicle.weapons),
			upgrades: asStringList(vehicle.upgrades),
			perks: asStringList(vehicle.perks),
			driverName: asString(vehicle.driverName)
		};
	});
}

function rulesVersionFrom(value: unknown): 2 | 3 | null {
	if (value === 3 || value === '3') return 3;
	if (value === 2 || value === '2') return 2;
	return null;
}

function teamFromData(id: string, data: Record<string, unknown>): DirectoryTeam {
	const teamData = (data.teamData ?? {}) as Record<string, unknown>;
	const maxCans = typeof teamData.maxCans === 'number' ? teamData.maxCans : null;
	return {
		id,
		teamName: asString(data.teamName) || asString(teamData.teamName) || 'Untitled team',
		sponsorId: asString(teamData.sponsor) || asString(teamData.sponsorId),
		rulesVersion: rulesVersionFrom(teamData.rulesVersion),
		maxCans,
		vehicles: vehiclesFrom(teamData.vehicles)
	};
}

function detailError(error: unknown, fallback: string): Error {
	if (isPermissionDenied(error)) return new Error(fallback);
	const message = permissionMessage(error);
	return new Error(message.startsWith(fallback) ? message : `${fallback} ${message}`);
}

async function readCollection(
	databaseRef: NonNullable<typeof db>,
	getDocs: (typeof import('firebase/firestore'))['getDocs'],
	collection: (typeof import('firebase/firestore'))['collection'],
	name: string
) {
	try {
		return await getDocs(collection(databaseRef, name));
	} catch (error) {
		if (isPermissionDenied(error)) return null;
		throw error;
	}
}

export async function loadDirectory(): Promise<Directory> {
	const { collection, getDocs, db: databaseRef } = await database();
	const [usersSnap, rolesSnap, controlsSnap, teamsSnap, settingsSnap, profilesSnap] = await Promise.all([
		getDocs(collection(databaseRef, USERS_COLLECTION)),
		getDocs(collection(databaseRef, ROLES_COLLECTION)),
		getDocs(collection(databaseRef, ACCOUNT_CONTROL_COLLECTION)),
		getDocs(collection(databaseRef, 'teams')),
		readCollection(databaseRef, getDocs, collection, 'userSettings'),
		readCollection(databaseRef, getDocs, collection, 'playerProfiles')
	]);

	const roles = new Map<string, string | null>();
	rolesSnap.forEach((entry) => {
		const role = entry.data().role;
		roles.set(entry.id, typeof role === 'string' ? role : null);
	});
	const controls = new Map<string, { disabled: boolean; disabledAt: string | null; disabledBy: string | null }>();
	controlsSnap.forEach((entry) => {
		const data = entry.data();
		controls.set(entry.id, {
			disabled: data.disabled === true,
			disabledAt: typeof data.disabledAt === 'string' ? data.disabledAt : null,
			disabledBy: typeof data.disabledBy === 'string' ? data.disabledBy : null
		});
	});

	const teamsByUser = new Map<string, DirectoryTeam[]>();
	teamsSnap.forEach((entry) => {
		const data = entry.data();
		const userId = asString(data.userId);
		if (!userId) return;
		const list = teamsByUser.get(userId) ?? [];
		list.push(teamFromData(entry.id, data));
		teamsByUser.set(userId, list);
	});

	const settingsByUser = settingsSnap
		? new Map<string, AdminAccountSettings>()
		: null;
	settingsSnap?.forEach((entry) => {
		settingsByUser?.set(entry.id, projectUserSettings(entry.data()));
	});
	const profilesByUser = profilesSnap ? new Map<string, AdminProfileView>() : null;
	profilesSnap?.forEach((entry) => {
		const profile = projectPlayerProfile(entry.data());
		if (profile) profilesByUser?.set(entry.id, profile);
	});

	const users: DirectoryUser[] = [];
	usersSnap.forEach((entry) => {
		const data = entry.data();
		const control = controls.get(entry.id);
		const lastSignInAt = asString(data.lastSignInAt) || asString(data.lastSeenAt);
		users.push({
			uid: entry.id,
			email: asString(data.email),
			displayName: asString(data.displayName),
			createdAt: asString(data.createdAt),
			lastSignInAt,
			teamCount: teamsByUser.get(entry.id)?.length ?? 0,
			role: roles.get(entry.id) ?? null,
			disabled: control?.disabled ?? false,
			disabledAt: control?.disabledAt ?? null,
			disabledBy: control?.disabledBy ?? null
		});
	});
	users.sort((a, b) => a.email.localeCompare(b.email) || a.uid.localeCompare(b.uid));
	return { users, teamsByUser, settingsByUser, profilesByUser };
}

/** Read one player's settings and profile. Active administrators are allowed to read `userSettings`. */
export async function loadUserAccount(uid: string): Promise<{
	settings: AdminAccountSettings;
	profile: AdminProfileView | null;
	profileLoaded: boolean;
}> {
	const { doc, getDoc, db: databaseRef } = await database();
	const [settingsResult, profileResult] = await Promise.all([
		getDoc(doc(databaseRef, 'userSettings', uid)).then(
			(snap) => snap,
			(error: unknown) => error
		),
		getDoc(doc(databaseRef, 'playerProfiles', uid)).then(
			(snap) => snap,
			(error: unknown) => error
		)
	]);

	if (!isSnapshot(settingsResult)) {
		throw detailError(settingsResult, 'Account settings could not be loaded.');
	}

	let profile: AdminProfileView | null = null;
	let profileLoaded = true;
	if (!isSnapshot(profileResult)) {
		if (!isPermissionDenied(profileResult)) throw detailError(profileResult, 'Player profile could not be loaded.');
		profileLoaded = false;
	} else if (profileResult.exists()) {
		profile = projectPlayerProfile(profileResult.data());
	}

	return {
		settings: projectUserSettings(settingsResult.exists() ? settingsResult.data() : undefined),
		profile,
		profileLoaded
	};
}

/** Teams saved by one player. An empty list means they have none. */
export async function loadUserTeams(uid: string): Promise<DirectoryTeam[]> {
	const { collection, getDocs, query, where, db: databaseRef } = await database();
	try {
		const snap = await getDocs(query(collection(databaseRef, 'teams'), where('userId', '==', uid)));
		const teams: DirectoryTeam[] = [];
		snap.forEach((entry) => {
			teams.push(teamFromData(entry.id, entry.data()));
		});
		return teams;
	} catch (error) {
		throw detailError(error, 'Teams could not be loaded.');
	}
}

async function applyAccountOperation(operation: AccountOperation): Promise<Result> {
	if (operation.type === 'deleteAuthUser') {
		return { success: false, error: DELETE_LATER_REASON };
	}
	try {
		const { doc, deleteDoc, setDoc, db: databaseRef } = await database();
		if (operation.type === 'setRole') {
			const ref = doc(databaseRef, ROLES_COLLECTION, operation.uid);
			if (operation.role === null) {
				await deleteDoc(ref);
			} else {
				await setDoc(ref, {
					role: operation.role,
					updatedAt: operation.updatedAt,
					updatedBy: operation.updatedBy
				});
			}
			return { success: true };
		}
		await setDoc(doc(databaseRef, ACCOUNT_CONTROL_COLLECTION, operation.uid), {
			disabled: operation.disabled,
			disabledAt: operation.disabledAt,
			disabledBy: operation.disabledBy
		});
		return { success: true };
	} catch (error) {
		console.error('Account update failed', error);
		return { success: false, error: permissionMessage(error) };
	}
}

export async function changeUserRole(actorUid: string, targetUid: string, role: string | null): Promise<Result> {
	const plan = planSetRole({ actorUid, targetUid, role, now: new Date().toISOString() });
	if (!plan.ok) return { success: false, error: plan.reason };
	return applyAccountOperation(plan.operation);
}

export async function setUserDisabled(actorUid: string, targetUid: string, disabled: boolean): Promise<Result> {
	const plan = planSetDisabled({ actorUid, targetUid, disabled, now: new Date().toISOString() });
	if (!plan.ok) return { success: false, error: plan.reason };
	return applyAccountOperation(plan.operation);
}

export async function requestAuthDeletion(actorUid: string, targetUid: string): Promise<Result> {
	const plan = planDeleteAuthUser({ actorUid, targetUid, now: new Date().toISOString() });
	if (!plan.ok) return { success: false, error: plan.reason };
	return applyAccountOperation(plan.operation);
}
