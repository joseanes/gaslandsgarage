import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { approximateCoordinate } from '../../app/src/lib/players/location.ts';
import { assertCaller } from './buddies.ts';

export const MAP_PLACEMENT_COLLECTION = 'mapPlacements';

export const placeMapPointOptions = {
	region: 'us-central1',
	memory: '256MiB',
	timeoutSeconds: 30,
	maxInstances: 10
} as const;

function finiteInRange(value: unknown, min: number, max: number): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Offsets a geocoded point 2–8 km and stores only the snapped result.
 * Clients cannot write `mapPlacements`; rules require a new or moved pin to match it.
 */
export async function handlePlaceMapPoint(
	uid: string,
	lat: unknown,
	lng: unknown,
	nowMs = Date.now(),
	random: () => number = Math.random
): Promise<{ latE2: number; lngE2: number }> {
	if (!finiteInRange(lat, -90, 90) || !finiteInRange(lng, -180, 180)) {
		throw new HttpsError('invalid-argument', 'That location cannot be placed.');
	}
	const point = approximateCoordinate(lat, lng, random);
	await getFirestore().doc(`${MAP_PLACEMENT_COLLECTION}/${uid}`).set({
		latE2: point.latE2,
		lngE2: point.lngE2,
		updatedAt: new Date(nowMs).toISOString()
	});
	return point;
}

export const placeMapPoint = onCall(placeMapPointOptions, async (request) => {
	const uid = await assertCaller(request.auth?.uid);
	const body =
		request.data && typeof request.data === 'object' ? (request.data as { lat?: unknown; lng?: unknown }) : {};
	return handlePlaceMapPoint(uid, body.lat, body.lng);
});
