import { writable } from 'svelte/store';

/**
 * ISO 3166-1 alpha-2 codes for the EEA, the UK, and Switzerland.
 * UK is GB. Consent Mode matches these against Google's region, not the timezone.
 */
export const CONSENT_REGION_CODES = [
	'AT',
	'BE',
	'BG',
	'CH',
	'CY',
	'CZ',
	'DE',
	'DK',
	'EE',
	'ES',
	'FI',
	'FR',
	'GB',
	'GR',
	'HR',
	'HU',
	'IE',
	'IS',
	'IT',
	'LI',
	'LT',
	'LU',
	'LV',
	'MT',
	'NL',
	'NO',
	'PL',
	'PT',
	'RO',
	'SE',
	'SI',
	'SK'
] as const;

/**
 * Timezones that are not under Europe/ but are still likely EEA, UK, or Switzerland:
 * Iceland, Portugal and Spain Atlantic islands, Ceuta, Svalbard, Cyprus, and EU
 * outermost regions. Europe/* is included separately and is intentionally broad.
 */
export const EXTRA_CONSENT_TIME_ZONES = [
	'Africa/Ceuta',
	'America/Cayenne',
	'America/Guadeloupe',
	'America/Marigot',
	'America/Martinique',
	'America/St_Barthelemy',
	'Arctic/Longyearbyen',
	'Asia/Famagusta',
	'Asia/Nicosia',
	'Atlantic/Azores',
	'Atlantic/Canary',
	'Atlantic/Madeira',
	'Atlantic/Reykjavik',
	'Indian/Mayotte',
	'Indian/Reunion'
] as const;

export const CONSENT_STORAGE_KEY = 'gaslands.analyticsConsent.v1';

export type ConsentChoice = 'accepted' | 'rejected';

export interface StoredConsent {
	choice: ConsentChoice;
	at: string;
	/** True when the visitor accepted while Global Privacy Control was on. */
	gpc?: boolean;
}

export type AnalyticsStorage = 'granted' | 'denied' | 'default';

const extraZones = new Set<string>(EXTRA_CONSENT_TIME_ZONES);
const regionCodes = new Set<string>(CONSENT_REGION_CODES);

/** Open the banner from the footer. Does not change a stored choice by itself. */
export const privacyBannerForced = writable(false);

export function openPrivacySettings(): void {
	privacyBannerForced.set(true);
}

export function likelyConsentTimezone(timeZone: string): boolean {
	if (timeZone.startsWith('Europe/')) return true;
	return extraZones.has(timeZone);
}

/**
 * A two-letter viewer country, when the page has one, wins over the timezone.
 * CloudFront does not currently forward CloudFront-Viewer-Country to the browser.
 * A `<meta name="viewer-country" content="DE">` tag is the hook if that changes.
 */
export function readViewerCountry(doc: {
	querySelector: (selector: string) => { getAttribute: (name: string) => string | null } | null;
}): string | null {
	const content = doc.querySelector('meta[name="viewer-country"]')?.getAttribute('content')?.trim().toUpperCase() ?? '';
	return /^[A-Z]{2}$/.test(content) ? content : null;
}

export function likelyNeedsConsent(timeZone: string, country: string | null): boolean {
	if (country && /^[A-Z]{2}$/.test(country)) return regionCodes.has(country);
	return likelyConsentTimezone(timeZone);
}

export function globalPrivacyControlEnabled(nav: { globalPrivacyControl?: boolean } | null | undefined): boolean {
	return nav?.globalPrivacyControl === true;
}

export function readStoredConsent(storage: { getItem: (key: string) => string | null } | null | undefined): StoredConsent | null {
	if (!storage) return null;
	try {
		const raw = storage.getItem(CONSENT_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<StoredConsent>;
		if (parsed.choice !== 'accepted' && parsed.choice !== 'rejected') return null;
		return {
			choice: parsed.choice,
			at: typeof parsed.at === 'string' ? parsed.at : '',
			gpc: parsed.gpc === true
		};
	} catch {
		return null;
	}
}

/**
 * GPC denies analytics unless this browser already has an explicit Accept made
 * while GPC was on. A stored choice otherwise wins. `default` leaves the
 * regional Consent Mode default in place.
 */
export function resolveAnalyticsStorage(input: { stored: StoredConsent | null; gpc: boolean }): AnalyticsStorage {
	if (input.gpc && !(input.stored?.choice === 'accepted' && input.stored.gpc === true)) return 'denied';
	if (input.stored?.choice === 'accepted') return 'granted';
	if (input.stored?.choice === 'rejected') return 'denied';
	return 'default';
}

export function shouldAutoShowConsentBanner(input: {
	stored: StoredConsent | null;
	timeZone: string;
	country: string | null;
}): boolean {
	if (input.stored) return false;
	return likelyNeedsConsent(input.timeZone, input.country);
}

export function consentUpdatePayload(choice: ConsentChoice): {
	analytics_storage: 'granted' | 'denied';
	ad_storage: 'denied';
	ad_user_data: 'denied';
	ad_personalization: 'denied';
} {
	return {
		analytics_storage: choice === 'accepted' ? 'granted' : 'denied',
		ad_storage: 'denied',
		ad_user_data: 'denied',
		ad_personalization: 'denied'
	};
}

export function writeStoredConsent(
	storage: { setItem: (key: string, value: string) => void },
	choice: ConsentChoice,
	gpc: boolean,
	nowIso: string
): StoredConsent {
	const stored: StoredConsent = { choice, at: nowIso, gpc };
	storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(stored));
	return stored;
}
