/**
 * Moves painted-car files from users/{uid}/vehicle-photos/... into
 * users/{uid}/photos-library/{photoId}.webp (or .jpg).
 *
 * Dry-run is the default. Pass --apply to copy each file and update the photo
 * document. The path rule matches libraryPhotoPath in app/src/lib/photos/model.ts.
 *
 * Uses Application Default Credentials. Run from functions/ so firebase-admin resolves:
 *   node scripts/migrate-photo-library.mjs
 *   node scripts/migrate-photo-library.mjs --uid ACCOUNT
 *   node scripts/migrate-photo-library.mjs --apply
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'gaslandsgarage-74ce6';
const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'gaslandsgarage-74ce6.firebasestorage.app';

function argValue(flag) {
	const index = process.argv.indexOf(flag);
	if (index === -1) return '';
	return process.argv[index + 1] ?? '';
}

function libraryPath(uid, photoId, contentType) {
	const extension = contentType === 'image/jpeg' ? 'jpg' : 'webp';
	return `users/${uid}/photos-library/${photoId}.${extension}`;
}

function legacyTarget(uid, photoId, path, contentType) {
	if (contentType !== 'image/webp' && contentType !== 'image/jpeg') return null;
	if (!path.startsWith(`users/${uid}/vehicle-photos/`)) return null;
	const target = libraryPath(uid, photoId, contentType);
	return target === path ? null : target;
}

async function main() {
	const apply = process.argv.includes('--apply');
	const onlyUid = argValue('--uid');
	if (getApps().length === 0) {
		initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID, storageBucket: BUCKET });
	}
	const db = getFirestore();
	const bucket = getStorage().bucket(BUCKET);
	const snap = await db.collectionGroup('photos').get();
	const moves = [];
	for (const item of snap.docs) {
		const parts = item.ref.path.split('/');
		if (parts.length !== 4 || parts[0] !== 'users' || parts[2] !== 'photos') continue;
		const uid = parts[1];
		if (onlyUid && uid !== onlyUid) continue;
		const path = String(item.get('path') ?? '');
		const target = legacyTarget(uid, item.id, path, item.get('contentType'));
		if (!target) continue;
		moves.push({ photoId: item.id, from: path, to: target });
		if (!apply) continue;
		const file = bucket.file(path);
		const [exists] = await file.exists().catch(() => [false]);
		if (exists) {
			await file.copy(bucket.file(target));
			await file.delete({ ignoreNotFound: true });
		}
		await item.ref.set({ path: target }, { merge: true });
	}
	console.log(JSON.stringify({ apply, projectId: PROJECT_ID, moves }, null, 2));
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
