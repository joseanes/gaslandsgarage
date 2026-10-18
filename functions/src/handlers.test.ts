import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  CONTACT_SETTINGS_URL,
  MAIL_TTL_MS,
  contactMailDocument,
  mailDocId,
  mailExpiresAt,
  recipientWantsContactEmail
} from './contactEmail';
import { USAGE_STATS_SCHEDULE, USAGE_STATS_TIME_ZONE } from '../../stats/job';
import {
  FUNCTIONS_REGION,
  mailFromAddress,
  publishUsageStatsOptions,
  sendQueuedMailOptions,
  twilioAccountSid,
  twilioAuthToken
} from './index';
import {
  DEFAULT_MAIL_FROM_ADDRESS,
  MAIL_FROM_NAME,
  TWILIO_EMAIL_URL,
  buildTwilioEmail,
  isRetryableTwilioStatus,
  postTwilioEmail,
  twilioAuthorization
} from './sendMail';

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

  it('keeps the address only in to and links to the contact setting', () => {
    const mail = contactMailDocument({
      to: 'ada@example.com',
      fromName: 'Ada\nLovelace',
      toName: 'Grace Hopper',
      message: 'Sunday at the warehouse?'
    });
    expect(Object.keys(mail).sort()).toEqual(['message', 'to', 'toName']);
    expect(mail.to).toEqual(['ada@example.com']);
    expect(mail.toName).toBe('Grace Hopper');
    expect(mail.message.subject).toBe('Ada Lovelace sent a Gaslands game request');
    expect(mail.message.subject).not.toContain('\n');
    expect(mail.message.text).toContain('Sunday at the warehouse?');
    expect(mail.message.text).toContain(CONTACT_SETTINGS_URL);
    expect(mail.message.text).toContain('turn off player contact');
    expect(mail.message.html).toContain(`href="${CONTACT_SETTINGS_URL}"`);
    expect(mail.message.text).not.toContain('ada@example.com');
    expect(mail.message.html).not.toContain('ada@example.com');
    expect(mailDocId('ada_grace')).toBe('gameContact_ada_grace');
  });

  it('escapes HTML in the message and drops an address used as a display name', () => {
    const mail = contactMailDocument({
      to: 'ada@example.com',
      fromName: '<b>Ada</b>',
      toName: 'grace@example.com',
      message: '<script>alert(1)</script>'
    });
    expect(mail.toName).toBeUndefined();
    expect(mail.message.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.message.html).toContain('&lt;b&gt;Ada&lt;/b&gt;');
    expect(mail.message.html).not.toContain('<script>');
    expect(mail.message.text).toContain('<script>alert(1)</script>');
  });

  it('sets expireAt 30 days after the queue time', () => {
    const now = new Date('2026-10-18T12:00:00.000Z');
    const expireAt = mailExpiresAt(now);
    expect(expireAt).toBeInstanceOf(Timestamp);
    expect(expireAt.toMillis() - now.getTime()).toBe(MAIL_TTL_MS);
  });
});

describe('Twilio Email request', () => {
  const email = {
    from: { address: 'noreply@gaslandsgarage.com', name: 'Gaslands Garage' },
    to: [{ address: 'grace@example.com', name: 'Grace' }],
    content: {
      subject: 'Ada sent a Gaslands game request',
      html: '<p>Hello</p>',
      text: 'Hello'
    }
  };

  it('POSTs Basic auth JSON to the Twilio Email mail send resource', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const result = await postTwilioEmail(email, { accountSid: 'ACsid', authToken: 'auth-token' }, async (url, init) => {
      seen.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          operationId: 'comms_operation_01h9krwprkeee8fzqspvwy6nq8',
          operationLocation: 'https://comms.twilio.com/v1/Emails/Operations/comms_operation_01h9krwprkeee8fzqspvwy6nq8'
        }),
        { status: 202, headers: { 'content-type': 'application/json' } }
      );
    });
    expect(result).toEqual({ ok: true, operationId: 'comms_operation_01h9krwprkeee8fzqspvwy6nq8' });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(TWILIO_EMAIL_URL);
    expect(seen[0].init?.method).toBe('POST');
    const headers = new Headers(seen[0].init?.headers);
    expect(headers.get('authorization')).toBe(twilioAuthorization('ACsid', 'auth-token'));
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from('ACsid:auth-token').toString('base64')}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(seen[0].init?.body))).toEqual(email);
  });

  it('retries only 429 and 5xx and discards the response body', async () => {
    expect(isRetryableTwilioStatus(429)).toBe(true);
    expect(isRetryableTwilioStatus(500)).toBe(true);
    expect(isRetryableTwilioStatus(503)).toBe(true);
    expect(isRetryableTwilioStatus(599)).toBe(true);
    expect(isRetryableTwilioStatus(400)).toBe(false);
    expect(isRetryableTwilioStatus(401)).toBe(false);
    expect(isRetryableTwilioStatus(403)).toBe(false);
    expect(isRetryableTwilioStatus(404)).toBe(false);
    expect(isRetryableTwilioStatus(408)).toBe(false);
    expect(isRetryableTwilioStatus(200)).toBe(false);

    const failed = await postTwilioEmail(email, { accountSid: 'ACsid', authToken: 'auth-token' }, async () => {
      return new Response('grace@example.com secret body', { status: 503 });
    });
    expect(failed).toEqual({ ok: false, status: 503, retryable: true });
    expect(JSON.stringify(failed)).not.toContain('grace@example.com');
    expect(JSON.stringify(failed)).not.toContain('secret body');

    const clientError = await postTwilioEmail(email, { accountSid: 'ACsid', authToken: 'auth-token' }, async () => {
      return new Response(JSON.stringify({ to: 'grace@example.com' }), { status: 400 });
    });
    expect(clientError).toEqual({ ok: false, status: 400, retryable: false });

    const rateLimited = await postTwilioEmail(email, { accountSid: 'ACsid', authToken: 'auth-token' }, async () => {
      return new Response('slow down', { status: 429 });
    });
    expect(rateLimited).toEqual({ ok: false, status: 429, retryable: true });
  });

  it('accepts a 202 that does not include an operationId', async () => {
    const result = await postTwilioEmail(email, { accountSid: 'ACsid', authToken: 'auth-token' }, async () => {
      return new Response('not-json', { status: 202 });
    });
    expect(result).toEqual({ ok: true, operationId: null });
  });

  it('builds the Twilio body from the queued document and adds a settings link when missing', () => {
    expect(MAIL_FROM_NAME).toBe('Gaslands Garage');
    expect(DEFAULT_MAIL_FROM_ADDRESS).toBe('noreply@gaslandsgarage.com');
    const built = buildTwilioEmail(
      {
        to: ['grace@example.com'],
        toName: 'Grace',
        expireAt: 'leave-me',
        message: { subject: 'Hello\nthere', text: 'Race on Sunday?', html: '<p>Race on Sunday?</p>' }
      },
      { address: DEFAULT_MAIL_FROM_ADDRESS, name: MAIL_FROM_NAME }
    );
    expect(built?.from).toEqual({ address: 'noreply@gaslandsgarage.com', name: 'Gaslands Garage' });
    expect(built?.to).toEqual([{ address: 'grace@example.com', name: 'Grace' }]);
    expect(built?.content.subject).toBe('Hello there');
    expect(built?.content.text).toContain('Race on Sunday?');
    expect(built?.content.text).toContain(CONTACT_SETTINGS_URL);
    expect(built?.content.html).toContain(`href="${CONTACT_SETTINGS_URL}"`);
    expect(JSON.stringify(built)).not.toContain('leave-me');
    expect(
      buildTwilioEmail(
        { to: ['grace@example.com\nBcc: evil@example.com'], message: { subject: 'Hi', text: 'Body', html: '<p>Body</p>' } },
        { address: DEFAULT_MAIL_FROM_ADDRESS, name: MAIL_FROM_NAME }
      )
    ).toBeNull();
  });
});

describe('sendQueuedMail wiring', () => {
  it('binds the Twilio secrets and the from-address param only on the mail trigger', () => {
    expect(twilioAccountSid.name).toBe('TWILIO_ACCOUNT_SID');
    expect(twilioAuthToken.name).toBe('TWILIO_AUTH_TOKEN');
    expect(mailFromAddress.name).toBe('MAIL_FROM_ADDRESS');
    expect(sendQueuedMailOptions).toMatchObject({
      document: 'mail/{id}',
      region: FUNCTIONS_REGION,
      retry: true
    });
    expect(sendQueuedMailOptions.secrets.map((secret) => secret.name)).toEqual([
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN'
    ]);
    expect(sendQueuedMailOptions).not.toHaveProperty('serviceAccount');
    expect(publishUsageStatsOptions).not.toHaveProperty('secrets');
  });
});

describe('function source', () => {
  it('does not delete Auth users or embed a service account key', () => {
    const files = ['index.ts', 'disableUser.ts', 'contactEmail.ts', 'sendMail.ts'];
    const source = files
      .map((name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/deleteUser/);
    expect(source).not.toMatch(/FIREBASE_SERVICE_ACCOUNT/);
    expect(source).not.toMatch(/private_key/);
    expect(source).not.toMatch(/serviceAccount/);
    expect(source).not.toMatch(/firestore-send-email/);
    expect(source).not.toMatch(/Trigger Email/);
  });

  it('logs mail delivery without the request or the credentials', () => {
    const source = readFileSync(new URL('./sendMail.ts', import.meta.url), 'utf8');
    expect(source.match(/console\.\w+/g)).toEqual(['console.log']);
    const logLine = source.match(/console\.log\(([^)]*)\)/)?.[1] ?? '';
    expect(logLine).not.toMatch(/accountSid|authToken|address|html|text|subject|body|email/i);
  });
});
