import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { CONTACT_SETTINGS_URL, MAIL_COLLECTION, MAIL_TTL_MS, queueContactEmail } from './contactEmail';
import { applyAuthDisabled, handleAdminUsersWrite } from './disableUser';
import { RetryableMailError, deliverQueuedMail } from './sendMail';
import { publishUsageStats } from '../../stats/job';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-gaslands-functions';

function emulatorUrl(host: string | undefined, fallbackPort: number): string {
  const value = host && host.length > 0 ? host : `127.0.0.1:${fallbackPort}`;
  return value.startsWith('http') ? value : `http://${value}`;
}

async function clearEmulators(): Promise<void> {
  const firestore = await fetch(
    `${emulatorUrl(process.env.FIRESTORE_EMULATOR_HOST, 8080)}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  if (!firestore.ok) throw new Error(`Could not clear Firestore (${firestore.status})`);
  const auth = await fetch(
    `${emulatorUrl(process.env.FIREBASE_AUTH_EMULATOR_HOST, 9099)}/emulator/v1/projects/${projectId}/accounts`,
    { method: 'DELETE' }
  );
  if (!auth.ok) throw new Error(`Could not clear Auth (${auth.status})`);
}

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
  if (getApps().length === 0) initializeApp({ projectId });
});

beforeEach(async () => {
  await clearEmulators();
});

afterAll(async () => {
  await clearEmulators();
});

describe('publishUsageStats', () => {
  it('writes stats/public and upserts users without a service account key', async () => {
    const auth = getAuth();
    const db = getFirestore();
    await auth.createUser({ uid: 'ada', email: 'ada@example.com', displayName: 'Ada' });
    await auth.createUser({ uid: 'grace', email: 'grace@example.com', displayName: 'Grace' });
    await db.doc('users/ada').set({
      uid: 'ada',
      email: 'old@example.com',
      displayName: 'Ada',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-02-01T00:00:00.000Z',
      lastSignInAt: '2026-02-01T00:00:00.000Z'
    });
    await db.doc('teams/one').set({
      userId: 'ada',
      teamName: 'Hidden name',
      createdAt: new Date().toISOString(),
      teamData: { sponsorId: 'rutherford', rulesVersion: 2, vehicles: [{ type: 'car' }, { type: 'buggy' }] }
    });
    await db.doc('roles/ada').set({ role: 'Administrator', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'bootstrap' });
    await db.doc('adminUsers/grace').set({ disabled: false, disabledAt: null, disabledBy: null });

    await publishUsageStats();

    const stats = (await db.doc('stats/public').get()).data();
    expect(stats).toMatchObject({
      totalUsers: 2,
      totalTeams: 1,
      totalVehicles: 2,
      teamsByRulesVersion: { v2: 1, v3: 0 },
      teamsBySponsor: [{ sponsorId: 'rutherford', count: 1 }],
      teamsCreatedLast30Days: 1
    });
    expect(stats).not.toHaveProperty('email');
    expect(JSON.stringify(stats)).not.toContain('ada@example.com');
    expect(JSON.stringify(stats)).not.toContain('Hidden name');

    const ada = (await db.doc('users/ada').get()).data();
    expect(ada).toMatchObject({
      email: 'ada@example.com',
      displayName: 'Ada',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-02-01T00:00:00.000Z'
    });
    const grace = (await db.doc('users/grace').get()).data();
    expect(grace).toMatchObject({ uid: 'grace', email: 'grace@example.com', displayName: 'Grace' });
    expect((await db.doc('roles/ada').get()).data()?.role).toBe('Administrator');
    expect((await db.doc('adminUsers/grace').get()).data()).toEqual({
      disabled: false,
      disabledAt: null,
      disabledBy: null
    });
  });
});

describe('adminUsers Auth sync', () => {
  it('disables and revokes refresh tokens, then re-enables, and never deletes the user', async () => {
    const auth = getAuth();
    await auth.createUser({ uid: 'player', email: 'player@example.com', disabled: false });

    await handleAdminUsersWrite('player', null, {
      disabled: true,
      disabledAt: '2026-10-18T12:00:00.000Z',
      disabledBy: 'admin'
    });
    const disabled = await auth.getUser('player');
    expect(disabled.disabled).toBe(true);
    expect(disabled.tokensValidAfterTime).toBeTruthy();
    const revokedAt = disabled.tokensValidAfterTime;

    await handleAdminUsersWrite(
      'player',
      { disabled: true, disabledAt: '2026-10-18T12:00:00.000Z', disabledBy: 'admin' },
      { disabled: true, disabledAt: '2026-10-18T12:00:00.000Z', disabledBy: 'admin' }
    );
    expect((await auth.getUser('player')).tokensValidAfterTime).toBe(revokedAt);

    await handleAdminUsersWrite(
      'player',
      { disabled: true },
      { disabled: false, disabledAt: null, disabledBy: null }
    );
    const enabled = await auth.getUser('player');
    expect(enabled.disabled).toBe(false);
    expect(enabled.email).toBe('player@example.com');

    await handleAdminUsersWrite('player', { disabled: false }, null);
    const stillThere = await auth.getUser('player');
    expect(stillThere.uid).toBe('player');
    expect(stillThere.disabled).toBe(false);
  });

  it('leaves Auth alone when the user record does not exist', async () => {
    await expect(applyAuthDisabled('missing', true)).resolves.toBeUndefined();
    await expect(getAuth().getUser('missing')).rejects.toMatchObject({ code: 'auth/user-not-found' });
  });
});

describe('game contact email', () => {
  const contact = {
    fromUid: 'ada',
    toUid: 'grace',
    fromName: 'Ada',
    toName: 'Grace',
    message: 'Race on Sunday?',
    createdAt: '2026-10-18T12:00:00.000Z',
    read: false,
    reply: '',
    repliedAt: ''
  };

  async function seedPlayers(): Promise<void> {
    const auth = getAuth();
    await auth.createUser({ uid: 'ada', email: 'ada@example.com', displayName: 'Ada' });
    await auth.createUser({ uid: 'grace', email: 'grace@example.com', displayName: 'Grace' });
    await getFirestore().doc('gameContacts/ada_grace').set(contact);
    await getFirestore().doc('users/grace').set({
      uid: 'grace',
      email: 'grace@example.com',
      displayName: 'Grace',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      lastSignInAt: '2026-01-01T00:00:00.000Z'
    });
  }

  it('skips recipients who have not opted in and writes no mail document', async () => {
    await seedPlayers();
    await expect(queueContactEmail('ada_grace', contact)).resolves.toEqual({
      status: 'skipped',
      reason: 'not-opted-in'
    });
    await getFirestore().doc('userSettings/grace').set({ allowContactFromPlayers: false, receiveUpdates: true });
    await expect(queueContactEmail('ada_grace', contact)).resolves.toEqual({
      status: 'skipped',
      reason: 'not-opted-in'
    });
    expect((await getFirestore().collection(MAIL_COLLECTION).get()).empty).toBe(true);
  });

  it('queues the Auth email on the mail document and does not store it on the contact', async () => {
    await seedPlayers();
    await getFirestore().doc('userSettings/grace').set({
      allowContactFromPlayers: true,
      darkMode: true
    });

    await expect(queueContactEmail('ada_grace', contact)).resolves.toEqual({ status: 'queued' });
    await expect(queueContactEmail('ada_grace', contact)).resolves.toEqual({ status: 'queued' });

    const mailSnap = await getFirestore().collection(MAIL_COLLECTION).get();
    expect(mailSnap.size).toBe(1);
    const mail = mailSnap.docs[0].data();
    expect(mailSnap.docs[0].id).toBe('gameContact_ada_grace');
    expect(mail.to).toEqual(['grace@example.com']);
    expect(mail.toName).toBe('Grace');
    expect(mail.message.subject).toBe('Ada sent a Gaslands game request');
    expect(mail.message.text).toContain('Race on Sunday?');
    expect(mail.message.text).toContain(CONTACT_SETTINGS_URL);
    expect(mail.message.text).toContain('turn off player contact');
    expect(mail.message.html).toContain(`href="${CONTACT_SETTINGS_URL}"`);
    expect(Object.keys(mail.message).sort()).toEqual(['html', 'subject', 'text']);
    expect(mail.expireAt).toBeInstanceOf(Timestamp);
    const ttl = (mail.expireAt as Timestamp).toMillis() - Date.now();
    expect(ttl).toBeGreaterThan(MAIL_TTL_MS - 60_000);
    expect(ttl).toBeLessThan(MAIL_TTL_MS + 60_000);
    expect(Object.keys(mail).sort()).toEqual(['expireAt', 'message', 'to', 'toName']);
    expect(JSON.stringify(mail.message)).not.toContain('grace@example.com');

    const storedContact = (await getFirestore().doc('gameContacts/ada_grace').get()).data();
    expect(storedContact).toEqual(contact);
    expect(storedContact).not.toHaveProperty('email');
    expect(JSON.stringify(storedContact)).not.toContain('@');

    const profile = (await getFirestore().doc('users/grace').get()).data();
    expect(profile?.email).toBe('grace@example.com');
    expect(Object.keys(profile ?? {}).sort()).toEqual([
      'createdAt',
      'displayName',
      'email',
      'lastSeenAt',
      'lastSignInAt',
      'uid'
    ]);
  });

  it('does not queue mail for a disabled Auth user or an account with no email', async () => {
    const auth = getAuth();
    await auth.createUser({ uid: 'ada', email: 'ada@example.com' });
    await auth.createUser({ uid: 'grace', email: 'grace@example.com', disabled: true });
    await getFirestore().doc('userSettings/grace').set({ allowContactFromPlayers: true });
    await expect(queueContactEmail('ada_grace', contact)).resolves.toEqual({ status: 'skipped', reason: 'disabled' });

    await auth.createUser({ uid: 'noemail', displayName: 'No Email' });
    await getFirestore().doc('userSettings/noemail').set({ allowContactFromPlayers: true });
    await expect(
      queueContactEmail('ada_noemail', { ...contact, toUid: 'noemail' })
    ).resolves.toEqual({ status: 'skipped', reason: 'no-email' });
    expect((await getFirestore().collection(MAIL_COLLECTION).get()).empty).toBe(true);
  });
});

describe('Twilio delivery of queued mail', () => {
  const operationId = 'comms_operation_01h9krwprkeee8fzqspvwy6nq8';
  const authToken = 'test-auth-token';

  function queuedMail(extra: Record<string, unknown> = {}) {
    return {
      to: ['grace@example.com'],
      toName: 'Grace',
      message: {
        subject: 'Ada sent a Gaslands game request',
        text: `Race on Sunday?\n\nTo turn off player contact, open your settings:\n${CONTACT_SETTINGS_URL}`,
        html: `<p>Race on Sunday?</p><p>To turn off player contact, open your <a href="${CONTACT_SETTINGS_URL}">settings</a>.</p>`
      },
      expireAt: Timestamp.fromMillis(Date.parse('2026-11-17T12:00:00.000Z')),
      ...extra
    };
  }

  function acceptedResponse(id = operationId): Response {
    return new Response(JSON.stringify({ operationId: id, operationLocation: `https://comms.twilio.com/v1/Emails/Operations/${id}` }), {
      status: 202,
      headers: { 'content-type': 'application/json' }
    });
  }

  async function deliver(
    mailId: string,
    fetchImpl: typeof fetch,
    leaseId = 'event-1'
  ): Promise<Awaited<ReturnType<typeof deliverQueuedMail>>> {
    return deliverQueuedMail(mailId, {
      accountSid: 'ACtest',
      authToken,
      fromAddress: 'noreply@gaslandsgarage.com',
      fromName: 'Gaslands Garage',
      leaseId,
      fetchImpl
    });
  }

  async function silenceLogs<T>(run: () => Promise<T>): Promise<{ result?: T; error?: unknown; output: string }> {
    const lines: string[] = [];
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = methods.map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' '));
      })
    );
    try {
      try {
        const result = await run();
        return { result, output: lines.join('\n') };
      } catch (error) {
        return { error, output: lines.join('\n') };
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  }

  function expectNoSecrets(output: string): void {
    expect(output).not.toContain('grace@example.com');
    expect(output).not.toContain('noreply@gaslandsgarage.com');
    expect(output).not.toContain(authToken);
    expect(output).not.toContain('ACtest');
    expect(output).not.toContain('Race on Sunday');
    expect(output).not.toContain('Ada sent a Gaslands game request');
  }

  it('sends once, stores the operationId, and leaves expireAt in place', async () => {
    const db = getFirestore();
    await db.doc(`${MAIL_COLLECTION}/gameContact_ada_grace`).set(queuedMail());
    const before = (await db.doc(`${MAIL_COLLECTION}/gameContact_ada_grace`).get()).data();
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), init });
      return acceptedResponse();
    };

    const { result, output } = await silenceLogs(() => deliver('gameContact_ada_grace', fetchImpl));
    expect(result).toEqual({ status: 'sent', operationId });
    const again = await silenceLogs(() => deliver('gameContact_ada_grace', fetchImpl));
    expect(again.result).toEqual({ status: 'skipped', reason: 'already-sent' });
    expectNoSecrets(output);
    expectNoSecrets(again.output);

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://comms.twilio.com/v1/Emails');
    expect(seen[0].init?.method).toBe('POST');
    const headers = new Headers(seen[0].init?.headers);
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from(`ACtest:${authToken}`).toString('base64')}`);
    expect(JSON.parse(String(seen[0].init?.body))).toEqual({
      from: { address: 'noreply@gaslandsgarage.com', name: 'Gaslands Garage' },
      to: [{ address: 'grace@example.com', name: 'Grace' }],
      content: {
        subject: 'Ada sent a Gaslands game request',
        html: before?.message.html,
        text: before?.message.text
      }
    });

    const after = (await db.doc(`${MAIL_COLLECTION}/gameContact_ada_grace`).get()).data();
    expect(after?.state).toBe('sent');
    expect(after?.operationId).toBe(operationId);
    expect(after?.error).toBeUndefined();
    expect(after?.leaseId).toBeUndefined();
    expect(after?.expireAt.toMillis()).toBe(before?.expireAt.toMillis());
    expect(after?.to).toEqual(before?.to);
    expect(after?.message).toEqual(before?.message);
    expect(JSON.stringify(after)).not.toContain('operationLocation');
    expect(JSON.stringify(after?.error ?? '')).not.toContain('grace@example.com');
  });

  it('retries a 503 and then records the operationId without keeping the response body', async () => {
    const db = getFirestore();
    await db.doc(`${MAIL_COLLECTION}/gameContact_retry`).set(queuedMail());
    const expireAt = (await db.doc(`${MAIL_COLLECTION}/gameContact_retry`).get()).data()?.expireAt.toMillis();
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ to: 'grace@example.com', html: '<p>secret body</p>' }), { status: 503 });
      return acceptedResponse();
    };

    const first = await silenceLogs(() => deliver('gameContact_retry', fetchImpl));
    expect(first.error).toBeInstanceOf(RetryableMailError);
    expect((first.error as Error).message).toMatch(/will retry \(http_503\)/);
    const failed = (await db.doc(`${MAIL_COLLECTION}/gameContact_retry`).get()).data();
    expect(failed?.state).toBe('error');
    expect(failed?.error).toEqual({
      status: 503,
      message: 'Twilio Email returned HTTP 503',
      retryable: true
    });
    expect(JSON.stringify(failed?.error)).not.toContain('grace@example.com');
    expect(JSON.stringify(failed?.error)).not.toContain('secret body');
    expect(failed?.expireAt.toMillis()).toBe(expireAt);
    expect(failed?.leaseId).toBeUndefined();
    expectNoSecrets(first.output);

    const second = await silenceLogs(() => deliver('gameContact_retry', fetchImpl, 'event-2'));
    expect(second.result).toEqual({ status: 'sent', operationId });
    const sent = (await db.doc(`${MAIL_COLLECTION}/gameContact_retry`).get()).data();
    expect(sent?.state).toBe('sent');
    expect(sent?.operationId).toBe(operationId);
    expect(sent?.error).toBeUndefined();
    expect(sent?.expireAt.toMillis()).toBe(expireAt);
    expect(calls).toBe(2);
  });

  it('stores a 400 and does not send that document again', async () => {
    const db = getFirestore();
    await db.doc(`${MAIL_COLLECTION}/gameContact_bad`).set(queuedMail());
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response('grace@example.com do not store', { status: 400 });
    };
    const { result, output } = await silenceLogs(() => deliver('gameContact_bad', fetchImpl));
    expect(result).toEqual({ status: 'skipped', reason: 'permanent-error' });
    expectNoSecrets(output);
    const failed = (await db.doc(`${MAIL_COLLECTION}/gameContact_bad`).get()).data();
    expect(failed?.state).toBe('error');
    expect(failed?.error).toEqual({
      status: 400,
      message: 'Twilio Email returned HTTP 400',
      retryable: false
    });
    expect(JSON.stringify(failed?.error)).not.toContain('do not store');
    await expect(deliver('gameContact_bad', fetchImpl)).resolves.toEqual({
      status: 'skipped',
      reason: 'permanent-error'
    });
    expect(calls).toBe(1);
  });

  it('throws on HTTP 429 and on a network failure so the event can retry', async () => {
    const db = getFirestore();
    await db.doc(`${MAIL_COLLECTION}/gameContact_rate`).set(queuedMail());
    const rate = await silenceLogs(() =>
      deliver('gameContact_rate', async () => new Response('grace@example.com', { status: 429 }))
    );
    expect(rate.error).toBeInstanceOf(RetryableMailError);
    expect((rate.error as Error).message).toMatch(/will retry \(http_429\)/);
    expect((rate.error as Error).message).not.toContain('grace@example.com');
    expectNoSecrets(rate.output);
    const rateDoc = (await db.doc(`${MAIL_COLLECTION}/gameContact_rate`).get()).data();
    expect(rateDoc?.error).toEqual({
      status: 429,
      message: 'Twilio Email returned HTTP 429',
      retryable: true
    });
    expect(rateDoc?.expireAt).toBeInstanceOf(Timestamp);

    await db.doc(`${MAIL_COLLECTION}/gameContact_network`).set(queuedMail());
    const network = await silenceLogs(() =>
      deliver('gameContact_network', async () => {
        throw new Error('connect ECONNREFUSED grace@example.com');
      })
    );
    expect(network.error).toBeInstanceOf(RetryableMailError);
    expect((network.error as Error).message).toMatch(/will retry \(network\)/);
    expect((network.error as Error).message).not.toContain('grace@example.com');
    expect(network.output).not.toContain('ECONNREFUSED');
    expectNoSecrets(network.output);
    const networkDoc = (await db.doc(`${MAIL_COLLECTION}/gameContact_network`).get()).data();
    expect(networkDoc?.error).toEqual({
      status: null,
      message: 'Twilio Email request failed',
      retryable: true
    });
    expect(JSON.stringify(networkDoc?.error)).not.toContain('ECONNREFUSED');
    expect(networkDoc?.expireAt.toMillis()).toBe(queuedMail().expireAt.toMillis());
  });

  it('keeps a single in-flight lease and sends after an expired lease', async () => {
    const db = getFirestore();
    await db.doc(`${MAIL_COLLECTION}/gameContact_lease`).set(queuedMail());
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) await hold;
      return acceptedResponse();
    };

    const first = deliver('gameContact_lease', fetchImpl, 'event-1');
    try {
      await vi.waitFor(async () => {
        const mid = (await db.doc(`${MAIL_COLLECTION}/gameContact_lease`).get()).data();
        expect(mid?.state).toBe('sending');
      });
      const mid = (await db.doc(`${MAIL_COLLECTION}/gameContact_lease`).get()).data();
      expect(mid?.leaseId).toBe('event-1');
      expect(mid?.expireAt.toMillis()).toBe(queuedMail().expireAt.toMillis());

      await expect(deliver('gameContact_lease', fetchImpl, 'event-1')).rejects.toThrow(/will retry \(lease\)/);
      await expect(deliver('gameContact_lease', fetchImpl, 'event-2')).resolves.toEqual({
        status: 'skipped',
        reason: 'leased'
      });
      expect(calls).toBe(1);
    } finally {
      release();
    }
    await expect(first).resolves.toEqual({ status: 'sent', operationId });
    expect(calls).toBe(1);

    await db.doc(`${MAIL_COLLECTION}/gameContact_expired`).set(
      queuedMail({
        state: 'sending',
        leaseId: 'event-1',
        leaseExpiresAt: Timestamp.fromMillis(Date.now() - 1000)
      })
    );
    await expect(deliver('gameContact_expired', fetchImpl, 'event-1')).resolves.toEqual({
      status: 'sent',
      operationId
    });
    expect(calls).toBe(2);
    const expired = (await db.doc(`${MAIL_COLLECTION}/gameContact_expired`).get()).data();
    expect(expired?.state).toBe('sent');
    expect(expired?.expireAt.toMillis()).toBe(queuedMail().expireAt.toMillis());
  });

  it('records a permanent error for a document that cannot be sent and does not call Twilio', async () => {
    const db = getFirestore();
    const expireAt = Timestamp.fromMillis(Date.parse('2026-11-17T12:00:00.000Z'));
    await db.doc(`${MAIL_COLLECTION}/bad`).set({ to: ['not-an-email'], message: { subject: 'Hi', text: 'Body' }, expireAt });
    let calls = 0;
    const { result } = await silenceLogs(() =>
      deliver('bad', async () => {
        calls += 1;
        return acceptedResponse();
      })
    );
    expect(result).toEqual({ status: 'skipped', reason: 'invalid' });
    expect(calls).toBe(0);
    const stored = (await db.doc(`${MAIL_COLLECTION}/bad`).get()).data();
    expect(stored?.state).toBe('error');
    expect(stored?.error.retryable).toBe(false);
    expect(stored?.expireAt.toMillis()).toBe(expireAt.toMillis());
    expect(JSON.stringify(stored?.error)).not.toContain('not-an-email');
  });

  it('throws before writing when Twilio config is missing so a later retry can send', async () => {
    const db = getFirestore();
    await db.doc(`${MAIL_COLLECTION}/configured-later`).set(queuedMail());
    await expect(
      deliverQueuedMail('configured-later', {
        accountSid: '',
        authToken: '',
        fromAddress: 'noreply@gaslandsgarage.com',
        fromName: 'Gaslands Garage',
        leaseId: 'event-1',
        fetchImpl: async () => acceptedResponse()
      })
    ).rejects.toThrow(/will retry \(config\)/);
    const stored = (await db.doc(`${MAIL_COLLECTION}/configured-later`).get()).data();
    expect(stored?.state).toBeUndefined();
    expect(stored?.expireAt.toMillis()).toBe(queuedMail().expireAt.toMillis());
  });

  it('marks a 202 without an operationId as sent and does not send again', async () => {
    const db = getFirestore();
    await db.doc(`${MAIL_COLLECTION}/no-operation`).set(queuedMail());
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response('accepted', { status: 202 });
    };
    await expect(deliver('no-operation', fetchImpl)).resolves.toEqual({ status: 'sent', operationId: null });
    const stored = (await db.doc(`${MAIL_COLLECTION}/no-operation`).get()).data();
    expect(stored?.state).toBe('sent');
    expect(stored?.operationId).toBeUndefined();
    expect(stored?.error).toEqual({
      status: 202,
      message: 'Twilio Email accepted the send without an operationId',
      retryable: false
    });
    expect(stored?.expireAt.toMillis()).toBe(queuedMail().expireAt.toMillis());
    await expect(deliver('no-operation', fetchImpl)).resolves.toEqual({ status: 'skipped', reason: 'already-sent' });
    expect(calls).toBe(1);
  });
});
