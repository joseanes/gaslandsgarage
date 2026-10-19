import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { BUDDY_FALLBACK_NAME } from '../../app/src/lib/buddies/model.ts';
import { storageBucketName } from '../../app/src/lib/photos/model.ts';
import { sharedPhotoMediaUrl, sharedPhotoObjectPath } from '../../app/src/lib/photos/share.ts';
import { deleteUserPhotos, reserveVehiclePhotoForUser } from './vehiclePhotos';
import {
	listVisibleTeamPhotosForCaller,
	moderateGalleryForAdmin,
	reportPhotoForUser,
	setPhotoSharingForUser
} from './photoShare';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-gaslands-functions';
const bucketName = storageBucketName(process.env.FIREBASE_STORAGE_BUCKET ?? '');

function emulatorUrl(host: string | undefined, fallbackPort: number): string {
	const value = host && host.length > 0 ? host : `127.0.0.1:${fallbackPort}`;
	return value.startsWith('http') ? value : `http://${value}`;
}

async function clearFirestore(): Promise<void> {
	const firestore = await fetch(
		`${emulatorUrl(process.env.FIRESTORE_EMULATOR_HOST, 8080)}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
		{ method: 'DELETE' }
	);
	if (!firestore.ok) throw new Error(`Could not clear Firestore (${firestore.status})`);
}

beforeAll(() => {
	process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
	process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
	if (getApps().length === 0) initializeApp({ projectId, storageBucket: bucketName });
});

beforeEach(async () => {
	await clearFirestore();
	try {
		const bucket = getStorage().bucket(bucketName);
		const [shared] = await bucket.getFiles({ prefix: 'shared-photos/' });
		const [owned] = await bucket.getFiles({ prefix: 'users/' });
		await Promise.all([...shared, ...owned].map((file) => file.delete({ ignoreNotFound: true })));
	} catch (error) {
		const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : 0;
		if (code !== 404) throw error;
	}
});

async function savePhoto() {
	await getFirestore().doc('teams/team1234').set({
		userId: 'ada',
		teamName: 'Racers',
		hiddenFromBuddies: false,
		teamData: { vehicles: [{ id: 'veh123', type: 'performance_car' }] }
	});
	await getFirestore().doc('users/ada').set({ displayName: 'Google Name', email: 'ada@gmail.com' });
	await getFirestore().doc('playerProfiles/ada').set({ playerName: 'Track Name' });
	const reserved = await reserveVehiclePhotoForUser('ada', {
		teamId: 'team1234',
		vehicleId: 'veh123',
		width: 800,
		height: 600,
		contentType: 'image/webp',
		caption: 'Red racer'
	});
	const bytes = Buffer.from('RIFF....WEBP');
	await getStorage().bucket(bucketName).file(reserved.path).save(bytes, { contentType: 'image/webp' });
	return { reserved, bytes };
}

describe('shared photos', () => {
	it('copies a shared photo without the account id, Google name, or email', async () => {
		const { reserved, bytes } = await savePhoto();
		const shared = await setPhotoSharingForUser('ada', {
			photoId: reserved.photoId,
			showToBuddies: true,
			showOnShareLink: true,
			showInGallery: true
		});
		expect(shared).toEqual({ shared: true, published: true, hidden: false });
		const publicDoc = (await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).data();
		expect(publicDoc).toMatchObject({
			displayName: 'Track Name',
			vehicleType: 'Performance Car',
			teamName: 'Racers',
			caption: 'Red racer',
			showInGallery: true,
			published: true,
			hidden: false
		});
		expect(publicDoc).not.toHaveProperty('ownerUid');
		expect(publicDoc).not.toHaveProperty('userId');
		expect(publicDoc).not.toHaveProperty('email');
		expect(JSON.stringify(publicDoc)).not.toContain('Google Name');
		expect(JSON.stringify(publicDoc)).not.toContain('ada@gmail.com');
		const privateDoc = (await getFirestore().doc(`sharedPhotoPrivate/${reserved.photoId}`).get()).data();
		expect(privateDoc?.ownerUid).toBe('ada');
		const file = getStorage().bucket(bucketName).file(sharedPhotoObjectPath(reserved.photoId));
		const [stored] = await file.download();
		expect(stored.equals(bytes)).toBe(true);
		const [meta] = await file.getMetadata();
		expect(meta.metadata?.firebaseStorageDownloadTokens ?? '').toBe('');
		const url = sharedPhotoMediaUrl(bucketName, reserved.photoId);
		expect(url).not.toContain('users/ada');
		expect(url).not.toContain('token=');

		const link = await listVisibleTeamPhotosForCaller(undefined, { teamId: 'team1234', audience: 'link' });
		expect(link.photos.map((photo) => photo.photoId)).toEqual([reserved.photoId]);
		expect(JSON.stringify(link)).not.toContain('ownerUid');
		expect(JSON.stringify(link)).not.toContain('Google Name');

		await getFirestore().doc('buddies/ada~bob').set({ status: 'accepted', members: ['ada', 'bob'] });
		const buddy = await listVisibleTeamPhotosForCaller('bob', { teamId: 'team1234', audience: 'buddies' });
		expect(buddy.photos).toHaveLength(1);
		await expect(listVisibleTeamPhotosForCaller('cy', { teamId: 'team1234', audience: 'buddies' })).rejects.toThrow(/not available/);

		await setPhotoSharingForUser('ada', {
			photoId: reserved.photoId,
			showToBuddies: false,
			showOnShareLink: false,
			showInGallery: false
		});
		expect((await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).exists).toBe(false);
		const [gone] = await file.exists();
		expect(gone).toBe(false);
	});

	it('hides a gallery photo after three different reports and keeps it hidden if shared again', async () => {
		const { reserved } = await savePhoto();
		await setPhotoSharingForUser('ada', {
			photoId: reserved.photoId,
			showToBuddies: false,
			showOnShareLink: false,
			showInGallery: true
		});
		const now = Date.parse('2026-10-19T12:00:00.000Z');
		expect((await reportPhotoForUser('bob', reserved.photoId, now)).hidden).toBe(false);
		expect((await reportPhotoForUser('cy', reserved.photoId, now + 1)).hidden).toBe(false);
		expect((await reportPhotoForUser('dee', reserved.photoId, now + 2)).hidden).toBe(true);
		expect((await reportPhotoForUser('bob', reserved.photoId, now + 3)).alreadyReported).toBe(true);
		expect((await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).get('hidden')).toBe(true);

		await setPhotoSharingForUser('ada', {
			photoId: reserved.photoId,
			showToBuddies: false,
			showOnShareLink: true,
			showInGallery: true
		});
		expect((await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).get('hidden')).toBe(true);
		const link = await listVisibleTeamPhotosForCaller(undefined, { teamId: 'team1234', audience: 'link' });
		expect(link.photos).toEqual([]);
	});

	it('holds new gallery photos when approval is required and removes them with the account', async () => {
		const { reserved } = await savePhoto();
		await expect(moderateGalleryForAdmin('ada', { action: 'setRequireApproval', requireApproval: true })).rejects.toThrow(/Administrator/);
		await getFirestore().doc('roles/mod').set({ role: 'Administrator' });
		await moderateGalleryForAdmin('mod', { action: 'setRequireApproval', requireApproval: true });
		const held = await setPhotoSharingForUser('ada', {
			photoId: reserved.photoId,
			showToBuddies: true,
			showOnShareLink: true,
			showInGallery: true
		});
		expect(held.published).toBe(false);
		const listed = await moderateGalleryForAdmin('mod', { action: 'list' });
		expect(listed.requireApproval).toBe(true);
		expect(listed.photos?.[0]?.ownerUid).toBe('ada');
		expect(listed.photos?.[0]?.displayName).toBe('Track Name');
		await moderateGalleryForAdmin('mod', { action: 'approve', photoId: reserved.photoId });
		expect((await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).get('published')).toBe(true);
		await moderateGalleryForAdmin('mod', { action: 'hide', photoId: reserved.photoId });
		expect((await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).get('hidden')).toBe(true);

		await getFirestore().doc('playerProfiles/ada').set({ playerName: 'ada@gmail.com' });
		await setPhotoSharingForUser('ada', {
			photoId: reserved.photoId,
			showToBuddies: false,
			showOnShareLink: false,
			showInGallery: true
		});
		expect((await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).get('displayName')).toBe(BUDDY_FALLBACK_NAME);

		await deleteUserPhotos('ada');
		expect((await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).exists).toBe(false);
		expect((await getFirestore().doc(`sharedPhotoPrivate/${reserved.photoId}`).get()).exists).toBe(false);
		const [files] = await getStorage().bucket(bucketName).getFiles({ prefix: 'shared-photos/' });
		expect(files).toEqual([]);
	});
});
