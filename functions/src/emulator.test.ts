import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import {
  DELETE_CONFIRMATION,
  OMITTED_NOTE,
  RATE_LIMIT_MAX,
  eraseAccount,
  handleDeleteMyAccount,
  handleExportMyData,
  privacyLogRef
} from './accountPrivacy';
import { MAIL_COLLECTION, MAIL_TTL_MS, queueContactEmail } from './contactEmail';
import { applyAuthDisabled, handleAdminUsersWrite } from './disableUser';
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
    expect(mail.message).toEqual({
      subject: 'Ada sent a Gaslands game request',
      text: expect.stringContaining('Race on Sunday?')
    });
    expect(mail.expireAt).toBeInstanceOf(Timestamp);
    const ttl = (mail.expireAt as Timestamp).toMillis() - Date.now();
    expect(ttl).toBeGreaterThan(MAIL_TTL_MS - 60_000);
    expect(ttl).toBeLessThan(MAIL_TTL_MS + 60_000);
    expect(Object.keys(mail).sort()).toEqual(['expireAt', 'message', 'to']);
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

describe('account privacy', () => {
  const ada = 'playerAda123';
  const grace = 'playerGrace456';
  const pin = 'abc123abc123abc123abc1';
  const gracePin = 'gracepingracepingrace1';

  function rulesCollections(): string[] {
    const rules = readFileSync(new URL('../../app/firestore.rules', import.meta.url), 'utf8');
    return [
      ...new Set(
        [...rules.matchAll(/match \/([A-Za-z][A-Za-z0-9]*)\/\{/g)]
          .map((match) => match[1])
          .filter((name) => name !== 'databases')
      )
    ].sort();
  }

  async function seed(): Promise<void> {
    const auth = getAuth();
    const db = getFirestore();
    await auth.createUser({ uid: ada, email: 'ada@example.com', displayName: 'Ada Lovelace' });
    await auth.createUser({ uid: grace, email: 'grace@example.com', displayName: 'Grace Hopper' });
    await db.doc(`users/${ada}`).set({
      uid: ada,
      email: 'ada@example.com',
      displayName: 'Ada',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-02-01T00:00:00.000Z',
      lastSignInAt: '2026-02-01T00:00:00.000Z'
    });
    await db.doc(`users/${grace}`).set({
      uid: grace,
      email: 'grace@example.com',
      displayName: 'Grace',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-02-01T00:00:00.000Z',
      lastSignInAt: '2026-02-01T00:00:00.000Z'
    });
    await db.doc(`users/${ada}/teams/legacy`).set({ teamName: 'Legacy' });
    await db.doc('teams/ada-team').set({ userId: ada, teamName: 'Racers' });
    await db.doc('teams/grace-team').set({ userId: grace, teamName: 'Keepers' });
    await db.doc(`userSettings/${ada}`).set({
      receiveUpdates: true,
      receiveUpdatesChangedAt: '2026-10-01T00:00:00.000Z',
      darkMode: true
    });
    await db.doc(`playerProfiles/${ada}`).set({ playerName: 'Ada', mapEntryId: pin, showOnMap: true });
    await db.doc(`playerMapOwners/${ada}`).set({ entryId: pin });
    await db.doc(`playerMapPrivate/${pin}`).set({ ownerUid: ada });
    await db.doc(`playerMap/${pin}`).set({ anonymous: false, playerName: 'Ada' });
    await db.doc(`playerMapPrivate/${gracePin}`).set({ ownerUid: grace });
    await db.doc(`playerMap/${gracePin}`).set({ anonymous: false, playerName: 'Grace' });
    await db.doc('playerMapBoard/public').set({
      markers: {
        [pin]: { playerName: 'Ada' },
        [gracePin]: { playerName: 'Grace' }
      }
    });
    await db.doc(`openToGames/${ada}`).set({ playerName: 'Ada', bio: 'Warsaw', playSpots: 'Weekends', updatedAt: '2026-10-01T00:00:00.000Z' });
    await db.doc(`openToGames/${grace}`).set({ playerName: 'Grace', bio: '', playSpots: '', updatedAt: '2026-10-01T00:00:00.000Z' });
    await db.doc('openToGamesBoard/public').set({
      players: {
        [ada]: { playerName: 'Ada' },
        [grace]: { playerName: 'Grace' }
      }
    });
    await db.doc(`gameContacts/${ada}_${grace}`).set({
      fromUid: ada,
      toUid: grace,
      fromName: 'Ada',
      toName: 'Grace',
      message: 'Sunday?',
      createdAt: '2026-10-18T00:00:00.000Z',
      read: false,
      reply: 'Yes',
      repliedAt: '2026-10-18T01:00:00.000Z'
    });
    await db.doc(`gameContacts/${grace}_${ada}`).set({
      fromUid: grace,
      toUid: ada,
      fromName: 'Grace',
      toName: 'Ada',
      message: 'Rematch?',
      createdAt: '2026-10-18T02:00:00.000Z',
      read: true,
      reply: 'Tomorrow',
      repliedAt: '2026-10-18T03:00:00.000Z'
    });
    await db.doc('messages/from-ada').set({
      userId: ada,
      email: 'ada@example.com',
      subject: 'Help',
      message: 'Secret',
      recipient: 'jose.anes@gmail.com'
    });
    await db.doc('messages/from-grace').set({
      userId: grace,
      email: 'grace@example.com',
      subject: 'Keep',
      message: 'Stay'
    });
    await db.doc(`roles/${ada}`).set({ role: 'Player', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'bootstrap' });
    await db.doc(`adminUsers/${ada}`).set({ disabled: false, disabledAt: null, disabledBy: null });
    await db.doc(`mail/gameContact_${ada}_${grace}`).set({
      to: ['grace@example.com'],
      message: { subject: 'Ada sent a request', text: 'Sunday?' }
    });
    await db.doc('mail/to-ada').set({
      to: ['ada@example.com'],
      message: { subject: 'Hello Ada', text: 'Queued for you' }
    });
    await db.doc('stats/public').set({ totalUsers: 2 });
  }

  it('audits every rules collection and leaves aggregate stats out of the download', () => {
    const source = readFileSync(new URL('./accountPrivacy.ts', import.meta.url), 'utf8');
    for (const name of rulesCollections()) {
      expect(source, name).toContain(`'${name}'`);
    }
    expect(rulesCollections()).toEqual(
      [
        'adminUsers',
        'gameContacts',
        'messages',
        'openToGames',
        'openToGamesBoard',
        'playerMap',
        'playerMapBoard',
        'playerMapOwners',
        'playerMapPrivate',
        'playerProfiles',
        'roles',
        'stats',
        'teams',
        'userSettings',
        'users'
      ].sort()
    );
  });

  it('exports only the signed-in account and strips the other player email from queued mail', async () => {
    await seed();
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      lines.push(String(message));
    });
    try {
      const exported = await handleExportMyData(ada, Date.parse('2026-10-18T12:00:00.000Z'));
      const data = exported.data as Record<string, unknown>;
      expect(exported.uid).toBe(ada);
      expect(exported.auth).toMatchObject({ email: 'ada@example.com', displayName: 'Ada Lovelace', disabled: false });
      expect(exported.omitted).toEqual({ 'stats/public': OMITTED_NOTE });
      expect(JSON.stringify(exported)).not.toContain('Keepers');
      expect(JSON.stringify(exported)).not.toContain('grace@example.com');
      expect(JSON.stringify(exported)).not.toContain('Stay');
      expect(data.teams).toEqual([{ id: 'ada-team', data: { userId: ada, teamName: 'Racers' } }]);
      expect(data['users/{uid}/teams']).toEqual([{ id: 'legacy', data: { teamName: 'Legacy' } }]);
      expect(data.userSettings).toMatchObject({
        data: { receiveUpdates: true, receiveUpdatesChangedAt: '2026-10-01T00:00:00.000Z' }
      });
      expect(data.playerMapBoard).toEqual({ key: pin, value: { playerName: 'Ada' } });
      expect(data.openToGamesBoard).toEqual({ key: ada, value: { playerName: 'Ada' } });
      expect(data.adminUsers).toMatchObject({ data: { disabled: false, disabledAt: null, disabledBy: null } });
      expect(data.gameContactsSent).toHaveLength(1);
      expect(data.gameContactsReceived).toHaveLength(1);
      expect(data.messages).toEqual([
        {
          id: 'from-ada',
          data: {
            userId: ada,
            email: 'ada@example.com',
            subject: 'Help',
            message: 'Secret',
            recipient: 'jose.anes@gmail.com'
          }
        }
      ]);
      const mail = data.mail as { id: string; to?: string[]; message: { text: string } }[];
      const queuedToAda = mail.find((item) => item.id === 'to-ada');
      const queuedToGrace = mail.find((item) => item.id === `gameContact_${ada}_${grace}`);
      expect(queuedToAda?.to).toEqual(['ada@example.com']);
      expect(queuedToGrace).not.toHaveProperty('to');
      expect(queuedToGrace?.message.text).toBe('Sunday?');
      expect(lines.join('\n')).not.toContain(ada);
      expect(lines.join('\n')).not.toContain('ada@example.com');
      expect(lines.join('\n')).toContain(`ref=${privacyLogRef(ada)}`);
      expect((await getFirestore().doc('stats/public').get()).data()).toEqual({ totalUsers: 2 });
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses deletion without a fresh sign-in and the typed confirmation', async () => {
    await seed();
    const now = Date.parse('2026-10-18T12:00:00.000Z');
    await expect(
      handleDeleteMyAccount({ uid: ada, confirmation: 'delete', authTimeSeconds: Math.floor(now / 1000), nowMs: now })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      handleDeleteMyAccount({
        uid: ada,
        confirmation: DELETE_CONFIRMATION,
        authTimeSeconds: Math.floor(now / 1000) - 10 * 60,
        nowMs: now
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await getAuth().getUser(ada)).email).toBe('ada@example.com');
    expect((await getFirestore().doc('teams/ada-team').get()).exists).toBe(true);
    expect((await getFirestore().doc(`users/${grace}`).get()).exists).toBe(true);
  });

  it('deletes the account last, anonymizes only that side, and can run again', async () => {
    await seed();
    const now = Date.parse('2026-10-18T12:00:00.000Z');
    const lines: string[] = [];
    const logSpy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      lines.push(String(message));
    });
    const auth = getAuth();
    const original = auth.deleteUser.bind(auth);
    const deleteSpy = vi.spyOn(auth, 'deleteUser').mockImplementation(async (uid: string) => {
      const db = getFirestore();
      expect((await db.doc('playerMapBoard/public').get()).get('markers')).not.toHaveProperty(pin);
      expect((await db.doc('openToGamesBoard/public').get()).get('players')).not.toHaveProperty(ada);
      expect((await db.doc(`users/${uid}`).get()).exists).toBe(false);
      expect((await db.doc('teams/ada-team').get()).exists).toBe(false);
      expect((await db.doc('messages/from-ada').get()).get('email')).toBe('');
      return original(uid);
    });
    try {
      const result = await handleDeleteMyAccount({
        uid: ada,
        confirmation: DELETE_CONFIRMATION,
        authTimeSeconds: Math.floor(now / 1000),
        nowMs: now
      });
      expect(result).toEqual({ status: 'deleted' });
      expect(deleteSpy).toHaveBeenCalledWith(ada);
      await expect(auth.getUser(ada)).rejects.toMatchObject({ code: 'auth/user-not-found' });
      expect((await auth.getUser(grace)).email).toBe('grace@example.com');

      const db = getFirestore();
      expect((await db.doc(`users/${ada}`).get()).exists).toBe(false);
      expect((await db.doc(`users/${grace}`).get()).exists).toBe(true);
      expect((await db.doc('teams/grace-team').get()).get('teamName')).toBe('Keepers');
      expect((await db.doc(`users/${ada}/teams/legacy`).get()).exists).toBe(false);
      expect((await db.doc(`userSettings/${ada}`).get()).exists).toBe(false);
      expect((await db.doc(`playerProfiles/${ada}`).get()).exists).toBe(false);
      expect((await db.doc(`playerMapOwners/${ada}`).get()).exists).toBe(false);
      expect((await db.doc(`playerMapPrivate/${pin}`).get()).exists).toBe(false);
      expect((await db.doc(`playerMap/${pin}`).get()).exists).toBe(false);
      expect((await db.doc(`playerMap/${gracePin}`).get()).exists).toBe(true);
      expect((await db.doc(`openToGames/${ada}`).get()).exists).toBe(false);
      expect((await db.doc(`openToGames/${grace}`).get()).exists).toBe(true);
      expect((await db.doc(`roles/${ada}`).get()).exists).toBe(false);
      expect((await db.doc(`adminUsers/${ada}`).get()).exists).toBe(false);
      expect((await db.doc('playerMapBoard/public').get()).get('markers')).toEqual({
        [gracePin]: { playerName: 'Grace' }
      });
      expect((await db.doc('openToGamesBoard/public').get()).get('players')).toEqual({
        [grace]: { playerName: 'Grace' }
      });
      expect((await db.doc(`gameContacts/${ada}_${grace}`).get()).data()).toMatchObject({
        fromUid: ada,
        toUid: grace,
        fromName: 'Deleted player',
        toName: 'Grace',
        message: '[deleted]',
        reply: 'Yes'
      });
      expect((await db.doc(`gameContacts/${grace}_${ada}`).get()).data()).toMatchObject({
        fromUid: grace,
        toUid: ada,
        fromName: 'Grace',
        toName: 'Deleted player',
        message: 'Rematch?',
        reply: '',
        repliedAt: ''
      });
      expect((await db.doc('messages/from-ada').get()).data()).toMatchObject({
        userId: 'deleted',
        email: '',
        subject: '[deleted]',
        message: '[deleted]'
      });
      expect((await db.doc('messages/from-grace').get()).get('message')).toBe('Stay');
      expect((await db.doc(`mail/gameContact_${ada}_${grace}`).get()).exists).toBe(false);
      expect((await db.doc('mail/to-ada').get()).exists).toBe(false);
      expect((await db.doc('stats/public').get()).data()).toEqual({ totalUsers: 2 });
      expect(lines.join('\n')).not.toContain(ada);
      expect(lines.join('\n')).not.toContain('ada@example.com');
      expect(lines.join('\n')).not.toContain('Grace');

      const again = await eraseAccount(ada);
      expect(again).toEqual(['boards', 'documents', 'anonymize', 'mail', 'rate', 'auth']);
      expect((await auth.getUser(grace)).email).toBe('grace@example.com');
      expect((await db.doc(`gameContacts/${grace}_${ada}`).get()).get('message')).toBe('Rematch?');
    } finally {
      deleteSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it('rate limits export separately from deletion', async () => {
    await seed();
    const now = Date.parse('2026-10-18T12:00:00.000Z');
    for (let attempt = 0; attempt < RATE_LIMIT_MAX; attempt += 1) {
      await handleExportMyData(ada, now + attempt);
    }
    await expect(handleExportMyData(ada, now + RATE_LIMIT_MAX)).rejects.toMatchObject({ code: 'resource-exhausted' });
    await expect(
      handleDeleteMyAccount({
        uid: ada,
        confirmation: DELETE_CONFIRMATION,
        authTimeSeconds: Math.floor(now / 1000),
        nowMs: now
      })
    ).resolves.toEqual({ status: 'deleted' });
  });
});
