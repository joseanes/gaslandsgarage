/**
 * A painting-guide link is a public http(s) URL the player typed.
 * The same pattern is enforced in firestore.rules (safeHttpUrl). Keep them together.
 * An empty value means the photo has no link. Callers must not substitute a profile website.
 */
export const PAINTING_URL_MAX = 300;

const PAINTING_URL = /^https?:\/\/[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}(?::[0-9]{1,5})?(?:\/[A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$/;

export const PAINTING_LINK_LABEL = 'Link to painting guide or your site';
export const USE_PROFILE_WEBSITE_LABEL = 'Use my profile website';
export const PROFILE_WEBSITE_LABEL = 'Website (YouTube channel, blog, etc.)';

export function normalizePaintingUrl(value: unknown): string {
	if (typeof value !== 'string') {
		if (value == null) return '';
		throw new Error('Use a full http or https link.');
	}
	const trimmed = value.trim();
	if (!trimmed) return '';
	if (trimmed.length > PAINTING_URL_MAX) throw new Error('That link must be 300 characters or fewer.');
	if (!PAINTING_URL.test(trimmed)) throw new Error('Use a full http or https link.');
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error('Use a full http or https link.');
	}
	if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
		throw new Error('Use a full http or https link.');
	}
	return trimmed;
}

export interface PaintingGuide {
	href: string;
	domain: string;
	youtube: boolean;
	label: string;
}

function hostName(href: string): string {
	return new URL(href).hostname.replace(/^www\./i, '').toLowerCase();
}

export function isYouTubeHost(host: string): boolean {
	const name = host.toLowerCase();
	return name === 'youtu.be' || name === 'youtube.com' || name.endsWith('.youtube.com') || name === 'youtube-nocookie.com';
}

/** Null when the photo has no usable link. Invalid stored text is treated as blank. */
export function paintingGuideLink(value: unknown): PaintingGuide | null {
	let href = '';
	try {
		href = normalizePaintingUrl(value);
	} catch {
		return null;
	}
	if (!href) return null;
	const host = hostName(href);
	const youtube = isYouTubeHost(host);
	const domain = youtube ? 'youtube.com' : host;
	return { href, domain, youtube, label: `Painting guide on ${domain}` };
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

const YOUTUBE_ICON =
	'<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#FF0033" d="M23 12.2s0-3.2-.4-4.6c-.2-.9-.9-1.6-1.8-1.8C19.2 5.4 12 5.4 12 5.4s-7.2 0-8.8.4c-.9.2-1.6.9-1.8 1.8C1 9 1 12.2 1 12.2s0 3.2.4 4.6c.2.9.9 1.6 1.8 1.8 1.6.4 8.8.4 8.8.4s7.2 0 8.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.4.4-4.6.4-4.6z"/><path fill="#fff" d="M9.8 15.5v-6.6l6.2 3.3-6.2 3.3z"/></svg>';

/** Escaped anchor, or an empty string when the photo has no link. */
export function paintingGuideHtml(value: unknown): string {
	const guide = paintingGuideLink(value);
	if (!guide) return '';
	const icon = guide.youtube ? YOUTUBE_ICON : '';
	return `<a class="guide" data-testid="painting-guide" href="${escapeHtml(guide.href)}" rel="nofollow ugc noopener noreferrer" target="_blank">${icon}${escapeHtml(guide.label)}</a>`;
}
