import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { aggregateUsage, readTime, rulesBucket } from './aggregate';

const now = new Date('2026-10-16T12:00:00.000Z');
const day = 24 * 60 * 60 * 1000;

describe('aggregateUsage', () => {
  it('counts users, vehicles, versions, sponsors, and the last 30 days', () => {
    const stats = aggregateUsage(
      [
        {
          userId: 'user-a',
          teamName: 'Hidden name',
          createdAt: new Date(now.getTime() - 2 * day).toISOString(),
          teamData: {
            sponsor: 'rutherford',
            sponsorId: 'rutherford',
            rulesVersion: 2,
            vehicles: [{ type: 'car' }, { type: 'buggy' }]
          }
        },
        {
          userId: 'user-b',
          createdAt: { seconds: Math.floor((now.getTime() - 10 * day) / 1000) },
          teamData: {
            sponsorId: 'rustys',
            rulesVersion: '3',
            vehicles: [{ type: 'car' }]
          }
        },
        {
          userId: 'user-a',
          createdAt: new Date(now.getTime() - 40 * day).toISOString(),
          draft: {
            sponsor: 'rutherford',
            vehicles: []
          }
        },
        {
          createdAt: { toDate: () => new Date(now.getTime() - day) },
          teamData: { vehicles: [{ type: 'war-rig' }, { type: 'car' }, { type: 'bike' }] }
        },
        null,
        'skip-me'
      ],
      12.9,
      now
    );

    expect(stats.totalUsers).toBe(12);
    expect(stats.totalTeams).toBe(4);
    expect(stats.totalVehicles).toBe(6);
    expect(stats.teamsByRulesVersion).toEqual({ v2: 3, v3: 1 });
    expect(stats.teamsCreatedLast30Days).toBe(3);
    expect(stats.teamsBySponsor).toEqual([
      { sponsorId: 'rutherford', count: 2 },
      { sponsorId: 'rustys', count: 1 },
      { sponsorId: 'unknown', count: 1 }
    ]);
    expect(stats.updatedAt).toBe(now.toISOString());
    expect(JSON.stringify(stats)).not.toContain('user-a');
    expect(JSON.stringify(stats)).not.toContain('Hidden name');
  });

  it('treats a missing rules version as v2 and ignores future createdAt values', () => {
    const stats = aggregateUsage(
      [
        { createdAt: new Date(now.getTime() + day).toISOString(), teamData: { sponsor: 'slime', vehicles: [{}] } }
      ],
      -3,
      now
    );
    expect(stats.totalUsers).toBe(0);
    expect(stats.teamsByRulesVersion.v2).toBe(1);
    expect(stats.teamsCreatedLast30Days).toBe(0);
    expect(rulesBucket(undefined)).toBe('v2');
    expect(rulesBucket(3)).toBe('v3');
  });

  it('reads the timestamp shapes Firestore can return', () => {
    expect(readTime('2026-01-02T00:00:00.000Z')?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(readTime({ _seconds: 1_700_000_000 })?.getTime()).toBe(1_700_000_000_000);
    expect(readTime('not-a-date')).toBeNull();
  });
});

describe('firestore rules', () => {
  const rules = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../app/firestore.rules'), 'utf8');

  it('publishes only stats/public for reading and still denies client writes', () => {
    expect(rules).toMatch(/match \/stats\/\{statId\} \{[^}]*allow read: if statId == 'public';[^}]*allow write: if false;/s);
    expect(rules).toContain('resource.data.userId == request.auth.uid');
    expect(rules).toContain('allow read, write: if false');
    expect(rules).not.toMatch(/match \/teams\/\{teamId\} \{[^}]*allow read: if true/s);
  });
});
