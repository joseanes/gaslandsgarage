import { db, initializeFirebase } from '$lib/firebase';
import type { User } from 'firebase/auth';
import { buildProfileWrite, USERS_COLLECTION } from '$lib/admin/profilePlan';

export async function syncSignedInProfile(user: User): Promise<void> {
	const init = await initializeFirebase();
	if (!init.success || !db) return;
	const { doc, getDoc, setDoc, updateDoc } = await import('firebase/firestore');
	const ref = doc(db, USERS_COLLECTION, user.uid);
	const snap = await getDoc(ref);
	const existing = snap.exists() ? { createdAt: snap.data().createdAt as string | undefined } : null;
	const planned = buildProfileWrite({
		uid: user.uid,
		email: user.email,
		displayName: user.displayName,
		creationTime: user.metadata.creationTime,
		lastSignInTime: user.metadata.lastSignInTime,
		now: new Date().toISOString(),
		existing
	});
	if (planned.op === 'create') {
		await setDoc(ref, planned.data);
		return;
	}
	await updateDoc(ref, planned.data);
}
