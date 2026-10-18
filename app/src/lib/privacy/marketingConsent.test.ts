import { describe, expect, it } from 'vitest';
import {
	NEWSLETTER_CONSENT_COPY,
	NEWSLETTER_CONSENT_VERSION,
	stampNewsletterConsent,
	stampReceiveUpdatesConsent
} from './marketingConsent';

const now = '2026-10-18T12:00:00.000Z';

describe('receiveUpdates consent timestamp', () => {
	it('stamps a change on or off and leaves an unchanged choice alone', () => {
		expect(stampReceiveUpdatesConsent(null, { receiveUpdates: false, darkMode: true }, now)).toEqual({
			receiveUpdates: false,
			darkMode: true
		});
		expect(stampReceiveUpdatesConsent(null, { receiveUpdates: true }, now)).toEqual({
			receiveUpdates: true,
			receiveUpdatesChangedAt: now
		});
		expect(stampReceiveUpdatesConsent({ receiveUpdates: false }, { receiveUpdates: true, darkMode: false }, now)).toEqual({
			receiveUpdates: true,
			darkMode: false,
			receiveUpdatesChangedAt: now
		});
		expect(
			stampReceiveUpdatesConsent(
				{ receiveUpdates: true, receiveUpdatesChangedAt: '2026-01-01T00:00:00.000Z' },
				{ receiveUpdates: false },
				now
			)
		).toEqual({ receiveUpdates: false, receiveUpdatesChangedAt: now });
		expect(
			stampReceiveUpdatesConsent(
				{ receiveUpdates: true, receiveUpdatesChangedAt: '2026-01-01T00:00:00.000Z' },
				{ receiveUpdates: true, receiveUpdatesChangedAt: '2099-01-01T00:00:00.000Z' },
				now
			)
		).toEqual({ receiveUpdates: true, receiveUpdatesChangedAt: '2026-01-01T00:00:00.000Z' });
	});

	it('drops a caller-supplied timestamp when the choice never changed', () => {
		expect(
			stampReceiveUpdatesConsent({ receiveUpdates: false }, { receiveUpdates: false, receiveUpdatesChangedAt: now }, now)
		).toEqual({ receiveUpdates: false });
	});
});

describe('monthly email consent', () => {
	it('uses the unchecked opt-in sentence and a fixed version', () => {
		expect(NEWSLETTER_CONSENT_COPY).toBe(
			'Send me the monthly Gaslands Garage email: game tips, car suggestions, and new site features. About once a month. Unsubscribe anytime.'
		);
		expect(NEWSLETTER_CONSENT_VERSION).toBe('monthly-email-v1');
	});

	it('leaves an unanswered save unanswered and keeps a previous choice', () => {
		const firstSave = { darkMode: true };
		expect(stampNewsletterConsent(null, firstSave, now)).toEqual({ darkMode: true });
		const unchanged = { darkMode: false, newsletterOptInAt: '2099-01-01T00:00:00.000Z' };
		expect(
			stampNewsletterConsent(
				{
					newsletterOptIn: true,
					newsletterOptInAt: '2026-10-01T00:00:00.000Z',
					newsletterConsentText: NEWSLETTER_CONSENT_VERSION,
					newsletterPromptDismissedAt: '2026-09-01T00:00:00.000Z'
				},
				unchanged,
				now
			)
		).toEqual({
			darkMode: false,
			newsletterOptIn: true,
			newsletterOptInAt: '2026-10-01T00:00:00.000Z',
			newsletterConsentText: NEWSLETTER_CONSENT_VERSION,
			newsletterPromptDismissedAt: '2026-09-01T00:00:00.000Z'
		});
	});

	it('stamps opt-in and opt-out without moving an unchanged timestamp', () => {
		expect(stampNewsletterConsent(null, { newsletterOptIn: true, darkMode: true }, now)).toEqual({
			darkMode: true,
			newsletterOptIn: true,
			newsletterOptInAt: now,
			newsletterConsentText: NEWSLETTER_CONSENT_VERSION
		});
		expect(
			stampNewsletterConsent(
				{ newsletterOptIn: true, newsletterOptInAt: '2026-10-01T00:00:00.000Z', newsletterConsentText: NEWSLETTER_CONSENT_VERSION },
				{ newsletterOptIn: true, newsletterOptInAt: '2099-01-01T00:00:00.000Z' },
				now
			)
		).toEqual({
			newsletterOptIn: true,
			newsletterOptInAt: '2026-10-01T00:00:00.000Z',
			newsletterConsentText: NEWSLETTER_CONSENT_VERSION
		});
		expect(
			stampNewsletterConsent(
				{ newsletterOptIn: true, newsletterOptInAt: '2026-10-01T00:00:00.000Z', newsletterConsentText: NEWSLETTER_CONSENT_VERSION },
				{ newsletterOptIn: false },
				now
			)
		).toEqual({
			newsletterOptIn: false,
			newsletterOptInAt: '2026-10-01T00:00:00.000Z',
			newsletterOptOutAt: now,
			newsletterConsentText: NEWSLETTER_CONSENT_VERSION
		});
		expect(stampNewsletterConsent(null, { newsletterOptIn: false }, now)).toEqual({
			newsletterOptIn: false,
			newsletterOptOutAt: now,
			newsletterConsentText: NEWSLETTER_CONSENT_VERSION
		});
		expect(
			stampNewsletterConsent(
				{ newsletterOptIn: false, newsletterOptOutAt: '2026-10-01T00:00:00.000Z', newsletterConsentText: NEWSLETTER_CONSENT_VERSION },
				{ newsletterOptIn: false, newsletterOptOutAt: now },
				now
			)
		).toEqual({
			newsletterOptIn: false,
			newsletterOptOutAt: '2026-10-01T00:00:00.000Z',
			newsletterConsentText: NEWSLETTER_CONSENT_VERSION
		});
	});
});
