import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import { auth, initializeFirebase, signOutUser, user } from '$lib/firebase';
import { ADMINISTRATOR_ROLE } from '$lib/admin/accountActions';
import { readOwnAccess } from '$lib/admin/api';
import { syncSignedInProfile } from '$lib/services/profile';

export const isAdministrator = writable(false);
export const accountSessionReady = writable(false);
export const disabledNotice = writable(false);

let started = false;
let ticket = 0;

export function startAccountSession(): void {
	if (!browser || started) return;
	started = true;
	user.subscribe(() => {
		const generation = ++ticket;
		void settle(generation);
	});
}

async function settle(generation: number): Promise<void> {
	const init = await initializeFirebase();
	if (generation !== ticket) return;
	if (!init.success) {
		isAdministrator.set(false);
		accountSessionReady.set(true);
		return;
	}

	const current = auth?.currentUser ?? null;
	if (!current) {
		isAdministrator.set(false);
		accountSessionReady.set(true);
		return;
	}

	let access = { disabled: false, role: null as string | null };
	try {
		access = await readOwnAccess(current.uid);
	} catch (error) {
		console.error('Could not read account access', error);
	}
	if (generation !== ticket) return;

	if (access.disabled) {
		disabledNotice.set(true);
		isAdministrator.set(false);
		accountSessionReady.set(true);
		await signOutUser();
		return;
	}

	try {
		await syncSignedInProfile(current);
	} catch (error) {
		console.error('Could not save the user profile', error);
	}
	if (generation !== ticket) return;
	isAdministrator.set(access.role === ADMINISTRATOR_ROLE);
	accountSessionReady.set(true);
}
