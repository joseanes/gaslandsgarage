import { describe, expect, it } from 'vitest';
import { BUDDY_EMAIL_INVITE_TTL_MS } from './model';
import {
	INVITE_MESSAGE_MAX,
	acceptInviteUrl,
	buildInviteMail,
	emailAddressHash,
	sanitizeInviteMessage,
	signEmailInvite,
	suppressInviteUrl,
	twilioEmailConfigured,
	verifyEmailInvite
} from './emailInvite';

const secret = 'test-token-value-16';
const jti = 'ab'.repeat(16);
const fromUid = 'playerAda123';
const now = Date.parse('2026-10-18T12:00:00.000Z');

describe('email invite tokens', () => {
	it('treats a placeholder Twilio secret as not configured', () => {
		expect(twilioEmailConfigured('', secret)).toBe(false);
		expect(twilioEmailConfigured('disabled', secret)).toBe(false);
		expect(twilioEmailConfigured('AC00000000000000000000000000000000', 'disabled')).toBe(false);
		expect(twilioEmailConfigured('AC00000000000000000000000000000000', 'short')).toBe(false);
		expect(twilioEmailConfigured('AC00000000000000000000000000000000', secret)).toBe(true);
	});

	it('hashes an address with the salt and does not keep the address', () => {
		const email = 'friend@example.com';
		const hash = emailAddressHash(email, secret);
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
		expect(hash).not.toContain('friend');
		expect(emailAddressHash(email, secret)).toBe(hash);
		expect(emailAddressHash(email, 'other-token-value-16')).not.toBe(hash);
	});

	it('strips links and caps the optional message', () => {
		const cleaned = sanitizeInviteMessage(
			'Hello https://evil.test/x see www.nope.test/a and [go](https://bad.test/z) at example.com and me@example.com done'
		);
		expect(cleaned).toBe('Hello see and go at and done');
		expect(cleaned).not.toContain('http');
		expect(cleaned).not.toContain('@');
		expect(sanitizeInviteMessage(`  <b>hi</b>  `)).toBe('<b>hi</b>');
		expect(sanitizeInviteMessage('a'.repeat(400))).toHaveLength(INVITE_MESSAGE_MAX);
		expect(sanitizeInviteMessage(12)).toBe('');
	});

	it('signs a token that fails when it is changed or expired', () => {
		const exp = now + BUDDY_EMAIL_INVITE_TTL_MS;
		const token = signEmailInvite({ jti, exp, fromUid }, secret);
		expect(verifyEmailInvite(token, secret, now)).toEqual({ jti, exp, fromUid });
		expect(verifyEmailInvite(`${token}x`, secret, now)).toBeNull();
		expect(verifyEmailInvite(token, 'other-token-value-16', now)).toBeNull();
		expect(verifyEmailInvite(token, secret, exp)).toBeNull();
		const tooFar = signEmailInvite({ jti, exp: now + BUDDY_EMAIL_INVITE_TTL_MS + 120_000, fromUid }, secret);
		expect(verifyEmailInvite(tooFar, secret, now)).toBeNull();
	});

	it('builds a plain transactional message with both links', () => {
		const acceptUrl = acceptInviteUrl('token.sig');
		const suppressUrl = suppressInviteUrl('optout');
		const mail = buildInviteMail({
			displayName: 'Ada <script>',
			message: sanitizeInviteMessage('See you https://evil.test <b>soon</b>'),
			acceptUrl,
			suppressUrl
		});
		expect(mail.subject).toBe('Ada <script> invited you to be Gaming Buddies on Gaslands Garage');
		expect(mail.text).toContain(acceptUrl);
		expect(mail.text).toContain(suppressUrl);
		expect(mail.text).toContain('You received this because Ada <script> entered this address');
		expect(mail.text).not.toContain('https://evil.test');
		expect(mail.html).toContain('Ada &lt;script&gt;');
		expect(mail.html).toContain('&lt;b&gt;soon&lt;/b&gt;');
		expect(mail.html).toContain(acceptUrl);
		expect(mail.html).toContain(suppressUrl);
		expect(mail.html).not.toContain('https://evil.test');
		expect(mail.html).not.toContain('Allow other players');
		expect(mail.text).not.toContain('openSettingsTab');
	});
});
