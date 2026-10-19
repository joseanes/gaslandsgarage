import { describe, expect, it } from 'vitest';
import { savedTeamIdFromLoadedTeam } from './savedTeam';

const previousId = 'graceRacers1';

describe('saved team id when a team is loaded', () => {
	it('keeps the id when the player loads one of their own saved teams', () => {
		expect(savedTeamIdFromLoadedTeam({ savedTeamId: 'myTeamId1', sponsor: 'rutherford', vehicles: [] })).toBe(
			'myTeamId1'
		);
	});

	it('clears a previous id for a buddy copy, an import, a share link, and a new team', () => {
		const buddyCopy = { sponsor: 'rutherford', teamName: 'Racers (from Ada)', vehicles: [{ id: 'hauler' }] };
		const imported = { sponsor: 'miyazaki', teamName: 'Imported', vehicles: [{ id: 'car' }] };
		const shareLink = { sponsor: 'mishkin', vehicles: [{ id: 'buggy' }] };
		const freshTeam = null;

		for (const loaded of [buddyCopy, imported, shareLink, freshTeam]) {
			const next = savedTeamIdFromLoadedTeam(loaded);
			expect(next).toBeNull();
			expect(next).not.toBe(previousId);
		}
	});

	it('clears when the id is missing, blank, or not a string', () => {
		expect(savedTeamIdFromLoadedTeam({ sponsor: 'rutherford' })).toBeNull();
		expect(savedTeamIdFromLoadedTeam({ savedTeamId: '' })).toBeNull();
		expect(savedTeamIdFromLoadedTeam({ savedTeamId: null })).toBeNull();
		expect(savedTeamIdFromLoadedTeam({ savedTeamId: 12 })).toBeNull();
		expect(savedTeamIdFromLoadedTeam([])).toBeNull();
	});
});
