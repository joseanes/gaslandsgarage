import { browser } from '$app/environment';
import { auth, initializeFirebase } from '../firebase';
import { PRIVACY_FUNCTIONS_REGION } from '../privacy/accountShared';
import { blobBytes, compressVehiclePhoto } from '../photos/compress';
import { attachmentsFromData, sha256Hex } from '../photos/library';
import {
	MAX_PHOTO_BYTES,
	PHOTO_PRIVACY_SHORT,
	assertPhotoIds,
	cleanCaption,
	quotaMessage,
	type VehiclePhotoRecord
} from '../photos/model';
import type { PrintPhoto } from '../photos/printPhotos';
import { clearPhotoSharing } from './photoShare';

export { PHOTO_PRIVACY_SHORT };

export interface VehiclePhoto extends VehiclePhotoRecord {
	url: string;
	showToBuddies: boolean;
	showOnShareLink: boolean;
	showInGallery: boolean;
	shareVehicleStats: boolean;
	paintingUrl: string;
}

function plainError(error: unknown, fallback: string): Error {
	const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
	const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
	if (code.includes('resource-exhausted') || code.includes('invalid-argument') || code.includes('not-found') || code.includes('permission-denied') || code.includes('unauthenticated')) {
		return new Error(message || fallback);
	}
	if (message && !message.startsWith('Firebase')) return new Error(message);
	return new Error(fallback);
}

async function readyUser(): Promise<{ uid: string; app: NonNullable<typeof auth>['app'] }> {
	if (!browser) throw new Error('Photos can be added in the browser.');
	const ready = await initializeFirebase();
	if (!ready.success || !auth?.currentUser || !auth.app) throw new Error('Sign in before adding a photo.');
	return { uid: auth.currentUser.uid, app: auth.app };
}

async function storageRef(path: string) {
	const { uid, app } = await readyUser();
	const { getStorage, ref } = await import('firebase/storage');
	return { uid, storageRef: ref(getStorage(app), path) };
}

function asPhoto(data: Record<string, unknown>, url: string): VehiclePhoto | null {
	if (typeof data.photoId !== 'string' || typeof data.path !== 'string') return null;
	return {
		photoId: data.photoId,
		userId: String(data.userId ?? ''),
		teamId: String(data.teamId ?? ''),
		vehicleId: String(data.vehicleId ?? ''),
		path: data.path,
		width: Number(data.width) || 0,
		height: Number(data.height) || 0,
		createdAt: String(data.createdAt ?? ''),
		caption: typeof data.caption === 'string' ? data.caption : '',
		contentType: data.contentType === 'image/jpeg' ? 'image/jpeg' : 'image/webp',
		attachments: attachmentsFromData(data),
		contentHash: typeof data.contentHash === 'string' ? data.contentHash : '',
		shareTeamId: typeof data.shareTeamId === 'string' ? data.shareTeamId : '',
		shareVehicleId: typeof data.shareVehicleId === 'string' ? data.shareVehicleId : '',
		showToBuddies: data.showToBuddies === true,
		showOnShareLink: data.showOnShareLink === true,
		showInGallery: data.showInGallery === true,
		shareVehicleStats: data.shareVehicleStats === true,
		paintingUrl: typeof data.paintingUrl === 'string' ? data.paintingUrl : '',
		url
	};
}

export function photoOnVehicle(photo: Pick<VehiclePhoto, 'attachments' | 'teamId' | 'vehicleId'>, teamId: string, vehicleId: string): boolean {
	return photo.attachments.some((item) => item.teamId === teamId && item.vehicleId === vehicleId);
}

async function listPhotoDocs(): Promise<VehiclePhoto[]> {
	const { uid } = await readyUser();
	const { collection, getDocs } = await import('firebase/firestore');
	const { db } = await import('../firebase');
	if (!db) throw new Error('Photos are not available right now.');
	const snap = await getDocs(collection(db, 'users', uid, 'photos'));
	const photos: VehiclePhoto[] = [];
	for (const item of snap.docs) {
		const photo = asPhoto(item.data() as Record<string, unknown>, '');
		if (photo) photos.push(photo);
	}
	photos.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return photos;
}

/** Vehicle ids on this team that have a photo attached. Skips download URLs. */
export async function vehicleIdsWithPhotos(teamId: string): Promise<string[]> {
	const photos = await listPhotoDocs();
	const ids = new Set<string>();
	for (const photo of photos) {
		const attached = photo.attachments.filter((item) => item.teamId === teamId && item.vehicleId);
		if (attached.length > 0) {
			for (const item of attached) ids.add(item.vehicleId);
		} else if (photo.teamId === teamId && photo.vehicleId) {
			ids.add(photo.vehicleId);
		}
	}
	return [...ids];
}

export async function listMyPhotos(): Promise<VehiclePhoto[]> {
	const { app } = await readyUser();
	const docs = await listPhotoDocs();
	const { getStorage, ref, getDownloadURL } = await import('firebase/storage');
	const storage = getStorage(app);
	const photos: VehiclePhoto[] = [];
	for (const photo of docs) {
		let url = '';
		try {
			url = await getDownloadURL(ref(storage, photo.path));
		} catch {
			url = '';
		}
		photos.push({ ...photo, url });
	}
	return photos;
}

/** Per-photo limit for looking up a print address. Lookups run in parallel, so the sheet waits at most this long. */
const PRINT_PHOTO_LOOKUP_MS = 6_000;

function within<T>(work: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		work,
		new Promise<T>((_, reject) => {
			timer = setTimeout(() => reject(new Error('Photo lookup timed out.')), ms);
		})
	]).finally(() => {
		if (timer !== undefined) clearTimeout(timer);
	});
}

/**
 * Print addresses for each vehicle's photos, looked up in parallel.
 *
 * The sheet uses the Storage download address in a plain <img>. Reading the
 * bytes with getBlob needs CORS on the bucket, and production has none, so
 * every getBlob failed after the SDK's retries and the sheet printed with no
 * photos. A plain image load does not need CORS.
 */
export async function photosForPrint(teamId: string): Promise<Record<string, PrintPhoto[]>> {
	const { app } = await readyUser();
	const docs = (await listPhotoDocs()).filter((photo) => photo.attachments.some((item) => item.teamId === teamId) || photo.teamId === teamId);
	const { getStorage, ref, getDownloadURL } = await import('firebase/storage');
	const storage = getStorage(app);
	const grouped: Record<string, PrintPhoto[]> = {};
	const looked = await Promise.allSettled(docs.map((photo) => within(getDownloadURL(ref(storage, photo.path)), PRINT_PHOTO_LOOKUP_MS)));
	docs.forEach((photo, index) => {
		const result = looked[index];
		if (result.status !== 'fulfilled') return;
		const targets = photo.attachments.filter((item) => item.teamId === teamId);
		const vehicles = targets.length > 0 ? targets : photo.teamId === teamId ? [{ teamId, vehicleId: photo.vehicleId }] : [];
		for (const target of vehicles) {
			const list = grouped[target.vehicleId] ?? [];
			list.push({ src: result.value, caption: photo.caption });
			grouped[target.vehicleId] = list;
		}
	});
	return grouped;
}

async function reserve(input: {
	teamId?: string;
	vehicleId?: string;
	width: number;
	height: number;
	contentType: string;
	caption: string;
	contentHash: string;
}): Promise<VehiclePhotoRecord & { duplicate?: boolean }> {
	const { app } = await readyUser();
	const { getFunctions, httpsCallable } = await import('firebase/functions');
	const functions = getFunctions(app, PRIVACY_FUNCTIONS_REGION);
	const callable = httpsCallable(functions, 'reserveVehiclePhoto');
	const result = await callable(input);
	return result.data as VehiclePhotoRecord;
}

export async function uploadVehiclePhoto(input: {
	teamId?: string;
	vehicleId?: string;
	file: Blob;
	caption?: string;
}): Promise<VehiclePhoto> {
	const { uid } = await readyUser();
	const teamId = input.teamId ?? '';
	const vehicleId = input.vehicleId ?? '';
	if (teamId || vehicleId) assertPhotoIds(uid, teamId, vehicleId);
	else if (!/^([A-Za-z0-9_-]{1,128})$/.test(uid)) throw new Error('Sign in again before adding a photo.');
	const caption = cleanCaption(input.caption);
	const existing = await listPhotoDocs();
	const onVehicle = teamId && vehicleId ? existing.filter((photo) => photoOnVehicle(photo, teamId, vehicleId)).length : 0;
	const compressed = await compressVehiclePhoto(input.file);
	if (compressed.blob.size > MAX_PHOTO_BYTES) throw new Error('That photo is still too large after compressing. Try a smaller one.');
	const contentHash = await sha256Hex(await blobBytes(compressed.blob));
	const duplicate = existing.find((photo) => photo.contentHash === contentHash);
	if (duplicate) {
		const alreadyHere = teamId && vehicleId ? photoOnVehicle(duplicate, teamId, vehicleId) : false;
		if (teamId && vehicleId && !alreadyHere && onVehicle >= 3) {
			throw new Error('This vehicle already has 3 photos. Detach one to add another.');
		}
	} else {
		const blocked = quotaMessage(existing.length, onVehicle);
		if (blocked) throw new Error(blocked);
	}

	let reserved: VehiclePhotoRecord & { duplicate?: boolean };
	try {
		reserved = await reserve({
			teamId: input.teamId,
			vehicleId: input.vehicleId,
			width: compressed.width,
			height: compressed.height,
			contentType: compressed.contentType,
			caption,
			contentHash
		});
	} catch (error) {
		throw plainError(error, 'That photo could not be saved.');
	}

	if (reserved.duplicate) {
		const stored = await storageRef(reserved.path);
		const { getDownloadURL } = await import('firebase/storage');
		let url = '';
		try {
			url = await getDownloadURL(stored.storageRef);
		} catch {
			url = '';
		}
		return { ...reserved, attachments: reserved.attachments ?? [], contentHash, shareTeamId: reserved.shareTeamId ?? '', shareVehicleId: reserved.shareVehicleId ?? '', showToBuddies: false, showOnShareLink: false, showInGallery: false, shareVehicleStats: false, paintingUrl: '', url };
	}

	const stored = await storageRef(reserved.path);
	const { uploadBytes, getDownloadURL } = await import('firebase/storage');
	try {
		await uploadBytes(stored.storageRef, compressed.blob, { contentType: compressed.contentType });
		const url = await getDownloadURL(stored.storageRef);
		return {
			...reserved,
			attachments: reserved.attachments ?? [],
			contentHash,
			shareTeamId: reserved.shareTeamId ?? '',
			shareVehicleId: reserved.shareVehicleId ?? '',
			showToBuddies: false,
			showOnShareLink: false,
			showInGallery: false,
			shareVehicleStats: false,
			paintingUrl: '',
			url
		};
	} catch (error) {
		await deleteVehiclePhoto(reserved).catch(() => undefined);
		throw plainError(error, 'That photo could not be uploaded.');
	}
}

export async function deleteVehiclePhoto(photo: Pick<VehiclePhotoRecord, 'photoId' | 'path'>): Promise<void> {
	await clearPhotoSharing(photo.photoId);
	const { uid, app } = await readyUser();
	const { db } = await import('../firebase');
	if (!db) throw new Error('Photos are not available right now.');
	const { deleteObject, getStorage, ref } = await import('firebase/storage');
	try {
		await deleteObject(ref(getStorage(app), photo.path));
	} catch (error) {
		const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
		if (!code.includes('object-not-found')) throw plainError(error, 'That photo could not be deleted.');
	}
	const { deleteDoc, doc } = await import('firebase/firestore');
	await deleteDoc(doc(db, 'users', uid, 'photos', photo.photoId));
}

async function libraryCall<T>(name: string, data: unknown, fallback: string): Promise<T> {
	const { app } = await readyUser();
	const { getFunctions, httpsCallable } = await import('firebase/functions');
	try {
		const result = await httpsCallable(getFunctions(app, PRIVACY_FUNCTIONS_REGION), name)(data);
		return result.data as T;
	} catch (error) {
		throw plainError(error, fallback);
	}
}

export async function attachLibraryPhoto(photoId: string, teamId: string, vehicleId: string): Promise<void> {
	await libraryCall('attachLibraryPhoto', { photoId, teamId, vehicleId }, 'That photo could not be attached.');
}

export async function detachLibraryPhoto(photoId: string, teamId: string, vehicleId: string): Promise<void> {
	await libraryCall('detachLibraryPhoto', { photoId, teamId, vehicleId }, 'That photo could not be removed from this car.');
}

/** Removes every attachment on this car. The files stay in My Photos. */
export async function detachVehiclePhotos(teamId: string, vehicleId: string): Promise<void> {
	await libraryCall('detachVehiclePhotos', { teamId, vehicleId }, 'Photos could not be removed from this car.');
}

/** Removes every attachment on this team. The files stay in My Photos. */
export async function detachTeamPhotos(teamId: string): Promise<void> {
	await libraryCall('detachTeamPhotos', { teamId }, 'Photos could not be removed from this team.');
}

export async function renameLibraryPhoto(photoId: string, caption: string): Promise<void> {
	await libraryCall('renameLibraryPhoto', { photoId, caption }, 'That caption could not be saved.');
}

export async function replaceLibraryPhoto(photo: VehiclePhoto, file: Blob): Promise<void> {
	const compressed = await compressVehiclePhoto(file);
	if (compressed.blob.size > MAX_PHOTO_BYTES) throw new Error('That photo is still too large after compressing. Try a smaller one.');
	const contentHash = await sha256Hex(await blobBytes(compressed.blob));
	let path = photo.path;
	let contentType = compressed.contentType;
	if (compressed.contentType !== photo.contentType || !photo.path.includes('/photos-library/')) {
		const prepared = await libraryCall<{ path: string; contentType: string }>(
			'preparePhotoReplace',
			{ photoId: photo.photoId, contentType: compressed.contentType },
			'That photo could not be replaced.'
		);
		path = prepared.path;
		contentType = prepared.contentType === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
	}
	const stored = await storageRef(path);
	const { uploadBytes } = await import('firebase/storage');
	await uploadBytes(stored.storageRef, compressed.blob, { contentType });
	await libraryCall('replaceLibraryPhoto', { photoId: photo.photoId, width: compressed.width, height: compressed.height, contentHash }, 'That photo could not be replaced.');
}

export async function migrateMyPhotoLibrary(): Promise<void> {
	await libraryCall('migratePhotoLibrary', { apply: true }, 'Photos could not be prepared.');
}

export async function cleanupMyPhotoOrphans(): Promise<void> {
	await libraryCall('cleanupOrphanPhotos', {}, 'Photos could not be cleaned up.');
}

export function countOnVehicleClient(photos: VehiclePhoto[], teamId: string, vehicleId: string): number {
	return photos.filter((photo) => photoOnVehicle(photo, teamId, vehicleId)).length;
}

export { quotaMessage };
