import { describe, expect, it } from 'vitest';
import { generatePrintableHtml } from '$lib/components/printing/PrintService';
import {
	escapeHtml,
	localPrintPhotos,
	printablePhotoSrc,
	revokePrintPhotosWhenClosed,
	vehiclePhotoSectionHtml,
	waitForPrintImages,
	waitForPrintSheet
} from './printPhotos';

const photoSrc = 'blob:http://127.0.0.1:4173/8c1a0b5e-1111-2222-3333-444455556666';

const vehicle = {
	id: 'v1',
	name: 'Zap <script>',
	type: 'sports_car',
	cost: 20,
	vehicleType: { name: 'Sports Car', maxHull: 10, handling: 5, maxGear: 6, crew: 1, weight: 2 },
	weaponObjects: [],
	upgradeObjects: [],
	perkObjects: [],
	printPhotos: [
		{
			src: photoSrc,
			caption: '<img src=x onerror=alert(1)>'
		},
		{ src: 'javascript:alert(1)', caption: 'nope' },
		{ src: 'https://evil.example/photo.jpg', caption: 'nope' },
		{
			src: 'https://firebasestorage.googleapis.com/v0/b/gaslandsgarage-74ce6.firebasestorage.app/o/users%2Fada%2Fphoto.webp?alt=media&token=secret',
			caption: 'token'
		}
	]
};

describe('print photo html', () => {
	it('escapes captions and keeps only local object URLs', () => {
		const html = vehiclePhotoSectionHtml(vehicle);
		expect(html).toContain('blob:http://127.0.0.1:4173/');
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(html).not.toContain('<img src=x');
		expect(html).not.toContain('onerror=alert(1)>');
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('evil.example');
		expect(html).not.toContain('token=secret');
		expect(html).not.toContain('firebasestorage.googleapis.com');
		expect(printablePhotoSrc('data:image/svg+xml;base64,PHN2Zy8+')).toBeNull();
		expect(printablePhotoSrc('https://firebasestorage.googleapis.com/v0/b/bucket/o/photo.webp?alt=media&token=abc')).toBeNull();
		expect(printablePhotoSrc('http://127.0.0.1:9199/v0/b/bucket/o/photo.webp?alt=media&token=abc')).toBeNull();
		expect(escapeHtml(`"quoted"`)).toBe('&quot;quoted&quot;');
	});

	it('creates an object URL from fetched bytes and revokes it when the print window closes', () => {
		const created: Blob[] = [];
		const revoked: string[] = [];
		const original = URL.revokeObjectURL;
		URL.revokeObjectURL = (url: string) => {
			revoked.push(url);
		};
		try {
			const local = localPrintPhotos([{ blob: new Blob(['jpeg']), caption: 'Red' }], (blob) => {
				created.push(blob);
				return 'blob:local-photo';
			});
			expect(created).toHaveLength(1);
			expect(local.photos).toEqual([{ src: 'blob:local-photo', caption: 'Red' }]);
			let closed = false;
			revokePrintPhotosWhenClosed(
				{
					addEventListener(_type: string, listener: () => void) {
						if (!closed) listener();
						closed = true;
					}
				} as Window,
				local.revoke
			);
			expect(revoked).toEqual(['blob:local-photo']);
			local.revoke();
			expect(revoked).toEqual(['blob:local-photo']);
		} finally {
			URL.revokeObjectURL = original;
		}
	});

	it('places the photo on classic, roster, and dashboard sheets', () => {
		for (const printStyle of ['classic', 'roster', 'dashboard']) {
			const html = generatePrintableHtml({
				teamName: 'Haulers & Co',
				totalCans: 20,
				maxCans: 50,
				sponsorName: 'Rutherford',
				vehicles: [vehicle],
				printStyle
			});
			expect(html).toContain('class="vehicle-photos"');
			expect(html).toContain('blob:http://127.0.0.1:4173/');
			expect(html).not.toContain('token=secret');
			expect(html).toContain('Haulers &amp; Co');
		}
	});

	it('waits until each image has loaded or failed', async () => {
		const pending = {
			complete: false,
			addEventListener(type: string, listener: () => void) {
				if (type === 'load') listener();
			}
		};
		const ready = { complete: true, addEventListener() {} };
		await expect(waitForPrintImages({ images: [ready, pending] })).resolves.toBeUndefined();
	});

	it('sees the sheet without a load event', async () => {
		const target = {
			closed: false,
			document: { querySelector: () => null as unknown }
		};
		const pending = waitForPrintSheet(target, 1000, async () => {
			target.document.querySelector = () => ({ tagName: 'H1' });
		});
		await expect(pending).resolves.toBeUndefined();
	});
});
