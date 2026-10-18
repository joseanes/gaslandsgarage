import { describe, expect, it } from 'vitest';
import {
	contactDocId,
	emptyForm,
	planPresence,
	presentMapMarker,
	validateContact,
	type StoredProfile
} from './profile';

const now = '2026-10-18T12:00:00.000Z';
const entryId = 'abcABC0123456789wxyz';

function previous(overrides: Partial<StoredProfile> = {}): StoredProfile {
	return {
		...emptyForm(),
		latE2: null,
		lngE2: null,
		mapEntryId: '',
		updatedAt: now,
		...overrides
	};
}

describe('planPresence', () => {
	it('keeps a private profile with both opt-ins off', () => {
		const planned = planPresence({
			uid: 'player',
			form: { ...emptyForm(), playerName: 'Ada', bio: 'Rookie', playSpots: 'At home' },
			previous: null,
			coords: { locationLabel: '', latE2: null, lngE2: null },
			now,
			createId: () => entryId
		});
		expect(planned.ok).toBe(true);
		if (!planned.ok) return;
		expect(planned.plan.map).toBeNull();
		expect(planned.plan.openToGames).toBeNull();
		expect(planned.plan.profile.showOnMap).toBe(false);
		expect(planned.plan.profile.openToGames).toBe(false);
		expect(planned.plan.profile).not.toHaveProperty('email');
	});

	it('publishes an anonymous pin with no name or id link', () => {
		const planned = planPresence({
			uid: 'player',
			form: {
				...emptyForm(),
				playerName: 'Ada',
				bio: 'Secret bio',
				playSpots: 'Guild hall',
				locationLabel: '78701',
				showOnMap: true,
				anonymousOnMap: true
			},
			previous: null,
			coords: { locationLabel: '78701', latE2: 3011, lngE2: -9802 },
			now,
			createId: () => entryId
		});
		expect(planned.ok).toBe(true);
		if (!planned.ok) return;
		expect(planned.plan.map).toEqual({
			entryId,
			entry: { anonymous: true, latE2: 3011, lngE2: -9802, updatedAt: now }
		});
		expect(planned.plan.map?.entryId).not.toBe('player');
		expect(JSON.stringify(planned.plan.map?.entry)).not.toContain('Ada');
		expect(JSON.stringify(planned.plan.map?.entry)).not.toContain('player');
	});

	it('publishes only the chosen public fields for a named pin', () => {
		const planned = planPresence({
			uid: 'player',
			form: {
				...emptyForm(),
				playerName: 'Ada',
				bio: 'Loves rust',
				playSpots: 'At home',
				locationLabel: 'Austin, TX',
				showOnMap: true,
				openToGames: true
			},
			previous: previous({ mapEntryId: entryId }),
			coords: { locationLabel: 'Austin, TX', latE2: 3019, lngE2: -9766 },
			now
		});
		expect(planned.ok).toBe(true);
		if (!planned.ok) return;
		expect(planned.plan.map?.entryId).toBe(entryId);
		expect(planned.plan.map?.entry).toEqual({
			anonymous: false,
			playerName: 'Ada',
			bio: 'Loves rust',
			playSpots: 'At home',
			locationLabel: 'Austin, TX',
			openToGames: true,
			latE2: 3019,
			lngE2: -9766,
			updatedAt: now
		});
		expect(planned.plan.openToGames).toEqual({
			playerName: 'Ada',
			bio: 'Loves rust',
			playSpots: 'At home',
			updatedAt: now
		});
		expect(planned.plan.openToGames).not.toHaveProperty('latE2');
		expect(planned.plan.openToGames).not.toHaveProperty('locationLabel');
		expect(planned.plan.openToGames).not.toHaveProperty('email');
	});

	it('refuses a named pin or contact opt-in without a player name', () => {
		const named = planPresence({
			uid: 'player',
			form: { ...emptyForm(), showOnMap: true, locationLabel: 'Austin, TX' },
			previous: null,
			coords: { locationLabel: 'Austin, TX', latE2: 1, lngE2: 2 },
			now
		});
		expect(named).toEqual({
			ok: false,
			error: 'Add a player name, or choose to appear on the map as anonymous.'
		});
		const contact = planPresence({
			uid: 'player',
			form: { ...emptyForm(), openToGames: true },
			previous: null,
			coords: { locationLabel: '', latE2: null, lngE2: null },
			now
		});
		expect(contact.ok).toBe(false);
	});

	it('removes a public pin and contact card when the player opts out', () => {
		const planned = planPresence({
			uid: 'player',
			form: emptyForm(),
			previous: previous({
				showOnMap: true,
				anonymousOnMap: true,
				openToGames: true,
				mapEntryId: entryId,
				playerName: 'Ada',
				latE2: 1,
				lngE2: 2,
				locationLabel: 'Austin, TX'
			}),
			coords: { locationLabel: 'Austin, TX', latE2: 1, lngE2: 2 },
			now
		});
		expect(planned.ok).toBe(true);
		if (!planned.ok) return;
		expect(planned.plan.map).toBeNull();
		expect(planned.plan.removeMapEntryId).toBe(entryId);
		expect(planned.plan.removeOpenToGames).toBe(true);
		expect(planned.plan.profile.anonymousOnMap).toBe(false);
	});

	it('rejects an email address in profile text', () => {
		const planned = planPresence({
			uid: 'player',
			form: { ...emptyForm(), playerName: 'ada@example.com' },
			previous: null,
			coords: { locationLabel: '', latE2: null, lngE2: null },
			now
		});
		expect(planned.ok).toBe(false);
	});
});

describe('presentMapMarker', () => {
	it('drops identifying fields on an anonymous pin even if they were stored', () => {
		expect(
			presentMapMarker('pin', {
				anonymous: true,
				latE2: 3011,
				lngE2: -9802,
				playerName: 'Ada',
				uid: 'player',
				email: 'ada@example.com'
			})
		).toEqual({
			id: 'pin',
			anonymous: true,
			lat: 30.11,
			lng: -98.02,
			playerName: '',
			bio: '',
			playSpots: '',
			locationLabel: '',
			openToGames: false
		});
	});

	it('ignores a pin that is more precise than hundredths of a degree', () => {
		expect(presentMapMarker('pin', { anonymous: true, latE2: 30.11, lngE2: -98 })).toBeNull();
	});
});

describe('contact', () => {
	it('addresses a request by ids and requires a chosen name', () => {
		expect(contactDocId('from', 'to')).toBe('from_to');
		expect(validateContact({ fromName: '', message: 'Game Friday?' })).toMatch(/player name/i);
		expect(validateContact({ fromName: 'ada@example.com', message: 'Game Friday?' })).toMatch(/email/i);
		expect(validateContact({ fromName: 'Ada', message: 'Game Friday?' })).toBeNull();
	});
});
