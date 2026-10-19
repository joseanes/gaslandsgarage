/** In-progress builder team. Survives in-app navigation and a reload. */

export const HELD_DRAFT_KEY = 'gaslands-builder-draft';

export type HeldDraft = {
	sponsor: string;
	vehicles: unknown[];
	teamName?: string;
	maxCans?: number;
	darkMode?: boolean;
	rulesVersion?: unknown;
	savedTeamId?: string | null;
	/** Signature of the last saved or freshly loaded team. Differs while edits are unsaved. */
	cleanSignature?: string;
};

export function readHeldDraft(storage: Pick<Storage, 'getItem'> = localStorage): HeldDraft | null {
	try {
		const raw = storage.getItem(HELD_DRAFT_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as HeldDraft;
		if (!parsed || typeof parsed !== 'object') return null;
		if (typeof parsed.sponsor !== 'string' || !Array.isArray(parsed.vehicles)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function writeHeldDraft(draft: HeldDraft, storage: Pick<Storage, 'setItem'> = localStorage) {
	try {
		storage.setItem(HELD_DRAFT_KEY, JSON.stringify(draft));
	} catch {
		/* storage can be blocked */
	}
}

export function clearHeldDraft(storage: Pick<Storage, 'removeItem'> = localStorage) {
	try {
		storage.removeItem(HELD_DRAFT_KEY);
	} catch {
		/* storage can be blocked */
	}
}
