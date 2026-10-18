import { USERS_COLLECTION } from '$lib/admin/accountActions';
import { toIso, type ProfileDocument, type ProfileUpdate } from './profileShape';

export { USERS_COLLECTION, toIso, type ProfileDocument, type ProfileUpdate };

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
