/** Photo markup for the print sheet. Captions and addresses are escaped. Image addresses are allow-listed. */

export interface PrintPhoto {
	src: string;
	caption?: string;
}

/** Bytes already fetched with the signed-in user's Storage access. */
export interface PrintPhotoBlob {
	blob: Blob;
	caption?: string;
}

/**
 * Turns fetched photo bytes into object URLs for the print sheet.
 * The returned revoke drops those URLs. Call it when the print window closes.
 */
export function localPrintPhotos(
	photos: PrintPhotoBlob[],
	createObjectURL: (blob: Blob) => string = (blob) => URL.createObjectURL(blob)
): { photos: PrintPhoto[]; revoke: () => void } {
	const urls: string[] = [];
	const mapped = photos.map((photo) => {
		const src = createObjectURL(photo.blob);
		urls.push(src);
		return { src, caption: photo.caption };
	});
	let revoked = false;
	return {
		photos: mapped,
		revoke() {
			if (revoked) return;
			revoked = true;
			for (const url of urls) URL.revokeObjectURL(url);
		}
	};
}

/** Revokes the object URLs when the print document goes away, including after print. */
export function revokePrintPhotosWhenClosed(target: { addEventListener: Window['addEventListener'] }, revoke: () => void): void {
	target.addEventListener('pagehide', () => revoke(), { once: true });
}

export function escapeHtml(value: unknown): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Object URLs, safe local image data, and Firebase Storage download addresses.
 * A download address carries a read token for that one photo. The sheet is a
 * local document in the owner's own browser and the token is never printed, so
 * the owner's photo addresses are allowed. Other hosts are refused.
 */
export function printablePhotoSrc(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const src = value.trim();
	if (src.length === 0 || src.length > 2000) return null;
	if (/[\u0000-\u001f\s]/.test(src)) return null;
	if (src.startsWith('blob:')) return src;
	if (/^data:image\/(?:webp|jpeg|jpg|png);base64,[a-z0-9+/=]+$/i.test(src)) return src;
	if (isStorageDownloadUrl(src)) return src;
	return null;
}

const STORAGE_HOSTS = new Set(['firebasestorage.googleapis.com']);
const EMULATOR_HOSTS = new Set(['127.0.0.1:9199', 'localhost:9199']);

function isStorageDownloadUrl(src: string): boolean {
	let url: URL;
	try {
		url = new URL(src);
	} catch {
		return false;
	}
	if (!url.pathname.startsWith('/v0/b/') || url.searchParams.get('alt') !== 'media') return false;
	if (url.protocol === 'https:' && STORAGE_HOSTS.has(url.host)) return true;
	return url.protocol === 'http:' && EMULATOR_HOSTS.has(url.host);
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
        <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="eager" decoding="async" style="display:block;max-width:2.4in;max-height:1.8in;object-fit:contain;border:1px solid #d6d3d1;" />
        ${figcaption}
      </figure>`;
		})
		.filter(Boolean);
	if (figures.length === 0) {
		// Print with photos sets printPhotos on every car. Say so when a car has none.
		if (!Array.isArray(vehicle?.printPhotos)) return '';
		return `<p class="vehicle-photos-missing" data-testid="print-no-photo" style="margin:6px 0 10px;font-size:11px;font-style:italic;color:#57534e;">No photo for this car yet.</p>`;
	}
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

interface PrintSheetWindow {
	closed?: boolean;
	document?: { querySelector(selector: string): unknown };
}

/**
 * Replacing the popup with a blob URL does not fire load.
 * Poll until the team heading is in the new document.
 */
export function waitForPrintSheet(
	target: PrintSheetWindow,
	timeoutMs = 8000,
	wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<void> {
	const started = Date.now();
	const poll = async (): Promise<void> => {
		if (target.closed) return;
		try {
			if (target.document?.querySelector('h1')) return;
		} catch {
			// The popup can be between documents while the sheet is opening.
		}
		if (Date.now() - started >= timeoutMs) return;
		await wait(50);
		return poll();
	};
	return poll();
}
