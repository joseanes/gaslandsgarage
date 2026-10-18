import { randomBytes } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';

/** Same region as the other functions. Kept local to avoid an import cycle with index.ts. */
export const NEWSLETTER_REGION = 'us-central1';

export const NEWSLETTER_TOKENS = 'newsletterTokens';
export const USER_SETTINGS = 'userSettings';
export const NEWSLETTER_CONSENT_VERSION = 'monthly-email-v1';

/** 32 bytes, base64url, no padding. */
export const UNSUBSCRIBE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const newsletterHttpsOptions = {
  region: NEWSLETTER_REGION,
  memory: '256MiB',
  timeoutSeconds: 30,
  maxInstances: 10,
  invoker: 'public',
  cors: false
} as const;

export type UnsubscribeResult = 'unsubscribed' | 'invalid';

/** Signed-in profile page where the player can opt in again. The function host is not the site. */
export const PROFILE_RESUBSCRIBE_URL = 'https://gaslandsgarage.com/profile';

/** RFC 8058 one-click body. Mailbox providers POST this to the List-Unsubscribe URL. */
export const ONE_CLICK_FIELD = 'List-Unsubscribe';
export const ONE_CLICK_VALUE = 'One-Click';

/**
 * In-memory limiter for the public unsubscribe link. Nothing about the caller
 * is stored. With maxInstances 10 this bounds the total request rate too.
 */
export const UNSUBSCRIBE_RATE_WINDOW_MS = 10 * 60 * 1000;
export const UNSUBSCRIBE_RATE_PER_CLIENT = 20;
export const UNSUBSCRIBE_RATE_GLOBAL_PER_MINUTE = 300;
const MAX_TRACKED_CLIENTS = 5000;

export function createUnsubscribeLimiter() {
  const clients = new Map<string, number[]>();
  let globalStamps: number[] = [];
  return function allow(clientKey: string, nowMs = Date.now()): boolean {
    globalStamps = globalStamps.filter((stamp) => nowMs - stamp < 60_000);
    if (globalStamps.length >= UNSUBSCRIBE_RATE_GLOBAL_PER_MINUTE) return false;
    const key = clientKey || 'unknown';
    const recent = (clients.get(key) ?? []).filter((stamp) => nowMs - stamp < UNSUBSCRIBE_RATE_WINDOW_MS);
    if (recent.length >= UNSUBSCRIBE_RATE_PER_CLIENT) {
      clients.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    clients.delete(key);
    clients.set(key, recent);
    if (clients.size > MAX_TRACKED_CLIENTS) {
      const oldest = clients.keys().next().value;
      if (oldest !== undefined) clients.delete(oldest);
    }
    globalStamps.push(nowMs);
    return true;
  };
}

const allowUnsubscribe = createUnsubscribeLimiter();

export function clientKey(req: { ip?: string; headers?: Record<string, unknown> }): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : '';
  return first || req.ip || '';
}

export function newUnsubscribeToken(): string {
  return randomBytes(32).toString('base64url');
}

export function readUnsubscribeToken(query: unknown): string {
  if (!query || typeof query !== 'object') return '';
  const value = (query as { token?: unknown }).token;
  return typeof value === 'string' ? value : '';
}

/** Token and one-click flag from a form body or an RFC 8058 POST. */
export function readPostedUnsubscribe(body: unknown): { token: string; oneClick: boolean } {
  if (Buffer.isBuffer(body)) return readPostedUnsubscribe(body.toString('utf8'));
  if (typeof body === 'string') {
    const params = new URLSearchParams(body);
    return {
      token: params.get('token') ?? '',
      oneClick: params.get(ONE_CLICK_FIELD) === ONE_CLICK_VALUE
    };
  }
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    return {
      token: typeof record.token === 'string' ? record.token : '',
      oneClick: record[ONE_CLICK_FIELD] === ONE_CLICK_VALUE
    };
  }
  return { token: '', oneClick: false };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * One token per opted-in player. A later opt-in keeps the same token so an
 * older email still unsubscribes. Opting out does not delete it.
 */
export async function ensureUnsubscribeToken(uid: string, nowIso = new Date().toISOString()): Promise<string> {
  const ref = getFirestore().doc(`${NEWSLETTER_TOKENS}/${uid}`);
  let token = '';
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.get('token');
    if (typeof current === 'string' && UNSUBSCRIBE_TOKEN_PATTERN.test(current)) {
      token = current;
      return;
    }
    token = newUnsubscribeToken();
    tx.set(ref, { uid, token, createdAt: nowIso });
  });
  return token;
}

/** Called after a settings write. Tokens are created only for an opt-in. */
export async function handleNewsletterSettingsWrite(
  uid: string,
  after: Record<string, unknown> | null
): Promise<void> {
  if (!after || after.newsletterOptIn !== true) return;
  await ensureUnsubscribeToken(uid);
}

/** Read-only check. A missing or duplicated token is the same answer as a bad one. */
export async function unsubscribeTokenMatches(token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || !UNSUBSCRIBE_TOKEN_PATTERN.test(token)) return false;
  const found = await getFirestore().collection(NEWSLETTER_TOKENS).where('token', '==', token).limit(2).get();
  if (found.size !== 1) return false;
  const snap = found.docs[0];
  return snap.get('uid') === snap.id;
}

/**
 * Flip the monthly email off. The same answer is returned for a second POST.
 * An unknown token changes nothing.
 */
export async function unsubscribeByToken(token: unknown, nowIso = new Date().toISOString()): Promise<UnsubscribeResult> {
  if (typeof token !== 'string' || !UNSUBSCRIBE_TOKEN_PATTERN.test(token)) return 'invalid';
  const db = getFirestore();
  const found = await db.collection(NEWSLETTER_TOKENS).where('token', '==', token).limit(2).get();
  if (found.size !== 1) return 'invalid';
  const snap = found.docs[0];
  if (snap.get('uid') !== snap.id) return 'invalid';
  const settingsRef = db.doc(`${USER_SETTINGS}/${snap.id}`);
  await db.runTransaction(async (tx) => {
    const settings = await tx.get(settingsRef);
    const data = settings.data() ?? {};
    if (data.newsletterOptIn === false && typeof data.newsletterOptOutAt === 'string') return;
    tx.set(
      settingsRef,
      {
        newsletterOptIn: false,
        newsletterOptOutAt: nowIso
      },
      { merge: true }
    );
  });
  return 'unsubscribed';
}

function pageHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 36rem; margin: 2rem auto; padding: 0 1rem; color: #292524;">
<h1 style="font-size: 1.5rem;">${title}</h1>
${body}
</body>
</html>`;
}

/** Shown for a GET. The form is the only way this page changes the subscription. */
export function unsubscribeConfirmHtml(token: string): string {
  const safe = escapeHtml(token);
  return pageHtml(
    'Confirm unsubscribe',
    `<p>Opening this page does not change your email settings.</p>
<form method="post">
<input type="hidden" name="token" value="${safe}">
<button type="submit">Confirm unsubscribe</button>
</form>`
  );
}

export function unsubscribeHtml(result: UnsubscribeResult): string {
  if (result === 'unsubscribed') {
    return pageHtml(
      "You're unsubscribed",
      `<p>You will not get the monthly Gaslands Garage email.</p>
<p><a href="${PROFILE_RESUBSCRIBE_URL}">Subscribe again from your player profile</a></p>`
    );
  }
  return pageHtml(
    'Link not valid',
    '<p>This unsubscribe link does not match an account. You can turn the monthly email off in Settings, or email jose.anes@gmail.com.</p>'
  );
}

export interface UnsubscribeHttpRequest {
  method?: string;
  query?: unknown;
  body?: unknown;
  headers?: Record<string, unknown>;
  ip?: string;
}

export interface UnsubscribeHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function htmlResponse(statusCode: number, body: string, extra: Record<string, string> = {}): UnsubscribeHttpResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'",
      ...extra
    },
    body
  };
}

/**
 * GET only renders a confirm page. POST from that button, or an RFC 8058
 * one-click POST, is what turns the monthly email off.
 */
export async function handleUnsubscribeRequest(req: UnsubscribeHttpRequest): Promise<UnsubscribeHttpResponse> {
  const method = (req.method ?? '').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return {
      statusCode: 405,
      headers: { Allow: 'GET, POST', 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Method not allowed'
    };
  }
  if (!allowUnsubscribe(clientKey(req))) {
    return {
      statusCode: 429,
      headers: {
        'Retry-After': '600',
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8'
      },
      body: 'Too many requests. Try again later.'
    };
  }

  const posted = method === 'POST' ? readPostedUnsubscribe(req.body) : { token: '', oneClick: false };
  const token = posted.token || readUnsubscribeToken(req.query);

  if (method === 'GET') {
    const matches = await unsubscribeTokenMatches(token);
    if (!matches) return htmlResponse(400, unsubscribeHtml('invalid'));
    return htmlResponse(200, unsubscribeConfirmHtml(token));
  }

  const result = await unsubscribeByToken(token);
  return htmlResponse(result === 'unsubscribed' ? 200 : 400, unsubscribeHtml(result));
}

export const syncNewsletterToken = onDocumentWritten(
  {
    document: `${USER_SETTINGS}/{uid}`,
    region: NEWSLETTER_REGION,
    retry: true
  },
  async (event) => {
    const afterSnap = event.data?.after;
    await handleNewsletterSettingsWrite(
      event.params.uid,
      afterSnap?.exists ? (afterSnap.data() as Record<string, unknown>) : null
    );
  }
);

/** Email link. No sign-in. GET does not change the subscription. POST does. */
export const unsubscribeNewsletter = onRequest(newsletterHttpsOptions, async (req, res) => {
  const result = await handleUnsubscribeRequest({
    method: req.method,
    query: req.query,
    body: req.body,
    headers: req.headers as Record<string, unknown>,
    ip: req.ip
  });
  res.status(result.statusCode);
  for (const [name, value] of Object.entries(result.headers)) res.set(name, value);
  res.send(result.body);
});
