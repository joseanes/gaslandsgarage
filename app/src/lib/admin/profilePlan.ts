import { USERS_COLLECTION } from '$lib/admin/accountActions';

export { USERS_COLLECTION };

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

export function buildProfileWrite(input: {
	uid: string;
	email: string | null;
	displayName: string | null;
	creationTime?: string | null;
	lastSignInTime?: string | null;
	now: string;
	existing: { createdAt?: string } | null;
}): { op: 'create'; data: ProfileDocument } | { op: 'update'; data: ProfileUpdate } {
	const email = input.email ?? '';
	const displayName = input.displayName ?? '';
	const lastSignInAt = toIso(input.lastSignInTime, input.now);
	const lastSeenAt = input.now;
	if (!input.existing) {
		return {
			op: 'create',
			data: {
				uid: input.uid,
				email,
				displayName,
				createdAt: toIso(input.creationTime, input.now),
				lastSeenAt,
				lastSignInAt
			}
		};
	}
	return {
		op: 'update',
		data: { email, displayName, lastSeenAt, lastSignInAt }
	};
}
