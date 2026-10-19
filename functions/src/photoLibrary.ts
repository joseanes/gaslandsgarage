import { randomBytes } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type DocumentReference, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
	MAX_PHOTO_EDGE,
	ORPHAN_GRACE_MS,
	PHOTO_ID_PATTERN,
	TEAM_ID_PATTERN,
	UID_PATTERN,
	VEHICLE_ID_PATTERN,
	cleanCaption,
	isPhotoContentType,
	libraryPhotoPath,
	quotaMessage,
	storageBucketForProject,
	type PhotoAttachment,
	type PhotoContentType,
	type VehiclePhotoRecord
} from '../../app/src/lib/photos/model.ts';
import {
	attachmentsFromData,
	countOnVehicle,
	isContentHash,
	legacyMigrationTarget,
	withAttachment,
	withoutAttachment
} from '../../app/src/lib/photos/library.ts';
import { sanitizeVehicleStats, sharedPhotoSearchPatch } from '../../app/src/lib/photos/share.ts';
import { removeSharedCopy, setPhotoSharingForUser } from './photoShare.ts';

const PHOTOS = 'photos';
const CALL = { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60, maxInstances: 10 } as const;

export interface ReserveLibraryInput {
	teamId?: unknown;
	vehicleId?: unknown;
	width: unknown;
	height: unknown;
	contentType: unknown;
	caption?: unknown;
	contentHash?: unknown;
}

export interface ReservedLibraryPhoto extends VehiclePhotoRecord {
	duplicate: boolean;
}

function httpsError(error: unknown): HttpsError {
	if (error instanceof HttpsError) return error;
	const message = error instanceof Error ? error.message : 'That photo could not be saved.';
	const code = /sign in/i.test(message)
		? 'unauthenticated'
		: /3 photos|100 photos/i.test(message)
			? 'resource-exhausted'
			: /not on this team|not found/i.test(message)
				? 'not-found'
				: 'invalid-argument';
	return new HttpsError(code, message);
}

async function assertActive(uid: string | undefined): Promise<string> {
	if (!uid || !UID_PATTERN.test(uid)) throw new HttpsError('unauthenticated', 'Sign in required.');
	const user = await getAuth().getUser(uid).catch((error: { code?: string }) => {
		if (error?.code === 'auth/user-not-found') throw new HttpsError('unauthenticated', 'Sign in required.');
		throw error;
	});
	if (user.disabled) throw new HttpsError('permission-denied', 'This account is disabled.');
	const adminDoc = await getFirestore().doc(`adminUsers/${uid}`).get();
	if (adminDoc.exists && adminDoc.get('disabled') === true) {
		throw new HttpsError('permission-denied', 'This account is disabled.');
	}
	return uid;
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function bucket() {
	return getStorage().bucket(storageBucketForProject(
		process.env.FIREBASE_STORAGE_BUCKET ?? '',
		process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? ''
	));
}

function teamHasVehicle(team: Record<string, unknown> | undefined, vehicleId: string): boolean {
	const vehicles = asRecord(team?.teamData).vehicles;
	if (!Array.isArray(vehicles)) return false;
	return vehicles.some((entry) => asRecord(entry).id === vehicleId);
}

function recordFrom(doc: QueryDocumentSnapshot): VehiclePhotoRecord {
	const data = doc.data();
	const attachments = attachmentsFromData(data);
	const contentType = data.contentType === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
	return {
		photoId: doc.id,
		userId: String(data.userId ?? ''),
		teamId: String(data.teamId ?? ''),
		vehicleId: String(data.vehicleId ?? ''),
		path: String(data.path ?? ''),
		width: Number(data.width) || 0,
		height: Number(data.height) || 0,
		createdAt: String(data.createdAt ?? ''),
		caption: typeof data.caption === 'string' ? data.caption : '',
		contentType,
		attachments,
		contentHash: typeof data.contentHash === 'string' ? data.contentHash : '',
		shareTeamId: String(data.shareTeamId ?? ''),
		shareVehicleId: String(data.shareVehicleId ?? '')
	};
}

async function ownedTeamVehicle(uid: string, teamId: string, vehicleId: string): Promise<void> {
	if (!TEAM_ID_PATTERN.test(teamId) || !VEHICLE_ID_PATTERN.test(vehicleId)) {
		throw new Error('Save this team before adding a photo.');
	}
	const team = await getFirestore().doc(`teams/${teamId}`).get();
	if (!team.exists || team.get('userId') !== uid) throw new Error('Save this team before adding a photo.');
	if (!teamHasVehicle(team.data(), vehicleId)) throw new Error('That vehicle is not on this team.');
}

function photoRef(uid: string, photoId: string): DocumentReference {
	return getFirestore().doc(`users/${uid}/${PHOTOS}/${photoId}`);
}

async function ownedPhoto(uid: string, photoId: string) {
	if (!PHOTO_ID_PATTERN.test(photoId)) throw new Error('That photo was not found.');
	const ref = photoRef(uid, photoId);
	const photo = await ref.get();
	if (!photo.exists || photo.get('userId') !== uid) throw new Error('That photo was not found.');
	return { ref, photo };
}

/**
 * Reserves a library file, or attaches an existing photo when the same bytes
 * are already in the library. The browser uploads only when duplicate is false.
 */
export async function reserveLibraryPhoto(uid: string, input: ReserveLibraryInput): Promise<ReservedLibraryPhoto> {
	const teamId = String(input.teamId ?? '');
	const vehicleId = String(input.vehicleId ?? '');
	const attaching = teamId.length > 0 || vehicleId.length > 0;
	if (attaching) await ownedTeamVehicle(uid, teamId, vehicleId);
	const width = Number(input.width);
	const height = Number(input.height);
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_PHOTO_EDGE || height > MAX_PHOTO_EDGE) {
		throw new Error('That photo could not be prepared.');
	}
	if (!isPhotoContentType(input.contentType)) throw new Error('Choose a JPEG or WebP photo.');
	const contentType: PhotoContentType = input.contentType;
	const caption = cleanCaption(input.caption);
	const contentHash = isContentHash(input.contentHash) ? input.contentHash : '';
	const db = getFirestore();
	const id = randomBytes(9).toString('base64url');
	if (!PHOTO_ID_PATTERN.test(id)) throw new Error('That photo could not be prepared.');

	return db.runTransaction(async (tx) => {
		const existing = await tx.get(db.collection('users').doc(uid).collection(PHOTOS));
		const photos = existing.docs.map((item) => recordFrom(item));
		if (contentHash) {
			const match = existing.docs.find((item) => item.get('contentHash') === contentHash);
			if (match) {
				const current = recordFrom(match);
				if (attaching) {
					const already = current.attachments.some((item) => item.teamId === teamId && item.vehicleId === vehicleId);
					if (!already && countOnVehicle(photos, teamId, vehicleId) >= 3) {
						throw new Error('This vehicle already has 3 photos. Detach one to add another.');
					}
					const attachments = already ? current.attachments : withAttachment(current.attachments, { teamId, vehicleId });
					tx.set(
						match.ref,
						{
							attachments,
							teamId: current.teamId || teamId,
							vehicleId: current.vehicleId || vehicleId
						},
						{ merge: true }
					);
					return {
						...current,
						attachments,
						teamId: current.teamId || teamId,
						vehicleId: current.vehicleId || vehicleId,
						duplicate: true
					};
				}
				return { ...current, duplicate: true };
			}
		}
		const blocked = quotaMessage(existing.size, attaching ? countOnVehicle(photos, teamId, vehicleId) : 0);
		if (blocked) throw new Error(blocked);
		const attachment: PhotoAttachment[] = attaching ? [{ teamId, vehicleId }] : [];
		const record: VehiclePhotoRecord = {
			photoId: id,
			userId: uid,
			teamId: attaching ? teamId : '',
			vehicleId: attaching ? vehicleId : '',
			path: libraryPhotoPath(uid, id, contentType),
			width,
			height,
			createdAt: new Date().toISOString(),
			caption,
			contentType,
			attachments: attachment,
			contentHash,
			shareTeamId: '',
			shareVehicleId: ''
		};
		tx.set(db.doc(`users/${uid}/${PHOTOS}/${id}`), record);
		return { ...record, duplicate: false };
	});
}

export async function attachLibraryPhotoForUser(uid: string, photoId: string, teamId: string, vehicleId: string): Promise<VehiclePhotoRecord> {
	await ownedTeamVehicle(uid, teamId, vehicleId);
	const { ref } = await ownedPhoto(uid, photoId);
	const db = getFirestore();
	return db.runTransaction(async (tx) => {
		const fresh = await tx.get(ref);
		if (!fresh.exists) throw new Error('That photo was not found.');
		const current = recordFrom(fresh as QueryDocumentSnapshot);
		if (current.attachments.some((item) => item.teamId === teamId && item.vehicleId === vehicleId)) return current;
		const all = await tx.get(db.collection('users').doc(uid).collection(PHOTOS));
		const photos = all.docs.map((item) => recordFrom(item));
		if (countOnVehicle(photos, teamId, vehicleId) >= 3) {
			throw new Error('This vehicle already has 3 photos. Detach one to add another.');
		}
		const attachments = withAttachment(current.attachments, { teamId, vehicleId });
		const next = {
			...current,
			attachments,
			teamId: current.teamId || teamId,
			vehicleId: current.vehicleId || vehicleId
		};
		tx.set(ref, { attachments, teamId: next.teamId, vehicleId: next.vehicleId }, { merge: true });
		return next;
	});
}

/** Drops one car. The file stays. A share that used that car is removed. */
export async function detachLibraryPhotoForUser(uid: string, photoId: string, teamId: string, vehicleId: string): Promise<void> {
	if (!TEAM_ID_PATTERN.test(teamId) || !VEHICLE_ID_PATTERN.test(vehicleId)) throw new Error('That car was not found.');
	const { ref, photo } = await ownedPhoto(uid, photoId);
	const data = photo.data() ?? {};
	const attachments = withoutAttachment(attachmentsFromData(data), teamId, vehicleId);
	const pointedHere = String(data.teamId ?? '') === teamId && String(data.vehicleId ?? '') === vehicleId;
	const sharePointed = String(data.shareTeamId ?? '') === teamId && String(data.shareVehicleId ?? '') === vehicleId;
	const flagsOn = data.showToBuddies === true || data.showOnShareLink === true || data.showInGallery === true;
	const droppedSource = flagsOn && (sharePointed || (pointedHere && !data.shareTeamId));
	if (droppedSource) await removeSharedCopy(photoId, false);
	const fallback = attachments[0] ?? { teamId: '', vehicleId: '' };
	await ref.set(
		{
			attachments,
			teamId: pointedHere ? fallback.teamId : String(data.teamId ?? ''),
			vehicleId: pointedHere ? fallback.vehicleId : String(data.vehicleId ?? ''),
			shareTeamId: droppedSource || sharePointed ? '' : String(data.shareTeamId ?? ''),
			shareVehicleId: droppedSource || sharePointed ? '' : String(data.shareVehicleId ?? ''),
			...(droppedSource
				? { showToBuddies: false, showOnShareLink: false, showInGallery: false, shareVehicleStats: false }
				: {})
		},
		{ merge: true }
	);
}

export async function detachVehiclePhotosForUser(uid: string, teamId: string, vehicleId: string): Promise<number> {
	if (!TEAM_ID_PATTERN.test(teamId) || !VEHICLE_ID_PATTERN.test(vehicleId)) return 0;
	const snap = await getFirestore().collection('users').doc(uid).collection(PHOTOS).get();
	let count = 0;
	for (const item of snap.docs) {
		const attachments = attachmentsFromData(item.data());
		if (!attachments.some((entry) => entry.teamId === teamId && entry.vehicleId === vehicleId)) continue;
		await detachLibraryPhotoForUser(uid, item.id, teamId, vehicleId);
		count += 1;
	}
	return count;
}

export async function detachTeamPhotosForUser(uid: string, teamId: string): Promise<number> {
	if (!TEAM_ID_PATTERN.test(teamId)) return 0;
	const snap = await getFirestore().collection('users').doc(uid).collection(PHOTOS).get();
	const pairs = new Set<string>();
	for (const item of snap.docs) {
		for (const attachment of attachmentsFromData(item.data())) {
			if (attachment.teamId === teamId) pairs.add(`${item.id}\n${attachment.vehicleId}`);
		}
	}
	for (const pair of pairs) {
		const [photoId, vehicleId] = pair.split('\n');
		await detachLibraryPhotoForUser(uid, photoId, teamId, vehicleId);
	}
	return pairs.size;
}

export async function renameLibraryPhotoForUser(uid: string, photoId: string, captionInput: unknown): Promise<void> {
	const caption = cleanCaption(captionInput);
	const { ref } = await ownedPhoto(uid, photoId);
	await ref.set({ caption }, { merge: true });
	const db = getFirestore();
	const [pub, priv] = await Promise.all([db.doc(`sharedPhotos/${photoId}`).get(), db.doc(`sharedPhotoPrivate/${photoId}`).get()]);
	if (pub.exists) {
		const data = pub.data() ?? {};
		const patch = sharedPhotoSearchPatch({
			caption,
			displayName: data.displayName,
			vehicleType: data.vehicleType,
			vehicleStats: sanitizeVehicleStats(data.vehicleStats)
		});
		await pub.ref.set({ caption, ...patch }, { merge: true });
	}
	if (priv.exists) await priv.ref.set({ caption }, { merge: true });
}

/** Points the reservation at the replacement bytes. The browser uploads after this returns. */
export async function preparePhotoReplaceForUser(
	uid: string,
	photoId: string,
	contentType: unknown
): Promise<{ path: string; contentType: PhotoContentType }> {
	if (!isPhotoContentType(contentType)) throw new Error('Choose a JPEG or WebP photo.');
	const { ref } = await ownedPhoto(uid, photoId);
	const nextPath = libraryPhotoPath(uid, photoId, contentType);
	await ref.set({ path: nextPath, contentType }, { merge: true });
	return { path: nextPath, contentType };
}

/** Records the new size and hash after the bytes are uploaded, and refreshes a shared copy. */
export async function replaceLibraryPhotoForUser(uid: string, input: Record<string, unknown>): Promise<void> {
	const photoId = String(input.photoId ?? '');
	const width = Number(input.width);
	const height = Number(input.height);
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_PHOTO_EDGE || height > MAX_PHOTO_EDGE) {
		throw new Error('That photo could not be prepared.');
	}
	const contentHash = isContentHash(input.contentHash) ? input.contentHash : '';
	const { ref, photo } = await ownedPhoto(uid, photoId);
	const caption = input.caption === undefined ? String(photo.get('caption') ?? '') : cleanCaption(input.caption);
	const path = String(photo.get('path') ?? '');
	const [exists] = await bucket().file(path).exists();
	if (!exists) throw new Error('Upload the replacement before saving it.');
	await ref.set({ width, height, contentHash, caption }, { merge: true });
	await deleteOtherPhotoFiles(uid, photoId, path);
	const data = photo.data() ?? {};
	const sharing = data.showToBuddies === true || data.showOnShareLink === true || data.showInGallery === true;
	if (!sharing) {
		await renameLibraryPhotoForUser(uid, photoId, caption);
		return;
	}
	const attachments = attachmentsFromData({ ...data, caption });
	const source = attachments.find((item) => item.teamId === String(data.shareTeamId || data.teamId) && item.vehicleId === String(data.shareVehicleId || data.vehicleId)) ?? attachments[0];
	await setPhotoSharingForUser(uid, {
		photoId,
		showToBuddies: data.showToBuddies === true,
		showOnShareLink: data.showOnShareLink === true,
		showInGallery: data.showInGallery === true,
		shareVehicleStats: data.shareVehicleStats === true,
		shareTeamId: source?.teamId,
		shareVehicleId: source?.vehicleId
	});
}

export interface LibraryMigration {
	photoId: string;
	from: string;
	to: string;
}

/** Lists legacy files. apply copies each one into the library and updates the document. */
export async function migratePhotoLibraryForUser(uid: string, apply: boolean): Promise<{ moves: LibraryMigration[] }> {
	if (!UID_PATTERN.test(uid)) return { moves: [] };
	const snap = await getFirestore().collection('users').doc(uid).collection(PHOTOS).get();
	const moves: LibraryMigration[] = [];
	for (const item of snap.docs) {
		const path = String(item.get('path') ?? '');
		const target = legacyMigrationTarget(uid, item.id, path, item.get('contentType'));
		if (!target) continue;
		moves.push({ photoId: item.id, from: path, to: target });
		if (!apply) continue;
		const file = bucket().file(path);
		const [exists] = await file.exists().catch(() => [false] as [boolean]);
		if (exists) {
			await file.copy(bucket().file(target));
			await file.delete({ ignoreNotFound: true });
		}
		await item.ref.set({ path: target }, { merge: true });
	}
	return { moves };
}

function createdMs(value: unknown, fallback = 0): number {
	const parsed = Date.parse(String(value ?? ''));
	return Number.isFinite(parsed) ? parsed : fallback;
}

function filePhotoId(name: string): string | null {
	const base = name.split('/').pop() ?? '';
	const stem = base.split('.')[0] ?? '';
	return PHOTO_ID_PATTERN.test(stem) ? stem : null;
}

type StoredFile = { name: string; metadata: { timeCreated?: string }; delete: (options: { ignoreNotFound: boolean }) => Promise<unknown> };

async function listUserFiles(uid: string): Promise<StoredFile[] | null> {
	try {
		const [rows] = await bucket().getFiles({ prefix: `users/${uid}/` });
		return rows;
	} catch (error) {
		const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : 0;
		if (code === 404) return null;
		throw error;
	}
}

/** Drops leftover files for this photo once the replacement bytes are in place. */
async function deleteOtherPhotoFiles(uid: string, photoId: string, keepPath: string): Promise<void> {
	const stored = await listUserFiles(uid);
	if (!stored) return;
	for (const file of stored) {
		if (file.name === keepPath) continue;
		if (filePhotoId(file.name) !== photoId) continue;
		if (!file.name.includes('/photos-library/') && !file.name.includes('/vehicle-photos/')) continue;
		await file.delete({ ignoreNotFound: true });
	}
}

/**
 * Removes a reservation that never received a file, and a file whose photo
 * document is already gone. A file that still shares its id with a document
 * is kept, so a replacement can finish.
 */
export async function cleanupOrphanPhotosForUser(uid: string, now = Date.now()): Promise<{ docs: number; files: number }> {
	if (!UID_PATTERN.test(uid)) return { docs: 0, files: 0 };
	const db = getFirestore();
	const snap = await db.collection('users').doc(uid).collection(PHOTOS).get();
	const stored = await listUserFiles(uid);
	const filesById = new Set<string>();
	for (const file of stored ?? []) {
		const id = filePhotoId(file.name);
		if (id) filesById.add(id);
	}
	const docIds = new Set(snap.docs.map((item) => item.id));
	let docs = 0;
	for (const item of snap.docs) {
		if (filesById.has(item.id)) continue;
		if (now - createdMs(item.get('createdAt')) <= ORPHAN_GRACE_MS) continue;
		await removeSharedCopy(item.id, true);
		await item.ref.delete();
		docs += 1;
	}
	let files = 0;
	for (const file of stored ?? []) {
		if (!file.name.includes('/photos-library/') && !file.name.includes('/vehicle-photos/')) continue;
		const id = filePhotoId(file.name);
		if (!id || docIds.has(id)) continue;
		const age = now - createdMs(file.metadata.timeCreated, now);
		if (age <= ORPHAN_GRACE_MS) continue;
		await file.delete({ ignoreNotFound: true });
		files += 1;
	}
	return { docs, files };
}

async function run<T>(requestUid: string | undefined, task: (uid: string) => Promise<T>): Promise<T> {
	try {
		return await task(await assertActive(requestUid));
	} catch (error) {
		throw httpsError(error);
	}
}

export const attachLibraryPhoto = onCall(CALL, async (request) => {
	const data = asRecord(request.data);
	return run(request.auth?.uid, (uid) => attachLibraryPhotoForUser(uid, String(data.photoId ?? ''), String(data.teamId ?? ''), String(data.vehicleId ?? '')));
});

export const detachLibraryPhoto = onCall(CALL, async (request) => {
	const data = asRecord(request.data);
	return run(request.auth?.uid, async (uid) => {
		await detachLibraryPhotoForUser(uid, String(data.photoId ?? ''), String(data.teamId ?? ''), String(data.vehicleId ?? ''));
		return { detached: true };
	});
});

export const detachVehiclePhotos = onCall(CALL, async (request) => {
	const data = asRecord(request.data);
	return run(request.auth?.uid, async (uid) => ({ detached: await detachVehiclePhotosForUser(uid, String(data.teamId ?? ''), String(data.vehicleId ?? '')) }));
});

export const detachTeamPhotos = onCall(CALL, async (request) => {
	const data = asRecord(request.data);
	return run(request.auth?.uid, async (uid) => ({ detached: await detachTeamPhotosForUser(uid, String(data.teamId ?? '')) }));
});

export const renameLibraryPhoto = onCall(CALL, async (request) => {
	const data = asRecord(request.data);
	return run(request.auth?.uid, async (uid) => {
		await renameLibraryPhotoForUser(uid, String(data.photoId ?? ''), data.caption);
		return { renamed: true };
	});
});

export const preparePhotoReplace = onCall(CALL, async (request) => {
	const data = asRecord(request.data);
	return run(request.auth?.uid, (uid) => preparePhotoReplaceForUser(uid, String(data.photoId ?? ''), data.contentType));
});

export const replaceLibraryPhoto = onCall(CALL, async (request) => {
	const data = asRecord(request.data);
	return run(request.auth?.uid, async (uid) => {
		await replaceLibraryPhotoForUser(uid, data);
		return { replaced: true };
	});
});

export const migratePhotoLibrary = onCall(CALL, async (request) => {
	const data = asRecord(request.data);
	return run(request.auth?.uid, (uid) => migratePhotoLibraryForUser(uid, data.apply === true));
});

export const cleanupOrphanPhotos = onCall(CALL, async (request) => {
	return run(request.auth?.uid, (uid) => cleanupOrphanPhotosForUser(uid));
});
