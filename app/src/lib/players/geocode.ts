import { assessLocation, approximateCoordinate } from './location';
import { lookupZip } from './zipCentroids';

export const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

const TOO_PRECISE = new Set([
	'house',
	'building',
	'residential',
	'address',
	'farm',
	'isolated_dwelling',
	'allotments'
]);

export type PlaceHit = { lat: number; lng: number };

/**
 * Reads one Nominatim result. House-level hits are rejected so a loose query
 * cannot be stored as a building. The display name is never returned.
 */
export function readNominatimBody(body: unknown): PlaceHit | { error: string } {
	if (!Array.isArray(body) || body.length === 0) {
		return { error: 'No matching city or region. Try a different wording, or a 5-digit US ZIP.' };
	}
	const first = body[0];
	if (!first || typeof first !== 'object') {
		return { error: 'No matching city or region. Try a different wording, or a 5-digit US ZIP.' };
	}
	const row = first as { lat?: unknown; lon?: unknown; addresstype?: unknown; type?: unknown };
	const kind = typeof row.addresstype === 'string' ? row.addresstype : typeof row.type === 'string' ? row.type : '';
	if (TOO_PRECISE.has(kind)) {
		return { error: 'That matched a street address. Enter a city and region, or a ZIP, instead.' };
	}
	const lat = typeof row.lat === 'string' ? Number(row.lat) : Number.NaN;
	const lng = typeof row.lon === 'string' ? Number(row.lon) : Number.NaN;
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		return { error: 'No matching city or region. Try a different wording, or a 5-digit US ZIP.' };
	}
	return { lat, lng };
}

let nextNominatimAt = 0;

/**
 * One search, only when a player saves a new city/region. No autocomplete.
 * Browsers will not let the page set User-Agent; the request Referer is the site.
 * Calls are spaced at least 1.1 seconds apart to stay inside the Nominatim policy.
 */
export async function fetchNominatimPlace(query: string, fetchImpl: typeof fetch = fetch): Promise<PlaceHit | { error: string }> {
	const wait = nextNominatimAt - Date.now();
	if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
	nextNominatimAt = Date.now() + 1100;
	const url = new URL(NOMINATIM_ENDPOINT);
	url.searchParams.set('format', 'jsonv2');
	url.searchParams.set('limit', '1');
	url.searchParams.set('q', query);
	let response: Response;
	try {
		response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
	} catch {
		return { error: 'City lookup is unavailable right now. A 5-digit US ZIP still works offline.' };
	}
	if (!response.ok) {
		return { error: 'City lookup is unavailable right now. A 5-digit US ZIP still works offline.' };
	}
	return readNominatimBody(await response.json());
}

export type ResolvedLocation = { locationLabel: string; latE2: number; lngE2: number };

export async function coordinatesForSave(
	raw: string,
	previous: { locationLabel: string; latE2: number | null; lngE2: number | null } | null,
	deps?: Parameters<typeof resolveApproximateLocation>[1]
): Promise<
	{ ok: true; locationLabel: string; latE2: number | null; lngE2: number | null } | { ok: false; error: string }
> {
	const assessed = assessLocation(raw);
	if (!assessed.ok) return assessed;
	if (assessed.kind === 'empty') return { ok: true, locationLabel: '', latE2: null, lngE2: null };
	if (previous && previous.locationLabel === assessed.label && previous.latE2 != null && previous.lngE2 != null) {
		return { ok: true, locationLabel: assessed.label, latE2: previous.latE2, lngE2: previous.lngE2 };
	}
	const resolved = await resolveApproximateLocation(raw, deps);
	if (!resolved.ok) return resolved;
	return { ok: true, ...resolved.value };
}

export async function resolveApproximateLocation(
	raw: string,
	deps?: {
		random?: () => number;
		lookupZip?: (zip: string) => Promise<{ lat: number; lng: number } | null>;
		fetchPlace?: (query: string) => Promise<PlaceHit | { error: string }>;
		/** Production saves pass the placeMapPoint callable. Tests keep the local offset. */
		offset?: (lat: number, lng: number) => Promise<{ latE2: number; lngE2: number }>;
	}
): Promise<{ ok: true; value: ResolvedLocation } | { ok: false; error: string }> {
	const assessed = assessLocation(raw);
	if (!assessed.ok) return assessed;
	if (assessed.kind === 'empty') {
		return { ok: false, error: 'Enter a city and region, or a 5-digit US ZIP.' };
	}

	const findZip = deps?.lookupZip ?? lookupZip;
	const findPlace = deps?.fetchPlace ?? fetchNominatimPlace;
	let hit: PlaceHit | { error: string } | null = null;
	if (assessed.kind === 'zip') {
		const zip = await findZip(assessed.label);
		hit = zip ?? { error: 'That ZIP is not in the US list. Try the city and state instead.' };
	} else {
		hit = await findPlace(assessed.label);
	}
	if (!hit || 'error' in hit) {
		return { ok: false, error: hit?.error ?? 'Could not place that location.' };
	}
	const approx = deps?.offset
		? await deps.offset(hit.lat, hit.lng)
		: approximateCoordinate(hit.lat, hit.lng, deps?.random);
	return { ok: true, value: { locationLabel: assessed.label, ...approx } };
}
