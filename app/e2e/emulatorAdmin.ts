import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'gaslandsgarage-74ce6';

export function emulatorFirestore(): Firestore {
	process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
	process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
	if (!getApps().length) {
		initializeApp({ projectId: PROJECT_ID });
	}
	return getFirestore();
}
