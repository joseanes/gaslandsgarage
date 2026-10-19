import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { BUDDY_EMAIL_INVITES_PER_DAY, BUDDY_EMAIL_INVITE_WINDOW_MS, rollingWindow } from '../../app/src/lib/buddies/model.ts';

/** Collection the Firebase Trigger Email extension watches. */
export const MAIL_COLLECTION = 'mail';

/**
 * Opens the builder settings tab where player contact can be turned off.
 * The Twilio sender in PR #25 appends this link to game-request mail only.
 */
export const CONTACT_SETTINGS_URL = 'https://gaslandsgarage.com/builder?openSettingsTab=general';

/** Firestore TTL deletes a mail document this long after it is queued. */
export const MAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ContactMail = {
  to: string[];
  message: {
    subject: string;
    text: string;
  };
};

export type QueuedContactMail = ContactMail & {
  expireAt: Timestamp;
};

export const GAME_CONTACT_EMAIL_RATE = 'gameContactEmailRate';

export type QueueResult =
  | { status: 'queued' }
  | {
      status: 'skipped';
      reason: 'invalid' | 'not-opted-in' | 'no-email' | 'disabled' | 'missing-user' | 'rate-limited';
    };

/**
 * Game-request email is opt-in. `userSettings.allowContactFromPlayers` defaults
 * to false. `openToGames` only allows an in-app request; it is not consent to email.
 */
export function recipientWantsContactEmail(settings: Record<string, unknown> | null | undefined): boolean {
  return settings?.allowContactFromPlayers === true;
}

function singleLine(value: string, max: number): string {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

export function mailDocId(contactId: string): string {
  return `gameContact_${contactId.replace(/\//g, '_')}`;
}

/** Timestamp a Firestore TTL policy on `mail.expireAt` can purge. */
export function mailExpiresAt(now: Date = new Date()): Timestamp {
  return Timestamp.fromMillis(now.getTime() + MAIL_TTL_MS);
}

/** Trigger Email extension document. `to` is the only copy of the address. */
export function contactMailDocument(input: { to: string; fromName: string; message: string }): ContactMail {
  const fromName = singleLine(input.fromName, 60) || 'A player';
  const message = input.message.trim().slice(0, 500);
  return {
    to: [input.to],
    message: {
      subject: `${fromName} sent a Gaslands game request`,
      text: [
        `${fromName} sent you a game request in Gaslands Garage.`,
        '',
        message,
        '',
        'Sign in to Gaslands Garage to read and reply. Your email address is not shown to the other player.'
      ].join('\n')
    }
  };
}

function readContact(
  data: Record<string, unknown>
): { fromUid: string; toUid: string; fromName: string; message: string } | null {
  const toUid = typeof data.toUid === 'string' ? data.toUid : '';
  const fromUid = typeof data.fromUid === 'string' ? data.fromUid : '';
  const fromName = typeof data.fromName === 'string' ? data.fromName : '';
  const message = typeof data.message === 'string' ? data.message : '';
  if (!toUid || !fromUid || toUid === fromUid || !message.trim()) return null;
  return { fromUid, toUid, fromName, message };
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) return String(error.code);
  return '';
}

function isUserNotFound(error: unknown): boolean {
  return errorCode(error) === 'auth/user-not-found';
}

function isAlreadyExists(error: unknown): boolean {
  const code = errorCode(error);
  return code === '6' || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

/**
 * Queues one email for a new `gameContacts` document.
 * The recipient address is read from Firebase Auth and written only on the
 * `mail` queue document the Trigger Email extension expects. It is not written
 * back onto the contact, the user profile, or settings.
 */
export async function queueContactEmail(contactId: string, data: Record<string, unknown>): Promise<QueueResult> {
  const contact = readContact(data);
  if (!contact) return { status: 'skipped', reason: 'invalid' };

  const db = getFirestore();
  const settingsSnap = await db.doc(`userSettings/${contact.toUid}`).get();
  const settings = settingsSnap.exists ? settingsSnap.data() : null;
  if (!recipientWantsContactEmail(settings)) return { status: 'skipped', reason: 'not-opted-in' };

  let email = '';
  try {
    const user = await getAuth().getUser(contact.toUid);
    if (user.disabled) return { status: 'skipped', reason: 'disabled' };
    email = user.email?.trim() ?? '';
  } catch (error) {
    if (isUserNotFound(error)) return { status: 'skipped', reason: 'missing-user' };
    throw error;
  }
  if (!email) return { status: 'skipped', reason: 'no-email' };

  const mailRef = db.doc(`${MAIL_COLLECTION}/${mailDocId(contactId)}`);
  if ((await mailRef.get()).exists) return { status: 'queued' };
  if (!(await reserveContactEmail(contact.fromUid))) return { status: 'skipped', reason: 'rate-limited' };

  const mail: QueuedContactMail = {
    ...contactMailDocument({ to: email, fromName: contact.fromName, message: contact.message }),
    expireAt: mailExpiresAt()
  };
  try {
    await mailRef.create(mail);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
  console.log(`Queued mail/${mailDocId(contactId)} for gameContacts/${contactId}`);
  return { status: 'queued' };
}

/** Ten game-request emails per sender per day. The in-app note is unaffected. */
async function reserveContactEmail(fromUid: string, nowMs = Date.now()): Promise<boolean> {
  const db = getFirestore();
  const ref = db.doc(`${GAME_CONTACT_EMAIL_RATE}/${fromUid}`);
  let allowed = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = rollingWindow(snap.get('sentAt'), nowMs, BUDDY_EMAIL_INVITES_PER_DAY, BUDDY_EMAIL_INVITE_WINDOW_MS);
    allowed = next.allowed;
    if (!next.allowed) return;
    tx.set(ref, { sentAt: next.stamps }, { merge: true });
  });
  return allowed;
}
