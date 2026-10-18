import { describe, expect, it } from 'vitest';
import {
	NEWSLETTER_CONSENT_COPY,
	NEWSLETTER_CONSENT_VERSION,
	preserveStoredReceiveUpdates,
	stampNewsletterConsent,
	type MarketingConsentFields,
	type NewsletterConsentFields
} from './marketingConsent';

const now = '2026-10-18T12:00:00.000Z';

/** Same order as saveUserSettings: stamp the monthly choice, then put the retired fields back. */
function saved(
	previous: (NewsletterConsentFields & MarketingConsentFields) | null,
	next: Record<string, unknown>
) {
	return preserveStoredReceiveUpdates(previous, stampNewsletterConsent(previous, next, now));
}

describe('retired Keep me up to date field', () => {
	it('drops a new choice and does not opt that person into the monthly email', () => {
		expect(saved(null, { receiveUpdates: true, darkMode: true })).toEqual({ darkMode: true });
		expect(saved(null, { receiveUpdates: false })).toEqual({});
		const opted = saved(null, { receiveUpdates: true, newsletterOptIn: true });
		expect(opted.receiveUpdates).toBeUndefined();
		expect(opted.newsletterOptIn).toBe(true);
	});

	it('keeps a stored value when a later save omits it or tries to change it', () => {
		const previous = {
			receiveUpdates: true,
			receiveUpdatesChangedAt: '2026-01-01T00:00:00.000Z',
			darkMode: true
		};
		expect(saved(previous, { darkMode: false, receiveUpdates: false })).toEqual({
			darkMode: false,
			receiveUpdates: true,
			receiveUpdatesChangedAt: '2026-01-01T00:00:00.000Z'
		});
		expect(saved(previous, { receiveUpdates: false, receiveUpdatesChangedAt: now })).toEqual({
			receiveUpdates: true,
			receiveUpdatesChangedAt: '2026-01-01T00:00:00.000Z'
		});
		expect(saved({ receiveUpdates: false }, { newsletterOptIn: false })).toMatchObject({
			receiveUpdates: false,
			newsletterOptIn: false
		});
	});

	it('does not turn the monthly email on for someone who only had the old box checked', () => {
		const onlyOldBox = saved(
			{ receiveUpdates: true, receiveUpdatesChangedAt: '2026-01-01T00:00:00.000Z' },
			{ darkMode: false }
		);
		expect(onlyOldBox.newsletterOptIn).toBeUndefined();
		expect(onlyOldBox.receiveUpdates).toBe(true);
		expect(onlyOldBox.receiveUpdatesChangedAt).toBe('2026-01-01T00:00:00.000Z');
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
		expect(stampNewsletterConsent(null, { newsletterOptIn: true, newsletterSource: 'profile' }, now)).toEqual({
			newsletterOptIn: true,
			newsletterOptInAt: now,
			newsletterConsentText: NEWSLETTER_CONSENT_VERSION,
			newsletterSource: 'profile'
		});
		expect(
			stampNewsletterConsent(
				{
					newsletterOptIn: true,
					newsletterOptInAt: '2026-10-01T00:00:00.000Z',
					newsletterConsentText: NEWSLETTER_CONSENT_VERSION,
					newsletterSource: 'profile'
				},
				{ darkMode: true },
				now
			)
		).toEqual({
			darkMode: true,
			newsletterOptIn: true,
			newsletterOptInAt: '2026-10-01T00:00:00.000Z',
			newsletterConsentText: NEWSLETTER_CONSENT_VERSION,
			newsletterSource: 'profile'
		});
		expect(
			stampNewsletterConsent(
				{
					newsletterOptIn: true,
					newsletterOptInAt: '2026-10-01T00:00:00.000Z',
					newsletterConsentText: NEWSLETTER_CONSENT_VERSION,
					newsletterSource: 'profile'
				},
				{ newsletterOptIn: false },
				now
			)
		).toEqual({
			newsletterOptIn: false,
			newsletterOptInAt: '2026-10-01T00:00:00.000Z',
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
