/** Query keys that must not reach Google Analytics. */
export const DRAFT_QUERY_KEY = 'draft';
export const EMAIL_INVITE_QUERY_KEY = 'emailInvite';
export const DRAFT_STORAGE_KEY = 'gaslands.pendingDraft';
export const EMAIL_INVITE_STORAGE_KEY = 'gaslands.emailInvite';

export function stashSensitiveSearch(href: string, storage: Pick<Storage, 'setItem'>): string {
	const url = new URL(href, 'https://gaslandsgarage.com');
	let changed = false;
	const draft = url.searchParams.get(DRAFT_QUERY_KEY);
	if (draft != null) {
		storage.setItem(DRAFT_STORAGE_KEY, draft);
		url.searchParams.delete(DRAFT_QUERY_KEY);
		changed = true;
	}
	const invite = url.searchParams.get(EMAIL_INVITE_QUERY_KEY);
	if (invite != null) {
		storage.setItem(EMAIL_INVITE_STORAGE_KEY, invite);
		url.searchParams.delete(EMAIL_INVITE_QUERY_KEY);
		changed = true;
	}
	if (!changed) return href;
	return `${url.pathname}${url.search}${url.hash}`;
}

/** Strips share-link and invite secrets from an analytics hit body or URL. */
export function redactAnalyticsPayload(value: string): string {
	return value
		.replace(/([?&#])(draft|emailInvite)=[^&#]*/gi, '$1$2=(redacted)')
		.replace(/(draft|emailInvite)%3D[^&#%]*/gi, '$1%3D(redacted)');
}
