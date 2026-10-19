import { randomBytes } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
	MAX_CAPTION_LENGTH,
	MAX_PHOTO_EDGE,
	PHOTO_ID_PATTERN,
	TEAM_ID_PATTERN,
	UID_PATTERN,
	VEHICLE_ID_PATTERN,
	cleanCaption,
	isPhotoContentType,
	quotaMessage,
	storageBucketName,
	vehiclePhotoPath,
	type PhotoContentType,
	type VehiclePhotoRecord
} from '../../app/src/lib/photos/model.ts';
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

function photoId(): string {
	return randomBytes(9).toString('base64url');
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function teamHasVehicle(team: Record<string, unknown> | undefined, vehicleId: string): boolean {
	const vehicles = asRecord(team?.teamData).vehicles;
	if (!Array.isArray(vehicles)) return false;
	return vehicles.some((entry) => asRecord(entry).id === vehicleId);
}

export interface ReservePhotoInput {
	teamId: unknown;
	vehicleId: unknown;
	width: unknown;
	height: unknown;
	contentType: unknown;
	caption?: unknown;
}

/**
 * Creates the metadata document the browser may then upload to.
 * Clients cannot create these documents themselves. The transaction counts
 * photos so a player stays within 3 per vehicle and 100 per account.
 */
export async function reserveVehiclePhotoForUser(uid: string, input: ReservePhotoInput): Promise<VehiclePhotoRecord> {
	if (!TEAM_ID_PATTERN.test(String(input.teamId ?? ''))) throw new Error('Save this team before adding a photo.');
	if (!VEHICLE_ID_PATTERN.test(String(input.vehicleId ?? ''))) {
		throw new Error('This vehicle cannot store a photo. Remove it and add it again.');
	}
	const teamId = String(input.teamId);
	const vehicleId = String(input.vehicleId);
	const width = Number(input.width);
	const height = Number(input.height);
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_PHOTO_EDGE || height > MAX_PHOTO_EDGE) {
		throw new Error('That photo could not be prepared.');
	}
	if (!isPhotoContentType(input.contentType)) throw new Error('Choose a JPEG or WebP photo.');
	const contentType: PhotoContentType = input.contentType;
	let caption = '';
	try {
		caption = cleanCaption(input.caption);
	} catch (error) {
		throw new Error(error instanceof Error ? error.message : `Captions can be ${MAX_CAPTION_LENGTH} characters.`);
	}

	const db = getFirestore();
	const id = photoId();
	if (!PHOTO_ID_PATTERN.test(id)) throw new Error('That photo could not be prepared.');
	const path = vehiclePhotoPath(uid, teamId, vehicleId, id, contentType);
	const record: VehiclePhotoRecord = {
		photoId: id,
		userId: uid,
		teamId,
		vehicleId,
		path,
		width,
		height,
		createdAt: new Date().toISOString(),
		caption,
		contentType
	};

	await db.runTransaction(async (tx) => {
		const team = await tx.get(db.doc(`teams/${teamId}`));
		if (!team.exists || team.get('userId') !== uid) throw new Error('Save this team before adding a photo.');
		if (!teamHasVehicle(team.data(), vehicleId)) throw new Error('That vehicle is not on this team.');
		const existing = await tx.get(db.collection('users').doc(uid).collection(PHOTOS));
		const onVehicle = existing.docs.filter((item) => item.get('teamId') === teamId && item.get('vehicleId') === vehicleId).length;
		const blocked = quotaMessage(existing.size, onVehicle);
		if (blocked) throw new Error(blocked);
		tx.set(db.doc(`users/${uid}/${PHOTOS}/${id}`), record);
	});
	return record;
}

export async function exportVehiclePhotos(uid: string): Promise<{ note: string; photos: VehiclePhotoRecord[] }> {
	const snap = await getFirestore().collection('users').doc(uid).collection(PHOTOS).get();
	const photos = snap.docs
		.map((item) => item.data() as VehiclePhotoRecord)
		.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
	return { note: PHOTO_EXPORT_NOTE, photos };
}

async function deleteStoragePrefix(uid: string): Promise<void> {
	const bucket = getStorage().bucket(storageBucketName(process.env.FIREBASE_STORAGE_BUCKET ?? ''));
	try {
		const [files] = await bucket.getFiles({ prefix: `users/${uid}/` });
		await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
	} catch (error) {
		const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : 0;
		if (code === 404) return;
		throw error;
	}
}

/** Deletes every Storage object under users/{uid}/ and the photo metadata. */
export async function deleteUserPhotos(uid: string): Promise<void> {
	if (!UID_PATTERN.test(uid)) return;
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
			caption: data.caption
		});
	} catch (error) {
		throw httpsError(error);
	}
});
