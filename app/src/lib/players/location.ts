// Privacy-first location text. A profile may store a city/region or a US ZIP.
// Street addresses and full postcodes are rejected before anything is geocoded.

const ZIP = /^(\d{5})(?:-\d{4})?$/;
const PLACE = /^[\p{L}\p{M}][\p{L}\p{M}\s.,''’-]*$/u;
const STREET =
	/\b(street|avenue|boulevard|lane|drive|court|place|terrace|highway|parkway|trail|circle|road|alley|square)\b|(?:[\p{L}.'’-]+\s+)(st|ave|blvd|ln|dr|ct|pl|rd|hwy|pkwy)\b\.?/iu;
const UNIT = /\b(apt|apartment|unit|suite|ste|floor|bldg|building)\b|#/i;

export type LocationAssessment =
	| { ok: true; kind: 'empty'; label: '' }
	| { ok: true; kind: 'zip' | 'place'; label: string }
	| { ok: false; error: string };

export function assessLocation(raw: string): LocationAssessment {
	const text = raw.trim().replace(/\s+/g, ' ');
	if (!text) return { ok: true, kind: 'empty', label: '' };
	if (text.length > 80) {
		return { ok: false, error: 'Keep the location to a city, region, or ZIP (80 characters or fewer).' };
	}
	if (/^at home$/i.test(text)) {
		return {
			ok: false,
			error: 'Put “at home” under where you like to play. Location should be a city, region, or ZIP.'
		};
	}

	const zip = ZIP.exec(text);
	if (zip) return { ok: true, kind: 'zip', label: zip[1] };

	if (/\d/.test(text)) {
		return {
			ok: false,
			error: 'Use a city and region, or a 5-digit US ZIP. Street addresses and full postcodes are too precise.'
		};
	}
	if (UNIT.test(text) || STREET.test(text)) {
		return {
			ok: false,
			error: 'Leave out the street address. A city and region, or a 5-digit US ZIP, is enough.'
		};
	}
	if (!PLACE.test(text)) {
		return { ok: false, error: 'Use a city and region, or a 5-digit US ZIP.' };
	}
	return { ok: true, kind: 'place', label: text };
}

const MIN_OFFSET_KM = 2;
const MAX_OFFSET_KM = 8;

/**
 * Moves a point 2–8 km in a random direction and snaps it to 0.01 degrees
 * (about 1 km). Only the snapped point is returned, so the input coordinate
 * cannot be recovered from the result.
 */
export function approximateCoordinate(
	lat: number,
	lng: number,
	random: () => number = Math.random
): { latE2: number; lngE2: number } {
	const distanceKm = MIN_OFFSET_KM + random() * (MAX_OFFSET_KM - MIN_OFFSET_KM);
	const angle = random() * Math.PI * 2;
	const deltaLat = (distanceKm * Math.cos(angle)) / 111.32;
	const cosLat = Math.cos((lat * Math.PI) / 180);
	const lngScale = 111.32 * Math.max(0.2, Math.abs(cosLat));
	const deltaLng = (distanceKm * Math.sin(angle)) / lngScale;
	let nextLat = Math.max(-90, Math.min(90, lat + deltaLat));
	let nextLng = lng + deltaLng;
	if (nextLng > 180) nextLng -= 360;
	if (nextLng < -180) nextLng += 360;
	return {
		latE2: Math.round(nextLat * 100),
		lngE2: Math.round(nextLng * 100)
	};
}

export function hundredthsToDegrees(latE2: number, lngE2: number): { lat: number; lng: number } {
	return { lat: latE2 / 100, lng: lngE2 / 100 };
}
