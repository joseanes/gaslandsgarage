/**
 * Link from the Players and Events menu to Wargaming Events, filtered to Gaslands.
 *
 * Only coarse location leaves Gaslands Garage: the saved map pin (already shifted
 * and rounded) rounded again to one decimal, about 11 km, and the city or ZIP label
 * the player typed. No email, uid, or exact position is ever added.
 */
import type { StoredProfile } from './profile';

export const WARGAMING_EVENTS_ORIGIN = 'https://wargamingevents.com';
export const WARGAMING_EVENTS_SYSTEM = 'gaslands';
export const WARGAMING_EVENTS_RADIUS_MILES = 100;
const NEAR_MAX = 80;

function oneDecimal(value: number): string {
	return (Math.round(value * 10) / 10).toFixed(1);
}

/** City, region, or ZIP text. Rejects anything that could carry an email or markup. */
export function coarseNear(label: unknown): string | null {
	if (typeof label !== 'string') return null;
	const text = label.trim().replace(/\s+/g, ' ');
	if (!text || text.length > NEAR_MAX) return null;
	if (!/^[\p{L}\p{N} .,'()-]+$/u.test(text)) return null;
	return text;
}

type SavedLocation = Pick<StoredProfile, 'latE2' | 'lngE2' | 'locationLabel'>;

export function wargamingEventsUrl(profile: SavedLocation | null | undefined): string {
	const params = new URLSearchParams({ system: WARGAMING_EVENTS_SYSTEM });
	const latE2 = profile?.latE2;
	const lngE2 = profile?.lngE2;
	if (
		typeof latE2 === 'number' && Number.isFinite(latE2) && Math.abs(latE2) <= 9000 &&
		typeof lngE2 === 'number' && Number.isFinite(lngE2) && Math.abs(lngE2) <= 18000
	) {
		params.set('lat', oneDecimal(latE2 / 100));
		params.set('lng', oneDecimal(lngE2 / 100));
		params.set('radius', String(WARGAMING_EVENTS_RADIUS_MILES));
		const near = coarseNear(profile?.locationLabel);
		if (near) params.set('near', near);
	}
	params.set('utm_source', 'gaslandsgarage');
	return `${WARGAMING_EVENTS_ORIGIN}/?${params.toString()}`;
}
