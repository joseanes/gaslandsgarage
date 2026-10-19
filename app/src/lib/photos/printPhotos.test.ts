import { describe, expect, it } from 'vitest';
import { generatePrintableHtml } from '$lib/components/printing/PrintService';
import { escapeHtml, printablePhotoSrc, vehiclePhotoSectionHtml, waitForPrintImages } from './printPhotos';

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
			src: 'https://firebasestorage.googleapis.com/v0/b/gaslandsgarage-74ce6.appspot.com/o/users%2Fada%2Fphoto.webp?alt=media&token=abc',
			caption: '<img src=x onerror=alert(1)>'
		},
		{ src: 'javascript:alert(1)', caption: 'nope' },
		{ src: 'https://evil.example/photo.jpg', caption: 'nope' }
	]
};

describe('print photo html', () => {
	it('escapes captions and drops addresses that are not this site or a local preview', () => {
		const html = vehiclePhotoSectionHtml(vehicle);
		expect(html).toContain('firebasestorage.googleapis.com');
		expect(html).toContain('&amp;token=abc');
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(html).not.toContain('<img src=x');
		expect(html).not.toContain('onerror=alert(1)>');
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('evil.example');
		expect(printablePhotoSrc('data:image/svg+xml;base64,PHN2Zy8+')).toBeNull();
		expect(printablePhotoSrc('http://127.0.0.1:9199/v0/b/bucket/o/photo.webp?alt=media&token=abc')).toContain('127.0.0.1:9199');
		expect(printablePhotoSrc('http://127.0.0.1:8080/photo.webp')).toBeNull();
		expect(escapeHtml(`"quoted"`)).toBe('&quot;quoted&quot;');
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
			expect(html).toContain('firebasestorage.googleapis.com');
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
});
