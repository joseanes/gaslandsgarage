import { describe, expect, it } from 'vitest';
import { resolveById } from './lookup';

const weapons = [{ id: 'machine_gun' }, { id: 'handgun' }];

describe('resolveById', () => {
	it('matches an instance id and a differently cased base', () => {
		expect(resolveById(weapons, 'machine_gun_UZI5')?.id).toBe('machine_gun');
		expect(resolveById(weapons, 'Machine_Gun_UZI5')?.id).toBe('machine_gun');
		expect(resolveById(weapons, 'HANDGUN')?.id).toBe('handgun');
	});

	it('returns undefined for a missing id or a non-string', () => {
		expect(resolveById(weapons, 'ghost')).toBeUndefined();
		expect(resolveById(weapons, { id: 'machine_gun' })).toBeUndefined();
		expect(resolveById(weapons, null)).toBeUndefined();
	});
});
