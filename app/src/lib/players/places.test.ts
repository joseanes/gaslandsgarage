import { describe, expect, it } from 'vitest';
import { acceptPlaceLabel, CITY_PRIMARY_TYPES, cityLabelFromPrediction, mapsBrowserKey, readPlaceText } from './places';

describe('mapsBrowserKey', () => {
	it('reads the public browser key and ignores a blank value', () => {
		expect(mapsBrowserKey({ VITE_GOOGLE_MAPS_API_KEY: '  abc  ' })).toBe('abc');
		expect(mapsBrowserKey({})).toBe('');
		expect(mapsBrowserKey({ VITE_GOOGLE_MAPS_API_KEY: '   ' })).toBe('');
	});
});

describe('city suggestions', () => {
	it('limits suggestions to the cities collection', () => {
		expect(CITY_PRIMARY_TYPES).toEqual(['(cities)']);
	});

	it('keeps a city and region from the prediction text', () => {
		expect(
			cityLabelFromPrediction({
				mainText: { text: 'Austin' },
				secondaryText: { text: 'TX, USA' },
				text: { text: 'Austin, TX, USA' }
			})
		).toBe('Austin, TX, USA');
	});

	it('reads a plain string prediction', () => {
		expect(readPlaceText('  Manchester  ')).toBe('Manchester');
		expect(cityLabelFromPrediction({ text: 'St. Louis, Missouri' })).toBe('St. Louis, Missouri');
	});

	it('drops a street address and does not keep coordinates', () => {
		const prediction = {
			text: { text: '123 Main Street, Austin, TX' },
			mainText: { text: '123 Main Street' },
			secondaryText: { text: 'Austin, TX' },
			location: { lat: 30.27, lng: -97.74 }
		};
		expect(cityLabelFromPrediction(prediction)).toBeNull();
		expect(acceptPlaceLabel('10 Downing Street')).toBeNull();
	});

	it('accepts a 5-digit ZIP typed as the label and rejects a full postcode', () => {
		expect(acceptPlaceLabel('78701')).toBe('78701');
		expect(acceptPlaceLabel('SW1A 1AA')).toBeNull();
	});
});
