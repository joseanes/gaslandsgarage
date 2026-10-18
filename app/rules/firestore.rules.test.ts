import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
	collection,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	query,
	setDoc,
	updateDoc,
	where,
	type Firestore
} from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const NOW = '2026-10-17T12:00:00.000Z';

function roleDoc(updatedBy = 'bootstrap') {
	return { role: 'Administrator', updatedAt: NOW, updatedBy };
}

function profile(uid: string, email: string) {
	return {
		uid,
		email,
		displayName: email.split('@')[0],
		createdAt: NOW,
		lastSeenAt: NOW,
		lastSignInAt: NOW
	};
}

function disabledBy(actor: string) {
	return { disabled: true, disabledAt: NOW, disabledBy: actor };
}

function activeAccount() {
	return { disabled: false, disabledAt: null, disabledBy: null };
}

beforeAll(async () => {
	testEnv = await initializeTestEnvironment({
		projectId: 'demo-gaslands-rules',
		firestore: {
			rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
			host: '127.0.0.1',
			port: 8080
		}
	});
});

afterAll(async () => {
	await testEnv.cleanup();
});

beforeEach(async () => {
	await testEnv.clearFirestore();
});

function authed(uid: string): Firestore {
	return testEnv.authenticatedContext(uid).firestore() as Firestore;
}

function guest(): Firestore {
	return testEnv.unauthenticatedContext().firestore() as Firestore;
}

async function seed(write: (database: Firestore) => Promise<void>) {
	await testEnv.withSecurityRulesDisabled(async (context) => {
		await write(context.firestore() as Firestore);
	});
}

describe('existing access', () => {
	it('keeps public stats readable and client writes denied', async () => {
		await seed(async (database) => {
			await setDoc(doc(database, 'stats', 'public'), { totalTeams: 1 });
		});
		await assertSucceeds(getDoc(doc(guest(), 'stats', 'public')));
		await assertFails(setDoc(doc(authed('player'), 'stats', 'public'), { totalTeams: 2 }));
	});

	it('lets a player manage only their own team and settings', async () => {
		const player = authed('player');
		await assertSucceeds(setDoc(doc(player, 'teams', 't1'), { userId: 'player', teamName: 'Racers' }));
		await assertSucceeds(getDocs(query(collection(player, 'teams'), where('userId', '==', 'player'))));
		await assertSucceeds(updateDoc(doc(player, 'teams', 't1'), { teamName: 'Racers 2' }));
		await assertSucceeds(setDoc(doc(player, 'userSettings', 'player'), { darkMode: true }));
		await assertSucceeds(getDoc(doc(player, 'userSettings', 'player')));

		const other = authed('other');
		await assertFails(getDoc(doc(other, 'teams', 't1')));
		await assertFails(getDocs(query(collection(other, 'teams'), where('userId', '==', 'player'))));
		await assertFails(getDoc(doc(guest(), 'teams', 't1')));
		await assertFails(updateDoc(doc(other, 'teams', 't1'), { teamName: 'Stolen' }));
		await assertFails(getDoc(doc(other, 'userSettings', 'player')));

		await assertSucceeds(deleteDoc(doc(player, 'teams', 't1')));
	});

	it('lets a player create a message and blocks them from reading it', async () => {
		await assertSucceeds(setDoc(doc(authed('player'), 'messages', 'm1'), { userId: 'player', subject: 'Hi' }));
		await assertFails(getDoc(doc(authed('player'), 'messages', 'm1')));
	});
});

describe('profiles and roles', () => {
	it('lets a player write their own profile and blocks self-promotion', async () => {
		const player = authed('player');
		await assertSucceeds(setDoc(doc(player, 'users', 'player'), profile('player', 'player@example.com')));
		await assertSucceeds(updateDoc(doc(player, 'users', 'player'), { displayName: 'Pat' }));
		await assertFails(updateDoc(doc(player, 'users', 'player'), { createdAt: '2020-01-01T00:00:00.000Z' }));
		await assertFails(setDoc(doc(player, 'users', 'player'), { ...profile('player', 'player@example.com'), role: 'Administrator' }));
		await assertFails(getDoc(doc(authed('other'), 'users', 'player')));
		await assertFails(getDocs(collection(player, 'users')));
		await assertFails(setDoc(doc(player, 'roles', 'player'), roleDoc('player')));
		await assertFails(setDoc(doc(player, 'adminUsers', 'player'), activeAccount()));
	});

	it('lets an administrator read accounts and grant a role, but not change their own', async () => {
		await seed(async (database) => {
			await setDoc(doc(database, 'roles', 'admin'), roleDoc());
			await setDoc(doc(database, 'users', 'player'), profile('player', 'player@example.com'));
			await setDoc(doc(database, 'users', 'admin'), profile('admin', 'admin@example.com'));
			await setDoc(doc(database, 'teams', 't1'), { userId: 'player', teamName: 'Racers' });
			await setDoc(doc(database, 'messages', 'm1'), { userId: 'player', subject: 'Hi' });
		});

		const admin = authed('admin');
		await assertSucceeds(getDocs(collection(admin, 'users')));
		await assertSucceeds(getDoc(doc(admin, 'teams', 't1')));
		await assertSucceeds(getDoc(doc(admin, 'messages', 'm1')));
		await assertSucceeds(
			setDoc(doc(admin, 'roles', 'player'), { role: 'Marshal', updatedAt: NOW, updatedBy: 'admin' })
		);
		await assertFails(setDoc(doc(admin, 'roles', 'admin'), { role: 'Marshal', updatedAt: NOW, updatedBy: 'admin' }));
		await assertFails(deleteDoc(doc(admin, 'roles', 'admin')));
		await assertFails(updateDoc(doc(admin, 'teams', 't1'), { teamName: 'Edited' }));
		await assertFails(deleteDoc(doc(admin, 'teams', 't1')));
		await assertFails(getDoc(doc(authed('player'), 'roles', 'admin')));
	});
});

describe('disabled accounts', () => {
	it('blocks a disabled player from private data and lets them read the flag', async () => {
		await seed(async (database) => {
			await setDoc(doc(database, 'roles', 'admin'), roleDoc());
			await setDoc(doc(database, 'users', 'player'), profile('player', 'player@example.com'));
			await setDoc(doc(database, 'teams', 't1'), { userId: 'player', teamName: 'Racers' });
			await setDoc(doc(database, 'userSettings', 'player'), { darkMode: true });
		});

		const admin = authed('admin');
		await assertFails(setDoc(doc(admin, 'adminUsers', 'admin'), disabledBy('admin')));
		await assertSucceeds(setDoc(doc(admin, 'adminUsers', 'player'), disabledBy('admin')));

		const player = authed('player');
		await assertSucceeds(getDoc(doc(player, 'adminUsers', 'player')));
		await assertFails(getDoc(doc(player, 'teams', 't1')));
		await assertFails(getDoc(doc(player, 'users', 'player')));
		await assertFails(getDoc(doc(player, 'userSettings', 'player')));
		await assertFails(setDoc(doc(player, 'teams', 't2'), { userId: 'player', teamName: 'New' }));
		await assertFails(setDoc(doc(player, 'messages', 'm2'), { userId: 'player', subject: 'Hi' }));
		await assertFails(setDoc(doc(player, 'adminUsers', 'player'), activeAccount()));
		await assertSucceeds(getDoc(doc(admin, 'teams', 't1')));

		await assertSucceeds(setDoc(doc(admin, 'adminUsers', 'player'), activeAccount()));
		await assertSucceeds(getDoc(doc(authed('player'), 'teams', 't1')));
	});

	it('rejects a disable written by a regular user', async () => {
		await assertFails(setDoc(doc(authed('player'), 'adminUsers', 'other'), disabledBy('player')));
	});
});

describe('rules file', () => {
	it('does not name a person as the administrator', () => {
		const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
		expect(rules).not.toContain('@');
	});
});
