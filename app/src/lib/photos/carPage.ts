/**
 * Public car pages and embeds.
 *
 * A page exists only for a gallery opt-in that is still published and not
 * hidden. Buddy-only and team-share-link photos stay off this URL. The view
 * is an allow-list: the account id, email, and any other private field are
 * dropped before HTML or JSON leaves this module.
 */

import { BUDDY_FALLBACK_NAME, publicDisplayName } from '../buddies/model';
import { PHOTO_ID_PATTERN } from './model';
import {
	sanitizeVehicleStats,
	sharedPhotoMediaUrl,
	type VehicleStatsSnapshot
} from './share';

export const SITE_ORIGIN = 'https://gaslandsgarage.com';
export const BUILD_CTA = 'Build your own team on Gaslands Garage';
export const VIA_GASLANDS = 'via Gaslands Garage';
export const NOT_SHARED_NOTICE = 'This car is no longer shared.';
export const CAR_PAGE_FUNCTION = 'renderSharedCar';

export const SHARE_CHANNELS = ['copy', 'x', 'facebook', 'reddit', 'native'] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

/** Fields a car page or embed is allowed to show. Nothing else is copied. */
export interface PublicCar {
	shareId: string;
	displayName: string;
	vehicleType: string;
	teamName: string;
	caption: string;
	imageUrl: string;
	vehicleStats: VehicleStatsSnapshot | null;
}

const PUBLIC_CAR_KEYS = [
	'shareId',
	'displayName',
	'vehicleType',
	'teamName',
	'caption',
	'imageUrl',
	'vehicleStats'
] as const;

export function carPagePath(shareId: string): string {
	assertShareId(shareId);
	return `/car/${shareId}`;
}

export function embedPagePath(shareId: string): string {
	assertShareId(shareId);
	return `/embed/car/${shareId}`;
}

export function carLabel(car: Pick<PublicCar, 'vehicleType' | 'vehicleStats'>): string {
	const name = car.vehicleStats?.name?.trim();
	return name || car.vehicleType || 'Car';
}

export function statRows(stats: VehicleStatsSnapshot): { label: string; value: string }[] {
	const rows = [
		{ label: 'Type', value: stats.type },
		{ label: 'Name', value: stats.name },
		{ label: 'Hull', value: String(stats.hull) },
		{ label: 'Handling', value: String(stats.handling) },
		{ label: 'Crew', value: String(stats.crew) },
		{ label: 'Gear', value: String(stats.gear) },
		{ label: 'Cans', value: String(stats.cans) },
		{ label: 'Weapons', value: stats.weapons.join(', ') || 'None' },
		{ label: 'Upgrades', value: stats.upgrades.join(', ') || 'None' },
		{ label: 'Perks', value: stats.perks.join(', ') },
		{ label: 'Slots', value: stats.slots },
		{ label: 'Weight', value: stats.weight },
		{ label: 'Armour', value: stats.armour },
		{ label: 'Driver', value: stats.driver }
	];
	return rows.filter((row) => row.value.length > 0);
}

/**
 * Gallery publication is the public opt-in. Unsharing clears showInGallery
 * (or deletes the document). A report takedown or an admin hide sets hidden.
 * Approval holds the page until published is true.
 */
export function isPubliclySharedCar(raw: unknown): boolean {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
	const data = raw as Record<string, unknown>;
	return data.showInGallery === true && data.published === true && data.hidden === false;
}

/**
 * Copies only the public card. Returns null when the car is not publicly
 * shared, so a hidden, unshared, or not-yet-approved photo cannot be rendered.
 * `imageUrl` is chosen by the caller (the Storage media URL). A URL stored on
 * the document is ignored.
 */
export function publicCarFromDocument(shareId: string, raw: unknown, imageUrl: string): PublicCar | null {
	if (!PHOTO_ID_PATTERN.test(shareId) || !isPubliclySharedCar(raw)) return null;
	if (!isPublicImageUrl(imageUrl)) return null;
	const data = raw as Record<string, unknown>;
	const stats = data.vehicleStats == null ? null : sanitizeVehicleStats(data.vehicleStats);
	const car: PublicCar = {
		shareId,
		displayName: publicDisplayName(data.displayName) ?? BUDDY_FALLBACK_NAME,
		vehicleType: publicText(data.vehicleType, 80) || 'Vehicle',
		teamName: publicText(data.teamName, 80),
		caption: publicText(data.caption, 140),
		imageUrl,
		vehicleStats: stats
	};
	if (Object.keys(car).some((key) => !PUBLIC_CAR_KEYS.includes(key as (typeof PUBLIC_CAR_KEYS)[number]))) return null;
	return car;
}

export function isPublicImageUrl(url: string): boolean {
	if (!url.startsWith('https://firebasestorage.googleapis.com/')) return false;
	if (url.includes('token=') || url.includes('@')) return false;
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'https:' && parsed.hostname === 'firebasestorage.googleapis.com';
	} catch {
		return false;
	}
}

/** UTM tags are optional. Omit `channel` and the link is only the car page. */
export function carShareUrl(shareId: string, channel?: ShareChannel, origin = SITE_ORIGIN): string {
	const url = new URL(carPagePath(shareId), origin);
	if (!channel) return url.toString();
	url.searchParams.set('utm_source', channel);
	url.searchParams.set('utm_medium', channel === 'copy' || channel === 'native' ? 'share' : 'social');
	url.searchParams.set('utm_campaign', 'shared_car');
	return url.toString();
}

export function shareIntent(channel: 'x' | 'facebook' | 'reddit', pageUrl: string, title: string): string {
	if (channel === 'x') {
		const intent = new URL('https://x.com/intent/post');
		intent.searchParams.set('text', title);
		intent.searchParams.set('url', pageUrl);
		return intent.toString();
	}
	if (channel === 'facebook') {
		const intent = new URL('https://www.facebook.com/sharer/sharer.php');
		intent.searchParams.set('u', pageUrl);
		return intent.toString();
	}
	const intent = new URL('https://www.reddit.com/submit');
	intent.searchParams.set('url', pageUrl);
	intent.searchParams.set('title', title);
	return intent.toString();
}

export function iframeSnippet(shareId: string, title: string, origin = SITE_ORIGIN): string {
	const src = `${origin}${embedPagePath(shareId)}`;
	const safeTitle = title.replace(/"/g, '');
	return `<iframe src="${src}" title="${safeTitle}" width="360" height="480" style="max-width:100%;border:0" loading="lazy"></iframe>`;
}

/** HTML card for sites that strip iframes. The link goes to the car page. */
export function htmlCardSnippet(car: PublicCar, origin = SITE_ORIGIN): string {
	const page = `${origin}${carPagePath(car.shareId)}`;
	const label = carLabel(car);
	const image = escapeHtml(car.imageUrl);
	const text = escapeHtml(label);
	const href = escapeHtml(page);
	return `<a href="${href}"><img src="${image}" alt="${text}" width="360"></a>\n<p><a href="${href}">${text}</a></p>\n<p><a href="${href}">${VIA_GASLANDS}</a></p>`;
}

export type CarRoute =
	| { kind: 'page' | 'embed'; shareId: string }
	| { kind: 'missing' }
	| { kind: 'other' };

/** Accepts the Cloud Functions path with or without the function-name prefix. */
export function parseCarPath(input: string): CarRoute {
	const raw = (input.split('?')[0] || '/').trim();
	let path = raw;
	if (raw.startsWith('http://') || raw.startsWith('https://')) {
		try {
			path = new URL(raw).pathname;
		} catch {
			return { kind: 'other' };
		}
	}
	path = path.replace(/\/{2,}/g, '/');
	if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
	path = path.replace(/^\/renderSharedCar(?=\/|$)/, '') || '/';
	const embed = /^\/embed\/car\/([^/]+)$/.exec(path);
	const page = /^\/car\/([^/]+)$/.exec(path);
	const id = embed?.[1] ?? page?.[1];
	if (!id) {
		if (path === '/car' || path === '/embed' || path.startsWith('/car/') || path.startsWith('/embed/')) return { kind: 'missing' };
		return { kind: 'other' };
	}
	let decoded = id;
	try {
		decoded = decodeURIComponent(id);
	} catch {
		return { kind: 'missing' };
	}
	if (!PHOTO_ID_PATTERN.test(decoded)) return { kind: 'missing' };
	return { kind: embed ? 'embed' : 'page', shareId: decoded };
}

export interface CarHttpResult {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
}

/**
 * Full HTML response, including Open Graph tags, with no browser JavaScript
 * required. CloudFront sends /car/* and /embed/* here. A 410 (instead of 404)
 * keeps CloudFront from replacing the body with the site 404 page.
 */
export async function renderCarHttp(input: {
	method: string;
	path: string;
	bucket: string;
	load: (shareId: string) => Promise<unknown>;
}): Promise<CarHttpResult> {
	const method = input.method.toUpperCase();
	if (method !== 'GET' && method !== 'HEAD') {
		return {
			statusCode: 405,
			headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
			body: method === 'HEAD' ? '' : 'Method not allowed'
		};
	}
	const head = method === 'HEAD';
	const route = parseCarPath(input.path);
	if (route.kind === 'other') {
		return plain(404, head ? '' : 'Not found');
	}
	if (route.kind === 'missing') {
		return htmlResult(410, 'page', null, false, head);
	}
	let raw: unknown = null;
	let failed = false;
	try {
		raw = await input.load(route.shareId);
	} catch {
		failed = true;
	}
	if (failed) return htmlResult(503, route.kind, null, true, head);
	let imageUrl = '';
	try {
		imageUrl = sharedPhotoMediaUrl(input.bucket, route.shareId);
	} catch {
		imageUrl = '';
	}
	const car = publicCarFromDocument(route.shareId, raw, imageUrl);
	if (!car) return htmlResult(410, route.kind, null, false, head);
	return htmlResult(200, route.kind, car, false, head);
}

function plain(statusCode: number, body: string): CarHttpResult {
	return {
		statusCode,
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff',
			'X-Robots-Tag': 'noindex'
		},
		body
	};
}

function htmlResult(
	statusCode: number,
	kind: 'page' | 'embed',
	car: PublicCar | null,
	unavailable = false,
	head = false
): CarHttpResult {
	const embed = kind === 'embed';
	const headers: Record<string, string> = {
		'Content-Type': 'text/html; charset=utf-8',
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
		'Referrer-Policy': 'strict-origin-when-cross-origin',
		'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
		'Content-Security-Policy': contentSecurityPolicy(embed),
		'X-Robots-Tag': statusCode === 200 && !embed ? 'index, follow' : 'noindex',
		'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
	};
	if (!embed) headers['X-Frame-Options'] = 'DENY';
	return {
		statusCode,
		headers,
		body: head ? '' : carDocument(kind, car, unavailable)
	};
}

function contentSecurityPolicy(embed: boolean): string {
	return [
		"default-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		"img-src https://firebasestorage.googleapis.com",
		"style-src 'unsafe-inline'",
		"script-src 'unsafe-inline'",
		embed ? 'frame-ancestors *' : "frame-ancestors 'none'"
	].join('; ');
}

function carDocument(kind: 'page' | 'embed', car: PublicCar | null, unavailable: boolean): string {
	if (!car) {
		const message = unavailable ? 'This car could not be loaded.' : NOT_SHARED_NOTICE;
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(message)} - Gaslands Garage</title>
<meta name="robots" content="noindex">
<meta name="description" content="${escapeHtml(message)}">
<style>${PAGE_CSS}</style>
</head>
<body>
<main class="wrap">
<h1>${escapeHtml(message)}</h1>
<p><a href="${escapeHtml(SITE_ORIGIN)}/gallery">Back to the Gallery</a></p>
<p><a href="${escapeHtml(`${SITE_ORIGIN}/builder`)}">${escapeHtml(BUILD_CTA)}</a></p>
</main>
</body>
</html>`;
	}

	const label = carLabel(car);
	const pageUrl = `${SITE_ORIGIN}${carPagePath(car.shareId)}`;
	const description = describeCar(car);
	const title = `${label} - Gaslands Garage`;
	const embed = kind === 'embed';
	const robots = embed ? '<meta name="robots" content="noindex">' : '';
	const imageMeta = `<meta property="og:image" content="${escapeHtml(car.imageUrl)}">
<meta property="og:image:alt" content="${escapeHtml(label)}">
<meta name="twitter:image" content="${escapeHtml(car.imageUrl)}">
<meta name="twitter:card" content="summary_large_image">`;
	const stats = car.vehicleStats
		? `<dl>${statRows(car.vehicleStats)
				.map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`)
				.join('')}</dl>`
		: '<p class="quiet">This player shared the photo without the car\'s build.</p>';
	const body = embed ? embedBody(car, pageUrl, label, stats) : pageBody(car, label, stats);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(pageUrl)}">
${robots}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Gaslands Garage">
<meta property="og:title" content="${escapeHtml(label)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(pageUrl)}">
${imageMeta}
<meta name="twitter:title" content="${escapeHtml(label)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<style>${PAGE_CSS}</style>
</head>
<body>
${body}
${embed ? '' : SHARE_SCRIPT}
</body>
</html>`;
}

function pageBody(car: PublicCar, label: string, stats: string): string {
	const copyUrl = carShareUrl(car.shareId, 'copy');
	const xUrl = shareIntent('x', carShareUrl(car.shareId, 'x'), label);
	const facebookUrl = shareIntent('facebook', carShareUrl(car.shareId, 'facebook'), label);
	const redditUrl = shareIntent('reddit', carShareUrl(car.shareId, 'reddit'), label);
	const nativeUrl = carShareUrl(car.shareId, 'native');
	const caption = car.caption ? `<p>${escapeHtml(car.caption)}</p>` : '';
	const team = car.teamName ? `<p>${escapeHtml(car.vehicleType)} · ${escapeHtml(car.teamName)}</p>` : `<p>${escapeHtml(car.vehicleType)}</p>`;
	return `<main class="wrap">
<article>
<img src="${escapeHtml(car.imageUrl)}" alt="${escapeHtml(car.caption || label)}">
<h1>${escapeHtml(label)}</h1>
<p class="by">Painted by ${escapeHtml(car.displayName)}</p>
${team}
${caption}
${stats}
<p class="share">
<button type="button" data-copy="${escapeHtml(copyUrl)}">Copy link</button>
<a href="${escapeHtml(xUrl)}" rel="noopener noreferrer">X</a>
<a href="${escapeHtml(facebookUrl)}" rel="noopener noreferrer">Facebook</a>
<a href="${escapeHtml(redditUrl)}" rel="noopener noreferrer">Reddit</a>
<button type="button" hidden data-native-share data-url="${escapeHtml(nativeUrl)}" data-title="${escapeHtml(label)}">Share</button>
</p>
<p data-share-note></p>
<p><a class="cta" href="${escapeHtml(`${SITE_ORIGIN}/builder`)}">${escapeHtml(BUILD_CTA)}</a></p>
<section>
<h2>Embed this car</h2>
<label>iframe
<textarea readonly rows="4">${escapeHtml(iframeSnippet(car.shareId, label))}</textarea>
</label>
<label>HTML card
<textarea readonly rows="4">${escapeHtml(htmlCardSnippet(car))}</textarea>
</label>
</section>
</article>
</main>`;
}

function embedBody(car: PublicCar, pageUrl: string, label: string, stats: string): string {
	const href = escapeHtml(pageUrl);
	const text = escapeHtml(label);
	return `<main class="wrap embed">
<article>
<a href="${href}" target="_top"><img src="${escapeHtml(car.imageUrl)}" alt="${escapeHtml(car.caption || label)}"></a>
<h1><a href="${href}" target="_top">${text}</a></h1>
<p class="by">Painted by ${escapeHtml(car.displayName)}</p>
${stats}
<p class="via"><a href="${href}" target="_top">${VIA_GASLANDS}</a></p>
</article>
</main>`;
}

function describeCar(car: PublicCar): string {
	const team = car.teamName ? ` from ${car.teamName}` : '';
	const caption = car.caption ? ` ${car.caption}` : '';
	return `${car.displayName}'s ${car.vehicleType}${team} on Gaslands Garage.${caption}`.slice(0, 200);
}

const SHARE_SCRIPT = `<script>
(function () {
  function note(message) {
    var el = document.querySelector('[data-share-note]');
    if (el) el.textContent = message;
  }
  document.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target : null;
    if (!target) return;
    var copy = target.closest('[data-copy]');
    if (copy && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(copy.getAttribute('data-copy') || '').then(function () {
        note('Link copied');
      }, function () {
        note('Select the link and copy it.');
      });
      return;
    }
    var native = target.closest('[data-native-share]');
    if (native && navigator.share) {
      navigator.share({ title: native.getAttribute('data-title') || '', url: native.getAttribute('data-url') || '' }).catch(function () {});
    }
  });
  if (navigator.share && window.matchMedia('(max-width: 640px)').matches) {
    var buttons = document.querySelectorAll('[data-native-share]');
    for (var i = 0; i < buttons.length; i++) buttons[i].hidden = false;
  }
})();
</script>`;

const PAGE_CSS = `
body{margin:0;background:#f5f5f4;color:#1c1917;font:16px/1.45 ui-sans-serif,system-ui,sans-serif}
.wrap{max-width:42rem;margin:0 auto;padding:1.25rem}
.embed{max-width:22rem}
img{width:100%;height:auto;border-radius:12px;background:#e7e5e4;object-fit:cover}
h1{font-size:1.6rem;line-height:1.2;margin:0.8rem 0 0.3rem}
h1 a,a{color:#92400e}
.by,.quiet{color:#44403c}
dl{display:grid;grid-template-columns:1fr 1fr;gap:0.4rem 1rem;margin:1rem 0}
dt{font-size:0.75rem;font-weight:600;color:#57534e}
dd{margin:0}
.share{display:flex;flex-wrap:wrap;gap:0.4rem}
.share a,.share button,.cta{display:inline-flex;align-items:center;border-radius:8px;padding:0.35rem 0.7rem;text-decoration:none}
.share a,.share button{border:1px solid #d6d3d1;background:#fff;color:#1c1917;font:inherit;cursor:pointer}
.cta{background:#b45309;color:#fff;font-weight:700}
textarea{width:100%;box-sizing:border-box;font:0.8rem ui-monospace,monospace}
.via{font-size:0.9rem}
`;

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function publicText(value: unknown, max: number): string {
	if (typeof value !== 'string') return '';
	const text = value.replace(/[\u0000-\u001f]/g, '').trim().replace(/\s+/g, ' ').slice(0, max);
	if (text.includes('@')) return '';
	return text;
}

function assertShareId(shareId: string): void {
	if (!PHOTO_ID_PATTERN.test(shareId)) throw new Error('That car is not available.');
}
