import { describe, expect, it } from 'vitest';
import { decodeDraft, encodeDraft } from './io';

describe('draft codes', () => {
	it('keeps rules version 3 in a share code', () => {
		const encoded = encodeDraft({
			sponsor: 'idris',
			rulesVersion: 3,
			maxCans: 60,
			vehicles: [
				{
					id: 'a',
					type: 'sports_car',
					name: 'Red',
					weapons: [],
					perks: [],
					driverArchetype: 'speed_demon',
					driverName: 'Ada'
				}
			]
		});
		const decoded = decodeDraft(encoded);
		expect(decoded?.rulesVersion).toBe(3);
		expect(decoded?.vehicles[0].driverName).toBe('Ada');
		expect(decoded?.maxCans).toBe(60);
	});

	it('treats a legacy code with no version as v2', () => {
		const encoded = encodeDraft({
			sponsor: 'miyazaki',
			vehicles: [{ id: 'a', type: 'car', name: 'Old', weapons: [], perks: [] }]
		});
		expect(encoded.includes('rulesVersion')).toBe(false);
		expect(decodeDraft(encoded)?.rulesVersion).toBe(2);
	});
});
