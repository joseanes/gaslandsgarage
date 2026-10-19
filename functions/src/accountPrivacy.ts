import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import {
  FieldPath,
  FieldValue,
  getFirestore,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction
} from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { emailAddressHash, normalizeInviteEmail, twilioEmailConfigured } from '../../app/src/lib/buddies/emailInvite.ts';
import { MAIL_COLLECTION, mailDocId } from './contactEmail.ts';
import { twilioAccountSid, twilioAuthToken } from './twilioConfig.ts';

/** Same region as the other functions. Kept local to avoid an import cycle with index.ts. */
export const PRIVACY_REGION = 'us-central1';

export const DELETE_CONFIRMATION = 'DELETE';
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const RATE_LIMIT_MAX = 5;

const USERS = 'users';
const TEAMS = 'teams';
const USER_SETTINGS = 'userSettings';
const MESSAGES = 'messages';
const ROLES = 'roles';
const ADMIN_USERS = 'adminUsers';
const PLAYER_PROFILES = 'playerProfiles';
const PLAYER_MAP_OWNERS = 'playerMapOwners';
const PLAYER_MAP_PRIVATE = 'playerMapPrivate';
const PLAYER_MAP = 'playerMap';
const PLAYER_MAP_BOARD = 'playerMapBoard';
const OPEN_TO_GAMES = 'openToGames';
const OPEN_TO_GAMES_BOARD = 'openToGamesBoard';
const GAME_CONTACTS = 'gameContacts';
const PRIVACY_RATE = 'privacyRate';
const NEWSLETTER_TOKENS = 'newsletterTokens';
const BUDDIES = 'buddies';
const BUDDY_REQUESTS = 'buddyRequests';
const BUDDY_BLOCKS = 'buddyBlocks';
const BUDDY_INVITES = 'buddyInvites';
const BUDDY_DIRECTORY = 'buddyDirectory';
const BUDDY_RATE = 'buddyRate';
const BUDDY_EMAIL_INVITES = 'buddyEmailInvites';
const BUDDY_EMAIL_OPT_OUTS = 'buddyEmailOptOuts';
const BUDDY_EMAIL_RATE = 'buddyEmailRate';
const BUDDY_EMAIL_SUPPRESS = 'buddyEmailSuppress';
const STATS = 'stats';
const BOARD_DOC = 'public';
const TOMBSTONE = 'deleted';
const DELETED_NAME = 'Deleted player';
const DELETED_TEXT = '[deleted]';
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const privacyCallableOptions = {
  region: PRIVACY_REGION,
  memory: '256MiB',
  timeoutSeconds: 60,
  maxInstances: 10
} as const;

const privacySecretOptions = {
  ...privacyCallableOptions,
  secrets: [twilioAccountSid, twilioAuthToken]
};

export const OMITTED_NOTE = 'Aggregate counts only. Not copied into a personal download.';

type RateAction = 'export' | 'delete';

function assertUid(uid: string): void {
  if (!UID_PATTERN.test(uid) || uid === TOMBSTONE) {
    throw new HttpsError('invalid-argument', 'This account cannot be used for that request.');
  }
}

export function privacyLogRef(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 12);
}

function logPrivacy(event: string, uid: string): void {
  console.info(`privacy ${event} ref=${privacyLogRef(uid)}`);
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) return String(error.code);
  return '';
}

function isUserNotFound(error: unknown): boolean {
  return errorCode(error) === 'auth/user-not-found';
}

export function deletionRequestError(input: {
  confirmation: unknown;
  authTimeSeconds: unknown;
  nowMs: number;
}): string | null {
  if (input.confirmation !== DELETE_CONFIRMATION) return 'Type DELETE to confirm account deletion.';
  const authTime = authTimeSeconds(input.authTimeSeconds);
  if (authTime === null) return 'Sign in again before deleting your account.';
  const age = input.nowMs - authTime * 1000;
  if (age > REAUTH_WINDOW_MS || age < -60_000) return 'Sign in again before deleting your account.';
  return null;
}

function authTimeSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

export function nextRateWindow(previous: unknown, nowMs: number): { allowed: boolean; stamps: number[] } {
  const recent = Array.isArray(previous)
    ? previous.filter((value): value is number => typeof value === 'number' && nowMs - value < RATE_LIMIT_WINDOW_MS)
    : [];
  if (recent.length >= RATE_LIMIT_MAX) return { allowed: false, stamps: recent };
  return { allowed: true, stamps: [...recent, nowMs] };
}

function readConfirmation(data: unknown): unknown {
  if (!data || typeof data !== 'object') return undefined;
  return (data as { confirmation?: unknown }).confirmation;
}

function jsonSafe(value: unknown): unknown {
  if (value == null) return value ?? null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    try {
      return (value.toDate as () => Date)().toISOString();
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = jsonSafe(item);
    return out;
  }
  return null;
}

function docJson(snap: DocumentSnapshot): { id: string; data: unknown } | null {
  if (!snap.exists) return null;
  return { id: snap.id, data: jsonSafe(snap.data()) };
}

function queryJson(docs: DocumentSnapshot[]): { id: string; data: unknown }[] {
  return docs.map((snap) => ({ id: snap.id, data: jsonSafe(snap.data()) }));
}

function boardKey(data: Record<string, unknown> | undefined, field: string, key: string | null): { key: string; value: unknown } | null {
  if (!data || !key) return null;
  const map = data[field];
  if (!map || typeof map !== 'object' || Array.isArray(map) || !(key in map)) return null;
  return { key, value: jsonSafe((map as Record<string, unknown>)[key]) };
}

function mailForSubject(id: string, data: Record<string, unknown>, ownEmail: string): Record<string, unknown> {
  const copy = jsonSafe(data) as Record<string, unknown>;
  const to = Array.isArray(data.to) ? data.to.filter((item) => typeof item === 'string' && item === ownEmail) : [];
  if (to.length === 0) delete copy.to;
  else copy.to = to;
  return { id, ...copy };
}

async function mapEntryIdFor(uid: string): Promise<string | null> {
  const db = getFirestore();
  const owner = await db.doc(`${PLAYER_MAP_OWNERS}/${uid}`).get();
  const fromOwner = owner.get('entryId');
  if (typeof fromOwner === 'string' && fromOwner) return fromOwner;
  const profile = await db.doc(`${PLAYER_PROFILES}/${uid}`).get();
  const fromProfile = profile.get('mapEntryId');
  if (typeof fromProfile === 'string' && fromProfile) return fromProfile;
  return null;
}

/** The pin is theirs when the private link names them, or when no link exists yet. */
async function ownedMapEntry(uid: string): Promise<string | null> {
  const entryId = await mapEntryIdFor(uid);
  if (!entryId || !/^[A-Za-z0-9]+$/.test(entryId)) return null;
  const privateSnap = await getFirestore().doc(`${PLAYER_MAP_PRIVATE}/${entryId}`).get();
  if (privateSnap.exists && privateSnap.get('ownerUid') !== uid) return null;
  return entryId;
}

async function authEmail(uid: string): Promise<string> {
  try {
    const user = await getAuth().getUser(uid);
    return user.email?.trim() ?? '';
  } catch (error) {
    if (isUserNotFound(error)) return '';
    throw error;
  }
}

function deleteBoardKey(
  tx: Transaction,
  snap: DocumentSnapshot,
  ref: DocumentReference,
  field: string,
  key: string | null
): void {
  if (!key || !snap.exists) return;
  const current = snap.get(field);
  if (!current || typeof current !== 'object' || Array.isArray(current)) return;
  if (!Object.prototype.hasOwnProperty.call(current, key)) return;
  if (/^[A-Za-z0-9]+$/.test(key)) {
    tx.update(ref, new FieldPath(field, key), FieldValue.delete());
    return;
  }
  const next = { ...(current as Record<string, unknown>) };
  delete next[key];
  tx.update(ref, { [field]: next });
}

async function removeBoardKeys(uid: string, entryId: string | null): Promise<void> {
  const db = getFirestore();
  const mapRef = db.doc(`${PLAYER_MAP_BOARD}/${BOARD_DOC}`);
  const openRef = db.doc(`${OPEN_TO_GAMES_BOARD}/${BOARD_DOC}`);
  await db.runTransaction(async (tx) => {
    const mapSnap = await tx.get(mapRef);
    const openSnap = await tx.get(openRef);
    deleteBoardKey(tx, mapSnap, mapRef, 'markers', entryId);
    deleteBoardKey(tx, openSnap, openRef, 'players', uid);
  });
}

async function deleteRefs(refs: DocumentReference[]): Promise<void> {
  const db = getFirestore();
  for (let index = 0; index < refs.length; index += 400) {
    const batch = db.batch();
    for (const ref of refs.slice(index, index + 400)) batch.delete(ref);
    if (refs.slice(index, index + 400).length > 0) await batch.commit();
  }
}

/** Salted hash of this account's address. Skipped when Twilio is not configured. */
function ownEmailHash(email: string): string | null {
	const normalized = normalizeInviteEmail(email);
	const sid = process.env.TWILIO_ACCOUNT_SID ?? '';
	const token = process.env.TWILIO_AUTH_TOKEN ?? '';
	if (!normalized || !twilioEmailConfigured(sid, token)) return null;
	return emailAddressHash(normalized, token);
}

async function deleteBuddyLinks(uid: string, email: string): Promise<void> {
	const db = getFirestore();
	const hash = ownEmailHash(email);
	const [member, sent, received, blocking, blocked, emailInvites, emailOptOuts, addressedInvites, addressedOptOuts] =
		await Promise.all([
			db.collection(BUDDIES).where('members', 'array-contains', uid).get(),
			db.collection(BUDDY_REQUESTS).where('fromUid', '==', uid).get(),
			db.collection(BUDDY_REQUESTS).where('toUid', '==', uid).get(),
			db.collection(BUDDY_BLOCKS).where('blockerUid', '==', uid).get(),
			db.collection(BUDDY_BLOCKS).where('blockedUid', '==', uid).get(),
			db.collection(BUDDY_EMAIL_INVITES).where('fromUid', '==', uid).get(),
			db.collection(BUDDY_EMAIL_OPT_OUTS).where('fromUid', '==', uid).get(),
			hash ? db.collection(BUDDY_EMAIL_INVITES).where('emailHash', '==', hash).get() : Promise.resolve(null),
			hash ? db.collection(BUDDY_EMAIL_OPT_OUTS).where('emailHash', '==', hash).get() : Promise.resolve(null)
		]);
	const refs = new Map<string, DocumentReference>();
	for (const item of [
		...member.docs,
		...sent.docs,
		...received.docs,
		...blocking.docs,
		...blocked.docs,
		...emailInvites.docs,
		...emailOptOuts.docs,
		...(addressedInvites?.docs ?? []),
		...(addressedOptOuts?.docs ?? [])
	]) {
		refs.set(item.ref.path, item.ref);
	}
	refs.set(`${BUDDY_INVITES}/${uid}`, db.doc(`${BUDDY_INVITES}/${uid}`));
	refs.set(`${BUDDY_DIRECTORY}/${uid}`, db.doc(`${BUDDY_DIRECTORY}/${uid}`));
	refs.set(`${BUDDY_RATE}/${uid}`, db.doc(`${BUDDY_RATE}/${uid}`));
	// The 7-day cooldown can be cleared. A "don't email me again" hash stays,
	// with or without Twilio, so the opt-out survives account deletion.
	if (hash) refs.set(`${BUDDY_EMAIL_RATE}/${hash}`, db.doc(`${BUDDY_EMAIL_RATE}/${hash}`));
	await deleteRefs([...refs.values()]);
}

async function buddyExport(uid: string, email: string): Promise<Record<string, unknown>> {
	const db = getFirestore();
	const hash = ownEmailHash(email);
	const [member, sent, received, blocking, blocked, invite, directory, rate, emailInvites, emailOptOuts, emailRate, emailSuppress] =
		await Promise.all([
			db.collection(BUDDIES).where('members', 'array-contains', uid).get(),
			db.collection(BUDDY_REQUESTS).where('fromUid', '==', uid).get(),
			db.collection(BUDDY_REQUESTS).where('toUid', '==', uid).get(),
			db.collection(BUDDY_BLOCKS).where('blockerUid', '==', uid).get(),
			db.collection(BUDDY_BLOCKS).where('blockedUid', '==', uid).get(),
			db.doc(`${BUDDY_INVITES}/${uid}`).get(),
			db.doc(`${BUDDY_DIRECTORY}/${uid}`).get(),
			db.doc(`${BUDDY_RATE}/${uid}`).get(),
			db.collection(BUDDY_EMAIL_INVITES).where('fromUid', '==', uid).get(),
			db.collection(BUDDY_EMAIL_OPT_OUTS).where('fromUid', '==', uid).get(),
			hash ? db.doc(`${BUDDY_EMAIL_RATE}/${hash}`).get() : Promise.resolve(null),
			hash ? db.doc(`${BUDDY_EMAIL_SUPPRESS}/${hash}`).get() : Promise.resolve(null)
		]);
	return {
		[BUDDIES]: queryJson(member.docs),
		buddyRequestsSent: queryJson(sent.docs),
		buddyRequestsReceived: queryJson(received.docs),
		[BUDDY_BLOCKS]: queryJson([...blocking.docs, ...blocked.docs]),
		[BUDDY_INVITES]: docJson(invite),
		[BUDDY_DIRECTORY]: docJson(directory),
		[BUDDY_RATE]: docJson(rate),
		[BUDDY_EMAIL_INVITES]: queryJson(emailInvites.docs),
		[BUDDY_EMAIL_OPT_OUTS]: queryJson(emailOptOuts.docs),
		[BUDDY_EMAIL_RATE]: emailRate ? docJson(emailRate) : null,
		[BUDDY_EMAIL_SUPPRESS]: emailSuppress ? docJson(emailSuppress) : null
	};
}

async function deleteOwnedDocuments(uid: string, entryId: string | null): Promise<void> {
  const db = getFirestore();
  const [teams, legacyTeams] = await Promise.all([
    db.collection(TEAMS).where('userId', '==', uid).get(),
    db.collection(USERS).doc(uid).collection(TEAMS).get()
  ]);
  const refs: DocumentReference[] = [
    ...teams.docs.map((item) => item.ref),
    ...legacyTeams.docs.map((item) => item.ref),
    db.doc(`${USER_SETTINGS}/${uid}`),
    db.doc(`${NEWSLETTER_TOKENS}/${uid}`),
    db.doc(`${PLAYER_PROFILES}/${uid}`),
    db.doc(`${PLAYER_MAP_OWNERS}/${uid}`),
    db.doc(`${OPEN_TO_GAMES}/${uid}`),
    db.doc(`${USERS}/${uid}`),
    db.doc(`${ROLES}/${uid}`),
    db.doc(`${ADMIN_USERS}/${uid}`)
  ];
  if (entryId) {
    refs.push(db.doc(`${PLAYER_MAP_PRIVATE}/${entryId}`), db.doc(`${PLAYER_MAP}/${entryId}`));
  }
  await deleteRefs(refs);
}

async function anonymizeContactsAndMessages(uid: string): Promise<string[]> {
  const db = getFirestore();
  const [sent, received, messages] = await Promise.all([
    db.collection(GAME_CONTACTS).where('fromUid', '==', uid).get(),
    db.collection(GAME_CONTACTS).where('toUid', '==', uid).get(),
    db.collection(MESSAGES).where('userId', '==', uid).get()
  ]);
  const contacts = new Map<string, DocumentSnapshot>();
  for (const item of [...sent.docs, ...received.docs]) contacts.set(item.id, item);

  const updates: { ref: DocumentReference; data: Record<string, string> }[] = [];
  for (const item of contacts.values()) {
    const data = item.data() ?? {};
    const patch: Record<string, string> = {};
    if (data.fromUid === uid) {
      patch.fromName = DELETED_NAME;
      patch.message = DELETED_TEXT;
    }
    if (data.toUid === uid) {
      patch.toName = DELETED_NAME;
      patch.reply = '';
      patch.repliedAt = '';
    }
    if (Object.keys(patch).length > 0) updates.push({ ref: item.ref, data: patch });
  }
  for (const item of messages.docs) {
    updates.push({
      ref: item.ref,
      data: {
        userId: TOMBSTONE,
        email: '',
        subject: DELETED_TEXT,
        message: DELETED_TEXT
      }
    });
  }
  for (let index = 0; index < updates.length; index += 400) {
    const batch = db.batch();
    for (const update of updates.slice(index, index + 400)) batch.update(update.ref, update.data);
    await batch.commit();
  }
  return [...contacts.keys()];
}

async function deleteQueuedMail(email: string, contactIds: string[]): Promise<void> {
  const db = getFirestore();
  const refs = new Map<string, DocumentReference>();
  for (const contactId of contactIds) {
    const id = mailDocId(contactId);
    refs.set(id, db.doc(`${MAIL_COLLECTION}/${id}`));
  }
  if (email) {
    const addressed = await db.collection(MAIL_COLLECTION).where('to', 'array-contains', email).get();
    for (const item of addressed.docs) refs.set(item.id, item.ref);
  }
  await deleteRefs([...refs.values()]);
}

/**
 * Erase one account. Board keys are removed in one transaction. The Auth user
 * is deleted last so a retry can still authenticate and finish leftover docs.
 * Shared gameContacts and contact-form messages are anonymized on this
 * account's side. The other person's text stays.
 */
export async function eraseAccount(uid: string): Promise<string[]> {
  assertUid(uid);
  const steps: string[] = [];
  const email = await authEmail(uid);
  const entryId = await ownedMapEntry(uid);
  steps.push('boards');
  await removeBoardKeys(uid, entryId);
  steps.push('documents');
  await deleteOwnedDocuments(uid, entryId);
  steps.push('anonymize');
  const contactIds = await anonymizeContactsAndMessages(uid);
	steps.push('mail');
	await deleteQueuedMail(email, contactIds);
	steps.push('buddies');
	await deleteBuddyLinks(uid, email);
	steps.push('rate');
	await getFirestore().doc(`${PRIVACY_RATE}/${uid}`).delete();
  steps.push('auth');
  try {
    await getAuth().deleteUser(uid);
  } catch (error) {
    if (!isUserNotFound(error)) throw error;
  }
  return steps;
}

export async function exportAccount(uid: string): Promise<Record<string, unknown>> {
  assertUid(uid);
  const db = getFirestore();
  const entryId = await ownedMapEntry(uid);
  let auth: Record<string, unknown> | null = null;
  let email = '';
  try {
    const user = await getAuth().getUser(uid);
    email = user.email?.trim() ?? '';
    auth = {
      uid: user.uid,
      email: user.email ?? null,
      emailVerified: user.emailVerified,
      displayName: user.displayName ?? null,
      disabled: user.disabled,
      providers: user.providerData.map((provider) => provider.providerId),
      creationTime: user.metadata.creationTime ?? null,
      lastSignInTime: user.metadata.lastSignInTime ?? null
    };
  } catch (error) {
    if (!isUserNotFound(error)) throw error;
  }

  const [
    userDoc,
    settingsDoc,
    tokenDoc,
    profileDoc,
    ownerDoc,
    openDoc,
    roleDoc,
    adminDoc,
    rateDoc,
    mapBoard,
    openBoard,
    teams,
    legacyTeams,
    messages,
    sent,
    received
  ] = await Promise.all([
    db.doc(`${USERS}/${uid}`).get(),
    db.doc(`${USER_SETTINGS}/${uid}`).get(),
    db.doc(`${NEWSLETTER_TOKENS}/${uid}`).get(),
    db.doc(`${PLAYER_PROFILES}/${uid}`).get(),
    db.doc(`${PLAYER_MAP_OWNERS}/${uid}`).get(),
    db.doc(`${OPEN_TO_GAMES}/${uid}`).get(),
    db.doc(`${ROLES}/${uid}`).get(),
    db.doc(`${ADMIN_USERS}/${uid}`).get(),
    db.doc(`${PRIVACY_RATE}/${uid}`).get(),
    db.doc(`${PLAYER_MAP_BOARD}/${BOARD_DOC}`).get(),
    db.doc(`${OPEN_TO_GAMES_BOARD}/${BOARD_DOC}`).get(),
    db.collection(TEAMS).where('userId', '==', uid).get(),
    db.collection(USERS).doc(uid).collection(TEAMS).get(),
    db.collection(MESSAGES).where('userId', '==', uid).get(),
    db.collection(GAME_CONTACTS).where('fromUid', '==', uid).get(),
    db.collection(GAME_CONTACTS).where('toUid', '==', uid).get()
  ]);

	const buddyData = await buddyExport(uid, email);
	const privateDoc = entryId ? await db.doc(`${PLAYER_MAP_PRIVATE}/${entryId}`).get() : null;
  const mapDoc = entryId ? await db.doc(`${PLAYER_MAP}/${entryId}`).get() : null;
  const ownsPin = entryId !== null;

  const contactIds = new Set<string>([...sent.docs, ...received.docs].map((item) => item.id));
  const mailSnaps = new Map<string, DocumentSnapshot>();
  if (email) {
    const addressed = await db.collection(MAIL_COLLECTION).where('to', 'array-contains', email).get();
    for (const item of addressed.docs) mailSnaps.set(item.id, item);
  }
  for (const contactId of contactIds) {
    const snap = await db.doc(`${MAIL_COLLECTION}/${mailDocId(contactId)}`).get();
    if (snap.exists) mailSnaps.set(snap.id, snap);
  }

  return {
    exportedAt: new Date().toISOString(),
    uid,
    auth,
    omitted: { [`${STATS}/public`]: OMITTED_NOTE },
    data: {
      [USERS]: docJson(userDoc),
      [`${USERS}/{uid}/${TEAMS}`]: queryJson(legacyTeams.docs),
      [TEAMS]: queryJson(teams.docs),
      [USER_SETTINGS]: docJson(settingsDoc),
      [NEWSLETTER_TOKENS]: docJson(tokenDoc),
      [PLAYER_PROFILES]: docJson(profileDoc),
      [PLAYER_MAP_OWNERS]: docJson(ownerDoc),
      [PLAYER_MAP_PRIVATE]: ownsPin && privateDoc ? docJson(privateDoc) : null,
      [PLAYER_MAP]: ownsPin && mapDoc ? docJson(mapDoc) : null,
      [PLAYER_MAP_BOARD]: boardKey(mapBoard.data(), 'markers', ownsPin ? entryId : null),
      [OPEN_TO_GAMES]: docJson(openDoc),
      [OPEN_TO_GAMES_BOARD]: boardKey(openBoard.data(), 'players', uid),
      gameContactsSent: queryJson(sent.docs),
      gameContactsReceived: queryJson(received.docs),
      [MESSAGES]: queryJson(messages.docs),
      [ROLES]: docJson(roleDoc),
      [ADMIN_USERS]: docJson(adminDoc),
			[MAIL_COLLECTION]: [...mailSnaps.values()].map((item) => mailForSubject(item.id, item.data() ?? {}, email)),
			[PRIVACY_RATE]: docJson(rateDoc),
			...buddyData
		}
	};
}

export async function consumePrivacyRateLimit(uid: string, action: RateAction, nowMs = Date.now()): Promise<void> {
  assertUid(uid);
  const db = getFirestore();
  const ref = db.doc(`${PRIVACY_RATE}/${uid}`);
  const field = action === 'export' ? 'exportAt' : 'deleteAt';
  let allowed = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const previous = snap.exists ? snap.get(field) : [];
    const next = nextRateWindow(previous, nowMs);
    allowed = next.allowed;
    if (!next.allowed) return;
    tx.set(ref, { [field]: next.stamps }, { merge: true });
  });
  if (!allowed) throw new HttpsError('resource-exhausted', 'Too many requests. Try again later.');
}

export async function handleExportMyData(uid: string | undefined, nowMs = Date.now()): Promise<Record<string, unknown>> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  await consumePrivacyRateLimit(uid, 'export', nowMs);
  logPrivacy('export', uid);
  return exportAccount(uid);
}

export async function handleDeleteMyAccount(input: {
  uid: string | undefined;
  confirmation: unknown;
  authTimeSeconds: unknown;
  nowMs?: number;
}): Promise<{ status: 'deleted' }> {
  if (!input.uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const failure = deletionRequestError({
    confirmation: input.confirmation,
    authTimeSeconds: input.authTimeSeconds,
    nowMs: input.nowMs ?? Date.now()
  });
  if (failure) throw new HttpsError('failed-precondition', failure);
  await consumePrivacyRateLimit(input.uid, 'delete', input.nowMs ?? Date.now());
  logPrivacy('delete', input.uid);
  await eraseAccount(input.uid);
  logPrivacy('delete-ok', input.uid);
  return { status: 'deleted' };
}

/** The signed-in account only. A uid in the body is ignored. */
export const exportMyData = onCall(privacySecretOptions, async (request) => {
  return handleExportMyData(request.auth?.uid);
});

/** Re-auth and the typed confirmation are required. Admins cannot call this for someone else. */
export const deleteMyAccount = onCall(privacySecretOptions, async (request) => {
  return handleDeleteMyAccount({
    uid: request.auth?.uid,
    confirmation: readConfirmation(request.data),
    authTimeSeconds: request.auth?.token?.auth_time
  });
});
