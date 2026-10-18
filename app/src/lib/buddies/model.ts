/** Shared buddy identifiers and name rules. No Firebase imports. */

export const BUDDY_REQUESTS_PER_HOUR = 10;
export const BUDDY_SEARCHES_PER_HOUR = 30;
export const BUDDY_RATE_WINDOW_MS = 60 * 60 * 1000;
export const BUDDY_NAME_MAX = 60;
export const INVITE_CODE_LENGTH = 10;
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const BUDDY_COLLECTIONS = {
	buddies: 'buddies',
	requests: 'buddyRequests',
	blocks: 'buddyBlocks',
	invites: 'buddyInvites',
	directory: 'buddyDirectory',
	rate: 'buddyRate'
} as const;

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function uidOk(uid: unknown): uid is string {
	return typeof uid === 'string' && UID_PATTERN.test(uid);
}

export function buddyPairId(a: string, b: string): string {
	if (!uidOk(a) || !uidOk(b) || a === b) {
		throw new Error('A buddy link needs two different players.');
	}
	return [a, b].sort().join('~');
}

export function buddyRequestId(fromUid: string, toUid: string): string {
	if (!uidOk(fromUid) || !uidOk(toUid) || fromUid === toUid) {
		throw new Error('A buddy request needs two different players.');
	}
	return `${fromUid}~${toUid}`;
}

export function buddyBlockId(blockerUid: string, blockedUid: string): string {
	if (!uidOk(blockerUid) || !uidOk(blockedUid) || blockerUid === blockedUid) {
		throw new Error('A block needs two different players.');
	}
	return `${blockerUid}~${blockedUid}`;
}

/** A name safe to show another player. Email addresses are rejected. */
export function publicDisplayName(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const name = value.trim().replace(/\s+/g, ' ');
	if (!name || name.length > BUDDY_NAME_MAX) return null;
	if (name.includes('@')) return null;
	if (/[\u0000-\u001f]/.test(name)) return null;
	return name;
}

export function displayNameKey(name: string): string {
	return name.toLowerCase();
}

export function normalizeInviteCode(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const code = value.trim().toUpperCase();
	if (code.length !== INVITE_CODE_LENGTH) return null;
	for (const char of code) {
		if (!INVITE_ALPHABET.includes(char)) return null;
	}
	return code;
}

export function normalizeSearchQuery(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const query = value.trim().replace(/\s+/g, ' ').toLowerCase();
	if (query.length < 2 || query.length > 40) return null;
	if (query.includes('@')) return null;
	if (/[\u0000-\u001f]/.test(query)) return null;
	return query;
}

export function createInviteCode(nextInt: (upper: number) => number): string {
	let code = '';
	for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
		const pick = nextInt(INVITE_ALPHABET.length);
		if (!Number.isInteger(pick) || pick < 0 || pick >= INVITE_ALPHABET.length) {
			throw new Error('Invite code generator returned an invalid index.');
		}
		code += INVITE_ALPHABET[pick];
	}
	return code;
}

export function rollingWindow(
	previous: unknown,
	nowMs: number,
	max: number,
	windowMs: number
): { allowed: boolean; stamps: number[] } {
	const recent = Array.isArray(previous)
		? previous.filter((value): value is number => typeof value === 'number' && nowMs - value < windowMs)
		: [];
	if (recent.length >= max) return { allowed: false, stamps: recent };
	return { allowed: true, stamps: [...recent, nowMs] };
}

/**
 * Keep the original name when this player does not already use it.
 * A collision becomes "<name> (from <buddy>)", then "… 2", "… 3".
 */
export function buddyCopyTeamName(original: string, buddyName: string, existingNames: string[]): string {
	const base = original.trim() || 'Untitled team';
	const taken = new Set(existingNames.map((name) => name.trim()).filter(Boolean));
	if (!taken.has(base)) return base;
	const buddy = publicDisplayName(buddyName) ?? 'a buddy';
	const stamped = `${base} (from ${buddy})`;
	if (!taken.has(stamped)) return stamped;
	for (let number = 2; number <= 99; number += 1) {
		const candidate = `${stamped} ${number}`;
		if (!taken.has(candidate)) return candidate;
	}
	return `${stamped} ${Date.now()}`;
}
