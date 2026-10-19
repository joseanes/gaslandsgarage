/**
 * Tile source for the players map.
 *
 * CARTO stopped serving its raster basemaps without an API key on 25 September 2026.
 * A keyless request now returns an "API KEY REQUIRED" image with HTTP 200, so the map
 * looked loaded but showed no streets or coastlines. Use CARTO Voyager only when a key
 * is configured, and fall back to the standard OpenStreetMap tiles otherwise.
 */
export type Basemap = {
	provider: 'carto' | 'osm';
	url: string;
	options: {
		attribution: string;
		maxZoom: number;
		subdomains?: string;
	};
};

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;

export function cartoKey(raw: string | undefined | null): string | null {
	const key = (raw ?? '').trim();
	return KEY_PATTERN.test(key) ? key : null;
}

export function basemapFor(rawKey: string | undefined | null): Basemap {
	const key = cartoKey(rawKey);
	if (key) {
		return {
			provider: 'carto',
			url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`,
			options: {
				attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
				subdomains: 'abcd',
				maxZoom: 20
			}
		};
	}
	return {
		provider: 'osm',
		url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
		options: { attribution: OSM_ATTRIBUTION, maxZoom: 19 }
	};
}
