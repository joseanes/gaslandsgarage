import {
	MAX_PHOTO_BYTES,
	MAX_PHOTO_EDGE,
	MAX_SOURCE_BYTES,
	PHOTO_WEBP_QUALITY,
	encodedImageHasMetadata,
	fittedSize,
	type PhotoContentType
} from './model';

export interface CompressedPhoto {
	blob: Blob;
	width: number;
	height: number;
	contentType: PhotoContentType;
}

export interface PhotoEncodeOptions {
	maxEdge: number;
	quality: number;
}

export type PhotoEncoder = (file: Blob, options: PhotoEncodeOptions) => Promise<CompressedPhoto>;

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
	return new Promise((resolve) => {
		canvas.toBlob((blob) => resolve(blob), type, quality);
	});
}

export async function blobBytes(blob: Blob): Promise<Uint8Array> {
	if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
	const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as ArrayBuffer);
		reader.onerror = () => reject(reader.error ?? new Error('That photo could not be prepared.'));
		reader.readAsArrayBuffer(blob);
	});
	return new Uint8Array(buffer);
}

async function sniffImageType(blob: Blob): Promise<PhotoContentType | null> {
	const bytes = (await blobBytes(blob)).slice(0, 16);
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return 'image/webp';
	}
	return null;
}

async function drawSource(file: Blob, maxEdge: number): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
	let source: CanvasImageSource;
	let sourceWidth = 0;
	let sourceHeight = 0;
	if (typeof createImageBitmap === 'function') {
		const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
		source = bitmap;
		sourceWidth = bitmap.width;
		sourceHeight = bitmap.height;
	} else {
		source = await loadHtmlImage(file);
		sourceWidth = source.naturalWidth;
		sourceHeight = source.naturalHeight;
	}
	const size = fittedSize(sourceWidth, sourceHeight, maxEdge);
	const canvas = document.createElement('canvas');
	canvas.width = size.width;
	canvas.height = size.height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('This browser cannot prepare photos.');
	context.drawImage(source, 0, 0, size.width, size.height);
	if ('close' in source && typeof source.close === 'function') source.close();
	return { canvas, width: size.width, height: size.height };
}

function loadHtmlImage(file: Blob): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const image = new Image();
		image.onload = () => {
			URL.revokeObjectURL(url);
			resolve(image);
		};
		image.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('Choose a JPEG, PNG, or WebP photo.'));
		};
		image.src = url;
	});
}

/** Re-encode through a canvas so the file sent to Storage has no EXIF or GPS segment. */
export async function encodeWithCanvas(file: Blob, options: PhotoEncodeOptions): Promise<CompressedPhoto> {
	let drawn: { canvas: HTMLCanvasElement; width: number; height: number };
	try {
		drawn = await drawSource(file, options.maxEdge);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith('Choose')) throw error;
		throw new Error('Choose a JPEG, PNG, or WebP photo.');
	}
	const webp = await canvasToBlob(drawn.canvas, 'image/webp', options.quality);
	const webpType = webp ? webp.type || (await sniffImageType(webp)) : null;
	if (webp && webpType === 'image/webp') {
		return { blob: webp, width: drawn.width, height: drawn.height, contentType: 'image/webp' };
	}
	const jpeg = await canvasToBlob(drawn.canvas, 'image/jpeg', options.quality);
	const jpegType = jpeg ? jpeg.type || (await sniffImageType(jpeg)) : null;
	if (!jpeg || jpegType !== 'image/jpeg') throw new Error('This browser cannot prepare photos.');
	return { blob: jpeg, width: drawn.width, height: drawn.height, contentType: 'image/jpeg' };
}

export async function compressVehiclePhoto(file: Blob, encode: PhotoEncoder = encodeWithCanvas): Promise<CompressedPhoto> {
	if (!(file instanceof Blob) || file.size === 0) throw new Error('Choose a photo to upload.');
	if (file.size > MAX_SOURCE_BYTES) throw new Error('That photo is too large to prepare. Choose one under 25 MB.');
	if (file.type && !file.type.startsWith('image/')) throw new Error('Choose a JPEG, PNG, or WebP photo.');
	const compressed = await encode(file, { maxEdge: MAX_PHOTO_EDGE, quality: PHOTO_WEBP_QUALITY });
	if (compressed.blob.size > MAX_PHOTO_BYTES) {
		throw new Error('That photo is still too large after compressing. Try a smaller one.');
	}
	if (compressed.blob.size === 0) throw new Error('That photo could not be prepared.');
	const bytes = await blobBytes(compressed.blob);
	if (encodedImageHasMetadata(bytes)) {
		throw new Error('That photo still had camera data, so it was not uploaded.');
	}
	if (compressed.contentType !== 'image/webp' && compressed.contentType !== 'image/jpeg') {
		throw new Error('This browser cannot prepare photos.');
	}
	return compressed;
}
