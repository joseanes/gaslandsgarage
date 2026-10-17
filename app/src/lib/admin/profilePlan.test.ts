import { describe, expect, it } from 'vitest';
import { buildProfileWrite, toIso } from './profilePlan';

const now = '2026-10-17T12:00:00.000Z';

describe('buildProfileWrite', () => {
	it('creates a profile with auth metadata on the first sign-in', () => {
		const plan = buildProfileWrite({
			uid: 'abc',
			email: null,
			displayName: null,
			creationTime: 'Thu, 01 Oct 2026 00:00:00 GMT',
			lastSignInTime: 'not-a-date',
			now,
			existing: null
		});
		expect(plan).toEqual({
			op: 'create',
			data: {
				uid: 'abc',
				email: '',
				displayName: '',
				createdAt: '2026-10-01T00:00:00.000Z',
				lastSeenAt: now,
				lastSignInAt: now
			}
		});
		expect(toIso(undefined, now)).toBe(now);
	});

	it('updates visit fields and leaves createdAt alone', () => {
		const plan = buildProfileWrite({
			uid: 'abc',
			email: 'ada@example.com',
			displayName: 'Ada',
			creationTime: 'Thu, 01 Oct 2026 00:00:00 GMT',
			lastSignInTime: '2026-10-17T11:00:00.000Z',
			now,
			existing: { createdAt: '2026-10-01T00:00:00.000Z' }
		});
		expect(plan.op).toBe('update');
		expect(plan.data).toEqual({
			email: 'ada@example.com',
			displayName: 'Ada',
			lastSeenAt: now,
			lastSignInAt: '2026-10-17T11:00:00.000Z'
		});
		expect(plan.data).not.toHaveProperty('createdAt');
		expect(plan.data).not.toHaveProperty('uid');
	});
});
