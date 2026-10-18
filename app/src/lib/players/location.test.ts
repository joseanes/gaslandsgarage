import { describe, expect, it } from 'vitest';
import { approximateCoordinate, assessLocation, hundredthsToDegrees } from './location';

describe('assessLocation', () => {
	it('treats a blank value as optional', () => {
		expect(assessLocation('   ')).toEqual({ ok: true, kind: 'empty', label: '' });
	});

	it('keeps a 5-digit ZIP and drops the +4', () => {
		expect(assessLocation('78701')).toEqual({ ok: true, kind: 'zip', label: '78701' });
		expect(assessLocation(' 78701-1234 ')).toEqual({ ok: true, kind: 'zip', label: '78701' });
	});

	it('accepts a city and region, including saint names', () => {
		expect(assessLocation('Austin, TX')).toEqual({ ok: true, kind: 'place', label: 'Austin, TX' });
		expect(assessLocation('St. Louis, Missouri')).toEqual({
			ok: true,
			kind: 'place',
			label: 'St. Louis, Missouri'
		});
		expect(assessLocation('Manchester')).toEqual({ ok: true, kind: 'place', label: 'Manchester' });
	});

	it('rejects street addresses, full postcodes, and at-home as a location', () => {
		for (const value of ['123 Main Street', '12 Oak Lane', 'Main St', 'SW1A 1AA', '10001-1234 Main', 'Apt 4']) {
			expect(assessLocation(value).ok, value).toBe(false);
		}
		expect(assessLocation('at home').ok).toBe(false);
	});
});

describe('approximateCoordinate', () => {
	it('snaps a jittered point to hundredths of a degree', () => {
		const point = approximateCoordinate(30.2701011, -97.7429572, () => 0);
		expect(point).toEqual({ latE2: 3029, lngE2: -9774 });
		expect(hundredthsToDegrees(point.latE2, point.lngE2)).toEqual({ lat: 30.29, lng: -97.74 });
	});

	it('stays a few kilometers from the input and does not keep the raw point', () => {
		const lat = 40.7484;
		const lng = -73.9857;
		const rawHundredths = { latE2: Math.round(lat * 100), lngE2: Math.round(lng * 100) };
		for (let i = 0; i < 20; i += 1) {
			const point = approximateCoordinate(lat, lng);
			expect(Number.isInteger(point.latE2)).toBe(true);
			expect(Number.isInteger(point.lngE2)).toBe(true);
			expect(point.latE2).toBeGreaterThanOrEqual(-9000);
			expect(point.latE2).toBeLessThanOrEqual(9000);
			const moved = km(lat, lng, point.latE2 / 100, point.lngE2 / 100);
			expect(moved).toBeGreaterThan(0.5);
			expect(moved).toBeLessThan(12);
			expect(point).not.toEqual(rawHundredths);
		}
	});
});

function km(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const dLat = (lat1 - lat2) * 111.32;
	const dLng = (lng1 - lng2) * 111.32 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
	return Math.hypot(dLat, dLng);
}
