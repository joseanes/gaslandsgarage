import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { approximateCoordinate } from '../../app/src/lib/players/location';
import { handlePlaceMapPoint, MAP_PLACEMENT_COLLECTION } from './mapPlacement';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-gaslands-functions';

function emulatorUrl(host: string | undefined, fallbackPort: number): string {
	const value = host && host.length > 0 ? host : `127.0.0.1:${fallbackPort}`;
	return value.startsWith('http') ? value : `http://${value}`;
}

async function clearEmulators(): Promise<void> {
	const firestore = await fetch(
		`${emulatorUrl(process.env.FIRESTORE_EMULATOR_HOST, 8080)}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
		{ method: 'DELETE' }
	);
	if (!firestore.ok) throw new Error(`Could not clear Firestore (${firestore.status})`);
}

beforeAll(() => {
	process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
	process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
	if (getApps().length === 0) initializeApp({ projectId });
});

beforeEach(async () => {
	await clearEmulators();
});

afterAll(async () => {
	await clearEmulators();
});

describe('placeMapPoint', () => {
	it('stores a 2–8 km offset and not the raw point', async () => {
		const lat = 30.2701011;
		const lng = -97.7429572;
		const expected = approximateCoordinate(lat, lng, () => 0);
		const point = await handlePlaceMapPoint('player', lat, lng, Date.parse('2026-10-19T12:00:00.000Z'), () => 0);
		expect(point).toEqual(expected);
		expect(point).not.toEqual({ latE2: Math.round(lat * 100), lngE2: Math.round(lng * 100) });
		const stored = await getFirestore().doc(`${MAP_PLACEMENT_COLLECTION}/player`).get();
		expect(stored.data()).toEqual({
			latE2: expected.latE2,
			lngE2: expected.lngE2,
			updatedAt: '2026-10-19T12:00:00.000Z'
		});
	});

	it('rejects a coordinate that is not a real lat/lng', async () => {
		await expect(handlePlaceMapPoint('player', 91, 0)).rejects.toBeInstanceOf(HttpsError);
		await expect(handlePlaceMapPoint('player', Number.NaN, 0)).rejects.toBeInstanceOf(HttpsError);
		const leftover = await getFirestore().doc(`${MAP_PLACEMENT_COLLECTION}/player`).get();
		expect(leftover.exists).toBe(false);
	});
});
