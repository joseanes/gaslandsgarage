/** Library photos are owned by the account. Cars hold attachments, not the file. */

import {
	CONTENT_HASH_PATTERN,
	PHOTO_ID_PATTERN,
	TEAM_ID_PATTERN,
	VEHICLE_ID_PATTERN,
	isPhotoContentType,
	libraryPhotoPath,
	type PhotoAttachment,
	type PhotoContentType
} from './model';

export function isLibraryPhotoPath(path: string, uid: string): boolean {
	return path.startsWith(`users/${uid}/photos-library/`);
}

export function isLegacyPhotoPath(path: string, uid: string): boolean {
	return path.startsWith(`users/${uid}/vehicle-photos/`);
}

export function validAttachment(value: unknown): value is PhotoAttachment {
	if (!value || typeof value !== 'object') return false;
	const record = value as PhotoAttachment;
	return TEAM_ID_PATTERN.test(String(record.teamId ?? '')) && VEHICLE_ID_PATTERN.test(String(record.vehicleId ?? ''));
}

export function sameAttachment(left: PhotoAttachment, right: PhotoAttachment): boolean {
	return left.teamId === right.teamId && left.vehicleId === right.vehicleId;
}

/** Attachments on the document, or the older single team and vehicle pair. */
export function attachmentsFromData(data: Record<string, unknown> | undefined): PhotoAttachment[] {
	const parsed: PhotoAttachment[] = [];
	const raw = data?.attachments;
	if (Array.isArray(raw)) {
		for (const item of raw) {
			if (!validAttachment(item)) continue;
			const next = { teamId: item.teamId, vehicleId: item.vehicleId };
			if (parsed.some((have) => sameAttachment(have, next))) continue;
			parsed.push(next);
		}
	}
	if (parsed.length > 0) return parsed;
	const teamId = typeof data?.teamId === 'string' ? data.teamId : '';
	const vehicleId = typeof data?.vehicleId === 'string' ? data.vehicleId : '';
	if (TEAM_ID_PATTERN.test(teamId) && VEHICLE_ID_PATTERN.test(vehicleId)) return [{ teamId, vehicleId }];
	return [];
}

export function countOnVehicle(photos: Array<{ attachments: PhotoAttachment[] }>, teamId: string, vehicleId: string): number {
	return photos.filter((photo) => photo.attachments.some((item) => item.teamId === teamId && item.vehicleId === vehicleId)).length;
}

export function withoutAttachment(attachments: PhotoAttachment[], teamId: string, vehicleId: string): PhotoAttachment[] {
	return attachments.filter((item) => item.teamId !== teamId || item.vehicleId !== vehicleId);
}

export function withAttachment(attachments: PhotoAttachment[], next: PhotoAttachment): PhotoAttachment[] {
	if (attachments.some((item) => sameAttachment(item, next))) return attachments;
	return [...attachments, next];
}

export function isContentHash(value: unknown): value is string {
	return typeof value === 'string' && CONTENT_HASH_PATTERN.test(value);
}

/** Where a legacy vehicle-photos object should live. Null when it is already a library file. */
export function legacyMigrationTarget(uid: string, photoId: string, path: string, contentType: unknown): string | null {
	if (!PHOTO_ID_PATTERN.test(photoId) || !isPhotoContentType(contentType)) return null;
	if (!isLegacyPhotoPath(path, uid)) return null;
	const target = libraryPhotoPath(uid, photoId, contentType as PhotoContentType);
	return target === path ? null : target;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	const digest = await crypto.subtle.digest('SHA-256', copy);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The car a share uses. One attachment is enough. Several require an explicit pick. */
export function shareSource(
	attachments: PhotoAttachment[],
	requestedTeamId: unknown,
	requestedVehicleId: unknown
): PhotoAttachment {
	const teamId = String(requestedTeamId ?? '');
	const vehicleId = String(requestedVehicleId ?? '');
	if (TEAM_ID_PATTERN.test(teamId) && VEHICLE_ID_PATTERN.test(vehicleId)) {
		const chosen = attachments.find((item) => item.teamId === teamId && item.vehicleId === vehicleId);
		if (!chosen) throw new Error('Attach this photo to that car before sharing it.');
		return chosen;
	}
	if (attachments.length === 1) return attachments[0];
	if (attachments.length === 0) throw new Error('Attach this photo to a car before sharing it.');
	throw new Error('Choose which car to share this photo from.');
}
