import { browser } from '$app/environment';
import { auth, initializeFirebase } from '../firebase';
import { PRIVACY_FUNCTIONS_REGION } from '../privacy/accountShared';
import { compressVehiclePhoto } from '../photos/compress';
import {
	MAX_PHOTO_BYTES,
	PHOTO_PRIVACY_SHORT,
	assertPhotoIds,
	cleanCaption,
	quotaMessage,
	type VehiclePhotoRecord
} from '../photos/model';
import type { PrintPhoto } from '../photos/printPhotos';

export { PHOTO_PRIVACY_SHORT };

export interface VehiclePhoto extends VehiclePhotoRecord {
	url: string;
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
		url
	};
}

async function listPhotoDocs(): Promise<VehiclePhotoRecord[]> {
	const { uid } = await readyUser();
	const { collection, getDocs } = await import('firebase/firestore');
	const { db } = await import('../firebase');
	if (!db) throw new Error('Photos are not available right now.');
	const snap = await getDocs(collection(db, 'users', uid, 'photos'));
	const photos: VehiclePhotoRecord[] = [];
	for (const item of snap.docs) {
		const photo = asPhoto(item.data() as Record<string, unknown>, '');
		if (photo) photos.push(photo);
	}
	photos.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return photos;
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

export async function photosForPrint(teamId: string): Promise<Record<string, PrintPhoto[]>> {
	const photos = await listMyPhotos();
	const grouped: Record<string, PrintPhoto[]> = {};
	for (const photo of photos) {
		if (photo.teamId !== teamId || !photo.url) continue;
		const list = grouped[photo.vehicleId] ?? [];
		list.push({ src: photo.url, caption: photo.caption });
		grouped[photo.vehicleId] = list;
	}
	return grouped;
}

async function reserve(input: {
	teamId: string;
	vehicleId: string;
	width: number;
	height: number;
	contentType: string;
	caption: string;
}): Promise<VehiclePhotoRecord> {
	const { app } = await readyUser();
	const { getFunctions, httpsCallable } = await import('firebase/functions');
	const functions = getFunctions(app, PRIVACY_FUNCTIONS_REGION);
	const callable = httpsCallable(functions, 'reserveVehiclePhoto');
	const result = await callable(input);
	return result.data as VehiclePhotoRecord;
}

export async function uploadVehiclePhoto(input: {
	teamId: string;
	vehicleId: string;
	file: Blob;
	caption?: string;
}): Promise<VehiclePhoto> {
	const { uid } = await readyUser();
	assertPhotoIds(uid, input.teamId, input.vehicleId);
	const caption = cleanCaption(input.caption);
	const existing = await listPhotoDocs();
	const onVehicle = existing.filter((photo) => photo.teamId === input.teamId && photo.vehicleId === input.vehicleId).length;
	const blocked = quotaMessage(existing.length, onVehicle);
	if (blocked) throw new Error(blocked);

	const compressed = await compressVehiclePhoto(input.file);
	if (compressed.blob.size > MAX_PHOTO_BYTES) throw new Error('That photo is still too large after compressing. Try a smaller one.');

	let reserved: VehiclePhotoRecord;
	try {
		reserved = await reserve({
			teamId: input.teamId,
			vehicleId: input.vehicleId,
			width: compressed.width,
			height: compressed.height,
			contentType: compressed.contentType,
			caption
		});
	} catch (error) {
		throw plainError(error, 'That photo could not be saved.');
	}

	const stored = await storageRef(reserved.path);
	const { uploadBytes, getDownloadURL } = await import('firebase/storage');
	try {
		await uploadBytes(stored.storageRef, compressed.blob, { contentType: compressed.contentType });
		const url = await getDownloadURL(stored.storageRef);
		return { ...reserved, url };
	} catch (error) {
		await deleteVehiclePhoto(reserved).catch(() => undefined);
		throw plainError(error, 'That photo could not be uploaded.');
	}
}

export async function deleteVehiclePhoto(photo: Pick<VehiclePhotoRecord, 'photoId' | 'path'>): Promise<void> {
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

export async function deleteVehiclePhotos(teamId: string, vehicleId: string): Promise<void> {
	const photos = (await listPhotoDocs()).filter((photo) => photo.teamId === teamId && photo.vehicleId === vehicleId);
	for (const photo of photos) await deleteVehiclePhoto(photo);
}

export async function deleteTeamPhotos(teamId: string): Promise<void> {
	const photos = (await listPhotoDocs()).filter((photo) => photo.teamId === teamId);
	for (const photo of photos) await deleteVehiclePhoto(photo);
}
