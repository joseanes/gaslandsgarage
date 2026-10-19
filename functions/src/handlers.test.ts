import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { MAIL_TTL_MS, contactMailDocument, mailDocId, mailExpiresAt, recipientWantsContactEmail } from './contactEmail';
import { USAGE_STATS_SCHEDULE, USAGE_STATS_TIME_ZONE } from '../../stats/job';
import { DELETE_CONFIRMATION, PRIVACY_REGION, REAUTH_WINDOW_MS, deletionRequestError, nextRateWindow, privacyCallableOptions } from './accountPrivacy';
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

describe('account deletion request', () => {
  it('requires the word DELETE and a sign-in from the last five minutes', () => {
    const now = Date.parse('2026-10-18T12:00:00.000Z');
    expect(deletionRequestError({ confirmation: 'delete', authTimeSeconds: now / 1000, nowMs: now })).toMatch(/DELETE/);
    expect(
      deletionRequestError({
        confirmation: DELETE_CONFIRMATION,
        authTimeSeconds: now / 1000 - REAUTH_WINDOW_MS / 1000 - 1,
        nowMs: now
      })
    ).toMatch(/Sign in again/);
    expect(
      deletionRequestError({ confirmation: DELETE_CONFIRMATION, authTimeSeconds: Math.floor(now / 1000), nowMs: now })
    ).toBeNull();
    expect(nextRateWindow([now - 1000, now - 2000], now).allowed).toBe(true);
    expect(nextRateWindow([now, now - 1, now - 2, now - 3, now - 4], now).allowed).toBe(false);
    expect(privacyCallableOptions.region).toBe(FUNCTIONS_REGION);
    expect(PRIVACY_REGION).toBe(FUNCTIONS_REGION);
  });
});

describe('function source', () => {
  it('keeps Auth deletion out of the admin and contact functions', () => {
    const files = ['index.ts', 'disableUser.ts', 'contactEmail.ts'];
    const source = files
      .map((name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/deleteUser/);
    expect(source).not.toMatch(/FIREBASE_SERVICE_ACCOUNT/);
    expect(source).not.toMatch(/private_key/);
    expect(source).not.toMatch(/serviceAccount/);
    const privacy = readFileSync(new URL('./accountPrivacy.ts', import.meta.url), 'utf8');
    expect(privacy).toMatch(/\.deleteUser\(/);
    expect(privacy.indexOf("steps.push('auth')")).toBeGreaterThan(privacy.indexOf("steps.push('anonymize')"));
    expect(privacy.indexOf("steps.push('auth')")).toBeGreaterThan(privacy.indexOf("steps.push('photos')"));
    expect(privacy).not.toMatch(/request\.data\.uid/);
    expect(privacy).toMatch(/request\.auth\?\.uid/);
  });
});
