import { describe, expect, it } from 'vitest';
import { planAuthProfileSync } from './profileShape';

const now = '2026-10-17T12:00:00.000Z';
const auth = {
	uid: 'abc',
	email: 'ada@example.com',
	displayName: 'Ada',
	creationTime: 'Thu, 01 Oct 2026 00:00:00 GMT',
	lastSignInTime: 'Fri, 16 Oct 2026 08:30:00 GMT'
};

describe('planAuthProfileSync', () => {
	it('creates the full app profile shape for a user with no document', () => {
		expect(planAuthProfileSync(auth, null, now)).toEqual({
			op: 'create',
			data: {
				uid: 'abc',
				email: 'ada@example.com',
				displayName: 'Ada',
				createdAt: '2026-10-01T00:00:00.000Z',
				lastSeenAt: '2026-10-16T08:30:00.000Z',
				lastSignInAt: '2026-10-16T08:30:00.000Z'
			}
		});
	});

	it('falls back to createdAt, then now, when Auth times are missing', () => {
		const plan = planAuthProfileSync({ uid: 'x', creationTime: 'bad' }, null, now);
		expect(plan).toEqual({
			op: 'create',
			data: { uid: 'x', email: '', displayName: '', createdAt: now, lastSeenAt: now, lastSignInAt: now }
		});
	});

	it('leaves a complete, up-to-date document alone', () => {
		const existing = {
			uid: 'abc',
			email: 'ada@example.com',
			displayName: 'Ada',
			createdAt: '2026-10-01T00:00:00.000Z',
			lastSeenAt: '2026-10-17T11:59:00.000Z',
			lastSignInAt: '2026-10-16T08:30:00.000Z'
		};
		expect(planAuthProfileSync(auth, existing, now)).toEqual({ op: 'none' });
	});

	it('never moves lastSignInAt back or touches app-owned lastSeenAt and createdAt', () => {
		const existing = {
			uid: 'abc',
			email: 'ada@example.com',
			displayName: 'Ada',
			createdAt: '2025-01-01T00:00:00.000Z',
			lastSeenAt: '2026-10-17T11:59:00.000Z',
			lastSignInAt: '2026-10-17T11:00:00.000Z'
		};
		expect(planAuthProfileSync(auth, existing, now)).toEqual({ op: 'none' });
	});

	it('refreshes email, displayName, and a later sign-in, but does not blank stored values', () => {
		const existing = {
			uid: 'abc',
			email: 'old@example.com',
			displayName: 'Old',
			createdAt: '2026-10-01T00:00:00.000Z',
			lastSeenAt: '2026-10-02T00:00:00.000Z',
			lastSignInAt: '2026-10-02T00:00:00.000Z'
		};
		expect(planAuthProfileSync(auth, existing, now)).toEqual({
			op: 'update',
			data: { email: 'ada@example.com', displayName: 'Ada', lastSignInAt: '2026-10-16T08:30:00.000Z' }
		});
		expect(planAuthProfileSync({ ...auth, email: null, displayName: null }, existing, now)).toEqual({
			op: 'update',
			data: { lastSignInAt: '2026-10-16T08:30:00.000Z' }
		});
	});

	it('only fills missing fields on a partial document', () => {
		const plan = planAuthProfileSync(auth, { createdAt: new Date('2020-01-01'), teams: [] }, now);
		expect(plan).toEqual({
			op: 'update',
			data: {
				uid: 'abc',
				email: 'ada@example.com',
				displayName: 'Ada',
				createdAt: '2026-10-01T00:00:00.000Z',
				lastSignInAt: '2026-10-16T08:30:00.000Z',
				lastSeenAt: '2026-10-16T08:30:00.000Z'
			}
		});
		expect(plan.op === 'update' && plan.data).not.toHaveProperty('teams');
	});
});
