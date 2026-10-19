import { describe, expect, it } from 'vitest';
import { basemapFor, cartoKey } from './basemap';

describe('basemapFor', () => {
	it('never requests keyless CARTO tiles, which now return an API KEY REQUIRED image', () => {
		for (const raw of [undefined, null, '', '   ', 'bad key!', 'short']) {
			const basemap = basemapFor(raw);
			expect(basemap.provider).toBe('osm');
			expect(basemap.url).not.toContain('cartocdn');
			expect(basemap.url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
			expect(basemap.options.attribution).toContain('OpenStreetMap');
			expect(basemap.options.attribution).not.toContain('CARTO');
			expect(basemap.options.maxZoom).toBe(19);
		}
	});

	it('uses CARTO Voyager with the key on every tile URL when a key is configured', () => {
		const basemap = basemapFor(' abcDEF123_-xyz ');
		expect(basemap.provider).toBe('carto');
		expect(basemap.url).toBe(
			'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=abcDEF123_-xyz'
		);
		expect(basemap.options.subdomains).toBe('abcd');
		expect(basemap.options.attribution).toContain('CARTO');
		expect(basemap.options.attribution).toContain('OpenStreetMap');
	});

	it('keeps the key exactly as issued, because CARTO treats a changed case as no key', () => {
		expect(cartoKey('AbCdEfGh12')).toBe('AbCdEfGh12');
		expect(cartoKey('a&b=c<script>')).toBeNull();
	});
});
