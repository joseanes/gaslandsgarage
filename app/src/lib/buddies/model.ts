/** Shared buddy identifiers and name rules. No Firebase imports. */

export const BUDDY_REQUESTS_PER_HOUR = 10;
export const BUDDY_SEARCHES_PER_HOUR = 30;
export const BUDDY_RATE_WINDOW_MS = 60 * 60 * 1000;
/** Gallery-sourced requests, on top of the hourly cap. One rolling day. */
export const BUDDY_GALLERY_REQUESTS_PER_DAY = 20;
export const BUDDY_GALLERY_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** After a decline, neither door (search, invite, or gallery) can ask again until this passes. */
export const BUDDY_DECLINE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
export const BUDDY_REQUEST_MESSAGE_MAX = 200;
export const BUDDY_EMAIL_INVITES_PER_DAY = 10;
export const BUDDY_EMAIL_INVITE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const BUDDY_EMAIL_RECIPIENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const BUDDY_EMAIL_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const BUDDY_NAME_MAX = 60;
/** Shown when the player has not saved a buddy name. Never a Google or Auth name. */
export const BUDDY_FALLBACK_NAME = 'A Gaslands Garage player';
export const INVITE_CODE_LENGTH = 10;
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const BUDDY_COLLECTIONS = {
	buddies: 'buddies',
	requests: 'buddyRequests',
	blocks: 'buddyBlocks',
	invites: 'buddyInvites',
	directory: 'buddyDirectory',
	rate: 'buddyRate',
	emailInvites: 'buddyEmailInvites',
	emailRate: 'buddyEmailRate',
	emailSuppress: 'buddyEmailSuppress',
	emailOptOuts: 'buddyEmailOptOuts'
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

/**
 * The name this player typed for buddies. A blank, an email, or anything
 * they did not choose here becomes the shared fallback.
 */
export function chosenBuddyName(...values: unknown[]): string {
	for (const value of values) {
		const name = publicDisplayName(value);
		if (name) return name;
	}
	return BUDDY_FALLBACK_NAME;
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

/**
 * Absent or any value other than false means the Gallery may offer a buddy request.
 * Players who have never saved the setting stay opted in.
 */
export function galleryBuddyRequestsAllowed(value: unknown): boolean {
	return value !== false;
}

/** Optional note on a gallery request. Blank is allowed. An address is not. */
export function buddyRequestMessage(value: unknown): string | null {
	if (value == null || value === '') return '';
	if (typeof value !== 'string') return null;
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return null;
	const text = value.trim().replace(/\s+/g, ' ');
	if (!text) return '';
	if (text.length > BUDDY_REQUEST_MESSAGE_MAX) return null;
	if (text.includes('@')) return null;
	return text;
}

const CAR_LABEL_MAX = 80;

function carLabelText(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const text = value.replace(/[\u0000-\u001f]/g, '').trim().replace(/\s+/g, ' ');
	if (!text || text.length > CAR_LABEL_MAX || text.includes('@')) return null;
	return text;
}

/** A car name safe to store on a buddy request. Never an address. */
export function publicCarLabel(input: { vehicleType?: unknown; caption?: unknown; vehicleStats?: unknown }): string {
	const stats =
		input.vehicleStats && typeof input.vehicleStats === 'object' && !Array.isArray(input.vehicleStats)
			? (input.vehicleStats as { name?: unknown })
			: null;
	for (const value of [stats?.name, input.caption, input.vehicleType]) {
		const label = carLabelText(value);
		if (label) return label;
	}
	return 'painted car';
}

export function declineCooldownActive(updatedAt: unknown, nowMs: number): boolean {
	if (typeof updatedAt !== 'string') return true;
	const updated = Date.parse(updatedAt);
	if (!Number.isFinite(updated)) return true;
	return nowMs - updated < BUDDY_DECLINE_COOLDOWN_MS;
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
