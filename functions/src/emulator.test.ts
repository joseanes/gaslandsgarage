import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { MAIL_COLLECTION, queueContactEmail } from './contactEmail';
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
    expect(mail).toEqual({
      to: ['grace@example.com'],
      message: {
        subject: 'Ada sent a Gaslands game request',
        text: expect.stringContaining('Race on Sunday?')
      }
    });
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
