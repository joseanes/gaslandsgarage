/** Hand-off so Teams menu items on other pages can finish on the builder. */

export const TEAM_MENU_ACTION_KEY = 'gaslands-team-action';
export const CURRENT_TEAM_KEY = 'gaslands-current-team';

export const TEAM_MENU_ACTIONS = ['myteams', 'import', 'print', 'copy', 'share', 'qr'] as const;
export type TeamMenuAction = (typeof TEAM_MENU_ACTIONS)[number];

const NEEDS_TEAM = new Set<TeamMenuAction>(['print', 'copy', 'share', 'qr']);

export function isTeamMenuAction(value: string | null | undefined): value is TeamMenuAction {
	return TEAM_MENU_ACTIONS.includes(value as TeamMenuAction);
}

export function teamActionNeedsTeam(action: TeamMenuAction) {
	return NEEDS_TEAM.has(action);
}

export function builderPathForTeamAction(action: TeamMenuAction) {
	return `/builder?open=${action}`;
}

export function rememberTeamMenuAction(action: TeamMenuAction) {
	sessionStorage.setItem(TEAM_MENU_ACTION_KEY, action);
}

/** URL wins over the session flag. Both are cleared so a refresh does not repeat the action. */
export function takeTeamMenuAction(): TeamMenuAction | null {
	const params = new URLSearchParams(window.location.search);
	const fromUrl = params.get('open');
	const fromStore = sessionStorage.getItem(TEAM_MENU_ACTION_KEY);
	sessionStorage.removeItem(TEAM_MENU_ACTION_KEY);
	if (fromUrl !== null) {
		params.delete('open');
		const query = params.toString();
		const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
		history.replaceState(history.state, '', next);
	}
	if (isTeamMenuAction(fromUrl)) return fromUrl;
	if (isTeamMenuAction(fromStore)) return fromStore;
	return null;
}

export function rememberCurrentTeam(draft: unknown) {
	const vehicles = (draft as { vehicles?: unknown } | null)?.vehicles;
	if (!Array.isArray(vehicles) || vehicles.length === 0) {
		sessionStorage.removeItem(CURRENT_TEAM_KEY);
		return;
	}
	sessionStorage.setItem(CURRENT_TEAM_KEY, JSON.stringify(draft));
}

export function peekCurrentTeam(): unknown {
	const raw = sessionStorage.getItem(CURRENT_TEAM_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
}
