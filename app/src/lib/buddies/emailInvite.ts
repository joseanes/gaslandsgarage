import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { BUDDY_EMAIL_INVITE_TTL_MS, uidOk } from './model';

export const INVITE_MESSAGE_MAX = 280;
export const SITE_ORIGIN = 'https://gaslandsgarage.com';
export const EMAIL_INVITE_ACCEPT_PATH = '/buddies';
export const SUPPRESS_FUNCTION_URL =
	'https://us-central1-gaslandsgarage-74ce6.cloudfunctions.net/suppressBuddyEmailInvites';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function twilioEmailConfigured(accountSid: string, authToken: string): boolean {
	const sid = accountSid.trim();
	const token = authToken.trim();
	if (!sid || !token || sid === 'disabled' || token === 'disabled') return false;
	return sid.startsWith('AC') && sid.length >= 34 && token.length >= 16;
}

export function normalizeInviteEmail(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const email = value.trim().toLowerCase();
	if (email.length < 3 || email.length > 320 || !EMAIL_PATTERN.test(email)) return null;
	return email;
}

/** Salted hash. The address itself is not stored. */
export function emailAddressHash(email: string, salt: string): string {
	return createHash('sha256').update(`buddy-email-v1\0${salt}\0${email}`).digest('hex');
}

export function hashSecret(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function encodeBase64Url(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string | null {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
	const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
	try {
		const binary = atob(padded);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

/**
 * Plain text for the optional note. Links and email addresses are removed.
 * The result is capped and has no control characters.
 */
export function sanitizeInviteMessage(value: unknown): string {
	if (typeof value !== 'string') return '';
	let text = value.replace(/[\u0000-\u001f]+/g, ' ');
	text = text.replace(/\[([^\]]*)\]\((?:https?:\/\/|www\.)[^)]+\)/gi, '$1');
	text = text.replace(/https?:\/\/\S+/gi, '');
	text = text.replace(/\bwww\.\S+/gi, '');
	text = text.replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, '');
	text = text.replace(/\b[a-z0-9][-a-z0-9]*\.[a-z]{2,}(?:\/\S*)?/gi, '');
	text = text.replace(/\s+/g, ' ').trim();
	return text.slice(0, INVITE_MESSAGE_MAX);
}

export function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

export type SignedInvite = { jti: string; exp: number; fromUid: string };

export function signEmailInvite(invite: SignedInvite, secret: string): string {
	if (!uidOk(invite.fromUid) || !/^[a-f0-9]{32}$/.test(invite.jti) || !Number.isFinite(invite.exp)) {
		throw new Error('Invite token payload is not valid.');
	}
	const body = `${invite.jti}.${invite.exp}.${invite.fromUid}`;
	const sig = createHmac('sha256', secret).update(body).digest('base64url');
	return `${encodeBase64Url(body)}.${sig}`;
}

export function verifyEmailInvite(token: unknown, secret: string, nowMs: number): SignedInvite | null {
	if (typeof token !== 'string' || !secret) return null;
	const dot = token.lastIndexOf('.');
	if (dot <= 0) return null;
	const encoded = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	const body = decodeBase64Url(encoded);
	if (body === null) return null;
	const expected = createHmac('sha256', secret).update(body).digest('base64url');
	const left = new TextEncoder().encode(sig);
	const right = new TextEncoder().encode(expected);
	if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
	const parts = body.split('.');
	if (parts.length !== 3) return null;
	const [jti, expText, fromUid] = parts;
	const exp = Number(expText);
	if (!/^[a-f0-9]{32}$/.test(jti) || !uidOk(fromUid) || !Number.isSafeInteger(exp)) return null;
	if (exp <= nowMs || exp > nowMs + BUDDY_EMAIL_INVITE_TTL_MS + 60_000) return null;
	return { jti, exp, fromUid };
}

export function acceptInviteUrl(token: string): string {
	return `${SITE_ORIGIN}${EMAIL_INVITE_ACCEPT_PATH}?emailInvite=${encodeURIComponent(token)}`;
}

export function suppressInviteUrl(token: string): string {
	return `${SUPPRESS_FUNCTION_URL}?token=${encodeURIComponent(token)}`;
}

export type InviteMail = { subject: string; text: string; html: string };

export function buildInviteMail(input: {
	displayName: string;
	message: string;
	acceptUrl: string;
	suppressUrl: string;
}): InviteMail {
	const name = input.displayName;
	const subject = `${name} invited you to be Gaming Buddies on Gaslands Garage`.slice(0, 200);
	const note = input.message ? `They wrote: ${input.message}\n\n` : '';
	const noteHtml = input.message ? `<p>They wrote: ${escapeHtml(input.message)}</p>` : '';
	const text = `${name} invited you to be Gaming Buddies on Gaslands Garage.

They asked to be gaming buddies so you can open a read-only copy of each other's teams. If you save a copy, it stays on your account.

${note}Accept the invite. This link expires in 14 days and works once:
${input.acceptUrl}

You received this because ${name} entered this address on Gaslands Garage. We use it only to send this invite.

Don't email me invites again:
${input.suppressUrl}
`;
	const html = `<p>${escapeHtml(name)} invited you to be Gaming Buddies on Gaslands Garage.</p>
<p>They asked to be gaming buddies so you can open a read-only copy of each other's teams. If you save a copy, it stays on your account.</p>
${noteHtml}
<p><a href="${escapeHtml(input.acceptUrl)}">Accept the invite</a>. This link expires in 14 days and works once.</p>
<p>You received this because ${escapeHtml(name)} entered this address on Gaslands Garage. We use it only to send this invite.</p>
<p><a href="${escapeHtml(input.suppressUrl)}">Don't email me invites again</a></p>`;
	return { subject, text, html };
}
