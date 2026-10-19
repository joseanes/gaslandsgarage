import { describe, expect, it } from 'vitest';
import { blobBytes, compressVehiclePhoto, type PhotoEncoder } from './compress';
import { encodedImageHasMetadata, MAX_PHOTO_EDGE, PHOTO_WEBP_QUALITY } from './model';

const exifJpeg = new Uint8Array([
	0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x47, 0x50, 0x53, 0x00, 0xff, 0xd9
]);

describe('compressVehiclePhoto', () => {
	it('asks for a 1600 pixel WebP and refuses to upload the original file', async () => {
		const calls: { maxEdge: number; quality: number }[] = [];
		const encoder: PhotoEncoder = async (_file, options) => {
			calls.push(options);
			const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
			return { blob, width: 1600, height: 900, contentType: 'image/jpeg' };
		};
		const source = new Blob([exifJpeg], { type: 'image/jpeg' });
		const result = await compressVehiclePhoto(source, encoder);
		expect(calls).toEqual([{ maxEdge: MAX_PHOTO_EDGE, quality: PHOTO_WEBP_QUALITY }]);
		expect(result.blob).not.toBe(source);
		expect(encodedImageHasMetadata(await blobBytes(result.blob))).toBe(false);
		expect(encodedImageHasMetadata(exifJpeg)).toBe(true);
	});

	it('does not upload a file that still contains an Exif segment', async () => {
		const encoder: PhotoEncoder = async () => ({
			blob: new Blob([exifJpeg], { type: 'image/jpeg' }),
			width: 10,
			height: 10,
			contentType: 'image/jpeg'
		});
		await expect(compressVehiclePhoto(new Blob([exifJpeg], { type: 'image/jpeg' }), encoder)).rejects.toThrow(
			/camera data/
		);
	});

	it('rejects a file that is not an image', async () => {
		await expect(compressVehiclePhoto(new Blob(['hello'], { type: 'text/plain' }))).rejects.toThrow(/JPEG, PNG, or WebP/);
	});
});
