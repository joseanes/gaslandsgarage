import { auth, initializeFirebase, signOutUser } from '$lib/firebase';
import { DELETE_CONFIRMATION, PRIVACY_FUNCTIONS_REGION, saveJsonDownload } from './accountShared';

export { DELETE_CONFIRMATION, privacyErrorMessage, saveJsonDownload } from './accountShared';

async function callPrivacy<T>(name: string, data?: object): Promise<T> {
	const ready = await initializeFirebase();
	if (!ready.success || !auth?.app) throw new Error('Firebase is not ready. Refresh the page and try again.');
	const { getFunctions, httpsCallable } = await import('firebase/functions');
	const functions = getFunctions(auth.app, PRIVACY_FUNCTIONS_REGION);
	const callable = httpsCallable(functions, name);
	const result = await callable(data);
	return result.data as T;
}

export async function downloadMyData(): Promise<void> {
	const data = await callPrivacy<unknown>('exportMyData');
	saveJsonDownload('gaslands-garage-my-data.json', data);
}

/**
 * Google sign-in again, so the callable sees a fresh auth_time.
 * The account is unchanged until deleteMyAccount returns.
 */
export async function reauthenticateForDeletion(): Promise<void> {
	const ready = await initializeFirebase();
	if (!ready.success || !auth?.currentUser) {
		throw new Error('Sign in again before deleting your account.');
	}
	const firebaseAuth = await import('firebase/auth');
	const current = auth.currentUser;
	const provider = new firebaseAuth.GoogleAuthProvider();
	await firebaseAuth.reauthenticateWithPopup(current, provider);
	await current.getIdToken(true);
}

export async function deleteMyAccount(): Promise<void> {
	await reauthenticateForDeletion();
	await callPrivacy<{ status: string }>('deleteMyAccount', { confirmation: DELETE_CONFIRMATION });
	await signOutUser();
}
