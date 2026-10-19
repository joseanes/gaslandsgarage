import { describe, expect, it, vi } from 'vitest';
import { coordinatesForSave, readNominatimBody, resolveApproximateLocation } from './geocode';

const austin = { lat: 30.2649261, lng: -97.7474086 };

describe('readNominatimBody', () => {
	it('returns a city point and drops the display name', () => {
		const hit = readNominatimBody([
			{ lat: '30.2649261', lon: '-97.7474086', addresstype: 'city', display_name: 'Austin, Texas' }
		]);
		expect(hit).toEqual(austin);
		expect(hit).not.toHaveProperty('display_name');
	});

	it('rejects a house-level match', () => {
		expect(readNominatimBody([{ lat: '30.27', lon: '-97.74', addresstype: 'house' }])).toEqual({
			error: 'That matched a street address. Enter a city and region, or a ZIP, instead.'
		});
	});
});

describe('resolveApproximateLocation', () => {
	it('places a US ZIP from the local centroid list and does not call the network', async () => {
		const fetchPlace = vi.fn();
		const resolved = await resolveApproximateLocation('78701-1234', {
			random: () => 0,
			lookupZip: async () => ({ lat: 30.27, lng: -97.74 }),
			fetchPlace
		});
		expect(fetchPlace).not.toHaveBeenCalled();
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		expect(resolved.value.locationLabel).toBe('78701');
		expect(resolved.value.latE2).not.toBe(3027);
		expect(Number.isInteger(resolved.value.latE2)).toBe(true);
		expect(Number.isInteger(resolved.value.lngE2)).toBe(true);
	});

	it('asks the place search only for a city, then stores the jittered pin', async () => {
		const fetchPlace = vi.fn(async () => austin);
		const resolved = await resolveApproximateLocation('Austin, TX', { random: () => 0, fetchPlace });
		expect(fetchPlace).toHaveBeenCalledWith('Austin, TX');
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		expect(resolved.value.locationLabel).toBe('Austin, TX');
		expect(resolved.value).not.toMatchObject({ latE2: 3026, lngE2: -9775 });
	});

	it('stores the server-issued point when a save supplies one', async () => {
		const offset = vi.fn(async () => ({ latE2: 3011, lngE2: -9802 }));
		const resolved = await resolveApproximateLocation('Austin, TX', {
			fetchPlace: async () => austin,
			offset
		});
		expect(offset).toHaveBeenCalledWith(austin.lat, austin.lng);
		expect(resolved).toEqual({
			ok: true,
			value: { locationLabel: 'Austin, TX', latE2: 3011, lngE2: -9802 }
		});
	});

	it('does not geocode a street address', async () => {
		const fetchPlace = vi.fn();
		const resolved = await resolveApproximateLocation('123 Main Street', { fetchPlace });
		expect(fetchPlace).not.toHaveBeenCalled();
		expect(resolved.ok).toBe(false);
	});
});

describe('coordinatesForSave', () => {
	it('reuses a pin when the location text has not changed', async () => {
		const fetchPlace = vi.fn();
		const saved = await coordinatesForSave('Austin, TX', {
			locationLabel: 'Austin, TX',
			latE2: 3019,
			lngE2: -9766
		}, { fetchPlace });
		expect(fetchPlace).not.toHaveBeenCalled();
		expect(saved).toEqual({ ok: true, locationLabel: 'Austin, TX', latE2: 3019, lngE2: -9766 });
		const offset = vi.fn();
		await coordinatesForSave(
			'Austin, TX',
			{ locationLabel: 'Austin, TX', latE2: 3019, lngE2: -9766 },
			{ offset }
		);
		expect(offset).not.toHaveBeenCalled();
	});

	it('clears the pin when the location is removed', async () => {
		const saved = await coordinatesForSave('  ', { locationLabel: 'Austin, TX', latE2: 3019, lngE2: -9766 });
		expect(saved).toEqual({ ok: true, locationLabel: '', latE2: null, lngE2: null });
	});
});
