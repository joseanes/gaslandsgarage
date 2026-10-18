import { describe, expect, it } from 'vitest';
import {
  NEWSLETTER_CONSENT_VERSION,
  NEWSLETTER_REGION,
  newUnsubscribeToken,
  readUnsubscribeToken,
  unsubscribeHtml,
  unsubscribeConfirmHtml,
  readPostedUnsubscribe,
  PROFILE_RESUBSCRIBE_URL,
  ONE_CLICK_FIELD,
  ONE_CLICK_VALUE,
  UNSUBSCRIBE_TOKEN_PATTERN,
  newsletterHttpsOptions,
  createUnsubscribeLimiter,
  clientKey,
  UNSUBSCRIBE_RATE_PER_CLIENT,
  UNSUBSCRIBE_RATE_WINDOW_MS,
  UNSUBSCRIBE_RATE_GLOBAL_PER_MINUTE
} from './newsletter';

describe('unsubscribe token', () => {
  it('is 32 bytes of unpadded base64url and is not taken from the query unless it is one string', () => {
    const token = newUnsubscribeToken();
    expect(token).toMatch(UNSUBSCRIBE_TOKEN_PATTERN);
    expect(newUnsubscribeToken()).not.toBe(token);
    expect(readUnsubscribeToken({ token })).toBe(token);
    expect(readUnsubscribeToken({ token: [token] })).toBe('');
    expect(readUnsubscribeToken(null)).toBe('');
    expect(readUnsubscribeToken({ token: 'short' })).toBe('short');
    expect(readPostedUnsubscribe(`token=${encodeURIComponent(token)}`)).toEqual({ token, oneClick: false });
    expect(readPostedUnsubscribe(`${ONE_CLICK_FIELD}=${ONE_CLICK_VALUE}`)).toEqual({ token: '', oneClick: true });
    expect(readPostedUnsubscribe({ token, [ONE_CLICK_FIELD]: ONE_CLICK_VALUE })).toEqual({ token, oneClick: true });
    expect(readPostedUnsubscribe(null)).toEqual({ token: '', oneClick: false });
  });

  it('renders a confirm page and a result page without remote assets', () => {
    for (const result of ['unsubscribed', 'invalid'] as const) {
      const html = unsubscribeHtml(result);
      expect(html).not.toMatch(/<script|<img|<link/i);
      expect(html).not.toContain(NEWSLETTER_CONSENT_VERSION);
    }
    const success = unsubscribeHtml('unsubscribed');
    expect(success).toContain("You're unsubscribed");
    expect(success).toContain(PROFILE_RESUBSCRIBE_URL);
    expect(success.replaceAll(PROFILE_RESUBSCRIBE_URL, '')).not.toMatch(/https?:/i);
    const invalid = unsubscribeHtml('invalid');
    expect(invalid).toContain('Link not valid');
    expect(invalid).toContain('jose.anes@gmail.com');
    expect(invalid).not.toContain('Confirm unsubscribe');
    expect(invalid).not.toMatch(/https?:/i);
    const token = newUnsubscribeToken();
    const confirm = unsubscribeConfirmHtml(token);
    expect(confirm).toContain('Confirm unsubscribe');
    expect(confirm).toContain('method="post"');
    expect(confirm).toContain(`name="token" value="${token}"`);
    expect(confirm).not.toContain("You're unsubscribed");
    expect(confirm).not.toMatch(/https?:/i);
    expect(newsletterHttpsOptions).toMatchObject({
      region: 'us-central1',
      invoker: 'public',
      cors: false
    });
    expect(NEWSLETTER_REGION).toBe('us-central1');
  });
});

describe('unsubscribe rate limit', () => {
  it('limits one client per window and recovers after it', () => {
    const allow = createUnsubscribeLimiter();
    const t = 1_000_000;
    for (let i = 0; i < UNSUBSCRIBE_RATE_PER_CLIENT; i++) expect(allow('a', t + i)).toBe(true);
    expect(allow('a', t + 100)).toBe(false);
    expect(allow('b', t + 100)).toBe(true);
    expect(allow('a', t + UNSUBSCRIBE_RATE_WINDOW_MS + 100)).toBe(true);
  });

  it('caps the total rate across clients', () => {
    const allow = createUnsubscribeLimiter();
    const t = 5_000_000;
    for (let i = 0; i < UNSUBSCRIBE_RATE_GLOBAL_PER_MINUTE; i++) expect(allow(`c${i}`, t)).toBe(true);
    expect(allow('fresh', t)).toBe(false);
    expect(allow('fresh', t + 60_001)).toBe(true);
  });

  it('keys on the first forwarded address', () => {
    expect(clientKey({ headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }, ip: '10.0.0.1' })).toBe('203.0.113.5');
    expect(clientKey({ headers: {}, ip: '198.51.100.7' })).toBe('198.51.100.7');
  });
});
