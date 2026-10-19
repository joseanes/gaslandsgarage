import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { ORPHAN_GRACE_MS, storageBucketName } from '../../app/src/lib/photos/model.ts';
import { setPhotoSharingForUser } from './photoShare';
import { reserveVehiclePhotoForUser } from './vehiclePhotos';
import {
	attachLibraryPhotoForUser,
	cleanupOrphanPhotosForUser,
	detachVehiclePhotosForUser,
	migratePhotoLibraryForUser,
	preparePhotoReplaceForUser,
	renameLibraryPhotoForUser,
	replaceLibraryPhotoForUser
} from './photoLibrary';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-gaslands-functions';
const bucketName = storageBucketName(process.env.FIREBASE_STORAGE_BUCKET ?? '');
const hash = 'ab'.repeat(32);

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
		const [owned] = await bucket.getFiles({ prefix: 'users/' });
		const [shared] = await bucket.getFiles({ prefix: 'shared-photos/' });
		await Promise.all([...owned, ...shared].map((file) => file.delete({ ignoreNotFound: true })));
	} catch (error) {
		const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : 0;
		if (code !== 404) throw error;
	}
});

async function saveTeam() {
	await getFirestore().doc('teams/team1234').set({
		userId: 'ada',
		teamName: 'Racers',
		teamData: {
			vehicles: [
				{ id: 'veh123', type: 'car', name: 'First' },
				{ id: 'veh456', type: 'buggy', name: 'Second' },
				{ id: 'veh789', type: 'car', name: 'Third' },
				{ id: 'vehabc', type: 'car', name: 'Fourth' }
			]
		}
	});
}

describe('photo library', () => {
	it('attaches the same bytes to a second car instead of storing another file', async () => {
		await saveTeam();
		const input = {
			teamId: 'team1234',
			vehicleId: 'veh123',
			width: 800,
			height: 600,
			contentType: 'image/webp' as const,
			caption: 'Red',
			contentHash: hash
		};
		const first = await reserveVehiclePhotoForUser('ada', input);
		const second = await reserveVehiclePhotoForUser('ada', { ...input, vehicleId: 'veh456', caption: 'Other' });
		expect(second.duplicate).toBe(true);
		expect(second.photoId).toBe(first.photoId);
		expect(second.attachments).toEqual([
			{ teamId: 'team1234', vehicleId: 'veh123' },
			{ teamId: 'team1234', vehicleId: 'veh456' }
		]);
		expect((await getFirestore().collection('users/ada/photos').get()).size).toBe(1);

		await reserveVehiclePhotoForUser('ada', { ...input, contentHash: 'cd'.repeat(32) });
		await reserveVehiclePhotoForUser('ada', { ...input, contentHash: 'ef'.repeat(32) });
		await expect(reserveVehiclePhotoForUser('ada', { ...input, contentHash: '12'.repeat(32) })).rejects.toThrow(/3 photos/);
		await expect(attachLibraryPhotoForUser('ada', first.photoId, 'team1234', 'veh123')).resolves.toMatchObject({
			photoId: first.photoId
		});
	});

	it('still accepts an existing photo when the account already has 100 files', async () => {
		await saveTeam();
		const db = getFirestore();
		const batch = db.batch();
		for (let index = 0; index < 100; index += 1) {
			const photoId = `p${String(index).padStart(7, '0')}`;
			batch.set(db.doc(`users/ada/photos/${photoId}`), {
				photoId,
				userId: 'ada',
				teamId: '',
				vehicleId: '',
				path: `users/ada/photos-library/${photoId}.webp`,
				contentType: 'image/webp',
				contentHash: index === 0 ? hash : '',
				attachments: [],
				createdAt: '2026-10-19T00:00:00.000Z'
			});
		}
		await batch.commit();
		await expect(
			reserveVehiclePhotoForUser('ada', {
				width: 10,
				height: 10,
				contentType: 'image/webp',
				contentHash: '99'.repeat(32)
			})
		).rejects.toThrow(/100 photos/);
		const attached = await reserveVehiclePhotoForUser('ada', {
			teamId: 'team1234',
			vehicleId: 'veh123',
			width: 10,
			height: 10,
			contentType: 'image/webp',
			contentHash: hash
		});
		expect(attached.duplicate).toBe(true);
		expect(attached.photoId).toBe('p0000000');
		expect((await db.collection('users/ada/photos').get()).size).toBe(100);
	});

	it('keeps the file when a car is removed and drops that car from the share', async () => {
		await saveTeam();
		const reserved = await reserveVehiclePhotoForUser('ada', {
			teamId: 'team1234',
			vehicleId: 'veh123',
			width: 800,
			height: 600,
			contentType: 'image/webp',
			caption: 'Red'
		});
		await attachLibraryPhotoForUser('ada', reserved.photoId, 'team1234', 'veh456');
		const bucket = getStorage().bucket(bucketName);
		await bucket.file(reserved.path).save(Buffer.from('webp'), { contentType: 'image/webp' });
		await setPhotoSharingForUser('ada', {
			photoId: reserved.photoId,
			showToBuddies: false,
			showOnShareLink: false,
			showInGallery: true,
			shareVehicleStats: false,
			shareTeamId: 'team1234',
			shareVehicleId: 'veh123'
		});
		expect(await detachVehiclePhotosForUser('ada', 'team1234', 'veh123')).toBe(1);
		const saved = await getFirestore().doc(`users/ada/photos/${reserved.photoId}`).get();
		expect(saved.exists).toBe(true);
		expect(saved.get('attachments')).toEqual([{ teamId: 'team1234', vehicleId: 'veh456' }]);
		expect(saved.get('showInGallery')).toBe(false);
		expect((await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).exists).toBe(false);
		const [stillThere] = await bucket.file(reserved.path).exists();
		expect(stillThere).toBe(true);
	});

	it('renames and replaces a photo without dropping its cars', async () => {
		await saveTeam();
		const reserved = await reserveVehiclePhotoForUser('ada', {
			teamId: 'team1234',
			vehicleId: 'veh123',
			width: 800,
			height: 600,
			contentType: 'image/webp',
			caption: 'Red'
		});
		await attachLibraryPhotoForUser('ada', reserved.photoId, 'team1234', 'veh456');
		const bucket = getStorage().bucket(bucketName);
		await bucket.file(reserved.path).save(Buffer.from('webp'), { contentType: 'image/webp' });
		await setPhotoSharingForUser('ada', {
			photoId: reserved.photoId,
			showToBuddies: true,
			showOnShareLink: false,
			showInGallery: false,
			shareTeamId: 'team1234',
			shareVehicleId: 'veh456'
		});
		await renameLibraryPhotoForUser('ada', reserved.photoId, 'Blue');
		expect((await getFirestore().doc(`users/ada/photos/${reserved.photoId}`).get()).get('caption')).toBe('Blue');
		expect((await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).get('caption')).toBe('Blue');

		const prepared = await preparePhotoReplaceForUser('ada', reserved.photoId, 'image/jpeg');
		expect(prepared.path).toBe(`users/ada/photos-library/${reserved.photoId}.jpg`);
		const [oldRemains] = await bucket.file(reserved.path).exists();
		expect(oldRemains).toBe(true);
		await bucket.file(prepared.path).save(Buffer.from('jpeg'), { contentType: 'image/jpeg' });
		await replaceLibraryPhotoForUser('ada', {
			photoId: reserved.photoId,
			width: 640,
			height: 480,
			contentHash: 'ef'.repeat(32)
		});
		const saved = await getFirestore().doc(`users/ada/photos/${reserved.photoId}`).get();
		expect(saved.get('attachments')).toEqual([
			{ teamId: 'team1234', vehicleId: 'veh123' },
			{ teamId: 'team1234', vehicleId: 'veh456' }
		]);
		expect(saved.get('contentHash')).toBe('ef'.repeat(32));
		expect(saved.get('width')).toBe(640);
		const [oldGone] = await bucket.file(reserved.path).exists();
		const [replaced] = await bucket.file(prepared.path).exists();
		expect(oldGone).toBe(false);
		expect(replaced).toBe(true);
		expect((await getFirestore().doc(`sharedPhotoPrivate/${reserved.photoId}`).get()).get('vehicleId')).toBe('veh456');
	});

	it('lists a legacy file in a dry run and copies it when asked', async () => {
		const legacy = 'users/ada/vehicle-photos/team1234/veh123/photo1234.webp';
		const target = 'users/ada/photos-library/photo1234.webp';
		await getFirestore().doc('users/ada/photos/photo1234').set({
			photoId: 'photo1234',
			userId: 'ada',
			path: legacy,
			contentType: 'image/webp',
			createdAt: '2026-10-19T00:00:00.000Z'
		});
		const bucket = getStorage().bucket(bucketName);
		await bucket.file(legacy).save(Buffer.from('webp'), { contentType: 'image/webp' });
		const listed = await migratePhotoLibraryForUser('ada', false);
		expect(listed.moves).toEqual([{ photoId: 'photo1234', from: legacy, to: target }]);
		expect((await getFirestore().doc('users/ada/photos/photo1234').get()).get('path')).toBe(legacy);
		const [before] = await bucket.file(legacy).exists();
		expect(before).toBe(true);

		const applied = await migratePhotoLibraryForUser('ada', true);
		expect(applied.moves).toEqual(listed.moves);
		expect((await getFirestore().doc('users/ada/photos/photo1234').get()).get('path')).toBe(target);
		const [oldGone] = await bucket.file(legacy).exists();
		const [copied] = await bucket.file(target).exists();
		expect(oldGone).toBe(false);
		expect(copied).toBe(true);
	});

	it('cleans a stale reservation and an unreferenced file, and keeps a fresh upload', async () => {
		const db = getFirestore();
		const old = new Date(Date.now() - ORPHAN_GRACE_MS - 60_000).toISOString();
		await db.doc('users/ada/photos/stalepho1').set({
			userId: 'ada',
			path: 'users/ada/photos-library/stalepho1.webp',
			createdAt: old
		});
		await db.doc('users/ada/photos/freshpho1').set({
			userId: 'ada',
			path: 'users/ada/photos-library/freshpho1.webp',
			createdAt: new Date().toISOString()
		});
		await db.doc('users/ada/photos/keptphot1').set({
			userId: 'ada',
			path: 'users/ada/photos-library/keptphot1.webp',
			createdAt: old
		});
		const bucket = getStorage().bucket(bucketName);
		await bucket.file('users/ada/photos-library/keptphot1.webp').save(Buffer.from('keep'), { contentType: 'image/webp' });
		await bucket.file('users/ada/vehicle-photos/team1234/veh123/keptphot1.webp').save(Buffer.from('old-path'), { contentType: 'image/webp' });
		await bucket.file('users/ada/photos-library/orphan12.webp').save(Buffer.from('old'), { contentType: 'image/webp' });

		const first = await cleanupOrphanPhotosForUser('ada', Date.now());
		expect(first.docs).toBe(1);
		expect(first.files).toBe(0);
		expect((await db.doc('users/ada/photos/stalepho1').get()).exists).toBe(false);
		expect((await db.doc('users/ada/photos/freshpho1').get()).exists).toBe(true);
		expect((await db.doc('users/ada/photos/keptphot1').get()).exists).toBe(true);

		const later = await cleanupOrphanPhotosForUser('ada', Date.now() + ORPHAN_GRACE_MS + 60_000);
		expect(later.docs).toBe(1);
		expect(later.files).toBe(1);
		const [libraryOrphan] = await bucket.file('users/ada/photos-library/orphan12.webp').exists();
		const [legacyTwin] = await bucket.file('users/ada/vehicle-photos/team1234/veh123/keptphot1.webp').exists();
		const [kept] = await bucket.file('users/ada/photos-library/keptphot1.webp').exists();
		expect(libraryOrphan).toBe(false);
		expect(legacyTwin).toBe(true);
		expect(kept).toBe(true);
		expect((await db.doc('users/ada/photos/freshpho1').get()).exists).toBe(false);
		expect((await db.doc('users/ada/photos/keptphot1').get()).exists).toBe(true);
	});
});
