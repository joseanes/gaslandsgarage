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

/**
 * Flip the monthly email off. The same answer is returned for a second click.
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

export function unsubscribeHtml(result: UnsubscribeResult): string {
  const title = result === 'unsubscribed' ? 'Unsubscribed' : 'Link not valid';
  const body =
    result === 'unsubscribed'
      ? 'You will not get the monthly Gaslands Garage email. You can opt in again from Settings on gaslandsgarage.com if you change your mind.'
      : 'This unsubscribe link does not match an account. You can turn the monthly email off in Settings, or email jose.anes@gmail.com.';
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
<p>${body}</p>
</body>
</html>`;
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

/** Email link. No sign-in. The token is the only credential, and the page loads nothing else. */
export const unsubscribeNewsletter = onRequest(newsletterHttpsOptions, async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).set('Allow', 'GET, POST').type('text/plain').send('Method not allowed');
    return;
  }
  if (!allowUnsubscribe(clientKey(req))) {
    res
      .status(429)
      .set('Retry-After', '600')
      .set('Cache-Control', 'no-store')
      .type('text/plain')
      .send('Too many requests. Try again later.');
    return;
  }
  const result = await unsubscribeByToken(readUnsubscribeToken(req.query));
  res
    .status(result === 'unsubscribed' ? 200 : 400)
    .set('Content-Type', 'text/html; charset=utf-8')
    .set('Cache-Control', 'no-store')
    .set('Referrer-Policy', 'no-referrer')
    .set('X-Content-Type-Options', 'nosniff')
    .set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
    .send(unsubscribeHtml(result));
});
