import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { storageBucketName } from '../../app/src/lib/photos/model.ts';
import { deleteUserPhotos, exportVehiclePhotos, reserveVehiclePhotoForUser } from './vehiclePhotos';

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
});

async function saveTeam() {
	await getFirestore().doc('teams/team1234').set({
		userId: 'ada',
		teamName: 'Racers',
		teamData: { vehicles: [{ id: 'veh123' }, { id: 'veh456' }] }
	});
}

describe('vehicle photos', () => {
	it('reserves three photos for a vehicle and refuses a fourth', async () => {
		await saveTeam();
		const input = { teamId: 'team1234', vehicleId: 'veh123', width: 800, height: 600, contentType: 'image/webp' as const, caption: 'Red' };
		const first = await reserveVehiclePhotoForUser('ada', input);
		await reserveVehiclePhotoForUser('ada', input);
		await reserveVehiclePhotoForUser('ada', input);
		await expect(reserveVehiclePhotoForUser('ada', input)).rejects.toThrow(/3 photos/);
		const other = await reserveVehiclePhotoForUser('ada', { ...input, vehicleId: 'veh456', caption: '' });
		expect(first.path).toBe(`users/ada/photos-library/${first.photoId}.webp`);
		expect(first.attachments).toEqual([{ teamId: 'team1234', vehicleId: 'veh123' }]);
		expect(other.vehicleId).toBe('veh456');
		await expect(reserveVehiclePhotoForUser('bob', input)).rejects.toThrow(/Save this team/);
		await expect(reserveVehiclePhotoForUser('ada', { ...input, vehicleId: 'missing1' })).rejects.toThrow(/not on this team/);
	});

	it('lists photos in the account export and deletes the files with the account', async () => {
		await saveTeam();
		const reserved = await reserveVehiclePhotoForUser('ada', {
			teamId: 'team1234',
			vehicleId: 'veh123',
			width: 1600,
			height: 900,
			contentType: 'image/jpeg',
			caption: 'Garage'
		});
		const bucket = getStorage().bucket(bucketName);
		await bucket.file(reserved.path).save(Buffer.from('jpeg'), { contentType: 'image/jpeg' });
		const exported = await exportVehiclePhotos('ada');
		expect(exported.note).toMatch(/private/);
		expect(exported.photos).toEqual([expect.objectContaining({ photoId: reserved.photoId, path: reserved.path, caption: 'Garage' })]);
		expect(JSON.stringify(exported)).not.toContain('alt=media');

		await deleteUserPhotos('ada');
		const [files] = await bucket.getFiles({ prefix: 'users/ada/' });
		expect(files).toEqual([]);
		expect((await getFirestore().doc(`users/ada/photos/${reserved.photoId}`).get()).exists).toBe(false);
	});
});
