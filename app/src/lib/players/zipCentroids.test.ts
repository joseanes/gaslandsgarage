import { describe, expect, it } from 'vitest';
import { lookupZip } from './zipCentroids';

describe('lookupZip', () => {
	it('returns coarse centroids for known ZIPs and misses unknown ones', async () => {
		const nyc = await lookupZip('10001');
		const austin = await lookupZip('78701');
		const beverly = await lookupZip('90210');
		expect(nyc?.lat).toBeCloseTo(40.75, 2);
		expect(nyc?.lng).toBeCloseTo(-74, 1);
		expect(austin?.lat).toBeCloseTo(30.27, 2);
		expect(austin?.lng).toBeCloseTo(-97.74, 2);
		expect(beverly?.lat).toBeCloseTo(34.1, 1);
		expect(beverly?.lng).toBeCloseTo(-118.41, 2);
		expect(await lookupZip('00000')).toBeNull();
	});
});
