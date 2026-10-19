import { describe, expect, it } from 'vitest';
import {
	dismissJoinBanner,
	formForJoin,
	isJoinDismissed,
	joinDismissStorageKey,
	joinDraft,
	markerFromJoinedProfile,
	shouldShowJoinBanner,
	withJoinedMarker,
	type JoinDraft
} from './joinBanner';
import { emptyForm, type StoredProfile } from './profile';

function memory() {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => {
			data.set(key, value);
		}
	};
}

function stored(overrides: Partial<StoredProfile> = {}): StoredProfile {
	return {
		...emptyForm(),
		latE2: null,
		lngE2: null,
		mapEntryId: '',
		updatedAt: '2026-10-18T12:00:00.000Z',
		...overrides
	};
}

describe('shouldShowJoinBanner', () => {
	it('shows for a signed-in player who is not on the map', () => {
		expect(shouldShowJoinBanner({ signedIn: true, showOnMap: false, dismissed: false })).toBe(true);
	});

	it('hides for a signed-out visitor', () => {
		expect(shouldShowJoinBanner({ signedIn: false, showOnMap: false, dismissed: false })).toBe(false);
	});

	it('hides when the player is already on the map', () => {
		expect(shouldShowJoinBanner({ signedIn: true, showOnMap: true, dismissed: false })).toBe(false);
	});

	it('hides after the player dismisses it', () => {
		expect(shouldShowJoinBanner({ signedIn: true, showOnMap: false, dismissed: true })).toBe(false);
	});
});

describe('join banner dismissal', () => {
	it('remembers a dismissal for that account only', () => {
		const storage = memory();
		expect(isJoinDismissed(storage, 'ada')).toBe(false);
		dismissJoinBanner(storage, 'ada');
		expect(isJoinDismissed(storage, 'ada')).toBe(true);
		expect(isJoinDismissed(storage, 'bea')).toBe(false);
		expect(storage.getItem(joinDismissStorageKey('ada'))).toBe('1');
	});

	it('treats a missing or blocked store as not dismissed', () => {
		expect(isJoinDismissed(null, 'ada')).toBe(false);
		expect(isJoinDismissed({ getItem: () => { throw new Error('blocked'); } }, 'ada')).toBe(false);
		expect(() => dismissJoinBanner({ setItem: () => { throw new Error('blocked'); } }, 'ada')).not.toThrow();
	});
});

describe('joinDraft', () => {
	it('does not pre-check map consent, with or without a saved location', () => {
		const located = joinDraft(
			stored({ playerName: 'Ada', locationLabel: '78701', showOnMap: false, anonymousOnMap: true })
		);
		expect(located).toEqual({
			playerName: 'Ada',
			locationLabel: '78701',
			showOnMap: false,
			anonymousOnMap: false,
			hasLocation: true
		});
		const fresh = joinDraft(null);
		expect(fresh.showOnMap).toBe(false);
		expect(fresh.anonymousOnMap).toBe(false);
		expect(fresh.hasLocation).toBe(false);
	});
});

describe('formForJoin', () => {
	it('keeps bio, play spots, and open-to-games while applying the join choices', () => {
		const profile = stored({
			playerName: 'Old',
			bio: 'Rookie',
			playSpots: 'At home',
			openToGames: true,
			locationLabel: 'Austin, TX'
		});
		const draft: JoinDraft = {
			playerName: 'Ada',
			locationLabel: '78701',
			showOnMap: true,
			anonymousOnMap: true,
			hasLocation: true
		};
		expect(formForJoin(profile, draft)).toEqual({
			playerName: 'Ada',
			bio: 'Rookie',
			locationLabel: '78701',
			playSpots: 'At home',
			website: '',
			showOnMap: true,
			anonymousOnMap: true,
			openToGames: true
		});
	});

	it('drops anonymous when map consent is off', () => {
		const draft = joinDraft(null);
		draft.anonymousOnMap = true;
		const form = formForJoin(null, draft);
		expect(form.showOnMap).toBe(false);
		expect(form.anonymousOnMap).toBe(false);
		expect(form.openToGames).toBe(false);
	});
});

describe('markerFromJoinedProfile', () => {
	it('adds a named pin and replaces a pin with the same id', () => {
		const profile = stored({
			showOnMap: true,
			playerName: 'Ada',
			bio: 'Rookie',
			playSpots: 'At home',
			locationLabel: '78701',
			openToGames: true,
			latE2: 3011,
			lngE2: -9802,
			mapEntryId: 'abcABC0123456789wxyz'
		});
		const pin = markerFromJoinedProfile(profile);
		expect(pin).toMatchObject({ id: 'abcABC0123456789wxyz', anonymous: false, playerName: 'Ada', lat: 30.11, lng: -98.02 });
		const next = withJoinedMarker(
			[{ ...pin!, playerName: 'Old' }, { ...pin!, id: 'other', playerName: 'Bea' }],
			profile
		);
		expect(next.map((marker) => marker.playerName)).toEqual(['Bea', 'Ada']);
	});

	it('publishes an anonymous pin with no name', () => {
		const pin = markerFromJoinedProfile(
			stored({
				showOnMap: true,
				anonymousOnMap: true,
				playerName: 'Ada',
				bio: 'Secret',
				latE2: 3011,
				lngE2: -9802,
				mapEntryId: 'abcABC0123456789wxyz'
			})
		);
		expect(pin?.anonymous).toBe(true);
		expect(pin?.playerName).toBe('');
		expect(JSON.stringify(pin)).not.toContain('Ada');
	});

	it('does not invent a pin when the player is not on the map', () => {
		expect(markerFromJoinedProfile(stored({ showOnMap: false, latE2: 1, lngE2: 2, mapEntryId: 'abc' }))).toBeNull();
		expect(withJoinedMarker([], stored())).toEqual([]);
	});
});
