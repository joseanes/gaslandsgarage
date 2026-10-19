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
import {
	SHARE_BRANDS,
	SHARE_BRAND_COLOR,
	SHARE_BRAND_LABEL,
	copyMark,
	nativeShareMark,
	shareMark,
	shareMarkIsDisc
} from './shareMarks';

export const SITE_ORIGIN = 'https://gaslandsgarage.com';
export const BUILD_CTA = 'Build your own team on Gaslands Garage';
export const VIA_GASLANDS = 'via Gaslands Garage';
export const NOT_SHARED_NOTICE = 'This car is no longer shared.';
export const CAR_PAGE_FUNCTION = 'renderSharedCar';

export const SHARE_CHANNELS = ['copy', 'x', 'facebook', 'reddit', 'pinterest', 'whatsapp', 'bluesky', 'native'] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];
export type ShareIntentChannel = 'x' | 'facebook' | 'reddit' | 'pinterest' | 'whatsapp' | 'bluesky';

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

export function shareIntent(channel: ShareIntentChannel, pageUrl: string, title: string, imageUrl = ''): string {
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
	if (channel === 'reddit') {
		const intent = new URL('https://www.reddit.com/submit');
		intent.searchParams.set('url', pageUrl);
		intent.searchParams.set('title', title);
		return intent.toString();
	}
	if (channel === 'pinterest') {
		const intent = new URL('https://pinterest.com/pin/create/button/');
		intent.searchParams.set('url', pageUrl);
		intent.searchParams.set('description', title);
		if (imageUrl.startsWith('https://')) intent.searchParams.set('media', imageUrl);
		return intent.toString();
	}
	if (channel === 'whatsapp') {
		const intent = new URL('https://api.whatsapp.com/send');
		intent.searchParams.set('text', `${title} ${pageUrl}`.trim());
		return intent.toString();
	}
	const intent = new URL('https://bsky.app/intent/compose');
	intent.searchParams.set('text', `${title} ${pageUrl}`.trim());
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
${siteHeader()}
<main class="sheet narrow">
<h1>${escapeHtml(message)}</h1>
<p><a class="textlink" href="${escapeHtml(SITE_ORIGIN)}/gallery">Back to the Gallery</a></p>
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
	const body = embed ? embedBody(car, pageUrl, label) : pageBody(car, label);
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

function siteHeader(): string {
	const home = escapeHtml(SITE_ORIGIN);
	const builder = escapeHtml(`${SITE_ORIGIN}/builder`);
	return `<header class="site">
<a class="brand" href="${home}" aria-label="Gaslands Garage home">
<svg class="crest" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="#9a3412"/><circle cx="16" cy="16" r="7" fill="none" stroke="#fdba74" stroke-width="2"/><path fill="#fff7ed" d="M7 17h18l-3.2 6H10.2z"/></svg>
<span class="word"><span class="gas">Gaslands</span> Garage</span>
</a>
<a class="cta" href="${builder}">${escapeHtml(BUILD_CTA)}</a>
</header>`;
}

function shareBar(car: PublicCar, label: string): string {
	const buttons = SHARE_BRANDS.map((brand) => {
		const href = escapeHtml(shareIntent(brand, carShareUrl(car.shareId, brand), label, car.imageUrl));
		const name = escapeHtml(`Share on ${SHARE_BRAND_LABEL[brand]}`);
		const disc = shareMarkIsDisc(brand);
		const klass = disc ? 'mark disc' : `mark glyph ${brand}`;
		const color = disc ? ` style="color:${SHARE_BRAND_COLOR[brand]}"` : '';
		return `<a class="${klass}"${color} href="${href}" target="_blank" rel="noopener noreferrer" aria-label="${name}" title="${name}">${shareMark(brand)}</a>`;
	}).join('');
	const copyUrl = escapeHtml(carShareUrl(car.shareId, 'copy'));
	const nativeUrl = escapeHtml(carShareUrl(car.shareId, 'native'));
	const safeLabel = escapeHtml(label);
	return `<nav class="share" aria-label="Share this car">${buttons}<button type="button" class="mark glyph copy" data-copy="${copyUrl}" aria-label="Copy link" title="Copy link">${copyMark()}</button><button type="button" class="mark glyph native" hidden data-native-share data-url="${nativeUrl}" data-title="${safeLabel}" aria-label="Share" title="Share">${nativeShareMark()}</button></nav>`;
}

function gameCard(stats: VehicleStatsSnapshot): string {
	const chips = [
		['Hull', String(stats.hull)],
		['Handling', String(stats.handling)],
		['Crew', String(stats.crew)],
		['Gear', String(stats.gear)]
	];
	const chipHtml = chips.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
	const pills = [...stats.weapons, ...stats.upgrades, ...stats.perks].filter((item) => item.trim().length > 0);
	const pillHtml = pills.length ? `<ul class="pills">${pills.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
	const extras = [
		['Weight', stats.weight],
		['Slots', stats.slots],
		['Armour', stats.armour],
		['Driver', stats.driver]
	].filter((row) => row[1].trim().length > 0);
	const extraHtml = extras.length
		? `<dl class="extra">${extras.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`
		: '';
	return `<section class="game" aria-label="Vehicle card">
<div class="gamehead">
<div><p class="kicker">${escapeHtml(stats.type || 'Vehicle')}</p><p class="game-name">${escapeHtml(stats.name)}</p></div>
<span class="cans"><span>Cans</span><b>${escapeHtml(String(stats.cans))}</b></span>
</div>
<dl class="stats">${chipHtml}</dl>
${pillHtml}
${extraHtml}
</section>`;
}

function pageBody(car: PublicCar, label: string): string {
	const caption = car.caption ? `<p class="caption">${escapeHtml(car.caption)}</p>` : '';
	const team = car.teamName
		? `<p class="team">${escapeHtml(car.vehicleType)} · ${escapeHtml(car.teamName)}</p>`
		: `<p class="team">${escapeHtml(car.vehicleType)}</p>`;
	const card = car.vehicleStats ? gameCard(car.vehicleStats) : '<p class="quiet">This player shared the photo without the car\'s build.</p>';
	return `${siteHeader()}
<main class="sheet">
<article class="poster">
<figure class="hero">
<img src="${escapeHtml(car.imageUrl)}" alt="${escapeHtml(car.caption || label)}">
<figcaption>
<p class="kicker">${escapeHtml(car.vehicleType)}</p>
<h1>${escapeHtml(label)}</h1>
<p class="by">Painted by ${escapeHtml(car.displayName)}</p>
</figcaption>
</figure>
<div class="body">
${team}
${caption}
${card}
${shareBar(car, label)}
<p class="note" data-share-note></p>
</div>
</article>
<section class="embed-box">
<h2>Embed this car</h2>
<label>iframe
<textarea readonly rows="4">${escapeHtml(iframeSnippet(car.shareId, label))}</textarea>
</label>
<label>HTML card
<textarea readonly rows="4">${escapeHtml(htmlCardSnippet(car))}</textarea>
</label>
</section>
</main>`;
}

function embedBody(car: PublicCar, pageUrl: string, label: string): string {
	const href = escapeHtml(pageUrl);
	const text = escapeHtml(label);
	const card = car.vehicleStats ? gameCard(car.vehicleStats) : '';
	return `<main class="sheet embed">
<article class="poster">
<a class="hero-link" href="${href}" target="_top"><img src="${escapeHtml(car.imageUrl)}" alt="${escapeHtml(car.caption || label)}"></a>
<div class="body">
<p class="kicker">${escapeHtml(car.vehicleType)}</p>
<h1><a href="${href}" target="_top">${text}</a></h1>
<p class="by">Painted by ${escapeHtml(car.displayName)}</p>
${card}
<p class="via"><a href="${href}" target="_top">${VIA_GASLANDS}</a></p>
</div>
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
  if (navigator.share && window.matchMedia('(max-width: 640px), (hover: none) and (pointer: coarse)').matches) {
    var buttons = document.querySelectorAll('[data-native-share]');
    for (var i = 0; i < buttons.length; i++) buttons[i].hidden = false;
  }
})();
</script>`;

const PAGE_CSS = `
body{margin:0;color:#fafaf9;color-scheme:dark;font:16px/1.45 ui-sans-serif,system-ui,sans-serif;background:radial-gradient(1100px 420px at 8% -10%,rgba(194,65,12,.38),transparent 55%),radial-gradient(800px 360px at 100% 0,rgba(120,53,15,.5),transparent 50%),repeating-linear-gradient(135deg,rgba(255,255,255,.025) 0 1px,transparent 1px 8px),#1c1917}
.site{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.6rem 1rem;background:#0c0a09;border-bottom:1px solid #44403c;position:sticky;top:0}
.brand{display:flex;align-items:center;gap:.55rem;color:#fafaf9;text-decoration:none;font-weight:800;letter-spacing:.02em}
.crest{width:32px;height:32px;flex:0 0 auto}
.gas{color:#f59e0b}
.cta{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:.45rem .8rem;background:linear-gradient(180deg,#fbbf24,#c2410c);color:#1c1917;font-weight:800;font-size:.78rem;text-decoration:none;text-align:center}
.sheet{max-width:52rem;margin:0 auto;padding:1.25rem 1rem 2rem}
.sheet.narrow{max-width:40rem}
.embed{max-width:22rem;padding:.5rem}
.poster{overflow:hidden;border:1px solid #9a3412;border-radius:18px;background:radial-gradient(700px 220px at 0 0,rgba(234,88,12,.28),transparent 55%),#1c1917;box-shadow:0 24px 50px rgba(0,0,0,.35)}
.hero{position:relative;margin:0}
.hero img,.hero-link img{display:block;width:100%;max-height:70vh;aspect-ratio:16/10;object-fit:cover;background:#292524}
.hero figcaption{position:absolute;left:0;right:0;bottom:0;padding:2.4rem 1.2rem 1rem;background:linear-gradient(transparent,rgba(12,10,9,.94) 62%)}
.kicker{margin:0;font-size:.72rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#fdba74}
h1{margin:.15rem 0 0;font-size:clamp(1.8rem,4vw,3rem);line-height:1.02;letter-spacing:-.03em}
h1 a,.textlink,.via a{color:#fdba74}
.body{padding:1rem 1.2rem 1.3rem}
.team{margin:0;color:#fdba74;font-weight:700}
.caption{margin:.35rem 0 0;font-size:1.05rem}
.by,.quiet,.note{color:#d6d3d1}
.game{margin-top:1rem;border-radius:16px;border:1px solid #c2410c;background:linear-gradient(180deg,rgba(254,215,170,.08),transparent 28%),radial-gradient(circle at top,#44403c,#1c1917 62%);padding:.9rem;box-shadow:inset 0 0 0 1px rgba(254,215,170,.12)}
.gamehead{display:flex;justify-content:space-between;align-items:center;gap:.75rem}
.game-name{margin:.1rem 0 0;font-size:1.25rem;font-weight:800}
.cans{width:68px;height:68px;border-radius:999px;border:2px solid #fdba74;background:#0c0a09;display:flex;flex-direction:column;align-items:center;justify-content:center;flex:0 0 auto}
.cans span{font-size:.62rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#fdba74}
.cans b{font-size:1.35rem;line-height:1}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:.4rem;margin:.8rem 0 0}
.stats div,.extra div{text-align:center;background:#0c0a09;border:1px solid #9a3412;border-radius:10px;padding:.35rem .2rem}
.stats dt,.extra dt{font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#fdba74}
.stats dd,.extra dd{margin:0;font-size:1.2rem;font-weight:800}
.extra{display:grid;grid-template-columns:repeat(2,1fr);gap:.4rem;margin:.75rem 0 0}
.extra dd{font-size:.95rem}
.pills{display:flex;flex-wrap:wrap;gap:.35rem;margin:.75rem 0 0;padding:0;list-style:none}
.pills li{border:1px solid #c2410c;background:#431407;color:#ffedd5;border-radius:999px;padding:.15rem .55rem;font-size:.72rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase}
.share{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:1rem}
.mark{width:36px;height:36px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;cursor:pointer;text-decoration:none;overflow:hidden;flex:0 0 36px;color:#fff;background:transparent}
.mark[hidden]{display:none}
.mark svg{display:block}
.mark.disc{background:#fff}
.mark.disc svg{width:36px;height:36px}
.mark.glyph svg{width:18px;height:18px}
.mark.x{background:#0F1419;box-shadow:inset 0 0 0 1px #e7e5e4}
.mark.bluesky{background:#1185FE}
.mark.copy{background:#292524;box-shadow:inset 0 0 0 1px #a8a29e}
.mark.native{background:#c2410c}
.mark:focus-visible{outline:2px solid #f59e0b;outline-offset:2px}
.embed-box{margin-top:1.25rem}
.embed-box h2{font-size:1.15rem;margin:0 0 .4rem}
textarea,label{display:block}
textarea{width:100%;box-sizing:border-box;margin:.25rem 0 .8rem;border-radius:8px;border:1px solid #44403c;background:#0c0a09;color:#fafaf9;font:.75rem ui-monospace,monospace;padding:.45rem}
.via{margin:.9rem 0 0;font-weight:700}
.hero-link{display:block}
@media (max-width:640px){.site{flex-wrap:wrap}.cta{font-size:.72rem}.stats{grid-template-columns:repeat(2,1fr)}}
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
