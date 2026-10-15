// app/src/lib/draft/io.ts
import { normalizeRulesVersion } from '$lib/rules/version';
import type { Draft } from '$lib/validate/model';

export function encodeDraft(d: Draft): string {
	return btoa(encodeURIComponent(JSON.stringify(d)));
}

export function decodeDraft(str: string): Draft | null {
	try {
		const draft = JSON.parse(decodeURIComponent(atob(str))) as Draft;
		draft.rulesVersion = normalizeRulesVersion(draft.rulesVersion);
		return draft;
	} catch {
		return null;
	}
}

