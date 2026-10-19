/** Photo sharing choices. Shared by the browser and the Cloud Functions. */

import { PHOTO_ID_PATTERN, UID_PATTERN, cleanCaption } from './model';

export const SHARE_BUDDIES_LABEL = 'Show to my Gaming Buddies';
export const SHARE_LINK_LABEL = 'Show on my team share link';
export const SHARE_GALLERY_LABEL = 'Show in the public Gallery';
export const GALLERY_SHARE_COPY =
	'Anyone can see photos you share to the Gallery. You can unshare anytime. Deleting your account removes them.';

/** Distinct signed-in reports that hide a gallery photo until an admin reviews it. */
export const REPORT_HIDE_THRESHOLD = 3;
export const REPORTS_PER_HOUR = 10;
export const REPORT_WINDOW_MS = 60 * 60 * 1000;
export const GALLERY_PAGE_LIMIT = 60;

export interface ShareFlags {
	showToBuddies: boolean;
	showOnShareLink: boolean;
	showInGallery: boolean;
}

export interface PublicSharedPhoto {
	photoId: string;
	displayName: string;
	vehicleType: string;
	teamName: string;
	caption: string;
	createdAt: string;
	hidden: boolean;
	published: boolean;
	showInGallery: boolean;
}

/** A missing or non-true value stays off. Nothing is shared unless the player turns it on. */
export function shareFlags(input: Partial<ShareFlags> | null | undefined): ShareFlags {
	return {
		showToBuddies: input?.showToBuddies === true,
		showOnShareLink: input?.showOnShareLink === true,
		showInGallery: input?.showInGallery === true
	};
}

export function anyShareFlag(flags: ShareFlags): boolean {
	return flags.showToBuddies || flags.showOnShareLink || flags.showInGallery;
}

/** Title-case a vehicle id from the saved team. The browser does not choose this label. */
export function vehicleTypeLabel(typeId: unknown): string {
	if (typeof typeId !== 'string') return 'Vehicle';
	const id = typeId.trim();
	if (!/^[A-Za-z0-9_]{1,40}$/.test(id)) return 'Vehicle';
	const label = id
		.split('_')
		.filter((word) => word.length > 0)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(' ');
	return label || 'Vehicle';
}

export function cleanTeamName(value: unknown): string {
	if (typeof value !== 'string') return '';
	return value.replace(/[\u0000-\u001f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

export function sharedPhotoObjectPath(photoId: string): string {
	if (!PHOTO_ID_PATTERN.test(photoId)) throw new Error('That photo is not available.');
	return `shared-photos/${photoId}`;
}

/**
 * Rules-backed media URL. No account id and no download token, so Storage
 * rules decide on every request.
 */
export function sharedPhotoMediaUrl(bucket: string, photoId: string, emulatorHost = ''): string {
	const name = bucket.trim().replace(/^gs:\/\//, '');
	if (!/^[a-z0-9][a-z0-9.-]{1,200}$/i.test(name)) throw new Error('Photos are not available right now.');
	const objectPath = encodeURIComponent(sharedPhotoObjectPath(photoId));
	if (emulatorHost) {
		const host = emulatorHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
		if (!/^[a-z0-9.-]+:\d+$/i.test(host)) throw new Error('Photos are not available right now.');
		return `http://${host}/v0/b/${name}/o/${objectPath}?alt=media`;
	}
	return `https://firebasestorage.googleapis.com/v0/b/${name}/o/${objectPath}?alt=media`;
}

export function photoReportId(photoId: string, uid: string): string {
	if (!PHOTO_ID_PATTERN.test(photoId) || !UID_PATTERN.test(uid)) throw new Error('That report could not be saved.');
	return `${photoId}~${uid}`;
}

export function nextReportWindow(previous: unknown, nowMs: number): { allowed: boolean; stamps: number[] } {
	const recent = Array.isArray(previous)
		? previous.filter((value): value is number => typeof value === 'number' && nowMs - value < REPORT_WINDOW_MS)
		: [];
	if (recent.length >= REPORTS_PER_HOUR) return { allowed: false, stamps: recent };
	return { allowed: true, stamps: [...recent, nowMs] };
}

/**
 * Gallery publication. Approval mode holds a new gallery share. Turning the
 * kill switch on does not unpublish a photo that was already approved.
 * Buddy and share-link visibility do not use this flag.
 */
export function galleryPublished(
	flags: ShareFlags,
	requireApproval: boolean,
	previous: { showInGallery: boolean; published: boolean }
): boolean {
	if (!flags.showInGallery) return false;
	if (!requireApproval) return true;
	return previous.showInGallery && previous.published;
}

/** Public gallery document. The account id is not a field. */
export function publicSharedPhoto(input: {
	photoId: string;
	displayName: string;
	vehicleType: string;
	teamName: string;
	caption: string;
	createdAt: string;
	hidden: boolean;
	published: boolean;
	showInGallery: boolean;
}): PublicSharedPhoto {
	if (!PHOTO_ID_PATTERN.test(input.photoId)) throw new Error('That photo could not be shared.');
	const photo: PublicSharedPhoto = {
		photoId: input.photoId,
		displayName: input.displayName,
		vehicleType: input.vehicleType,
		teamName: cleanTeamName(input.teamName),
		caption: cleanCaption(input.caption),
		createdAt: input.createdAt,
		hidden: input.hidden === true,
		published: input.published === true,
		showInGallery: input.showInGallery === true
	};
	const forbidden = Object.keys(photo).filter((key) => /uid|email|user/i.test(key));
	if (forbidden.length > 0) throw new Error('That photo could not be shared.');
	return photo;
}
