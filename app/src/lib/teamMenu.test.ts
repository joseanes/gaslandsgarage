import { afterEach, describe, expect, it } from 'vitest';
import {
	CURRENT_TEAM_KEY,
	TEAM_MENU_ACTION_KEY,
	builderPathForTeamAction,
	peekCurrentTeam,
	rememberCurrentTeam,
	rememberTeamMenuAction,
	takeTeamMenuAction,
	teamActionNeedsTeam
} from './teamMenu';

afterEach(() => {
	sessionStorage.clear();
	history.replaceState(null, '', '/builder');
});

describe('team menu hand-off', () => {
	it('builds a builder url that opens the requested action', () => {
		expect(builderPathForTeamAction('myteams')).toBe('/builder?open=myteams');
		expect(builderPathForTeamAction('import')).toBe('/builder?open=import');
		expect(builderPathForTeamAction('new')).toBe('/builder?open=new');
		expect(teamActionNeedsTeam('new')).toBe(false);
	});

	it('prefers the open query, then drops it and the session flag', () => {
		history.replaceState(null, '', '/builder?open=myteams&draft=abc');
		rememberTeamMenuAction('print');
		expect(takeTeamMenuAction()).toBe('myteams');
		expect(sessionStorage.getItem(TEAM_MENU_ACTION_KEY)).toBeNull();
		expect(`${location.pathname}${location.search}`).toBe('/builder?draft=abc');
	});

	it('uses the session flag when the url has no open param', () => {
		rememberTeamMenuAction('qr');
		expect(takeTeamMenuAction()).toBe('qr');
		expect(takeTeamMenuAction()).toBeNull();
	});

	it('keeps a team that has vehicles and forgets an empty one', () => {
		rememberCurrentTeam({ sponsor: 'rutherford', vehicles: [{ id: 'v1' }] });
		expect(peekCurrentTeam()).toEqual({ sponsor: 'rutherford', vehicles: [{ id: 'v1' }] });
		rememberCurrentTeam({ sponsor: 'rutherford', vehicles: [] });
		expect(sessionStorage.getItem(CURRENT_TEAM_KEY)).toBeNull();
		expect(peekCurrentTeam()).toBeNull();
	});
});
