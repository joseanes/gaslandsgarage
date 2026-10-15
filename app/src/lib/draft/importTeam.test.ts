import { describe, it, expect } from 'vitest';
import { normalizeIncomingDraft, withUpgradePerks } from './importTeam';

describe('withUpgradePerks', () => {
	it('adds perks granted by upgrades without duplicating existing perks', () => {
		const vehicles = withUpgradePerks(
			[
				{
					id: 'v1',
					type: 'car',
					name: 'Lead',
					weapons: ['handgun_ab'],
					upgrades: ['extra_crew'],
					perks: ['powder_keg']
				}
			],
			[{ id: 'extra_crew', perks: ['powder_keg', 'expert_driver'] }]
		);

		expect(vehicles[0].perks).toEqual(['powder_keg', 'expert_driver']);
		expect(vehicles[0].weapons).toEqual(['handgun_ab']);
	});

	it('fills missing weapon, upgrade, and perk arrays', () => {
		const vehicles = withUpgradePerks(
			[{ id: 'v1', type: 'car', name: '', weapons: undefined as unknown as string[], perks: undefined as unknown as string[] }],
			[]
		);
		expect(vehicles[0].name).toBe('Vehicle');
		expect(vehicles[0].weapons).toEqual([]);
		expect(vehicles[0].upgrades).toEqual([]);
		expect(vehicles[0].perks).toEqual([]);
	});
});

describe('normalizeIncomingDraft', () => {
	it('unwraps saved teams and maps sponsorId onto sponsor', () => {
		const draft = normalizeIncomingDraft({
			teamData: {
				sponsorId: 'idris',
				teamName: 'Orange',
				maxCans: 42,
				vehicles: [{ id: 'v1', type: 'car', name: 'Lead', weapons: [], perks: [] }]
			}
		});
		expect(draft?.sponsor).toBe('idris');
		expect(draft?.teamName).toBe('Orange');
		expect(draft?.maxCans).toBe(42);
	});

	it('keeps a version 3 team on version 3 and treats a missing version as 2', () => {
		const versioned = normalizeIncomingDraft({
			sponsor: 'idris',
			rulesVersion: 3,
			vehicles: [{ id: 'v1', type: 'sports_car', name: 'Zap', weapons: [], perks: [], driverName: 'Zap' }]
		});
		expect(versioned?.rulesVersion).toBe(3);
		expect(versioned?.vehicles[0].driverName).toBe('Zap');

		const legacy = normalizeIncomingDraft({
			sponsor: 'miyazaki',
			vehicles: [{ id: 'v1', type: 'car', name: 'Old', weapons: [], perks: [] }]
		});
		expect(legacy?.rulesVersion).toBe(2);
	});

	it('returns null when the payload has no vehicles', () => {
		expect(normalizeIncomingDraft({ sponsor: 'idris' })).toBeNull();
		expect(normalizeIncomingDraft(null)).toBeNull();
	});
});
