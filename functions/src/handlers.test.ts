import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { MAIL_TTL_MS, contactMailDocument, mailDocId, mailExpiresAt, recipientWantsContactEmail } from './contactEmail';
import { USAGE_STATS_SCHEDULE, USAGE_STATS_TIME_ZONE } from '../../stats/job';
import { FUNCTIONS_REGION, publishUsageStatsOptions } from './index';

describe('publishUsageStats schedule', () => {
  it('keeps the GitHub cron and runs it in America/New_York on the default identity', () => {
    expect(USAGE_STATS_SCHEDULE).toBe('15 6 * * *');
    expect(USAGE_STATS_TIME_ZONE).toBe('America/New_York');
    expect(publishUsageStatsOptions).toEqual({
      schedule: '15 6 * * *',
      timeZone: 'America/New_York',
      region: FUNCTIONS_REGION,
      memory: '256MiB',
      timeoutSeconds: 300,
      maxInstances: 1
    });
    expect(publishUsageStatsOptions).not.toHaveProperty('serviceAccount');
    expect(publishUsageStatsOptions).not.toHaveProperty('secrets');
  });
});

describe('contact mail document', () => {
  it('opts in only when allowContactFromPlayers is true', () => {
    expect(recipientWantsContactEmail(null)).toBe(false);
    expect(recipientWantsContactEmail(undefined)).toBe(false);
    expect(recipientWantsContactEmail({})).toBe(false);
    expect(recipientWantsContactEmail({ allowContactFromPlayers: false })).toBe(false);
    expect(recipientWantsContactEmail({ receiveUpdates: true })).toBe(false);
    expect(recipientWantsContactEmail({ allowContactFromPlayers: true })).toBe(true);
  });

  it('uses the Trigger Email shape and keeps the address only in to', () => {
    const mail = contactMailDocument({
      to: 'ada@example.com',
      fromName: 'Ada\nLovelace',
      message: 'Sunday at the warehouse?'
    });
    expect(Object.keys(mail).sort()).toEqual(['message', 'to']);
    expect(mail.to).toEqual(['ada@example.com']);
    expect(mail.message.subject).toBe('Ada Lovelace sent a Gaslands game request');
    expect(mail.message.subject).not.toContain('\n');
    expect(mail.message.text).toContain('Sunday at the warehouse?');
    expect(mail.message.text).not.toContain('ada@example.com');
    expect(mailDocId('ada_grace')).toBe('gameContact_ada_grace');
  });

  it('sets expireAt 30 days after the queue time', () => {
    const now = new Date('2026-10-18T12:00:00.000Z');
    const expireAt = mailExpiresAt(now);
    expect(expireAt).toBeInstanceOf(Timestamp);
    expect(expireAt.toMillis() - now.getTime()).toBe(MAIL_TTL_MS);
  });
});

describe('function source', () => {
  it('does not delete Auth users or embed a service account key', () => {
    const files = ['index.ts', 'disableUser.ts', 'contactEmail.ts'];
    const source = files
      .map((name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/deleteUser/);
    expect(source).not.toMatch(/FIREBASE_SERVICE_ACCOUNT/);
    expect(source).not.toMatch(/private_key/);
    expect(source).not.toMatch(/serviceAccount/);
  });
});
