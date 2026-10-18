import { REGULAR_USER_LABEL } from '$lib/admin/accountActions';
import type { DirectoryUser } from '$lib/admin/api';

export type UserSortKey = 'email' | 'displayName' | 'created' | 'lastSignIn' | 'teams' | 'role' | 'status';
export type SortDirection = 'asc' | 'desc';

export type UserSort = {
	key: UserSortKey;
	direction: SortDirection;
};

/** Same order `loadDirectory` uses before a header is clicked. */
export const DEFAULT_USER_SORT: UserSort = { key: 'email', direction: 'asc' };

export function nextUserSort(current: UserSort, key: UserSortKey): UserSort {
	if (current.key === key) {
		return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
	}
	return { key, direction: 'asc' };
}

function timeOrNull(value: string): number | null {
	if (!value) return null;
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? null : parsed;
}

function textCompare(left: string, right: string, direction: SortDirection): number {
	const diff = left.localeCompare(right);
	return direction === 'asc' ? diff : -diff;
}

function numberCompare(left: number, right: number, direction: SortDirection): number {
	const diff = left - right;
	return direction === 'asc' ? diff : -diff;
}

/**
 * Missing and unreadable last sign-in times stay at the bottom in both directions.
 * Every other tie falls back to email, then account id, so the order stays stable.
 */
export function compareDirectoryUsers(a: DirectoryUser, b: DirectoryUser, sort: UserSort): number {
	let primary = 0;
	if (sort.key === 'lastSignIn') {
		const aTime = timeOrNull(a.lastSignInAt);
		const bTime = timeOrNull(b.lastSignInAt);
		if (aTime === null || bTime === null) {
			if (aTime === null && bTime === null) primary = 0;
			else return aTime === null ? 1 : -1;
		} else {
			primary = numberCompare(aTime, bTime, sort.direction);
		}
	} else if (sort.key === 'created') {
		primary = numberCompare(timeOrNull(a.createdAt) ?? 0, timeOrNull(b.createdAt) ?? 0, sort.direction);
	} else if (sort.key === 'teams') {
		primary = numberCompare(a.teamCount, b.teamCount, sort.direction);
	} else if (sort.key === 'email') {
		primary = textCompare(a.email, b.email, sort.direction);
	} else if (sort.key === 'displayName') {
		primary = textCompare(a.displayName, b.displayName, sort.direction);
	} else if (sort.key === 'role') {
		primary = textCompare(a.role || REGULAR_USER_LABEL, b.role || REGULAR_USER_LABEL, sort.direction);
	} else {
		primary = textCompare(a.disabled ? 'Disabled' : 'Active', b.disabled ? 'Disabled' : 'Active', sort.direction);
	}
	if (primary !== 0) return primary;
	return a.email.localeCompare(b.email) || a.uid.localeCompare(b.uid);
}

/** Sorts the full directory. The admin list is not paged, so this is every account, including after search. */
export function sortDirectoryUsers(users: DirectoryUser[], sort: UserSort): DirectoryUser[] {
	return [...users].sort((a, b) => compareDirectoryUsers(a, b, sort));
}
