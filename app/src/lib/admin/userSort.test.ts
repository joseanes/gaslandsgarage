import { describe, expect, it } from 'vitest';
import type { DirectoryUser } from './api';
import { DEFAULT_USER_SORT, nextUserSort, sortDirectoryUsers } from './userSort';

function person(partial: Partial<DirectoryUser> & Pick<DirectoryUser, 'uid' | 'email'>): DirectoryUser {
	return {
		displayName: '',
		createdAt: '2024-01-01T00:00:00.000Z',
		lastSignInAt: '',
		teamCount: 0,
		role: null,
		disabled: false,
		disabledAt: null,
		disabledBy: null,
		...partial
	};
}

const ada = person({
	uid: 'ada',
	email: 'ada@example.com',
	displayName: 'Ada',
	createdAt: '2020-01-01T00:00:00.000Z',
	lastSignInAt: '2024-06-01T00:00:00.000Z',
	teamCount: 2,
	role: 'Administrator'
});
const bea = person({
	uid: 'bea',
	email: 'bea@example.com',
	displayName: 'Bea',
	createdAt: '2023-01-01T00:00:00.000Z',
	lastSignInAt: '2020-01-01T00:00:00.000Z',
	teamCount: 0,
	disabled: true
});
const cy = person({
	uid: 'cy',
	email: 'cy@example.com',
	displayName: 'Cy',
	createdAt: '2022-01-01T00:00:00.000Z',
	lastSignInAt: '',
	teamCount: 1
});

describe('directory sort', () => {
	it('starts on email ascending, matching the unsorted directory', () => {
		expect(DEFAULT_USER_SORT).toEqual({ key: 'email', direction: 'asc' });
		expect(sortDirectoryUsers([cy, ada, bea], DEFAULT_USER_SORT).map((row) => row.uid)).toEqual(['ada', 'bea', 'cy']);
	});

	it('toggles a column and starts a new column ascending', () => {
		expect(nextUserSort(DEFAULT_USER_SORT, 'email')).toEqual({ key: 'email', direction: 'desc' });
		expect(nextUserSort({ key: 'email', direction: 'desc' }, 'lastSignIn')).toEqual({
			key: 'lastSignIn',
			direction: 'asc'
		});
	});

	it('puts accounts with no last sign-in last in both directions', () => {
		const rows = [cy, bea, ada];
		expect(sortDirectoryUsers(rows, { key: 'lastSignIn', direction: 'asc' }).map((row) => row.uid)).toEqual([
			'bea',
			'ada',
			'cy'
		]);
		expect(sortDirectoryUsers(rows, { key: 'lastSignIn', direction: 'desc' }).map((row) => row.uid)).toEqual([
			'ada',
			'bea',
			'cy'
		]);
		const unread = person({ uid: 'unread', email: 'unread@example.com', lastSignInAt: 'not-a-date' });
		expect(sortDirectoryUsers([unread, ada], { key: 'lastSignIn', direction: 'desc' }).map((row) => row.uid)).toEqual([
			'ada',
			'unread'
		]);
	});

	it('sorts the other columns and keeps email as the tie break', () => {
		expect(sortDirectoryUsers([cy, ada, bea], { key: 'teams', direction: 'asc' }).map((row) => row.uid)).toEqual([
			'bea',
			'cy',
			'ada'
		]);
		expect(sortDirectoryUsers([cy, ada, bea], { key: 'teams', direction: 'desc' }).map((row) => row.teamCount)).toEqual([
			2, 1, 0
		]);
		expect(sortDirectoryUsers([cy, bea, ada], { key: 'displayName', direction: 'desc' }).map((row) => row.uid)).toEqual([
			'cy',
			'bea',
			'ada'
		]);
		expect(sortDirectoryUsers([cy, bea, ada], { key: 'created', direction: 'asc' }).map((row) => row.uid)).toEqual([
			'ada',
			'cy',
			'bea'
		]);
		expect(sortDirectoryUsers([cy, bea, ada], { key: 'role', direction: 'asc' }).map((row) => row.uid)).toEqual([
			'ada',
			'bea',
			'cy'
		]);
		expect(sortDirectoryUsers([ada, bea], { key: 'status', direction: 'asc' }).map((row) => row.uid)).toEqual(['ada', 'bea']);
		const sameTime = person({
			uid: 'zed',
			email: 'zed@example.com',
			lastSignInAt: ada.lastSignInAt
		});
		expect(sortDirectoryUsers([sameTime, ada], { key: 'lastSignIn', direction: 'desc' }).map((row) => row.uid)).toEqual([
			'ada',
			'zed'
		]);
	});

	it('sorts a searched subset without looking at the hidden rows', () => {
		const visible = [ada, cy].filter((row) => row.displayName !== 'Bea');
		expect(sortDirectoryUsers(visible, { key: 'teams', direction: 'desc' }).map((row) => row.uid)).toEqual(['ada', 'cy']);
	});
});
