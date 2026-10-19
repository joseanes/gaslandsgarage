import { describe, expect, it } from 'vitest';
import { coarseNear, wargamingEventsUrl } from './wargamingEvents';

describe('wargamingEventsUrl', () => {
	it('filters to Gaslands with no location when nothing is saved', () => {
		expect(wargamingEventsUrl(null)).toBe('https://wargamingevents.com/?system=gaslands&utm_source=gaslandsgarage');
		expect(wargamingEventsUrl({ latE2: null, lngE2: null, locationLabel: 'Tampa, FL' })).toBe(
			'https://wargamingevents.com/?system=gaslands&utm_source=gaslandsgarage'
		);
	});

	it('passes the saved pin rounded to one decimal, a radius, and the city label', () => {
		const url = new URL(wargamingEventsUrl({ latE2: 2795, lngE2: -8246, locationLabel: ' Tampa,  FL ' }));
		expect(url.origin).toBe('https://wargamingevents.com');
		expect(url.searchParams.get('system')).toBe('gaslands');
		expect(url.searchParams.get('lat')).toBe('28.0');
		expect(url.searchParams.get('lng')).toBe('-82.5');
		expect(url.searchParams.get('radius')).toBe('100');
		expect(url.searchParams.get('near')).toBe('Tampa, FL');
		expect(url.searchParams.get('utm_source')).toBe('gaslandsgarage');
	});

	it('never adds anything that is not on the allow list', () => {
		const url = new URL(
			wargamingEventsUrl({ latE2: 4071, lngE2: -7401, locationLabel: 'ada@example.com' } as never)
		);
		expect([...url.searchParams.keys()].sort()).toEqual(['lat', 'lng', 'radius', 'system', 'utm_source']);
		expect(url.toString()).not.toContain('@');
	});

	it('drops out-of-range coordinates', () => {
		expect(wargamingEventsUrl({ latE2: 99999, lngE2: 0, locationLabel: '' })).not.toContain('lat=');
	});
});

describe('coarseNear', () => {
	it('keeps a city or ZIP and rejects email, markup, and long text', () => {
		expect(coarseNear('46225')).toBe('46225');
		expect(coarseNear("Coeur d'Alene, ID")).toBe("Coeur d'Alene, ID");
		expect(coarseNear('São Paulo')).toBe('São Paulo');
		expect(coarseNear('a@b.co')).toBeNull();
		expect(coarseNear('<script>')).toBeNull();
		expect(coarseNear('x'.repeat(81))).toBeNull();
		expect(coarseNear(42)).toBeNull();
	});
});
