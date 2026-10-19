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
import {
  ensureUnsubscribeToken,
  handleNewsletterSettingsWrite,
  handleUnsubscribeRequest,
  unsubscribeByToken
} from './newsletter';
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

  it('stops a sender after 10 game-request emails in a day and still leaves the note alone', async () => {
    const auth = getAuth();
    const db = getFirestore();
    await auth.createUser({ uid: 'ada', email: 'ada@example.com' });
    await auth.createUser({ uid: 'grace', email: 'grace@example.com' });
    await db.doc('userSettings/grace').set({ allowContactFromPlayers: true });
    for (let index = 0; index < 10; index += 1) {
      const id = `ada_grace${index}`;
      await expect(queueContactEmail(id, contact)).resolves.toEqual({ status: 'queued' });
    }
    await expect(queueContactEmail('ada_overflow', contact)).resolves.toEqual({
      status: 'skipped',
      reason: 'rate-limited'
    });
    expect((await db.collection(MAIL_COLLECTION).get()).size).toBe(10);
    expect((await db.doc('gameContacts/ada_overflow').get()).exists).toBe(false);
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toContain('deliverQueuedMail');
    expect(source).toContain("document: 'mail/{mailId}'");
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
      darkMode: true,
      newsletterOptIn: true,
      newsletterOptInAt: '2026-10-02T00:00:00.000Z',
      newsletterConsentText: 'monthly-email-v1'
    });
    await db.doc(`newsletterTokens/${ada}`).set({
      uid: ada,
      token: 'a'.repeat(43),
      createdAt: '2026-10-02T00:00:00.000Z'
    });
    await db.doc(`newsletterTokens/${grace}`).set({
      uid: grace,
      token: 'b'.repeat(43),
      createdAt: '2026-10-02T00:00:00.000Z'
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
			'accountControl',
			'adminUsers',
			'buddies',
			'buddyBlocks',
			'buddyDirectory',
			'buddyEmailInvites',
			'buddyEmailOptOuts',
			'buddyEmailRate',
			'buddyEmailSuppress',
			'buddyInvites',
			'buddyRequests',
			'config',
			'gameContactEmailRate',
			'gameContacts',
        'mapPlacements',
        'messages',
        'newsletterTokens',
        'openToGames',
        'openToGamesBoard',
        'photoReportRate',
        'photoReports',
        'playerMap',
        'playerMapBoard',
        'playerMapOwners',
        'playerMapPrivate',
        'playerProfiles',
        'roles',
        'sharedPhotoPrivate',
        'sharedPhotos',
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
      expect(exported.omitted).toEqual({
        'stats/public': OMITTED_NOTE,
        'config/gallery': 'Site-wide gallery setting. Deleting an account does not change it.'
      });
      expect(JSON.stringify(exported)).not.toContain('Keepers');
      expect(JSON.stringify(exported)).not.toContain('grace@example.com');
      expect(JSON.stringify(exported)).not.toContain('Stay');
      expect(data.teams).toEqual([{ id: 'ada-team', data: { userId: ada, teamName: 'Racers' } }]);
      expect(data['users/{uid}/teams']).toEqual([{ id: 'legacy', data: { teamName: 'Legacy' } }]);
      expect(data.userSettings).toMatchObject({
        data: {
          receiveUpdates: true,
          receiveUpdatesChangedAt: '2026-10-01T00:00:00.000Z',
          newsletterOptIn: true,
          newsletterOptInAt: '2026-10-02T00:00:00.000Z',
          newsletterConsentText: 'monthly-email-v1'
        }
      });
      expect(data.newsletterTokens).toEqual({
        id: ada,
        data: { uid: ada, token: 'a'.repeat(43), createdAt: '2026-10-02T00:00:00.000Z' }
      });
      expect(JSON.stringify(exported)).not.toContain('b'.repeat(43));
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
      expect((await db.doc(`newsletterTokens/${ada}`).get()).exists).toBe(false);
      expect((await db.doc(`newsletterTokens/${grace}`).get()).exists).toBe(true);
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
      expect((await db.doc(`accountControl/${ada}`).get()).get('deleted')).toBe(true);
      expect((await db.doc(`gameContacts/${ada}_${grace}`).get()).data()).toMatchObject({
        fromUid: 'deleted',
        toUid: grace,
        fromName: 'Deleted player',
        toName: 'Grace',
        message: '[deleted]',
        reply: 'Yes'
      });
      expect((await db.doc(`gameContacts/${grace}_${ada}`).get()).data()).toMatchObject({
        fromUid: grace,
        toUid: 'deleted',
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
      expect(again).toEqual(['marker', 'revoke', 'boards', 'documents', 'anonymize', 'mail', 'buddies', 'rate', 'photos', 'auth', 'rescan']);
      expect((await db.doc(`accountControl/${ada}`).get()).get('deleted')).toBe(true);
      expect((await auth.getUser(grace)).email).toBe('grace@example.com');
      expect((await db.doc(`gameContacts/${grace}_${ada}`).get()).get('message')).toBe('Rematch?');
      await eraseAccount(grace);
      expect((await db.doc(`gameContacts/${ada}_${grace}`).get()).exists).toBe(false);
      expect((await db.doc(`gameContacts/${grace}_${ada}`).get()).exists).toBe(false);
      expect((await db.doc(`accountControl/${ada}`).get()).get('deleted')).toBe(true);
      expect((await db.doc(`accountControl/${grace}`).get()).get('deleted')).toBe(true);
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

describe('monthly email unsubscribe', () => {
  const ada = 'playerAda123';
  const now = '2026-10-18T12:00:00.000Z';

  it('does not mint a token or opt in when only the retired receiveUpdates flag is set', async () => {
    const db = getFirestore();
    const uid = 'playerOldBoxOnly';
    await db.doc(`userSettings/${uid}`).set({
      receiveUpdates: true,
      receiveUpdatesChangedAt: '2026-01-01T00:00:00.000Z'
    });
    await handleNewsletterSettingsWrite(uid, {
      receiveUpdates: true,
      receiveUpdatesChangedAt: '2026-01-01T00:00:00.000Z'
    });
    expect((await db.doc(`newsletterTokens/${uid}`).get()).exists).toBe(false);
    const stored = (await db.doc(`userSettings/${uid}`).get()).data();
    expect(stored?.newsletterOptIn).toBeUndefined();
    expect(stored?.receiveUpdates).toBe(true);
  });

  it('stores one token when someone opts in and the link turns the flag off', async () => {
    const db = getFirestore();
    await db.doc(`userSettings/${ada}`).set({
      darkMode: true,
      receiveUpdates: true,
      newsletterOptIn: true,
      newsletterOptInAt: '2026-10-02T00:00:00.000Z',
      newsletterConsentText: 'monthly-email-v1'
    });
    await handleNewsletterSettingsWrite(ada, { newsletterOptIn: true });
    const first = await ensureUnsubscribeToken(ada, now);
    const second = await ensureUnsubscribeToken(ada, '2026-11-01T00:00:00.000Z');
    expect(second).toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await db.doc(`newsletterTokens/${ada}`).get()).data()).toMatchObject({ uid: ada, token: first });

    await handleNewsletterSettingsWrite(ada, { newsletterOptIn: false });
    expect((await db.doc(`newsletterTokens/${ada}`).get()).get('token')).toBe(first);

    expect(await unsubscribeByToken('not-a-token', now)).toBe('invalid');
    expect((await db.doc(`userSettings/${ada}`).get()).get('newsletterOptIn')).toBe(true);

    expect(await unsubscribeByToken(first, now)).toBe('unsubscribed');
    expect((await db.doc(`userSettings/${ada}`).get()).data()).toMatchObject({
      darkMode: true,
      receiveUpdates: true,
      newsletterOptIn: false,
      newsletterOptInAt: '2026-10-02T00:00:00.000Z',
      newsletterConsentText: 'monthly-email-v1',
      newsletterOptOutAt: now
    });
    expect(await unsubscribeByToken(first, '2026-12-01T00:00:00.000Z')).toBe('unsubscribed');
    expect((await db.doc(`userSettings/${ada}`).get()).get('newsletterOptOutAt')).toBe(now);
    expect((await db.doc(`newsletterTokens/${ada}`).get()).get('token')).toBe(first);
  });

  it('leaves the subscription alone on GET and unsubscribes on POST', async () => {
    const db = getFirestore();
    const uid = 'playerUnsubscribe';
    await db.doc(`userSettings/${uid}`).set({
      newsletterOptIn: true,
      newsletterOptInAt: '2026-10-02T00:00:00.000Z',
      newsletterConsentText: 'monthly-email-v1',
      receiveUpdates: true
    });
    await handleNewsletterSettingsWrite(uid, { newsletterOptIn: true });
    const token = await ensureUnsubscribeToken(uid, now);

    const opened = await handleUnsubscribeRequest({
      method: 'GET',
      query: { token },
      headers: { 'x-forwarded-for': '203.0.113.20' }
    });
    expect(opened.statusCode).toBe(200);
    expect(opened.body).toContain('Confirm unsubscribe');
    expect(opened.body).not.toContain("You're unsubscribed");
    expect((await db.doc(`userSettings/${uid}`).get()).data()).toMatchObject({
      newsletterOptIn: true,
      receiveUpdates: true
    });
    expect((await db.doc(`userSettings/${uid}`).get()).get('newsletterOptOutAt')).toBeUndefined();

    const confirmed = await handleUnsubscribeRequest({
      method: 'POST',
      query: { token },
      body: `token=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '203.0.113.21' }
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.body).toContain("You're unsubscribed");
    expect(confirmed.body).toContain('https://gaslandsgarage.com/profile');
    expect((await db.doc(`userSettings/${uid}`).get()).data()).toMatchObject({
      newsletterOptIn: false,
      newsletterOptInAt: '2026-10-02T00:00:00.000Z',
      newsletterConsentText: 'monthly-email-v1',
      receiveUpdates: true
    });
    expect((await db.doc(`userSettings/${uid}`).get()).get('newsletterOptOutAt')).toEqual(expect.any(String));
    expect((await db.doc(`newsletterTokens/${uid}`).get()).get('token')).toBe(token);
  });

  it('keeps an invalid token on a generic page for GET and POST', async () => {
    const db = getFirestore();
    const uid = 'playerStillIn';
    await db.doc(`userSettings/${uid}`).set({ newsletterOptIn: true, receiveUpdates: false });
    const before = (await db.doc(`userSettings/${uid}`).get()).data();

    for (const method of ['GET', 'POST'] as const) {
      const response = await handleUnsubscribeRequest({
        method,
        query: { token: 'not-a-token' },
        body: 'token=not-a-token',
        headers: { 'x-forwarded-for': `203.0.113.${method === 'GET' ? 30 : 31}` }
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('Link not valid');
      expect(response.body).toContain('jose.anes@gmail.com');
      expect(response.body).not.toContain('Confirm unsubscribe');
      expect(response.body).not.toContain("You're unsubscribed");
      expect(response.body).not.toContain('not-a-token');
    }
    expect((await db.doc(`userSettings/${uid}`).get()).data()).toEqual(before);
  });

  it('accepts an RFC 8058 one-click POST on the same link', async () => {
    const db = getFirestore();
    const uid = 'playerOneClick';
    await db.doc(`userSettings/${uid}`).set({
      newsletterOptIn: true,
      newsletterOptInAt: '2026-10-02T00:00:00.000Z',
      newsletterConsentText: 'monthly-email-v1'
    });
    await handleNewsletterSettingsWrite(uid, { newsletterOptIn: true });
    const token = await ensureUnsubscribeToken(uid, now);
    const response = await handleUnsubscribeRequest({
      method: 'POST',
      query: { token },
      body: 'List-Unsubscribe=One-Click',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '203.0.113.40' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("You're unsubscribed");
    expect((await db.doc(`userSettings/${uid}`).get()).get('newsletterOptIn')).toBe(false);
    expect((await db.doc(`newsletterTokens/${uid}`).get()).get('token')).toBe(token);
  });
});
