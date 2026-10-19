import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUDDY_FALLBACK_NAME } from '../buddies/model';
import {
	BUILD_CTA,
	NOT_SHARED_NOTICE,
	VIA_GASLANDS,
	carShareUrl,
	htmlCardSnippet,
	iframeSnippet,
	parseCarPath,
	publicCarFromDocument,
	renderCarHttp,
	shareIntent,
	type PublicCar
} from './carPage';

const SHARE_ID = 'photoshare1';
const EMAIL = 'ada@example.com';
const UID = 'owneruid12345678';
const BUCKET = 'gaslandsgarage-74ce6.firebasestorage.app';
const IMAGE = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/shared-photos%2F${SHARE_ID}?alt=media`;

function sharedDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		photoId: SHARE_ID,
		displayName: 'Casey',
		vehicleType: 'Performance Car',
		teamName: 'Rust Runners',
		caption: 'Orange and loud',
		createdAt: '2026-10-19T00:00:00.000Z',
		hidden: false,
		published: true,
		showInGallery: true,
		vehicleStats: {
			type: 'Performance Car',
			name: 'Rust Rocket',
			hull: 8,
			handling: 4,
			crew: 1,
			gear: 5,
			cans: 45,
			weapons: ['Heavy Machine Gun'],
			upgrades: ['Ram'],
			perks: [],
			slots: '2',
			weight: 'Light',
			armour: '',
			driver: 'Casey'
		},
		...overrides
	};
}

function load(doc: unknown) {
	return async () => doc;
}

describe('public car privacy gate', () => {
	it('returns only allow-listed fields for a published gallery car', () => {
		const car = publicCarFromDocument(SHARE_ID, sharedDoc(), IMAGE);
		expect(car).toMatchObject({
			shareId: SHARE_ID,
			displayName: 'Casey',
			vehicleType: 'Performance Car',
			teamName: 'Rust Runners',
			caption: 'Orange and loud',
			imageUrl: IMAGE
		});
		expect(Object.keys(car ?? {}).sort()).toEqual([
			'caption',
			'displayName',
			'imageUrl',
			'shareId',
			'teamName',
			'vehicleStats',
			'vehicleType'
		]);
		expect(car?.vehicleStats?.name).toBe('Rust Rocket');
		expect(car?.vehicleStats?.cans).toBe(45);
		expect(JSON.stringify(car)).not.toContain('createdAt');
	});

	it.each([
		['unshared', { showInGallery: false }],
		['buddies only', { showInGallery: false, showToBuddies: true }],
		['share link only', { showInGallery: false, showOnShareLink: true }],
		['waiting for approval', { published: false }],
		['hidden by reports', { hidden: true }],
		['hidden flag missing', { hidden: undefined }],
		['missing document', null]
	])('stays dark when the car is %s', (_label, doc) => {
		expect(publicCarFromDocument(SHARE_ID, doc, IMAGE)).toBeNull();
	});

	it('drops private fields, emails, and a caller-supplied image URL', () => {
		const car = publicCarFromDocument(
			SHARE_ID,
			sharedDoc({
				displayName: EMAIL,
				teamName: `Crew ${EMAIL}`,
				caption: `see ${EMAIL}`,
				ownerUid: UID,
				userId: UID,
				email: EMAIL,
				userEmail: EMAIL,
				googleName: 'Ada Google',
				imageUrl: 'https://evil.example/track.png',
				vehicleStats: {
					type: 'Car',
					name: EMAIL,
					hull: 1,
					handling: 1,
					crew: 1,
					gear: 1,
					cans: 20,
					weapons: [EMAIL, 'Minigun'],
					upgrades: [],
					perks: [],
					slots: '',
					weight: '',
					armour: '',
					driver: '',
					ownerUid: UID
				}
			}),
			IMAGE
		);
		expect(car?.displayName).toBe(BUDDY_FALLBACK_NAME);
		expect(car?.teamName).toBe('');
		expect(car?.caption).toBe('');
		expect(car?.imageUrl).toBe(IMAGE);
		expect(car?.vehicleStats).toBeNull();
		const json = JSON.stringify(car);
		expect(json).not.toContain(EMAIL);
		expect(json).not.toContain(UID);
		expect(json).not.toContain('evil.example');
		expect(json).not.toContain('ownerUid');
		expect(json).not.toContain('googleName');
	});

	it('rejects a short id, a tokenised image, and a non-storage image', () => {
		expect(publicCarFromDocument('short', sharedDoc(), IMAGE)).toBeNull();
		expect(publicCarFromDocument(SHARE_ID, sharedDoc(), `${IMAGE}&token=secret`)).toBeNull();
		expect(publicCarFromDocument(SHARE_ID, sharedDoc(), 'https://evil.example/car.png')).toBeNull();
	});
});

describe('car page HTTP', () => {
	it('serves Open Graph and Twitter card tags without requiring JavaScript', async () => {
		const result = await renderCarHttp({
			method: 'GET',
			path: `/car/${SHARE_ID}`,
			bucket: BUCKET,
			load: load(sharedDoc())
		});
		expect(result.statusCode).toBe(200);
		expect(result.headers['Content-Type']).toContain('text/html');
		expect(result.headers['Cache-Control']).toBe('no-store');
		expect(result.headers['X-Frame-Options']).toBe('DENY');
		expect(result.headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
		expect(result.body).toContain('property="og:title" content="Rust Rocket"');
		expect(result.body).toContain('property="og:image"');
		expect(result.body).toContain('name="twitter:card" content="summary_large_image"');
		expect(result.body).toContain('name="twitter:image"');
		expect(result.body).toContain(IMAGE);
		expect(result.body).toContain('Casey');
		expect(result.body).toContain('Heavy Machine Gun');
		expect(result.body).toContain('Ram');
		expect(result.body).toContain('>45<');
		expect(result.body).toContain(BUILD_CTA);
		expect(result.body).toContain('https://x.com/intent/post');
		expect(result.body).toContain('facebook.com/sharer');
		expect(result.body).toContain('reddit.com/submit');
		expect(result.body).toContain('pinterest.com/pin/create/button/');
		expect(result.body).toContain('api.whatsapp.com/send');
		expect(result.body).toContain('bsky.app/intent/compose');
		expect(result.body).toContain('aria-label="Share on Facebook"');
		expect(result.body).toContain('aria-label="Copy link"');
		expect(result.body).toContain('class="site"');
		expect(result.body).toContain('utm_source=copy');
		expect(result.body).not.toContain('<script>alert');
	});

	it('escapes markup in public text', async () => {
		const result = await renderCarHttp({
			method: 'GET',
			path: `/car/${SHARE_ID}`,
			bucket: BUCKET,
			load: load(
				sharedDoc({
					caption: '<script>alert(1)</script>',
					displayName: 'Casey <img src=x onerror=alert(1)>'
				})
			)
		});
		expect(result.statusCode).toBe(200);
		expect(result.body).not.toContain('<script>alert');
		expect(result.body).not.toContain('<img src=x');
		expect(result.body).toContain('&lt;script&gt;');
	});

	it.each([
		['deleted', null],
		['unshared', sharedDoc({ showInGallery: false, showToBuddies: true })],
		['hidden', sharedDoc({ hidden: true })],
		['unpublished', sharedDoc({ published: false })]
	])('goes dark with a notice when the photo is %s', async (_label, doc) => {
		const page = await renderCarHttp({ method: 'GET', path: `/car/${SHARE_ID}`, bucket: BUCKET, load: load(doc) });
		const embed = await renderCarHttp({
			method: 'GET',
			path: `/embed/car/${SHARE_ID}`,
			bucket: BUCKET,
			load: load(doc)
		});
		for (const result of [page, embed]) {
			expect(result.statusCode).toBe(410);
			expect(result.body).toContain(NOT_SHARED_NOTICE);
			expect(result.headers['X-Robots-Tag']).toBe('noindex');
			expect(result.body).not.toContain(IMAGE);
			expect(result.body).not.toContain('Casey');
			expect(result.body).not.toContain('Rust Rocket');
			expect(result.body).not.toContain('og:image');
		}
	});

	it('does not echo private fields when a dark document still has them', async () => {
		const result = await renderCarHttp({
			method: 'GET',
			path: `/renderSharedCar/car/${SHARE_ID}`,
			bucket: BUCKET,
			load: load(sharedDoc({ hidden: true, ownerUid: UID, email: EMAIL, displayName: EMAIL }))
		});
		expect(result.statusCode).toBe(410);
		expect(result.body).not.toContain(UID);
		expect(result.body).not.toContain(EMAIL);
		expect(result.body).not.toContain('ownerUid');
	});

	it('fails closed when the lookup throws', async () => {
		const result = await renderCarHttp({
			method: 'GET',
			path: `/car/${SHARE_ID}`,
			bucket: BUCKET,
			load: async () => {
				throw new Error(`firestore blew up for ${EMAIL}`);
			}
		});
		expect(result.statusCode).toBe(503);
		expect(result.body).toContain('could not be loaded');
		expect(result.body).not.toContain(EMAIL);
	});

	it('serves a frameable embed that links back with attribution', async () => {
		const result = await renderCarHttp({
			method: 'GET',
			path: `/embed/car/${SHARE_ID}`,
			bucket: BUCKET,
			load: load(sharedDoc())
		});
		expect(result.statusCode).toBe(200);
		expect(result.headers['X-Frame-Options']).toBeUndefined();
		expect(result.headers['Content-Security-Policy']).toContain('frame-ancestors *');
		expect(result.headers['X-Robots-Tag']).toBe('noindex');
		expect(result.body).toContain(`href="https://gaslandsgarage.com/car/${SHARE_ID}"`);
		expect(result.body).toContain(VIA_GASLANDS);
		expect(result.body).toContain('target="_top"');
		expect(result.body).not.toContain('Copy link');
		expect(result.body).not.toContain('class="site"');
		expect(result.body).not.toContain('data-copy');
	});

	it('rejects bad paths and methods without reflecting them', async () => {
		const missing = await renderCarHttp({ method: 'GET', path: '/car/nope', bucket: BUCKET, load: load(sharedDoc()) });
		expect(missing.statusCode).toBe(410);
		expect(missing.body).not.toContain('nope');
		const other = await renderCarHttp({ method: 'GET', path: '/builder', bucket: BUCKET, load: load(sharedDoc()) });
		expect(other.statusCode).toBe(404);
		const posted = await renderCarHttp({ method: 'POST', path: `/car/${SHARE_ID}`, bucket: BUCKET, load: load(sharedDoc()) });
		expect(posted.statusCode).toBe(405);
		const head = await renderCarHttp({ method: 'HEAD', path: `/car/${SHARE_ID}`, bucket: BUCKET, load: load(sharedDoc()) });
		expect(head.statusCode).toBe(200);
		expect(head.body).toBe('');
		expect(head.headers['Content-Type']).toContain('text/html');
	});
});

describe('share links and embed snippets', () => {
	const car = publicCarFromDocument(SHARE_ID, sharedDoc(), IMAGE) as PublicCar;

	it('adds UTM tags only when a channel is passed', () => {
		expect(carShareUrl(SHARE_ID)).toBe(`https://gaslandsgarage.com/car/${SHARE_ID}`);
		expect(carShareUrl(SHARE_ID)).not.toContain('utm_');
		const copy = new URL(carShareUrl(SHARE_ID, 'copy'));
		expect(copy.searchParams.get('utm_source')).toBe('copy');
		expect(copy.searchParams.get('utm_medium')).toBe('share');
		expect(copy.searchParams.get('utm_campaign')).toBe('shared_car');
		expect(new URL(carShareUrl(SHARE_ID, 'facebook')).searchParams.get('utm_medium')).toBe('social');
		expect(shareIntent('x', carShareUrl(SHARE_ID, 'x'), 'Rust Rocket')).toContain('utm_source%3Dx');
		expect(shareIntent('reddit', carShareUrl(SHARE_ID, 'reddit'), 'Rust Rocket')).toContain('reddit.com/submit');
		const pin = shareIntent('pinterest', carShareUrl(SHARE_ID, 'pinterest'), 'Rust Rocket', IMAGE);
		expect(pin).toContain('pinterest.com/pin/create/button/');
		expect(pin).toContain('media=');
		expect(shareIntent('pinterest', carShareUrl(SHARE_ID, 'pinterest'), 'Rust Rocket', 'data:image/svg')).not.toContain('media=');
		expect(shareIntent('whatsapp', carShareUrl(SHARE_ID, 'whatsapp'), 'Rust Rocket')).toContain('api.whatsapp.com/send');
		expect(shareIntent('bluesky', carShareUrl(SHARE_ID, 'bluesky'), 'Rust Rocket')).toContain('bsky.app/intent/compose');
		expect(new URL(carShareUrl(SHARE_ID, 'bluesky')).searchParams.get('utm_medium')).toBe('social');
	});

	it('builds an iframe and an HTML card that both point at the car page', () => {
		const iframe = iframeSnippet(SHARE_ID, 'Rust Rocket');
		expect(iframe).toContain(`https://gaslandsgarage.com/embed/car/${SHARE_ID}`);
		expect(iframe.startsWith('<iframe ')).toBe(true);
		const card = htmlCardSnippet(car);
		expect(card).toContain(`https://gaslandsgarage.com/car/${SHARE_ID}`);
		expect(card).toContain(VIA_GASLANDS);
		expect(card).toContain(IMAGE);
		expect(card).not.toContain(UID);
	});

	it('parses function and site paths', () => {
		expect(parseCarPath(`/car/${SHARE_ID}`)).toEqual({ kind: 'page', shareId: SHARE_ID });
		expect(parseCarPath(`/embed/car/${SHARE_ID}/`)).toEqual({ kind: 'embed', shareId: SHARE_ID });
		expect(parseCarPath(`/renderSharedCar/car/${SHARE_ID}`)).toEqual({ kind: 'page', shareId: SHARE_ID });
		expect(parseCarPath('/car/../secrets')).toEqual({ kind: 'missing' });
	});
});

describe('car page function source', () => {
	it('reads the public gallery document and no private collection', () => {
		const source = readFileSync(resolve(process.cwd(), '../functions/src/carPage.ts'), 'utf8');
		expect(source).toContain('sharedPhotos');
		expect(source).not.toContain('sharedPhotoPrivate');
		expect(source).not.toContain('getUser');
		expect(source).not.toContain('ownerUid');
		expect(source).not.toContain('password');
		expect(source).not.toContain('secret');
	});
});
