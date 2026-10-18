// The users/{uid} profile shape, shared by the app (sign-in), scripts/set-admin.ts, and the
// daily usage-stats job (stats/usersSync.ts). Keep this file free of `$lib` imports so the
// stats job can import it directly.

export type ProfileDocument = {
	uid: string;
	email: string;
	displayName: string;
	createdAt: string;
	lastSeenAt: string;
	lastSignInAt: string;
};

export type ProfileUpdate = Pick<ProfileDocument, 'email' | 'displayName' | 'lastSeenAt' | 'lastSignInAt'>;

export function toIso(value: string | null | undefined, fallback: string): string {
	if (!value) return fallback;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return fallback;
	return parsed.toISOString();
}

export type AuthProfileSource = {
	uid: string;
	email?: string | null;
	displayName?: string | null;
	creationTime?: string | null;
	lastSignInTime?: string | null;
};

export type AuthProfileSync =
	| { op: 'create'; data: ProfileDocument }
	| { op: 'update'; data: Partial<ProfileDocument> }
	| { op: 'none' };

function isString(value: unknown): value is string {
	return typeof value === 'string';
}

function timeOf(value: string): number {
	const parsed = new Date(value).getTime();
	return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Plans an upsert of users/{uid} from a Firebase Auth record, for jobs that run outside a
 * browser session (the daily stats job and one-off backfills).
 *
 * - Missing document: create it with the full shape. `lastSeenAt` starts as the Auth last
 *   sign-in, because the job has not seen the player visit.
 * - Existing document: refresh `email` and `displayName` from Auth (never blanking a stored
 *   value), move `lastSignInAt` forward when Auth has a later sign-in, and only fill
 *   `uid`, `createdAt`, and `lastSeenAt` when they are missing. `lastSeenAt` belongs to the app,
 *   and `createdAt` is immutable under the Firestore rules.
 */
export function planAuthProfileSync(
	user: AuthProfileSource,
	existing: Record<string, unknown> | null,
	now: string
): AuthProfileSync {
	const email = user.email ?? '';
	const displayName = user.displayName ?? '';
	const createdAt = toIso(user.creationTime, now);
	const lastSignInAt = toIso(user.lastSignInTime, createdAt);

	if (!existing) {
		return {
			op: 'create',
			data: { uid: user.uid, email, displayName, createdAt, lastSeenAt: lastSignInAt, lastSignInAt }
		};
	}

	const data: Partial<ProfileDocument> = {};
	if (existing.uid !== user.uid) data.uid = user.uid;
	if (!isString(existing.email) || (email && existing.email !== email)) data.email = email;
	if (!isString(existing.displayName) || (displayName && existing.displayName !== displayName)) {
		data.displayName = displayName;
	}
	if (!isString(existing.createdAt)) data.createdAt = createdAt;
	if (!isString(existing.lastSignInAt) || timeOf(lastSignInAt) > timeOf(existing.lastSignInAt)) {
		data.lastSignInAt = lastSignInAt;
	}
	if (!isString(existing.lastSeenAt)) data.lastSeenAt = data.lastSignInAt ?? (existing.lastSignInAt as string);

	return Object.keys(data).length > 0 ? { op: 'update', data } : { op: 'none' };
}
