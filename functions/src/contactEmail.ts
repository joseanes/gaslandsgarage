import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

/** Queued game-request mail. `sendQueuedMail` delivers each created document. */
export const MAIL_COLLECTION = 'mail';

/** Opens the builder settings tab where player contact can be turned off. */
export const CONTACT_SETTINGS_URL = 'https://gaslandsgarage.com/builder?openSettingsTab=general';

const CONTACT_SETTING_LABEL = 'Allow other players to contact me to setup a game';

/** Firestore TTL deletes a mail document this long after it is queued. */
export const MAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ContactMail = {
  to: string[];
  toName?: string;
  message: {
    subject: string;
    text: string;
    html: string;
  };
};

export type QueuedContactMail = ContactMail & {
  expireAt: Timestamp;
};

export type QueueResult =
  | { status: 'queued' }
  | { status: 'skipped'; reason: 'invalid' | 'not-opted-in' | 'no-email' | 'disabled' | 'missing-user' };

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

/** Display name safe to store beside a queued address. An address is not a name. */
export function displayName(value: string): string {
  const name = singleLine(value, 60);
  if (!name || name.includes('@')) return '';
  return name;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function htmlText(value: string): string {
  return escapeHtml(value).replaceAll('\n', '<br>');
}

function settingsText(): string {
  return `To turn off player contact, open your settings and clear "${CONTACT_SETTING_LABEL}":\n${CONTACT_SETTINGS_URL}`;
}

function settingsHtml(): string {
  return `<p>To turn off player contact, open your <a href="${CONTACT_SETTINGS_URL}">settings</a> and clear &quot;${CONTACT_SETTING_LABEL}&quot;.</p>`;
}

export function mailDocId(contactId: string): string {
  return `gameContact_${contactId.replace(/\//g, '_')}`;
}

/** Timestamp a Firestore TTL policy on `mail.expireAt` can purge. */
export function mailExpiresAt(now: Date = new Date()): Timestamp {
  return Timestamp.fromMillis(now.getTime() + MAIL_TTL_MS);
}

/**
 * Queued mail document. `to` is the only copy of the recipient address.
 * Text and HTML both include a settings link so the player can turn contact off.
 */
export function contactMailDocument(input: {
  to: string;
  fromName: string;
  message: string;
  toName?: string;
}): ContactMail {
  const fromName = singleLine(input.fromName, 60) || 'A player';
  const message = input.message.trim().slice(0, 500);
  const toName = input.toName ? displayName(input.toName) : '';
  const text = [
    `${fromName} sent you a game request in Gaslands Garage.`,
    '',
    message,
    '',
    'Sign in to Gaslands Garage to read and reply. Your email address is not shown to the other player.',
    '',
    settingsText()
  ].join('\n');
  const html = [
    `<p>${htmlText(fromName)} sent you a game request in Gaslands Garage.</p>`,
    `<p>${htmlText(message)}</p>`,
    '<p>Sign in to Gaslands Garage to read and reply. Your email address is not shown to the other player.</p>',
    settingsHtml()
  ].join('');
  const mail: ContactMail = {
    to: [input.to],
    message: {
      subject: `${fromName} sent a Gaslands game request`,
      text,
      html
    }
  };
  if (toName) mail.toName = toName;
  return mail;
}

function readContact(
  data: Record<string, unknown>
): { toUid: string; fromName: string; toName: string; message: string } | null {
  const toUid = typeof data.toUid === 'string' ? data.toUid : '';
  const fromUid = typeof data.fromUid === 'string' ? data.fromUid : '';
  const fromName = typeof data.fromName === 'string' ? data.fromName : '';
  const toName = typeof data.toName === 'string' ? data.toName : '';
  const message = typeof data.message === 'string' ? data.message : '';
  if (!toUid || !fromUid || toUid === fromUid || !message.trim()) return null;
  return { toUid, fromName, toName, message };
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
 * `mail` document. It is not written back onto the contact, the user profile,
 * or settings. `sendQueuedMail` performs the Twilio send.
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

  const mail: QueuedContactMail = {
    ...contactMailDocument({
      to: email,
      fromName: contact.fromName,
      toName: contact.toName,
      message: contact.message
    }),
    expireAt: mailExpiresAt()
  };
  try {
    await db.doc(`${MAIL_COLLECTION}/${mailDocId(contactId)}`).create(mail);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
  console.log(`Queued mail/${mailDocId(contactId)} for gameContacts/${contactId}`);
  return { status: 'queued' };
}
