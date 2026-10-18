import { describe, expect, it, vi } from 'vitest';
import { syncUserProfiles, type AuthUserLike, type ProfileWriter } from './usersSync';

const now = '2026-10-17T12:00:00.000Z';

function user(uid: string, extra: Partial<AuthUserLike> = {}): AuthUserLike {
  return {
    uid,
    email: `${uid}@example.com`,
    displayName: uid.toUpperCase(),
    metadata: {
      creationTime: 'Thu, 01 Oct 2026 00:00:00 GMT',
      lastSignInTime: 'Fri, 16 Oct 2026 08:30:00 GMT'
    },
    ...extra
  };
}

function fakeWriter(failUid?: string) {
  const created = new Map<string, unknown>();
  const updated = new Map<string, unknown>();
  let flushed = false;
  const pending: Array<() => void> = [];
  const queue = (uid: string, store: Map<string, unknown>, data: unknown) =>
    new Promise<void>((resolve, reject) => {
      // Like a BulkWriter: nothing settles until flush().
      pending.push(() => {
        if (uid === failUid) return reject(new Error('ALREADY_EXISTS'));
        store.set(uid, data);
        resolve();
      });
    });
  const writer: ProfileWriter = {
    create: (uid, data) => queue(uid, created, data),
    update: (uid, data) => queue(uid, updated, data),
    flush: async () => {
      flushed = true;
      pending.splice(0).forEach((run) => run());
    }
  };
  return { writer, created, updated, wasFlushed: () => flushed };
}

describe('syncUserProfiles', () => {
  it('creates missing profiles, updates stale ones, and skips current ones', async () => {
    const existing = new Map<string, Record<string, unknown>>([
      [
        'current',
        {
          uid: 'current',
          email: 'current@example.com',
          displayName: 'CURRENT',
          createdAt: '2026-10-01T00:00:00.000Z',
          lastSeenAt: '2026-10-17T11:00:00.000Z',
          lastSignInAt: '2026-10-16T08:30:00.000Z'
        }
      ],
      [
        'stale',
        {
          uid: 'stale',
          email: 'stale@example.com',
          displayName: 'STALE',
          createdAt: '2026-09-01T00:00:00.000Z',
          lastSeenAt: '2026-10-17T11:00:00.000Z',
          lastSignInAt: '2026-10-01T00:00:00.000Z'
        }
      ],
      ['orphan', { uid: 'orphan' }]
    ]);
    const fake = fakeWriter();
    const result = await syncUserProfiles([user('new'), user('current'), user('stale')], existing, fake.writer, now);

    expect(result).toEqual({ created: 1, updated: 1, unchanged: 1, failed: 0 });
    expect(fake.wasFlushed()).toBe(true);
    expect(fake.created.get('new')).toEqual({
      uid: 'new',
      email: 'new@example.com',
      displayName: 'NEW',
      createdAt: '2026-10-01T00:00:00.000Z',
      lastSeenAt: '2026-10-16T08:30:00.000Z',
      lastSignInAt: '2026-10-16T08:30:00.000Z'
    });
    expect(fake.updated.get('stale')).toEqual({ lastSignInAt: '2026-10-16T08:30:00.000Z' });
    expect(fake.updated.has('orphan')).toBe(false);
    expect(fake.created.has('orphan')).toBe(false);
  });

  it('counts failed writes instead of throwing', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakeWriter('racer');
    const result = await syncUserProfiles([user('racer'), user('ok')], new Map(), fake.writer, now);
    expect(result).toEqual({ created: 1, updated: 0, unchanged: 0, failed: 1 });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('users/racer'));
    errors.mockRestore();
  });
});
