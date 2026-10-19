import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	PHOTO_PRIVACY_SHORT,
	encodedImageHasMetadata,
	fittedSize,
	quotaMessage,
	vehiclePhotoPath
} from './model';

describe('vehicle photo limits', () => {
	it('fits the long edge to 1600 pixels', () => {
		expect(fittedSize(4000, 2000)).toEqual({ width: 1600, height: 800 });
		expect(fittedSize(800, 600)).toEqual({ width: 800, height: 600 });
		expect(fittedSize(100, 4000)).toEqual({ width: 40, height: 1600 });
	});

	it('stops at 3 photos on a vehicle and 100 on the account', () => {
		expect(quotaMessage(0, 0)).toBeNull();
		expect(quotaMessage(99, 2)).toBeNull();
		expect(quotaMessage(10, 3)).toMatch(/3 photos/);
		expect(quotaMessage(100, 0)).toMatch(/100 photos/);
	});

	it('builds the storage path from the account, team, and vehicle', () => {
		expect(vehiclePhotoPath('ada', 'team1', 'car1', 'photo1234', 'image/webp')).toBe(
			'users/ada/vehicle-photos/team1/car1/photo1234.webp'
		);
		expect(vehiclePhotoPath('ada', 'team1', 'car1', 'photo1234', 'image/jpeg')).toBe(
			'users/ada/vehicle-photos/team1/car1/photo1234.jpg'
		);
	});

	it('detects an Exif marker and ignores a re-encoded file', () => {
		const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xff, 0xd9]);
		expect(encodedImageHasMetadata(jpeg)).toBe(true);
		const clean = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
		expect(encodedImageHasMetadata(clean)).toBe(false);
		const webp = new TextEncoder().encode('RIFF....WEBP....EXIF....');
		expect(encodedImageHasMetadata(webp)).toBe(true);
	});

	it('keeps the privacy sentence a player can read next to the upload button', () => {
		expect(PHOTO_PRIVACY_SHORT).toContain('Your photos are yours');
		expect(PHOTO_PRIVACY_SHORT).toContain('never use them anywhere else');
		expect(PHOTO_PRIVACY_SHORT).toContain('deleting your account deletes all of your photos');
		const page = readFileSync(resolve(process.cwd(), 'src/routes/privacy/+page.svelte'), 'utf8');
		const card = readFileSync(resolve(process.cwd(), 'src/lib/components/VehiclePhotos.svelte'), 'utf8');
		expect(page).toContain('PHOTO_PRIVACY_SHORT');
		expect(page).toContain('never use them for advertising');
		expect(page).toContain('train models');
		expect(card).toContain('PHOTO_PRIVACY_SHORT');
		expect(card).toContain('Learn more');
		expect(card).toContain('href="/privacy#photos"');
		expect(page).toContain('id="photos"');
		expect(card).toContain('accept="image/*"');
		expect(card).toContain('capture="environment"');
	});
});
