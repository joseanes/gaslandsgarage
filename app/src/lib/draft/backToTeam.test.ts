import { describe, expect, it } from 'vitest';
import { backToTeamMenuLabel, isActiveHeldDraft } from './backToTeam';
import { heldDraftSignature, type HeldDraft } from './hold';

function cleanEmpty(patch: Partial<HeldDraft> = {}): HeldDraft {
	const draft: HeldDraft = {
		sponsor: 'no_sponsor',
		vehicles: [],
		teamName: 'My Gaslands Team',
		maxCans: 50,
		rulesVersion: 2,
		savedTeamId: null,
		...patch
	};
	draft.cleanSignature = heldDraftSignature(draft);
	return draft;
}

describe('back to my team', () => {
	it('locks the dirty-check signature to the builder shape', () => {
		expect(
			heldDraftSignature({
				teamName: 'Road Warriors',
				sponsor: 'rutherford',
				maxCans: 50,
				rulesVersion: 2,
				vehicles: []
			})
		).toBe('{"teamName":"Road Warriors","sponsorId":"rutherford","maxCans":50,"rulesVersion":2,"vehicles":[]}');
	});

	it('hides the item when there is no team', () => {
		expect(backToTeamMenuLabel('/stats', null)).toBeNull();
		expect(backToTeamMenuLabel('/players', cleanEmpty())).toBeNull();
		expect(isActiveHeldDraft(cleanEmpty())).toBe(false);
	});

	it('hides the item on the builder even when a team is in progress', () => {
		const draft = cleanEmpty({
			teamName: 'Road Warriors',
			vehicles: [{ id: 'v1', type: 'car', name: 'Scout' }]
		});
		expect(backToTeamMenuLabel('/builder', draft)).toBeNull();
		expect(backToTeamMenuLabel('/builder/', draft)).toBeNull();
	});

	it('names an unsaved draft, and omits a blank name', () => {
		const named = cleanEmpty();
		named.teamName = 'Road Warriors';
		expect(backToTeamMenuLabel('/stats', named)).toBe('Back to my team: Road Warriors');

		const vehiclesOnly = cleanEmpty({
			teamName: '   ',
			vehicles: [{ id: 'v1', type: 'car' }]
		});
		expect(backToTeamMenuLabel('/photos', vehiclesOnly)).toBe('Back to my team');

		const padded = cleanEmpty();
		padded.teamName = '  Road Warriors  ';
		expect(backToTeamMenuLabel('/gallery', padded)).toBe('Back to my team: Road Warriors');
	});

	it('shows a saved team that was loaded, even with no cars yet', () => {
		const saved = cleanEmpty({ savedTeamId: 'saved-team-1', teamName: 'Road Warriors' });
		expect(backToTeamMenuLabel('/buddies', saved)).toBe('Back to my team: Road Warriors');
		expect(backToTeamMenuLabel('/profile', cleanEmpty({ savedTeamId: '   ' }))).toBeNull();
	});
});
