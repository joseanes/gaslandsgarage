/** Photo markup for the print sheet. Captions and addresses are escaped. Image addresses are allow-listed. */

export interface PrintPhoto {
	src: string;
	caption?: string;
}

export function escapeHtml(value: unknown): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Download URLs from this site's bucket, plus local previews. SVG data URLs are left out. */
export function printablePhotoSrc(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const src = value.trim();
	if (src.length === 0 || src.length > 2000) return null;
	if (/[\u0000-\u001f\s]/.test(src)) return null;
	if (src.startsWith('https://firebasestorage.googleapis.com/')) return src;
	// Storage emulator download URLs, so a local print preview can load the same photo.
	if (/^https?:\/\/(?:127\.0\.0\.1|localhost):9199\/v0\/b\//.test(src)) return src;
	if (src.startsWith('blob:')) return src;
	if (/^data:image\/(?:webp|jpeg|jpg|png);base64,[a-z0-9+/=]+$/i.test(src)) return src;
	return null;
}

export function vehiclePhotoSectionHtml(vehicle: { name?: unknown; printPhotos?: unknown }): string {
	const photos = Array.isArray(vehicle?.printPhotos) ? vehicle.printPhotos : [];
	const figures = photos
		.map((photo) => {
			if (!photo || typeof photo !== 'object') return '';
			const record = photo as PrintPhoto;
			const src = printablePhotoSrc(record.src);
			if (!src) return '';
			const caption = typeof record.caption === 'string' ? record.caption.trim() : '';
			const name = typeof vehicle?.name === 'string' && vehicle.name.trim() ? vehicle.name.trim() : 'this car';
			const alt = caption || `Painted photo of ${name}`;
			const figcaption = caption ? `<figcaption style="font-size:11px;margin-top:4px;">${escapeHtml(caption)}</figcaption>` : '';
			return `<figure style="margin:0;break-inside:avoid;page-break-inside:avoid;">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" style="display:block;max-width:2.4in;max-height:1.8in;object-fit:contain;border:1px solid #d6d3d1;" />
        ${figcaption}
      </figure>`;
		})
		.filter(Boolean);
	if (figures.length === 0) return '';
	return `<div class="vehicle-photos" style="display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 12px;">${figures.join('')}</div>`;
}

interface PrintImage {
	complete: boolean;
	addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
}

/** Resolves when every image has loaded or failed, or when the timeout wins. */
export function waitForPrintImages(doc: { images: ArrayLike<PrintImage> }, timeoutMs = 8000): Promise<void> {
	const images = Array.from(doc.images ?? []);
	if (images.length === 0) return Promise.resolve();
	return new Promise((resolve) => {
		let pending = 0;
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		const mark = () => {
			pending -= 1;
			if (pending <= 0) finish();
		};
		for (const image of images) {
			if (image.complete) continue;
			pending += 1;
			image.addEventListener('load', mark, { once: true });
			image.addEventListener('error', mark, { once: true });
		}
		if (pending === 0) {
			finish();
			return;
		}
		setTimeout(finish, timeoutMs);
	});
}
