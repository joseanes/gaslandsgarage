import { describe, expect, it } from 'vitest';
import {
	BUDDY_REQUESTS_PER_HOUR,
	INVITE_ALPHABET,
	buddyBlockId,
	BUDDY_FALLBACK_NAME,
	buddyCopyTeamName,
	chosenBuddyName,
	buddyPairId,
	buddyRequestId,
	createInviteCode,
	normalizeInviteCode,
	normalizeSearchQuery,
	buddyRequestMessage,
	declineCooldownActive,
	galleryBuddyRequestsAllowed,
	publicCarLabel,
	publicDisplayName,
	rollingWindow,
	BUDDY_DECLINE_COOLDOWN_MS,
	BUDDY_GALLERY_REQUESTS_PER_DAY,
	BUDDY_GALLERY_RATE_WINDOW_MS
} from './model';

describe('buddy ids', () => {
	it('uses one pair id for both directions and keeps request direction', () => {
		expect(buddyPairId('userB', 'userA')).toBe('userA~userB');
		expect(buddyPairId('userA', 'userB')).toBe('userA~userB');
		expect(buddyRequestId('userA', 'userB')).toBe('userA~userB');
		expect(buddyRequestId('userB', 'userA')).toBe('userB~userA');
		expect(buddyBlockId('userA', 'userB')).toBe('userA~userB');
		expect(() => buddyPairId('userA', 'userA')).toThrow(/two different/);
		expect(() => buddyPairId('has~tilde', 'userA')).toThrow(/two different/);
	});
});

describe('public names and search', () => {
	it('uses only a name the player chose', () => {
		expect(chosenBuddyName('Ada', 'google@example.com')).toBe('Ada');
		expect(chosenBuddyName('ada@example.com', '   ', undefined)).toBe(BUDDY_FALLBACK_NAME);
		expect(chosenBuddyName()).toBe('A Gaslands Garage player');
		expect(BUDDY_FALLBACK_NAME.includes('@')).toBe(false);
	});

	it('rejects email addresses and blank names', () => {
		expect(publicDisplayName('  Ada  Lovelace ')).toBe('Ada Lovelace');
		expect(publicDisplayName('ada@example.com')).toBeNull();
		expect(publicDisplayName('Player @ home')).toBeNull();
		expect(publicDisplayName('   ')).toBeNull();
		expect(publicDisplayName('x'.repeat(61))).toBeNull();
	});

	it('normalizes invite codes and refuses short or email-like searches', () => {
		expect(normalizeInviteCode(' abcd234567 ')).toBe('ABCD234567');
		expect(normalizeInviteCode('ABCD23456O')).toBeNull();
		expect(normalizeSearchQuery('  Ada ')).toBe('ada');
		expect(normalizeSearchQuery('a')).toBeNull();
		expect(normalizeSearchQuery('ada@example.com')).toBeNull();
	});

	it('builds an invite code from the unambiguous alphabet', () => {
		const code = createInviteCode((upper) => upper - 1);
		expect(code).toHaveLength(10);
		expect(code).toBe(INVITE_ALPHABET.at(-1)!.repeat(10));
		expect(INVITE_ALPHABET).not.toMatch(/[01IO]/);
	});
});

describe('buddy copy names', () => {
	it('adds the buddy name only when the player already has that team name', () => {
		expect(buddyCopyTeamName('Racers', 'Ada', [])).toBe('Racers');
		expect(buddyCopyTeamName('Racers', 'Ada', ['Haulers'])).toBe('Racers');
		expect(buddyCopyTeamName('Racers', 'Ada', ['Racers'])).toBe('Racers (from Ada)');
		expect(buddyCopyTeamName('Racers', 'Ada', ['Racers', 'Racers (from Ada)'])).toBe('Racers (from Ada) 2');
		expect(buddyCopyTeamName('Racers', 'ada@example.com', ['Racers'])).toBe('Racers (from a buddy)');
		expect(buddyCopyTeamName('  ', 'Ada', [])).toBe('Untitled team');
	});
});

describe('gallery buddy requests', () => {
	it('keeps the gallery open unless the player turned it off', () => {
		expect(galleryBuddyRequestsAllowed(undefined)).toBe(true);
		expect(galleryBuddyRequestsAllowed(true)).toBe(true);
		expect(galleryBuddyRequestsAllowed(false)).toBe(false);
	});

	it('keeps a short note and drops anything that could be an address', () => {
		expect(buddyRequestMessage(undefined)).toBe('');
		expect(buddyRequestMessage('  Nice paint  ')).toBe('Nice paint');
		expect(buddyRequestMessage('a'.repeat(200))).toHaveLength(200);
		expect(buddyRequestMessage('a'.repeat(201))).toBeNull();
		expect(buddyRequestMessage('see me@example.com')).toBeNull();
		expect(buddyRequestMessage('line\nbreak')).toBe('line break');
		expect(buddyRequestMessage('bad\u0000note')).toBeNull();
	});

	it('names the painted car without copying an address', () => {
		expect(publicCarLabel({ vehicleStats: { name: 'Rust Rocket' }, caption: 'Red', vehicleType: 'Car' })).toBe('Rust Rocket');
		expect(publicCarLabel({ caption: 'Red door', vehicleType: 'Car' })).toBe('Red door');
		expect(publicCarLabel({ vehicleStats: { name: 'ada@example.com' }, vehicleType: 'Car' })).toBe('Car');
		expect(publicCarLabel({})).toBe('painted car');
	});

	it('holds a declined request for 30 days', () => {
		const now = Date.parse('2026-10-18T12:00:00.000Z');
		expect(declineCooldownActive(new Date(now).toISOString(), now + BUDDY_DECLINE_COOLDOWN_MS - 1)).toBe(true);
		expect(declineCooldownActive(new Date(now).toISOString(), now + BUDDY_DECLINE_COOLDOWN_MS)).toBe(false);
		expect(declineCooldownActive('not-a-date', now)).toBe(true);
		expect(BUDDY_GALLERY_REQUESTS_PER_DAY).toBe(20);
		expect(BUDDY_GALLERY_RATE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
	});
});

describe('request rate window', () => {
	it('allows a limited number of stamps per hour', () => {
		const now = Date.parse('2026-10-18T12:00:00.000Z');
		const first = rollingWindow([], now, BUDDY_REQUESTS_PER_HOUR, 60 * 60 * 1000);
		expect(first.allowed).toBe(true);
		const full = rollingWindow(
			Array.from({ length: BUDDY_REQUESTS_PER_HOUR }, (_, index) => now - index),
			now,
			BUDDY_REQUESTS_PER_HOUR,
			60 * 60 * 1000
		);
		expect(full.allowed).toBe(false);
		expect(full.stamps).toHaveLength(BUDDY_REQUESTS_PER_HOUR);
		const later = rollingWindow(full.stamps, now + 60 * 60 * 1000, BUDDY_REQUESTS_PER_HOUR, 60 * 60 * 1000);
		expect(later.allowed).toBe(true);
		expect(later.stamps).toEqual([now + 60 * 60 * 1000]);
	});
});
