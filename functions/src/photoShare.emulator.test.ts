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
	refreshSharedVehicleStatsForTeam,
	reportPhotoForUser,
	setPhotoPaintingUrlForUser,
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

	it('copies vehicle stats onto the gallery card, refreshes them, and removes them when stats sharing is off', async () => {
		const { reserved } = await savePhoto();
		await getFirestore().doc('teams/team1234').set({
			userId: 'ada',
			teamName: 'Racers',
			hiddenFromBuddies: false,
			teamData: {
				rulesVersion: 2,
				vehicles: [
					{
						id: 'veh123',
						type: 'performance_car',
						name: 'Red',
						weapons: ['mg'],
						upgrades: ['armour_plating'],
						perks: []
					}
				]
			}
		});
		await setPhotoSharingForUser('ada', {
			photoId: reserved.photoId,
			showToBuddies: false,
			showOnShareLink: false,
			showInGallery: true,
			shareVehicleStats: true
		});
		const shared = (await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).data();
		expect(shared?.vehicleStats).toMatchObject({
			type: 'Performance Car',
			name: 'Red',
			hull: 10,
			cans: 21,
			weapons: ['Machine Gun'],
			upgrades: ['Armour Plating']
		});
		expect(shared).not.toHaveProperty('ownerUid');
		expect(JSON.stringify(shared)).not.toContain('Google Name');
		expect(JSON.stringify(shared)).not.toContain('ada@gmail.com');

		await getFirestore().doc('teams/team1234').set({
			userId: 'ada',
			teamName: 'Racers',
			teamData: {
				rulesVersion: 2,
				vehicles: [
					{
						id: 'veh123',
						type: 'performance_car',
						name: 'Red',
						weapons: [],
						upgrades: ['armour_plating'],
						perks: []
					}
				]
			}
		});
		const team = (await getFirestore().doc('teams/team1234').get()).data();
		await refreshSharedVehicleStatsForTeam('team1234', team);
		const refreshed = (await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).get('vehicleStats');
		expect(refreshed.cans).toBe(19);
		expect(refreshed.weapons).toEqual([]);

		await setPhotoSharingForUser('ada', {
			photoId: reserved.photoId,
			showToBuddies: false,
			showOnShareLink: false,
			showInGallery: true,
			shareVehicleStats: false
		});
		const quiet = (await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).data();
		expect(quiet).not.toHaveProperty('vehicleStats');
		expect(quiet?.showInGallery).toBe(true);
		expect((await getFirestore().doc(`users/ada/photos/${reserved.photoId}`).get()).get('shareVehicleStats')).toBe(false);
	});

	it('asks which car to share from when a photo is on more than one', async () => {
		const { reserved } = await savePhoto();
		await getFirestore().doc('teams/team1234').set({
			userId: 'ada',
			teamName: 'Racers',
			hiddenFromBuddies: false,
			teamData: {
				rulesVersion: 2,
				vehicles: [
					{ id: 'veh123', type: 'performance_car', name: 'Red', weapons: [], upgrades: [], perks: [] },
					{ id: 'veh456', type: 'buggy', name: 'Bug', weapons: [], upgrades: [], perks: [] }
				]
			}
		});
		const { attachLibraryPhotoForUser } = await import('./photoLibrary');
		await attachLibraryPhotoForUser('ada', reserved.photoId, 'team1234', 'veh456');
		await expect(
			setPhotoSharingForUser('ada', {
				photoId: reserved.photoId,
				showToBuddies: false,
				showOnShareLink: false,
				showInGallery: true,
				shareVehicleStats: true
			})
		).rejects.toThrow(/Choose which car/);
		await setPhotoSharingForUser('ada', {
			photoId: reserved.photoId,
			showToBuddies: false,
			showOnShareLink: false,
			showInGallery: true,
			shareVehicleStats: true,
			shareTeamId: 'team1234',
			shareVehicleId: 'veh456'
		});
		const shared = (await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).data();
		expect(shared?.vehicleType).toBe('Buggy');
		expect(shared?.vehicleStats).toMatchObject({ name: 'Bug', type: 'Buggy' });
		expect((await getFirestore().doc(`sharedPhotoPrivate/${reserved.photoId}`).get()).get('vehicleId')).toBe('veh456');
	});

	it('publishes a gallery photo with no car, and refuses stats until one is linked', async () => {
		await getFirestore().doc('users/ada').set({ displayName: 'Google Name', email: 'ada@gmail.com' });
		await getFirestore().doc('playerProfiles/ada').set({ playerName: 'Track Name' });
		const reserved = await reserveVehiclePhotoForUser('ada', {
			width: 800,
			height: 600,
			contentType: 'image/webp',
			caption: 'Loose car'
		});
		expect(reserved.attachments).toEqual([]);
		const bytes = Buffer.from('RIFF....WEBP');
		await getStorage().bucket(bucketName).file(reserved.path).save(bytes, { contentType: 'image/webp' });

		await expect(
			setPhotoSharingForUser('ada', {
				photoId: reserved.photoId,
				showToBuddies: false,
				showOnShareLink: false,
				showInGallery: true,
				shareVehicleStats: true,
				vehicleType: 'Performance Car'
			})
		).rejects.toThrow(/Link this photo/);
		await expect(
			setPhotoSharingForUser('ada', {
				photoId: reserved.photoId,
				showToBuddies: true,
				showOnShareLink: false,
				showInGallery: true,
				vehicleType: 'Performance Car'
			})
		).rejects.toThrow(/Link this photo/);
		await expect(
			setPhotoSharingForUser('ada', {
				photoId: reserved.photoId,
				showToBuddies: false,
				showOnShareLink: false,
				showInGallery: true,
				vehicleType: 'Not A Real Car'
			})
		).rejects.toThrow(/vehicle type/);

		const shared = await setPhotoSharingForUser('ada', {
			photoId: reserved.photoId,
			showToBuddies: false,
			showOnShareLink: false,
			showInGallery: true,
			shareVehicleStats: false,
			vehicleType: 'Performance Car'
		});
		expect(shared).toEqual({ shared: true, published: true, hidden: false });
		const publicDoc = (await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).data();
		expect(publicDoc).toMatchObject({
			displayName: 'Track Name',
			vehicleType: 'Performance Car',
			teamName: '',
			caption: 'Loose car',
			showInGallery: true,
			published: true
		});
		expect(publicDoc).not.toHaveProperty('vehicleStats');
		expect(publicDoc).not.toHaveProperty('cans');
		expect(publicDoc).not.toHaveProperty('ownerUid');
		expect(JSON.stringify(publicDoc)).not.toContain('ada@gmail.com');
		const privateDoc = (await getFirestore().doc(`sharedPhotoPrivate/${reserved.photoId}`).get()).data();
		expect(privateDoc?.teamId).toBe('');
		expect(privateDoc?.vehicleId).toBe('');
		expect(privateDoc?.shareVehicleStats).toBe(false);
		const [stored] = await getStorage().bucket(bucketName).file(sharedPhotoObjectPath(reserved.photoId)).download();
		expect(stored.equals(bytes)).toBe(true);

		const { reserved: linked } = await savePhoto();
		await setPhotoSharingForUser('ada', {
			photoId: linked.photoId,
			showToBuddies: false,
			showOnShareLink: false,
			showInGallery: true,
			vehicleType: 'War Rig'
		});
		expect((await getFirestore().doc(`sharedPhotos/${linked.photoId}`).get()).get('vehicleType')).toBe('Performance Car');
	});

	it('stores a painting-guide link on the photo and does not copy the profile website', async () => {
		const { reserved } = await savePhoto();
		await getFirestore().doc('playerProfiles/ada').set({ playerName: 'Track Name', website: 'https://blog.example/profile' }, { merge: true });
		await setPhotoSharingForUser('ada', {
			photoId: reserved.photoId,
			showToBuddies: false,
			showOnShareLink: false,
			showInGallery: true
		});
		expect((await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).get('paintingUrl')).toBe('');
		expect((await getFirestore().doc(`users/ada/photos/${reserved.photoId}`).get()).get('paintingUrl')).toBe('');

		const guide = 'https://www.youtube.com/@rustpainter';
		await expect(setPhotoPaintingUrlForUser('ada', reserved.photoId, 'javascript:alert(1)')).rejects.toThrow(/http/);
		const saved = await setPhotoPaintingUrlForUser('ada', reserved.photoId, guide);
		expect(saved.paintingUrl).toBe(guide);
		expect((await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).get('paintingUrl')).toBe(guide);
		expect((await getFirestore().doc(`users/ada/photos/${reserved.photoId}`).get()).get('paintingUrl')).toBe(guide);

		await setPhotoPaintingUrlForUser('ada', reserved.photoId, '  ');
		expect((await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).get('paintingUrl')).toBe('');
		expect((await getFirestore().doc(`sharedPhotos/${reserved.photoId}`).get()).get('paintingUrl')).not.toBe('https://blog.example/profile');
	});
});
