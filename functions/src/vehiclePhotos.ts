import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
	UID_PATTERN,
	storageBucketForProject,
	type VehiclePhotoRecord
} from '../../app/src/lib/photos/model.ts';
import { deleteSharedPhotosForOwner } from './photoShare.ts';
import { reserveLibraryPhoto, type ReserveLibraryInput, type ReservedLibraryPhoto } from './photoLibrary.ts';
const PHOTOS = 'photos';
const PHOTO_REGION = 'us-central1';

export const PHOTO_EXPORT_NOTE =
	'These photos are private to your account. This download lists them. It does not include a public link. Open Gaslands Garage while signed in to view or delete each photo.';

export const reserveVehiclePhotoOptions = {
	region: PHOTO_REGION,
	memory: '256MiB',
	timeoutSeconds: 60,
	maxInstances: 10
} as const;

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

export type ReservePhotoInput = ReserveLibraryInput;

/**
 * Creates the library reservation the browser may then upload to.
 * Clients cannot create these documents themselves. The transaction counts
 * library files toward 100 per account and attachments toward 3 per car.
 * The same bytes attach to the existing photo instead of creating another file.
 */
export async function reserveVehiclePhotoForUser(uid: string, input: ReservePhotoInput): Promise<ReservedLibraryPhoto> {
	return reserveLibraryPhoto(uid, input);
}

export async function exportVehiclePhotos(uid: string): Promise<{ note: string; photos: VehiclePhotoRecord[] }> {
	const snap = await getFirestore().collection('users').doc(uid).collection(PHOTOS).get();
	const photos = snap.docs
		.map((item) => item.data() as VehiclePhotoRecord)
		.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
	return { note: PHOTO_EXPORT_NOTE, photos };
}

async function deleteStoragePrefix(uid: string): Promise<void> {
	const bucket = getStorage().bucket(storageBucketForProject(
		process.env.FIREBASE_STORAGE_BUCKET ?? '',
		process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? ''
	));
	try {
		const [files] = await bucket.getFiles({ prefix: `users/${uid}/` });
		await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
	} catch (error) {
		const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : 0;
		if (code === 404) return;
		throw error;
	}
}

/** Deletes shared copies, every Storage object under users/{uid}/, and the photo metadata. */
export async function deleteUserPhotos(uid: string): Promise<void> {
	if (!UID_PATTERN.test(uid)) return;
	await deleteSharedPhotosForOwner(uid);
	await deleteStoragePrefix(uid);
	const db = getFirestore();
	const snap = await db.collection('users').doc(uid).collection(PHOTOS).get();
	const refs: DocumentReference[] = snap.docs.map((item) => item.ref);
	for (let index = 0; index < refs.length; index += 400) {
		const batch = db.batch();
		for (const ref of refs.slice(index, index + 400)) batch.delete(ref);
		if (refs.slice(index, index + 400).length > 0) await batch.commit();
	}
}

export const reserveVehiclePhoto = onCall(reserveVehiclePhotoOptions, async (request) => {
	try {
		const uid = await assertActive(request.auth?.uid);
		const data = asRecord(request.data);
		return await reserveVehiclePhotoForUser(uid, {
			teamId: data.teamId,
			vehicleId: data.vehicleId,
			width: data.width,
			height: data.height,
			contentType: data.contentType,
			caption: data.caption,
			contentHash: data.contentHash
		});
	} catch (error) {
		throw httpsError(error);
	}
});
