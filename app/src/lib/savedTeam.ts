/**
 * The id Quick Save should update after the builder loads a team.
 * A payload with no id is a new team: a buddy copy, an import, a share link,
 * or a fresh team. The previous id must not survive, or Quick Save overwrites it.
 */
export function savedTeamIdFromLoadedTeam(raw: unknown): string | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('savedTeamId' in raw)) return null;
	const incoming = (raw as { savedTeamId?: unknown }).savedTeamId;
	return typeof incoming === 'string' && incoming.length > 0 ? incoming : null;
}
