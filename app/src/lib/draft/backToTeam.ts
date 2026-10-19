import { heldDraftSignature, type HeldDraft } from './hold';

/** Header pages that are the builder. The back link stays off these. */
export function isBuilderPath(pathname: string) {
	return pathname === '/builder' || pathname.startsWith('/builder/');
}

function savedTeamLoaded(draft: HeldDraft) {
	return typeof draft.savedTeamId === 'string' && draft.savedTeamId.trim().length > 0;
}

/** A team the player is in the middle of: a loaded save, or an unsaved draft. */
export function isActiveHeldDraft(draft: HeldDraft | null | undefined): draft is HeldDraft {
	if (!draft) return false;
	if (savedTeamLoaded(draft)) return true;
	if (draft.vehicles.length > 0) return true;
	return typeof draft.cleanSignature === 'string' && draft.cleanSignature !== heldDraftSignature(draft);
}

export function backToTeamLabel(draft: HeldDraft | null | undefined): string | null {
	if (!isActiveHeldDraft(draft)) return null;
	const name = typeof draft.teamName === 'string' ? draft.teamName.trim() : '';
	return name ? `Back to my team: ${name}` : 'Back to my team';
}

/** Label for the Teams menu, or null when the item should stay hidden. */
export function backToTeamMenuLabel(pathname: string, draft: HeldDraft | null | undefined): string | null {
	if (isBuilderPath(pathname)) return null;
	return backToTeamLabel(draft);
}
