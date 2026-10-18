import { describe, expect, it } from 'vitest';
import { profileVisibility, projectPlayerProfile, projectUserSettings } from './accountSettings';

describe('projectUserSettings', () => {
	it('keeps consent and map choices and drops other stored preferences', () => {
		const view = projectUserSettings({
			newsletterOptIn: true,
			newsletterOptInAt: '2026-10-01T15:04:00.000Z',
			newsletterConsentText: 'monthly-email-v1',
			receiveUpdates: true,
			receiveUpdatesChangedAt: '2026-09-01T12:00:00.000Z',
			allowContactFromPlayers: true,
			showOnPlayersMap: false,
			location: 'Austin, TX',
			printStyle: 'dashboard',
			darkMode: true,
			email: 'person@example.com',
			analyticsConsent: { choice: 'accepted', at: '2026-10-02T00:00:00.000Z', gpc: true },
			smsOptIn: false
		});

		expect(view.newsletterOptIn).toBe(true);
		expect(view.newsletterOptInAt).toBe('2026-10-01T15:04:00.000Z');
		expect(view.newsletterConsentText).toBe('monthly-email-v1');
		expect(view.allowContactFromPlayers).toBe(true);
		expect(view.location).toBe('Austin, TX');
		expect(view.analytics).toEqual({
			stored: true,
			choice: 'accepted',
			at: '2026-10-02T00:00:00.000Z',
			gpc: true
		});
		expect(view.ads).toEqual({ stored: false });
		expect(view.sms).toEqual({ collected: true, optIn: false, at: null });

		const serialized = JSON.stringify(view);
		expect(serialized).not.toContain('dashboard');
		expect(serialized).not.toContain('person@example.com');
		expect(serialized).not.toContain('darkMode');
		expect(serialized).not.toContain('receiveUpdates');
		expect(serialized).not.toContain('2026-09-01');
	});

	it('treats a missing document as unanswered and not stored', () => {
		const view = projectUserSettings(undefined);
		expect(view.newsletterOptIn).toBeNull();
		expect(view).not.toHaveProperty('receiveUpdates');
		expect(view.analytics).toEqual({ stored: false });
		expect(view.ads).toEqual({ stored: false });
		expect(view.gpc).toBeNull();
		expect(view.sms).toEqual({ collected: false });
	});

	it('reads an SMS object and a top-level privacy signal when those fields exist', () => {
		const view = projectUserSettings({
			smsConsent: { optIn: true, at: '2026-10-03T00:00:00.000Z' },
			gpc: true
		});
		expect(view.sms).toEqual({ collected: true, optIn: true, at: '2026-10-03T00:00:00.000Z' });
		expect(view.gpc).toBe(true);
	});
});

describe('projectPlayerProfile', () => {
	it('keeps city and visibility and drops the coordinate and pin id', () => {
		const view = projectPlayerProfile({
			playerName: 'Ada',
			locationLabel: 'Austin, TX',
			showOnMap: true,
			anonymousOnMap: false,
			openToGames: true,
			latE2: 3011,
			lngE2: -9802,
			mapEntryId: 'aaaaaaaaaaaaaaaaaaaa',
			bio: 'secret bio',
			email: 'person@example.com'
		});
		expect(view).toEqual({
			city: 'Austin, TX',
			showOnMap: true,
			anonymousOnMap: false,
			openToGames: true,
			playerName: 'Ada'
		});
		expect(profileVisibility(view!)).toBe('On the map as Ada');
		expect(JSON.stringify(view)).not.toContain('3011');
		expect(JSON.stringify(view)).not.toContain('person@example.com');
		expect(JSON.stringify(view)).not.toContain('secret bio');
	});

	it('describes a hidden or anonymous pin', () => {
		expect(
			profileVisibility({ city: '', showOnMap: false, anonymousOnMap: false, openToGames: false, playerName: '' })
		).toBe('Hidden');
		expect(
			profileVisibility({ city: 'Austin, TX', showOnMap: true, anonymousOnMap: true, openToGames: false, playerName: 'Ada' })
		).toBe('On the map, anonymous');
	});
});
