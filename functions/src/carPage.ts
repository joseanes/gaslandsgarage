import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { storageBucketName } from '../../app/src/lib/photos/model.ts';
import { renderCarHttp } from '../../app/src/lib/photos/carPage.ts';

const REGION = 'us-central1';

/**
 * Public HTML for /car/* and /embed/*. CloudFront routes those paths at this
 * function so a crawler can read the Open Graph tags without running the SPA.
 * The lookup is the public gallery document only. Private photo metadata is
 * not read. The function has no credentials of its own. The photo is already
 * world-readable when the player opted in.
 */
export const renderSharedCar = onRequest(
	{
		region: REGION,
		memory: '256MiB',
		timeoutSeconds: 30,
		maxInstances: 10,
		invoker: 'public',
		cors: false
	},
	async (req, res) => {
		const result = await renderCarHttp({
			method: req.method || 'GET',
			path: req.path || req.url || '/',
			bucket: storageBucketName(process.env.FIREBASE_STORAGE_BUCKET ?? ''),
			load: async (shareId) => {
				const snap = await getFirestore().doc(`sharedPhotos/${shareId}`).get();
				return snap.exists ? (snap.data() ?? null) : null;
			}
		});
		res.status(result.statusCode);
		for (const [name, value] of Object.entries(result.headers)) res.set(name, value);
		res.send(result.body);
	}
);
