import {
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentData,
  type DocumentReference
} from 'firebase-admin/firestore';
import { CONTACT_SETTINGS_URL, MAIL_COLLECTION } from './contactEmail.ts';

/** Shown as the sender name. Twilio requires a from name. */
export const MAIL_FROM_NAME = 'Gaslands Garage';

/** Default for the `MAIL_FROM_ADDRESS` param. The domain must be verified at Twilio. */
export const DEFAULT_MAIL_FROM_ADDRESS = 'noreply@gaslandsgarage.com';

export const TWILIO_EMAIL_URL = 'https://comms.twilio.com/v1/Emails';

/** How long a claimed document stays leased if the attempt stops before it finishes. */
const LEASE_MS = 90_000;

const SETTINGS_TEXT = `To turn off player contact, open your settings and clear "Allow other players to contact me to setup a game":\n${CONTACT_SETTINGS_URL}`;

const SETTINGS_HTML = `<p>To turn off player contact, open your <a href="${CONTACT_SETTINGS_URL}">settings</a> and clear &quot;Allow other players to contact me to setup a game&quot;.</p>`;

export type TwilioEmail = {
  from: { address: string; name: string };
  to: Array<{ address: string; name?: string }>;
  content: { subject: string; html: string; text: string };
};

export type TwilioPostResult =
  | { ok: true; operationId: string | null }
  | { ok: false; status: number; retryable: boolean };

export type MailDeliveryError = {
  status: number | null;
  message: string;
  retryable: boolean;
};

export type DeliverResult =
  | { status: 'sent'; operationId: string | null }
  | { status: 'skipped'; reason: 'already-sent' | 'leased' | 'permanent-error' | 'invalid' };

type Claim =
  | { action: 'missing' }
  | { action: 'already-sent' }
  | { action: 'permanent-error' }
  | { action: 'own-lease' }
  | { action: 'leased' }
  | { action: 'invalid' }
  | { action: 'send'; email: TwilioEmail };

/**
 * Thrown only when another attempt should run: HTTP 429 or 5xx, a network
 * failure, a still-held lease for this event, or missing Twilio config.
 * The message is safe to log. It has no address and no body.
 */
export class RetryableMailError extends Error {
  readonly retryable = true;

  constructor(mailId: string, reason: string) {
    super(`mail/${logId(mailId)} will retry (${reason})`);
    this.name = 'RetryableMailError';
  }
}

export function isRetryableTwilioStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export function twilioAuthorization(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`, 'utf8').toString('base64')}`;
}

/** Logs the mail id and a fixed outcome. Never pass an address, body, or credential. */
function report(mailId: string, outcome: string): void {
  console.log(`mail/${logId(mailId)} ${outcome}`);
}

function logId(mailId: string): string {
  return mailId.replace(/[\r\n]/g, '').slice(0, 120);
}

function isEmailAddress(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(value);
}

function readRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const addresses: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !isEmailAddress(item.trim())) continue;
    addresses.push(item.trim());
  }
  return addresses;
}

function displayName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = value.replace(/[\r\n]+/g, ' ').trim().slice(0, 60);
  if (!name || name.includes('@')) return '';
  return name;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function withSettingsText(text: string): string {
  if (text.includes(CONTACT_SETTINGS_URL)) return text;
  const base = text.replace(/\s+$/, '');
  return base ? `${base}\n\n${SETTINGS_TEXT}` : SETTINGS_TEXT;
}

export function withSettingsHtml(html: string): string {
  if (html.includes(`href="${CONTACT_SETTINGS_URL}"`)) return html;
  return `${html}${SETTINGS_HTML}`;
}

/**
 * Twilio payload for a queued mail document.
 * Returns null when the document cannot be sent. The result is a new object,
 * so Firestore fields such as `expireAt` are not copied into the request.
 */
export function buildTwilioEmail(
  data: Record<string, unknown>,
  from: { address: string; name: string }
): TwilioEmail | null {
  const fromAddress = from.address.trim();
  const fromName = from.name.trim();
  if (!isEmailAddress(fromAddress) || !fromName) return null;
  const recipients = readRecipients(data.to);
  if (recipients.length === 0) return null;
  const message = data.message;
  if (!message || typeof message !== 'object') return null;
  const record = message as Record<string, unknown>;
  const subject =
    typeof record.subject === 'string' ? record.subject.replace(/[\r\n]+/g, ' ').trim().slice(0, 200) : '';
  const text = typeof record.text === 'string' ? record.text : '';
  const html = typeof record.html === 'string' ? record.html : '';
  if (!subject || (!text.trim() && !html.trim())) return null;
  const toName = recipients.length === 1 ? displayName(data.toName) : '';
  const bodyText = withSettingsText(text.trim() ? text : '');
  const bodyHtml = withSettingsHtml(html.trim() ? html : `<p>${escapeHtml(bodyText).replaceAll('\n', '<br>')}</p>`);
  return {
    from: { address: fromAddress, name: fromName },
    to: recipients.map((address) => (toName ? { address, name: toName } : { address })),
    content: { subject, html: bodyHtml, text: bodyText }
  };
}

function readOperationId(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('operationId' in body)) return null;
  const value = (body as { operationId?: unknown }).operationId;
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || id.length > 200 || /\s/.test(id)) return null;
  return id;
}

/**
 * POST https://comms.twilio.com/v1/Emails.
 * A non-202 response body is discarded. Error bodies can echo the recipient.
 */
export async function postTwilioEmail(
  email: TwilioEmail,
  auth: { accountSid: string; authToken: string },
  fetchImpl: typeof fetch = fetch
): Promise<TwilioPostResult> {
  const response = await fetchImpl(TWILIO_EMAIL_URL, {
    method: 'POST',
    headers: {
      Authorization: twilioAuthorization(auth.accountSid, auth.authToken),
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(email)
  });
  if (response.status !== 202) {
    return { ok: false, status: response.status, retryable: isRetryableTwilioStatus(response.status) };
  }
  let operationId: string | null = null;
  try {
    operationId = readOperationId(await response.json());
  } catch {
    operationId = null;
  }
  return { ok: true, operationId };
}

function timestampMillis(value: unknown): number {
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis: unknown }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function readStoredError(value: unknown): MailDeliveryError | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.retryable !== 'boolean') return null;
  return {
    status: typeof record.status === 'number' ? record.status : null,
    message: typeof record.message === 'string' ? record.message : '',
    retryable: record.retryable
  };
}

function mailRef(mailId: string): DocumentReference {
  return getFirestore().doc(`${MAIL_COLLECTION}/${mailId}`);
}

async function claimMail(
  mailId: string,
  leaseId: string,
  from: { address: string; name: string },
  now: number
): Promise<Claim> {
  const ref = mailRef(mailId);
  return getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { action: 'missing' };
    const data = snap.data() as DocumentData;
    if (data.state === 'sent' || typeof data.operationId === 'string') return { action: 'already-sent' };
    const stored = readStoredError(data.error);
    if (data.state === 'error' && stored?.retryable !== true) return { action: 'permanent-error' };
    if (data.state === 'sending' && timestampMillis(data.leaseExpiresAt) > now) {
      if (data.leaseId === leaseId) return { action: 'own-lease' };
      return { action: 'leased' };
    }
    const email = buildTwilioEmail(data, from);
    if (!email) {
      tx.update(ref, {
        state: 'error',
        error: { status: null, message: 'Mail document cannot be sent', retryable: false },
        leaseId: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete()
      });
      return { action: 'invalid' };
    }
    tx.update(ref, {
      state: 'sending',
      leaseId,
      leaseExpiresAt: Timestamp.fromMillis(now + LEASE_MS)
    });
    return { action: 'send', email };
  });
}

async function writeError(mailId: string, leaseId: string, error: MailDeliveryError): Promise<void> {
  const ref = mailRef(mailId);
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() as DocumentData;
    if (data.state === 'sent' || typeof data.operationId === 'string') return;
    if (typeof data.leaseId === 'string' && data.leaseId !== leaseId) return;
    tx.update(ref, {
      state: 'error',
      error,
      leaseId: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete()
    });
  });
}

async function writeSent(mailId: string, leaseId: string, operationId: string | null): Promise<void> {
  const ref = mailRef(mailId);
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() as DocumentData;
    if (data.state === 'sent') return;
    if (data.state === 'sending' && typeof data.leaseId === 'string' && data.leaseId !== leaseId) return;
    const leaseClear = {
      leaseId: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete()
    };
    if (operationId) {
      tx.update(ref, {
        state: 'sent',
        operationId,
        error: FieldValue.delete(),
        ...leaseClear
      });
      return;
    }
    tx.update(ref, {
      state: 'sent',
      error: {
        status: 202,
        message: 'Twilio Email accepted the send without an operationId',
        retryable: false
      },
      ...leaseClear
    });
  });
}

/**
 * Claims `mail/{mailId}`, POSTs it to Twilio Email, and writes `state`,
 * `operationId`, or `error` back. `expireAt`, `to`, and `message` are not rewritten.
 * Throws {@link RetryableMailError} for 429, 5xx, and network failures.
 */
export async function deliverQueuedMail(
  mailId: string,
  options: {
    accountSid: string;
    authToken: string;
    fromAddress: string;
    fromName: string;
    leaseId: string;
    fetchImpl?: typeof fetch;
    now?: () => number;
  }
): Promise<DeliverResult> {
  if (!mailId || !options.leaseId) return { status: 'skipped', reason: 'invalid' };
  if (!options.accountSid || !options.authToken || !options.fromAddress.trim() || !options.fromName.trim()) {
    throw new RetryableMailError(mailId, 'config');
  }

  const claimed = await claimMail(
    mailId,
    options.leaseId,
    { address: options.fromAddress, name: options.fromName },
    options.now?.() ?? Date.now()
  );

  switch (claimed.action) {
    case 'own-lease':
      report(mailId, 'retry lease');
      throw new RetryableMailError(mailId, 'lease');
    case 'missing':
      report(mailId, 'skipped missing');
      return { status: 'skipped', reason: 'invalid' };
    case 'already-sent':
      report(mailId, 'skipped already-sent');
      return { status: 'skipped', reason: 'already-sent' };
    case 'leased':
      report(mailId, 'skipped leased');
      return { status: 'skipped', reason: 'leased' };
    case 'permanent-error':
      report(mailId, 'skipped permanent-error');
      return { status: 'skipped', reason: 'permanent-error' };
    case 'invalid':
      report(mailId, 'failed invalid');
      return { status: 'skipped', reason: 'invalid' };
    case 'send':
      break;
  }

  let result: TwilioPostResult;
  try {
    result = await postTwilioEmail(
      claimed.email,
      { accountSid: options.accountSid, authToken: options.authToken },
      options.fetchImpl
    );
  } catch {
    await writeError(mailId, options.leaseId, {
      status: null,
      message: 'Twilio Email request failed',
      retryable: true
    });
    report(mailId, 'failed network retry');
    throw new RetryableMailError(mailId, 'network');
  }

  if (!result.ok) {
    await writeError(mailId, options.leaseId, {
      status: result.status,
      message: `Twilio Email returned HTTP ${result.status}`,
      retryable: result.retryable
    });
    report(mailId, `failed http ${result.status}${result.retryable ? ' retry' : ''}`);
    if (result.retryable) throw new RetryableMailError(mailId, `http_${result.status}`);
    return { status: 'skipped', reason: 'permanent-error' };
  }

  await writeSent(mailId, options.leaseId, result.operationId);
  report(mailId, 'sent');
  return { status: 'sent', operationId: result.operationId };
}
