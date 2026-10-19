import { describe, expect, it } from 'vitest';
import { clearHeldDraft, HELD_DRAFT_KEY, readHeldDraft, writeHeldDraft, type HeldDraft } from './hold';

function memory() {
	const bag = new Map<string, string>();
	return {
		getItem: (key: string) => bag.get(key) ?? null,
		setItem: (key: string, value: string) => {
			bag.set(key, value);
		},
		removeItem: (key: string) => {
			bag.delete(key);
		}
	};
}

describe('held builder draft', () => {
	it('round-trips the team, rules version, and saved team id', () => {
		const storage = memory();
		const draft: HeldDraft = {
			sponsor: 'beverly',
			teamName: 'Hold Me',
			maxCans: 50,
			rulesVersion: 3,
			savedTeamId: 'team-9',
			cleanSignature: 'saved',
			vehicles: [{ id: 'v1', type: 'tank', name: 'New Vehicle', weapons: [], upgrades: [], perks: [] }]
		};
		writeHeldDraft(draft, storage);
		expect(storage.getItem(HELD_DRAFT_KEY)).toContain('team-9');
		expect(readHeldDraft(storage)).toEqual(draft);
		clearHeldDraft(storage);
		expect(readHeldDraft(storage)).toBeNull();
	});

	it('ignores a corrupt or incomplete blob', () => {
		const storage = memory();
		storage.setItem(HELD_DRAFT_KEY, '{');
		expect(readHeldDraft(storage)).toBeNull();
		storage.setItem(HELD_DRAFT_KEY, JSON.stringify({ sponsor: 'beverly' }));
		expect(readHeldDraft(storage)).toBeNull();
	});
});
