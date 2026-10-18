import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	CONSENT_REGION_CODES,
	EXTRA_CONSENT_TIME_ZONES,
	CONSENT_STORAGE_KEY,
	consentUpdatePayload,
	likelyConsentTimezone,
	likelyNeedsConsent,
	readStoredConsent,
	readViewerCountry,
	resolveAnalyticsStorage,
	shouldAutoShowConsentBanner,
	writeStoredConsent
} from './consent';

describe('consent regions', () => {
	it('lists the EEA, the UK, and Switzerland once each', () => {
		expect(new Set(CONSENT_REGION_CODES).size).toBe(CONSENT_REGION_CODES.length);
		expect(CONSENT_REGION_CODES).toHaveLength(32);
		for (const code of ['GB', 'CH', 'IS', 'NO', 'LI', 'DE', 'FR', 'CY']) {
			expect(CONSENT_REGION_CODES).toContain(code);
		}
		expect(CONSENT_REGION_CODES).not.toContain('US');
		expect(CONSENT_REGION_CODES).not.toContain('UK');
	});
});

describe('likely visitors', () => {
	it('treats Europe and the listed territories as likely, and a viewer country as decisive', () => {
		expect(likelyConsentTimezone('Europe/Berlin')).toBe(true);
		expect(likelyConsentTimezone('Europe/London')).toBe(true);
		expect(likelyConsentTimezone('Europe/Zurich')).toBe(true);
		expect(likelyConsentTimezone('Atlantic/Reykjavik')).toBe(true);
		expect(likelyConsentTimezone('Atlantic/Azores')).toBe(true);
		expect(likelyConsentTimezone('Asia/Nicosia')).toBe(true);
		expect(likelyConsentTimezone('America/New_York')).toBe(false);
		expect(likelyConsentTimezone('UTC')).toBe(false);
		expect(likelyNeedsConsent('America/New_York', 'DE')).toBe(true);
		expect(likelyNeedsConsent('Europe/Berlin', 'US')).toBe(false);
		expect(likelyNeedsConsent('Europe/Paris', null)).toBe(true);
		expect(likelyNeedsConsent('America/Chicago', null)).toBe(false);
	});
});

describe('stored choice and Global Privacy Control', () => {
	it('denies analytics for GPC unless the visitor accepted while GPC was on', () => {
		expect(resolveAnalyticsStorage({ stored: null, gpc: true })).toBe('denied');
		expect(resolveAnalyticsStorage({ stored: { choice: 'accepted', at: 't', gpc: false }, gpc: true })).toBe('denied');
		expect(resolveAnalyticsStorage({ stored: { choice: 'accepted', at: 't', gpc: true }, gpc: true })).toBe('granted');
		expect(resolveAnalyticsStorage({ stored: { choice: 'rejected', at: 't' }, gpc: false })).toBe('denied');
		expect(resolveAnalyticsStorage({ stored: { choice: 'accepted', at: 't' }, gpc: false })).toBe('granted');
		expect(resolveAnalyticsStorage({ stored: null, gpc: false })).toBe('default');
	});

	it('shows the banner only when a likely visitor has not chosen', () => {
		expect(shouldAutoShowConsentBanner({ stored: null, timeZone: 'Europe/Madrid', country: null })).toBe(true);
		expect(
			shouldAutoShowConsentBanner({
				stored: { choice: 'rejected', at: 't' },
				timeZone: 'Europe/Madrid',
				country: null
			})
		).toBe(false);
		expect(shouldAutoShowConsentBanner({ stored: null, timeZone: 'America/Los_Angeles', country: null })).toBe(false);
	});

	it('round-trips a choice and ignores junk', () => {
		const storage = new Map<string, string>();
		const memory = {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => {
				storage.set(key, value);
			}
		};
		writeStoredConsent(memory, 'accepted', true, '2026-10-18T00:00:00.000Z');
		expect(readStoredConsent(memory)).toEqual({ choice: 'accepted', at: '2026-10-18T00:00:00.000Z', gpc: true });
		storage.set(CONSENT_STORAGE_KEY, '{');
		expect(readStoredConsent(memory)).toBeNull();
		expect(consentUpdatePayload('rejected')).toEqual({
			analytics_storage: 'denied',
			ad_storage: 'denied',
			ad_user_data: 'denied',
			ad_personalization: 'denied'
		});
	});

	it('reads a viewer-country meta tag and nothing else', () => {
		const meta = { getAttribute: (name: string) => (name === 'content' ? ' de ' : null) };
		expect(readViewerCountry({ querySelector: () => meta })).toBe('DE');
		expect(readViewerCountry({ querySelector: () => null })).toBeNull();
		expect(readViewerCountry({ querySelector: () => ({ getAttribute: () => 'USA' }) })).toBeNull();
	});
});

describe('app.html Consent Mode', () => {
	const html = readFileSync(path.resolve(process.cwd(), 'src/app.html'), 'utf8');

	it('sets regional defaults before gtag.js and keeps advertising denied', () => {
		const match = html.match(/var consentRegions = (\[[\s\S]*?\]);/);
		expect(match).toBeTruthy();
		expect(JSON.parse(match?.[1] ?? '[]')).toEqual([...CONSENT_REGION_CODES]);
		const consentAt = html.indexOf("gtag('consent', 'default'");
		const srcAt = html.indexOf('https://www.googletagmanager.com/gtag/js?id=G-EKPMXMY097');
		expect(consentAt).toBeGreaterThan(-1);
		expect(srcAt).toBeGreaterThan(consentAt);
		expect(html).toContain('wait_for_update: 500');
		expect(html).toContain("analytics_storage: 'denied'");
		expect(html).toContain("analytics_storage: consentTimeZone ? 'denied' : 'granted'");
		const zones = html.match(/var consentTimeZones = (\[[\s\S]*?\]);/);
		expect(zones).toBeTruthy();
		expect(JSON.parse(zones?.[1] ?? '[]')).toEqual([...EXTRA_CONSENT_TIME_ZONES]);
		expect(html).toContain("viewerTimeZone.indexOf('Europe/') === 0");
		expect(html.match(/ad_storage: 'denied'/g)?.length).toBeGreaterThanOrEqual(3);
		expect(html.match(/ad_user_data: 'denied'/g)?.length).toBeGreaterThanOrEqual(3);
		expect(html.match(/ad_personalization: 'denied'/g)?.length).toBeGreaterThanOrEqual(3);
		expect(html).toContain('allow_google_signals: false');
		expect(html).toContain('allow_ad_personalization_signals: false');
		expect(html).toContain('navigator.globalPrivacyControl');
		expect(html).toContain(CONSENT_STORAGE_KEY);
		expect(html).toContain('G-EKPMXMY097');
	});
});
