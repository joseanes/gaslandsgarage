import { describe, expect, it } from 'vitest';
import {
  NEWSLETTER_CONSENT_VERSION,
  NEWSLETTER_REGION,
  newUnsubscribeToken,
  readUnsubscribeToken,
  unsubscribeHtml,
  UNSUBSCRIBE_TOKEN_PATTERN,
  newsletterHttpsOptions
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
  });

  it('renders a page that does not load a remote URL', () => {
    for (const result of ['unsubscribed', 'invalid'] as const) {
      const html = unsubscribeHtml(result);
      expect(html).not.toMatch(/https?:/i);
      expect(html).not.toContain(NEWSLETTER_CONSENT_VERSION);
    }
    expect(unsubscribeHtml('unsubscribed')).toContain('Unsubscribed');
    expect(unsubscribeHtml('invalid')).toContain('jose.anes@gmail.com');
    expect(newsletterHttpsOptions).toMatchObject({
      region: 'us-central1',
      invoker: 'public',
      cors: false
    });
    expect(NEWSLETTER_REGION).toBe('us-central1');
  });
});
