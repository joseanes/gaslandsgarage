/** Painted-car photos. Shared by the browser and the Cloud Functions. */

export const MAX_PHOTOS_PER_VEHICLE = 3;
export const MAX_PHOTOS_PER_ACCOUNT = 100;
/** 1.5 MiB. Storage rules use the same cap. */
export const MAX_PHOTO_BYTES = 1_572_864;
export const MAX_PHOTO_EDGE = 1600;
export const PHOTO_WEBP_QUALITY = 0.8;
export const MAX_CAPTION_LENGTH = 140;
/** Reject huge camera originals before the browser tries to decode them. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export const DEFAULT_STORAGE_BUCKET = 'gaslandsgarage-74ce6.firebasestorage.app';

export const STAGING_PROJECT_ID = 'gaslandsgarage-staging';
export const STAGING_STORAGE_BUCKET = 'gaslandsgarage-staging.firebasestorage.app';

export function storageBucketName(configured = ''): string {
	const name = configured.trim();
	return name.length > 0 ? name : DEFAULT_STORAGE_BUCKET;
}

/**
 * Bucket for server code: an explicit FIREBASE_STORAGE_BUCKET wins, the staging
 * project uses its own bucket, and everything else keeps the production default.
 */
export function storageBucketForProject(configured = '', projectId = ''): string {
	if (configured.trim().length > 0) return configured.trim();
	return projectId.trim() === STAGING_PROJECT_ID ? STAGING_STORAGE_BUCKET : DEFAULT_STORAGE_BUCKET;
}

export const PHOTO_PRIVACY_SHORT =
	'Your photos are yours. We store them only to show them to you on Gaslands Garage and in your printouts. We never use them anywhere else. Delete a photo anytime; deleting your account deletes all of your photos.';

export const PHOTO_ID_PATTERN = /^[A-Za-z0-9_-]{8,40}$/;
export const TEAM_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
export const VEHICLE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type PhotoContentType = 'image/webp' | 'image/jpeg';

export interface VehiclePhotoRecord {
	photoId: string;
	userId: string;
	/** Car the Gallery and share link currently use. Empty when the photo is not shared from a car. */
	teamId: string;
	vehicleId: string;
	path: string;
	width: number;
	height: number;
	createdAt: string;
	caption: string;
	contentType: PhotoContentType;
	attachments: PhotoAttachment[];
	contentHash: string;
	shareTeamId: string;
	shareVehicleId: string;
}

export function photoExtension(contentType: PhotoContentType): 'webp' | 'jpg' {
	return contentType === 'image/webp' ? 'webp' : 'jpg';
}

export function vehiclePhotoPath(
	uid: string,
	teamId: string,
	vehicleId: string,
	photoId: string,
	contentType: PhotoContentType
): string {
	return `users/${uid}/vehicle-photos/${teamId}/${vehicleId}/${photoId}.${photoExtension(contentType)}`;
}

/** A library file belongs to the account. Cars point at it; they do not own the bytes. */
export function libraryPhotoPath(uid: string, photoId: string, contentType: PhotoContentType): string {
	return `users/${uid}/photos-library/${photoId}.${photoExtension(contentType)}`;
}

export interface PhotoAttachment {
	teamId: string;
	vehicleId: string;
}

export const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
/** A reservation with no file is an orphan only after the upload has had time to finish. */
export const ORPHAN_GRACE_MS = 15 * 60 * 1000;

export function isPhotoContentType(value: unknown): value is PhotoContentType {
	return value === 'image/webp' || value === 'image/jpeg';
}

export function fittedSize(width: number, height: number, maxEdge = MAX_PHOTO_EDGE): { width: number; height: number } {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		throw new Error('That image has no size.');
	}
	const edge = Math.max(width, height);
	if (edge <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
	const scale = maxEdge / edge;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

/** JPEG APP1 Exif and a WebP EXIF chunk. Pixel data that happens to look like the word is not a marker. */
export function encodedImageHasMetadata(bytes: Uint8Array): boolean {
	for (let index = 0; index < bytes.length - 8; index += 1) {
		if (bytes[index] === 0xff && bytes[index + 1] === 0xe1) {
			const exif =
				bytes[index + 4] === 0x45 &&
				bytes[index + 5] === 0x78 &&
				bytes[index + 6] === 0x69 &&
				bytes[index + 7] === 0x66;
			if (exif) return true;
		}
	}
	if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
		const latin = new TextDecoder('latin1').decode(bytes);
		return latin.includes('EXIF');
	}
	return false;
}

export function cleanCaption(value: unknown): string {
	if (value == null || value === '') return '';
	if (typeof value !== 'string') throw new Error('Caption must be text.');
	const caption = value.trim();
	if (caption.length > MAX_CAPTION_LENGTH) throw new Error(`Captions can be ${MAX_CAPTION_LENGTH} characters.`);
	return caption;
}

export function quotaMessage(total: number, onVehicle: number): string | null {
	if (onVehicle >= MAX_PHOTOS_PER_VEHICLE) return 'This vehicle already has 3 photos. Detach one to add another.';
	if (total >= MAX_PHOTOS_PER_ACCOUNT) return 'This account already has 100 photos. Delete one to add another.';
	return null;
}

export function assertPhotoIds(uid: string, teamId: string, vehicleId: string): void {
	if (!UID_PATTERN.test(uid)) throw new Error('Sign in again before adding a photo.');
	if (!TEAM_ID_PATTERN.test(teamId)) throw new Error('Save this team before adding a photo.');
	if (!VEHICLE_ID_PATTERN.test(vehicleId)) throw new Error('This vehicle cannot store a photo. Remove it and add it again.');
}
