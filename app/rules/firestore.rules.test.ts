import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
	collection,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	orderBy,
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

function authed(uid: string, token?: Record<string, unknown>): Firestore {
	return testEnv.authenticatedContext(uid, token).firestore() as Firestore;
}

function guest(): Firestore {
	return testEnv.unauthenticatedContext().firestore() as Firestore;
}

async function seed(write: (database: Firestore) => Promise<void>) {
	await testEnv.withSecurityRulesDisabled(async (context) => {
		await write(context.firestore() as Firestore);
	});
}

async function seedPlacement(uid: string, latE2: number, lngE2: number) {
	await seed(async (database) => {
		await setDoc(doc(database, 'mapPlacements', uid), { latE2, lngE2, updatedAt: NOW });
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
		await assertFails(setDoc(doc(player, 'teams', 'extra'), { userId: 'player', teamName: 'Racers', injected: true }));
		await assertFails(setDoc(doc(player, 'teams', 'long'), { userId: 'player', teamName: 'x'.repeat(121) }));
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
		await assertFails(setDoc(doc(authed('player'), 'messages', 'bad'), { userId: 'player', subject: 'Hi', injected: true }));
		await assertFails(
			setDoc(doc(authed('player'), 'messages', 'huge'), { userId: 'player', message: 'x'.repeat(5001) })
		);
		await assertFails(getDoc(doc(authed('player'), 'messages', 'm1')));
	});
});

describe('profiles and roles', () => {
	it('lets a player write their own profile and blocks self-promotion', async () => {
		const player = authed('player', { email: 'player@example.com' });
		await assertSucceeds(setDoc(doc(player, 'users', 'player'), profile('player', 'player@example.com')));
		await assertFails(setDoc(doc(player, 'users', 'player'), profile('player', 'planted@example.com')));
		await assertSucceeds(setDoc(doc(authed('noemail'), 'users', 'noemail'), profile('noemail', '')));
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
		await assertFails(setDoc(doc(player, 'userSettings', 'player'), NEWSLETTER_IN));
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

	it('blocks writes from an account that is marked deleted and still allows everyone else', async () => {
		await seed(async (database) => {
			await setDoc(doc(database, 'teams', 't1'), { userId: 'player', teamName: 'Racers' });
			await setDoc(doc(database, 'accountControl', 'player'), { deleted: true });
		});
		const player = authed('player');
		await assertFails(getDoc(doc(player, 'teams', 't1')));
		await assertFails(setDoc(doc(player, 'teams', 't2'), { userId: 'player', teamName: 'New' }));
		await assertFails(setDoc(doc(player, 'accountControl', 'player'), { deleted: false }));
		await assertSucceeds(setDoc(doc(authed('other'), 'teams', 'o1'), { userId: 'other', teamName: 'Still here' }));
	});
});

const ENTRY = 'aaaaaaaaaaaaaaaaaaaa';

function playerProfile(overrides: Record<string, unknown> = {}) {
	return {
		playerName: '',
		bio: '',
		locationLabel: '',
		playSpots: '',
		latE2: null,
		lngE2: null,
		showOnMap: false,
		anonymousOnMap: false,
		openToGames: false,
		mapEntryId: '',
		updatedAt: NOW,
		...overrides
	};
}

function anonPin() {
	return { anonymous: true, latE2: 3011, lngE2: -9802, updatedAt: NOW };
}

function namedPin(overrides: Record<string, unknown> = {}) {
	return {
		anonymous: false,
		playerName: 'Ada',
		bio: 'Rookie',
		playSpots: 'At home',
		locationLabel: 'Austin, TX',
		latE2: 3019,
		lngE2: -9766,
		openToGames: false,
		updatedAt: NOW,
		...overrides
	};
}

function openCard(overrides: Record<string, unknown> = {}) {
	return { playerName: 'Ada', bio: 'Rookie', playSpots: 'At home', updatedAt: NOW, ...overrides };
}

function contact(fromUid: string, toUid: string, overrides: Record<string, unknown> = {}) {
	return {
		fromUid,
		toUid,
		fromName: 'Pat',
		toName: 'Ada',
		message: 'Game on Friday?',
		createdAt: NOW,
		read: false,
		reply: '',
		repliedAt: '',
		...overrides
	};
}

describe('player privacy', () => {
	it('keeps the private profile to the owner and administrators', async () => {
		const player = authed('player');
		await assertSucceeds(setDoc(doc(player, 'playerProfiles', 'player'), playerProfile()));
		await assertSucceeds(setDoc(doc(player, 'playerProfiles', 'player'), playerProfile({ locationLabel: 'Austin, TX' })));
		await assertSucceeds(setDoc(doc(player, 'playerProfiles', 'player'), playerProfile({ locationLabel: '78701' })));
		await assertFails(
			setDoc(doc(player, 'playerProfiles', 'player'), playerProfile({ locationLabel: '221B Baker Street' }))
		);
		await assertFails(
			setDoc(doc(player, 'playerProfiles', 'player'), playerProfile({ locationLabel: 'Main Street' }))
		);
		await assertFails(setDoc(doc(player, 'playerProfiles', 'player'), playerProfile({ locationLabel: 'Main St' })));
		await assertSucceeds(setDoc(doc(player, 'playerProfiles', 'player'), playerProfile({ locationLabel: 'St. Louis' })));
		await assertFails(
			setDoc(doc(player, 'playerProfiles', 'player'), playerProfile({ latE2: 3011, lngE2: -9802, locationLabel: '78701' }))
		);
		await seedPlacement('player', 3011, -9802);
		await assertSucceeds(
			setDoc(doc(player, 'playerProfiles', 'player'), playerProfile({ latE2: 3011, lngE2: -9802, locationLabel: '78701' }))
		);
		await assertSucceeds(
			setDoc(
				doc(player, 'playerProfiles', 'player'),
				playerProfile({ latE2: 3011, lngE2: -9802, locationLabel: '78701', bio: 'Hi' })
			)
		);
		await assertFails(
			setDoc(doc(player, 'playerProfiles', 'player'), playerProfile({ latE2: 1200, lngE2: -9802, locationLabel: '78701' }))
		);
		await assertSucceeds(getDoc(doc(player, 'playerProfiles', 'player')));
		await assertFails(getDoc(doc(authed('other'), 'playerProfiles', 'player')));
		await assertFails(getDoc(doc(guest(), 'playerProfiles', 'player')));
		await assertFails(getDocs(collection(player, 'playerProfiles')));
		await assertFails(setDoc(doc(player, 'playerProfiles', 'player'), { ...playerProfile(), email: 'player@example.com' }));
		await assertFails(
			setDoc(doc(player, 'playerProfiles', 'player'), playerProfile({ bio: 'mail me player@example.com' }))
		);
		await assertFails(
			setDoc(
				doc(player, 'playerProfiles', 'player'),
				playerProfile({ showOnMap: true, anonymousOnMap: true, latE2: 30.27, lngE2: -9774, mapEntryId: ENTRY })
			)
		);

		await seed(async (database) => {
			await setDoc(doc(database, 'roles', 'admin'), roleDoc());
		});
		await assertSucceeds(getDoc(doc(authed('admin'), 'playerProfiles', 'player')));
	});

	it('publishes an anonymous pin with no identity and blocks hijacking', async () => {
		const player = authed('player');
		const missing = await getDoc(doc(player, 'playerMapPrivate', 'zzzzzzzzzzzzzzzzzzzz'));
		expect(missing.exists()).toBe(false);
		await assertSucceeds(
			setDoc(doc(player, 'playerMapOwners', 'player'), { entryId: ENTRY, updatedAt: NOW })
		);
		await assertSucceeds(setDoc(doc(player, 'playerMapPrivate', ENTRY), { ownerUid: 'player' }));
		await assertFails(setDoc(doc(player, 'playerMap', ENTRY), anonPin()));
		await assertFails(setDoc(doc(player, 'mapPlacements', 'player'), { latE2: 3011, lngE2: -9802, updatedAt: NOW }));
		await seedPlacement('player', anonPin().latE2, anonPin().lngE2);
		await assertSucceeds(setDoc(doc(player, 'playerMap', ENTRY), anonPin()));

		const pin = await getDoc(doc(guest(), 'playerMap', ENTRY));
		expect(pin.data()).toEqual(anonPin());
		await assertFails(getDocs(collection(guest(), 'playerMap')));
		await assertFails(getDoc(doc(guest(), 'playerMapPrivate', ENTRY)));
		await assertFails(getDoc(doc(authed('other'), 'playerMapPrivate', ENTRY)));
		await assertFails(getDoc(doc(guest(), 'playerMapOwners', 'player')));
		await assertFails(setDoc(doc(player, 'playerMap', ENTRY), { ...anonPin(), playerName: 'Ada', uid: 'player' }));
		await assertFails(setDoc(doc(player, 'playerMap', ENTRY), { ...anonPin(), email: 'player@example.com' }));

		const same = 'bbbbbbbbbbbbbbbbbbbb';
		await assertFails(setDoc(doc(authed(same), 'playerMapOwners', same), { entryId: same, updatedAt: NOW }));

		const attacker = authed('attacker');
		await assertSucceeds(setDoc(doc(attacker, 'playerMapOwners', 'attacker'), { entryId: ENTRY, updatedAt: NOW }));
		await assertFails(updateDoc(doc(attacker, 'playerMap', ENTRY), { latE2: 1 }));
		await assertFails(setDoc(doc(attacker, 'playerMapPrivate', ENTRY), { ownerUid: 'attacker' }));
		await assertFails(deleteDoc(doc(attacker, 'playerMap', ENTRY)));

		await assertSucceeds(deleteDoc(doc(player, 'playerMap', ENTRY)));
	});

	it('lets a named pin show only opted-in fields', async () => {
		const player = authed('player');
		await assertSucceeds(setDoc(doc(player, 'playerMapOwners', 'player'), { entryId: ENTRY, updatedAt: NOW }));
		await assertSucceeds(setDoc(doc(player, 'playerMapPrivate', ENTRY), { ownerUid: 'player' }));
		await assertFails(setDoc(doc(player, 'playerMap', ENTRY), namedPin({ locationLabel: '221B Baker Street' })));
		await seedPlacement('player', namedPin().latE2, namedPin().lngE2);
		await assertSucceeds(setDoc(doc(player, 'playerMap', ENTRY), namedPin()));
		await assertSucceeds(setDoc(doc(player, 'playerMap', ENTRY), namedPin({ bio: 'Veteran' })));
		await assertFails(setDoc(doc(player, 'playerMap', ENTRY), namedPin({ latE2: 1200 })));
		expect((await getDoc(doc(guest(), 'playerMap', ENTRY))).data()).toEqual(namedPin({ bio: 'Veteran' }));
		await assertFails(setDoc(doc(player, 'playerMap', ENTRY), { ...namedPin(), email: 'ada@example.com', uid: 'player' }));
		await assertFails(setDoc(doc(player, 'playerMap', ENTRY), namedPin({ playerName: '' })));
	});

	it('lists open players to signed-in users without email or a coordinate', async () => {
		const player = authed('player');
		await assertSucceeds(setDoc(doc(player, 'openToGames', 'player'), openCard()));
		await assertSucceeds(getDoc(doc(authed('other'), 'openToGames', 'player')));
		await assertFails(getDoc(doc(guest(), 'openToGames', 'player')));
		await assertFails(setDoc(doc(player, 'openToGames', 'player'), { ...openCard(), email: 'ada@example.com' }));
		await assertFails(setDoc(doc(player, 'openToGames', 'player'), { ...openCard(), latE2: 3019, lngE2: -9766 }));
		await assertFails(setDoc(doc(authed('other'), 'openToGames', 'player'), openCard()));
	});

	it('stores a game request for the two players and never an email field', async () => {
		await seed(async (database) => {
			await setDoc(doc(database, 'openToGames', 'player'), openCard());
		});
		const other = authed('other');
		const missing = await assertSucceeds(getDoc(doc(other, 'gameContacts', 'other_player')));
		expect(missing.exists()).toBe(false);
		await assertFails(getDoc(doc(authed('stranger'), 'gameContacts', 'other_nobody')));
		await assertFails(setDoc(doc(other, 'gameContacts', 'other_stranger'), contact('other', 'stranger')));
		await assertSucceeds(setDoc(doc(other, 'gameContacts', 'other_player'), contact('other', 'player')));
		await assertFails(
			setDoc(doc(other, 'gameContacts', 'other_player'), { ...contact('other', 'player'), email: 'other@example.com' })
		);
		await assertFails(getDoc(doc(guest(), 'gameContacts', 'other_player')));
		await assertFails(getDoc(doc(authed('stranger'), 'gameContacts', 'other_player')));
		await assertSucceeds(getDoc(doc(authed('player'), 'gameContacts', 'other_player')));
		await assertSucceeds(
			updateDoc(doc(authed('player'), 'gameContacts', 'other_player'), {
				read: true,
				reply: 'Saturday works.',
				repliedAt: NOW
			})
		);
		await assertFails(updateDoc(doc(other, 'gameContacts', 'other_player'), { toUid: 'stranger' }));
		await assertFails(updateDoc(doc(authed('player'), 'gameContacts', 'other_player'), { message: 'changed' }));

		await seed(async (database) => {
			await setDoc(doc(database, 'roles', 'admin'), roleDoc());
		});
		await assertSucceeds(getDoc(doc(authed('admin'), 'gameContacts', 'other_player')));
	});

	it('blocks a disabled player from profiles, the map, and contact', async () => {
		await seed(async (database) => {
			await setDoc(doc(database, 'roles', 'admin'), roleDoc());
			await setDoc(doc(database, 'adminUsers', 'player'), disabledBy('admin'));
			await setDoc(doc(database, 'playerProfiles', 'player'), playerProfile({ playerName: 'Ada' }));
		});
		const player = authed('player');
		await assertFails(getDoc(doc(player, 'playerProfiles', 'player')));
		await assertFails(setDoc(doc(player, 'playerProfiles', 'player'), playerProfile()));
		await assertFails(setDoc(doc(player, 'openToGames', 'player'), openCard()));
		await assertFails(setDoc(doc(player, 'gameContacts', 'player_other'), contact('player', 'other')));
		await assertFails(getDoc(doc(player, 'openToGamesBoard', 'public')));
		await assertFails(setDoc(doc(player, 'openToGamesBoard', 'public'), { players: { player: openCard() } }));
		await assertFails(setDoc(doc(player, 'playerMapBoard', 'public'), { markers: { [ENTRY]: anonPin() } }));
	});
});

function fullMarkerBoard(count: number, extra: Record<string, unknown> = {}) {
	const markers: Record<string, unknown> = { ...extra };
	for (let index = 0; index < count; index += 1) {
		markers[`m${String(index).padStart(19, '0')}`] = anonPin();
	}
	return markers;
}

describe('player directory boards', () => {
	const otherEntry = 'bbbbbbbbbbbbbbbbbbbb';

	async function claimPin(uid: string, entryId: string) {
		const player = authed(uid);
		await assertSucceeds(setDoc(doc(player, 'playerMapOwners', uid), { entryId, updatedAt: NOW }));
		await assertSucceeds(setDoc(doc(player, 'playerMapPrivate', entryId), { ownerUid: uid }));
	}

	it('publishes one public map board and rejects scans, spoofed pins, and deletion', async () => {
		await claimPin('player', ENTRY);
		const player = authed('player');
		await seedPlacement('player', anonPin().latE2, anonPin().lngE2);
		await assertSucceeds(setDoc(doc(player, 'playerMapBoard', 'public'), { markers: { [ENTRY]: anonPin() } }));
		expect((await getDoc(doc(guest(), 'playerMapBoard', 'public'))).data()).toEqual({
			markers: { [ENTRY]: anonPin() }
		});
		await assertFails(getDocs(collection(guest(), 'playerMapBoard')));
		await assertFails(getDoc(doc(guest(), 'playerMapBoard', 'secret')));
		await assertFails(setDoc(doc(guest(), 'playerMapBoard', 'public'), { markers: { [ENTRY]: anonPin() } }));
		await assertFails(deleteDoc(doc(player, 'playerMapBoard', 'public')));
		await assertFails(setDoc(doc(player, 'playerMapBoard', 'other'), { markers: { [ENTRY]: anonPin() } }));
		await assertFails(
			setDoc(doc(player, 'playerMapBoard', 'public'), {
				markers: { [ENTRY]: { ...anonPin(), email: 'ada@example.com' } }
			})
		);
		await assertFails(
			setDoc(doc(player, 'playerMapBoard', 'public'), { markers: { [ENTRY]: anonPin() }, note: 'extra' })
		);

		await claimPin('other', otherEntry);
		const other = authed('other');
		await seedPlacement('other', namedPin().latE2, namedPin().lngE2);
		await assertSucceeds(
			setDoc(doc(other, 'playerMapBoard', 'public'), {
				markers: { [ENTRY]: anonPin(), [otherEntry]: namedPin() }
			})
		);
		await assertFails(
			setDoc(doc(other, 'playerMapBoard', 'public'), {
				markers: { [otherEntry]: namedPin() }
			})
		);
		await assertFails(
			setDoc(doc(other, 'playerMapBoard', 'public'), {
				markers: { [ENTRY]: { ...anonPin(), latE2: 1 }, [otherEntry]: namedPin() }
			})
		);
		await assertFails(deleteDoc(doc(other, 'playerMapBoard', 'public')));

		await assertSucceeds(setDoc(doc(player, 'playerMapBoard', 'public'), { markers: { [otherEntry]: namedPin() } }));
		expect((await getDoc(doc(guest(), 'playerMapBoard', 'public'))).data()).toEqual({
			markers: { [otherEntry]: namedPin() }
		});
	});

	it('stops a new pin once the map board is full but still lets an owner edit theirs', async () => {
		const owned = 'm' + '0'.repeat(19);
		const markers = fullMarkerBoard(500);
		await seed(async (database) => {
			await setDoc(doc(database, 'playerMapBoard', 'public'), { markers });
			await setDoc(doc(database, 'playerMapOwners', 'player'), { entryId: owned, updatedAt: NOW });
			await setDoc(doc(database, 'playerMapPrivate', owned), { ownerUid: 'player' });
		});
		const player = authed('player');
		const updated = { ...markers, [owned]: { ...anonPin(), latE2: 1200 } };
		await seed(async (database) => {
			await setDoc(doc(database, 'mapPlacements', 'player'), { latE2: 1200, lngE2: anonPin().lngE2, updatedAt: NOW });
		});
		await assertSucceeds(setDoc(doc(player, 'playerMapBoard', 'public'), { markers: updated }));

		await claimPin('newbie', otherEntry);
		await assertFails(
			setDoc(doc(authed('newbie'), 'playerMapBoard', 'public'), {
				markers: { ...updated, [otherEntry]: anonPin() }
			})
		);
	});

	it('lists open players from one board and blocks taking or erasing someone else', async () => {
		const player = authed('player');
		await assertSucceeds(setDoc(doc(player, 'openToGamesBoard', 'public'), { players: { player: openCard() } }));
		await assertSucceeds(getDoc(doc(authed('other'), 'openToGamesBoard', 'public')));
		await assertFails(getDoc(doc(guest(), 'openToGamesBoard', 'public')));
		await assertFails(getDocs(collection(authed('other'), 'openToGames')));
		await assertFails(getDocs(collection(authed('other'), 'openToGamesBoard')));
		await assertFails(
			setDoc(doc(player, 'openToGamesBoard', 'public'), {
				players: { player: { ...openCard(), email: 'ada@example.com' } }
			})
		);
		await assertFails(deleteDoc(doc(player, 'openToGamesBoard', 'public')));

		const other = authed('other');
		await assertSucceeds(
			setDoc(doc(other, 'openToGamesBoard', 'public'), {
				players: { player: openCard(), other: openCard({ playerName: 'Bea' }) }
			})
		);
		await assertFails(
			setDoc(doc(other, 'openToGamesBoard', 'public'), {
				players: { other: openCard({ playerName: 'Bea' }) }
			})
		);
		await assertFails(
			setDoc(doc(other, 'openToGamesBoard', 'public'), {
				players: { player: openCard({ playerName: 'Stolen' }), other: openCard({ playerName: 'Bea' }) }
			})
		);
		await assertSucceeds(
			setDoc(doc(player, 'openToGamesBoard', 'public'), {
				players: { other: openCard({ playerName: 'Bea' }) }
			})
		);
	});

	it('stops a new contact card once the open board is full', async () => {
		const players: Record<string, unknown> = { player: openCard() };
		for (let index = 0; index < 499; index += 1) {
			players[`open${String(index).padStart(16, '0')}`] = openCard();
		}
		await seed(async (database) => {
			await setDoc(doc(database, 'openToGamesBoard', 'public'), { players });
		});
		const updated = { ...players, player: openCard({ playerName: 'Ada 2' }) };
		await assertSucceeds(setDoc(doc(authed('player'), 'openToGamesBoard', 'public'), { players: updated }));
		await assertFails(
			setDoc(doc(authed('newbie'), 'openToGamesBoard', 'public'), {
				players: { ...updated, newbie: openCard({ playerName: 'Newbie' }) }
			})
		);
	});
});

const NEWSLETTER_IN = {
	newsletterOptIn: true,
	newsletterOptInAt: NOW,
	newsletterConsentText: 'monthly-email-v1'
};

describe('monthly email consent', () => {
	it('lets only the owner write a typed opt-in and keeps everyone else out', async () => {
		const player = authed('player');
		await assertSucceeds(setDoc(doc(player, 'userSettings', 'player'), { darkMode: true }));
		await assertFails(setDoc(doc(player, 'userSettings', 'player'), { darkMode: true, injected: true }));
		await assertSucceeds(setDoc(doc(player, 'userSettings', 'player'), { ...NEWSLETTER_IN, darkMode: true }));
		await assertSucceeds(
			setDoc(doc(player, 'userSettings', 'player'), { ...NEWSLETTER_IN, newsletterSource: 'profile', darkMode: true })
		);
		await assertFails(
			setDoc(doc(player, 'userSettings', 'player'), { ...NEWSLETTER_IN, newsletterSource: 'x'.repeat(40) })
		);
		await assertSucceeds(
			updateDoc(doc(player, 'userSettings', 'player'), {
				newsletterOptIn: false,
				newsletterOptOutAt: NOW,
				newsletterPromptDismissedAt: NOW
			})
		);
		expect((await getDoc(doc(player, 'userSettings', 'player'))).get('newsletterOptIn')).toBe(false);

		await assertFails(setDoc(doc(player, 'userSettings', 'player'), { newsletterOptIn: 'yes' }));
		await assertFails(setDoc(doc(player, 'userSettings', 'player'), { newsletterOptIn: true }));
		await assertFails(
			setDoc(doc(player, 'userSettings', 'player'), {
				newsletterOptIn: true,
				newsletterOptInAt: NOW,
				newsletterConsentText: 'other-version'
			})
		);
		await assertFails(
			setDoc(doc(player, 'userSettings', 'player'), {
				newsletterOptIn: true,
				newsletterOptInAt: 123,
				newsletterConsentText: 'monthly-email-v1'
			})
		);
		await assertFails(setDoc(doc(player, 'userSettings', 'player'), { newsletterOptIn: false }));
		await assertFails(setDoc(doc(player, 'userSettings', 'player'), { newsletterPromptDismissedAt: 1 }));

		await assertFails(getDoc(doc(authed('other'), 'userSettings', 'player')));
		await assertFails(getDoc(doc(guest(), 'userSettings', 'player')));
		await assertFails(setDoc(doc(authed('other'), 'userSettings', 'player'), NEWSLETTER_IN));
		await assertFails(getDocs(collection(authed('other'), 'userSettings')));

		await seed(async (database) => {
			await setDoc(doc(database, 'roles', 'admin'), roleDoc());
		});
		const admin = authed('admin');
		await assertSucceeds(getDoc(doc(admin, 'userSettings', 'player')));
		const listed = await assertSucceeds(getDocs(collection(admin, 'userSettings')));
		expect(listed.docs.map((entry) => entry.id)).toEqual(['player']);
		await assertFails(
			updateDoc(doc(admin, 'userSettings', 'player'), {
				newsletterOptIn: true,
				newsletterOptInAt: NOW,
				newsletterConsentText: 'monthly-email-v1'
			})
		);
		await assertFails(setDoc(doc(admin, 'userSettings', 'player'), NEWSLETTER_IN));
		await assertFails(deleteDoc(doc(admin, 'userSettings', 'player')));
		expect((await getDoc(doc(admin, 'userSettings', 'player'))).get('newsletterOptIn')).toBe(false);

		await assertFails(getDoc(doc(player, 'newsletterTokens', 'player')));
		await assertFails(setDoc(doc(player, 'newsletterTokens', 'player'), { token: 'abc', uid: 'player' }));
		await assertFails(setDoc(doc(guest(), 'newsletterTokens', 'player'), { token: 'abc', uid: 'player' }));
		await assertFails(getDocs(collection(authed('admin'), 'newsletterTokens')));
	});

	it('stops a disabled administrator and a regular player from reading another settings document', async () => {
		await seed(async (database) => {
			await setDoc(doc(database, 'roles', 'admin'), roleDoc());
			await setDoc(doc(database, 'adminUsers', 'admin'), disabledBy('bootstrap'));
			await setDoc(doc(database, 'userSettings', 'player'), {
				newsletterOptIn: false,
				newsletterOptOutAt: NOW,
				receiveUpdates: false
			});
		});
		await assertFails(getDoc(doc(authed('admin'), 'userSettings', 'player')));
		await assertFails(getDocs(collection(authed('admin'), 'userSettings')));
		await assertFails(getDoc(doc(authed('other'), 'userSettings', 'player')));
		await assertFails(getDocs(collection(authed('other'), 'userSettings')));
	});
});

describe('gaming buddies', () => {
	const pair = 'buddy~owner';

	function buddyLink(status = 'accepted') {
		return {
			members: ['buddy', 'owner'],
			status,
			names: { buddy: 'Bea', owner: 'Oak' },
			createdAt: NOW,
			updatedAt: NOW
		};
	}

	async function seedTeams() {
		await seed(async (database) => {
			await setDoc(doc(database, 'teams', 'visible'), {
				userId: 'owner',
				teamName: 'Racers',
				hiddenFromBuddies: false,
				teamData: { sponsor: 'rutherford', vehicles: [] }
			});
			await setDoc(doc(database, 'teams', 'hidden'), {
				userId: 'owner',
				teamName: 'Secret',
				hiddenFromBuddies: true
			});
			await setDoc(doc(database, 'teams', 'legacy'), {
				userId: 'owner',
				teamName: 'Old'
			});
			await setDoc(doc(database, 'buddies', pair), buddyLink());
		});
	}

	it('lets a signed-in player list their own buddy links, requests, and blocks', async () => {
		const player = authed('buddy');
		await assertSucceeds(
			getDocs(query(collection(player, 'buddies'), where('members', 'array-contains', 'buddy'), where('status', '==', 'accepted')))
		);
		await assertSucceeds(getDocs(query(collection(player, 'buddyRequests'), where('toUid', '==', 'buddy'))));
		await assertSucceeds(getDocs(query(collection(player, 'buddyRequests'), where('fromUid', '==', 'buddy'))));
		await assertSucceeds(getDocs(query(collection(player, 'buddyBlocks'), where('blockerUid', '==', 'buddy'))));
		await assertFails(getDocs(collection(player, 'buddies')));
		await assertFails(getDocs(collection(player, 'buddyRequests')));
		await assertFails(getDocs(collection(player, 'buddyDirectory')));
	});

	it('lets an accepted buddy read a visible team and blocks writes', async () => {
		await seedTeams();
		const buddy = authed('buddy');
		await assertSucceeds(getDoc(doc(buddy, 'teams', 'visible')));
		await assertSucceeds(
			getDocs(query(collection(buddy, 'teams'), where('userId', '==', 'owner'), where('hiddenFromBuddies', '==', false)))
		);
		const listed = await getDocs(
			query(collection(buddy, 'teams'), where('userId', '==', 'owner'), where('hiddenFromBuddies', '==', false))
		);
		expect(listed.docs.map((item) => item.id)).toEqual(['visible']);
		await assertFails(updateDoc(doc(buddy, 'teams', 'visible'), { teamName: 'Stolen' }));
		await assertFails(deleteDoc(doc(buddy, 'teams', 'visible')));
		await assertFails(setDoc(doc(buddy, 'teams', 'planted'), { userId: 'owner', teamName: 'Planted', hiddenFromBuddies: false }));
		await assertFails(setDoc(doc(buddy, 'buddies', pair), buddyLink()));
	});

	it('denies a player who is not a buddy', async () => {
		await seedTeams();
		await assertFails(getDoc(doc(authed('stranger'), 'teams', 'visible')));
		await assertFails(
			getDocs(query(collection(authed('stranger'), 'teams'), where('userId', '==', 'owner'), where('hiddenFromBuddies', '==', false)))
		);
		await assertFails(getDoc(doc(guest(), 'teams', 'visible')));
	});

	it('denies a pending request', async () => {
		await seed(async (database) => {
			await setDoc(doc(database, 'teams', 'visible'), {
				userId: 'owner',
				teamName: 'Racers',
				hiddenFromBuddies: false
			});
			await setDoc(doc(database, 'buddyRequests', 'buddy~owner'), {
				fromUid: 'buddy',
				toUid: 'owner',
				fromName: 'Bea',
				toName: 'Oak',
				status: 'pending',
				createdAt: NOW,
				updatedAt: NOW
			});
		});
		await assertFails(getDoc(doc(authed('buddy'), 'teams', 'visible')));
		await assertSucceeds(getDoc(doc(authed('buddy'), 'buddyRequests', 'buddy~owner')));
		await assertFails(setDoc(doc(authed('buddy'), 'buddyRequests', 'buddy~owner'), { status: 'accepted' }));
	});

	it('denies access after the buddy link is removed or is not accepted', async () => {
		await seedTeams();
		await seed(async (database) => {
			await deleteDoc(doc(database, 'buddies', pair));
		});
		await assertFails(getDoc(doc(authed('buddy'), 'teams', 'visible')));

		await seed(async (database) => {
			await setDoc(doc(database, 'buddies', pair), buddyLink('removed'));
		});
		await assertFails(getDoc(doc(authed('buddy'), 'teams', 'visible')));
	});

	it('denies a hidden team and a team with no visibility field', async () => {
		await seedTeams();
		const buddy = authed('buddy');
		await assertFails(getDoc(doc(buddy, 'teams', 'hidden')));
		await assertFails(getDoc(doc(buddy, 'teams', 'legacy')));
		await assertSucceeds(getDoc(doc(authed('owner'), 'teams', 'hidden')));
		await assertSucceeds(getDoc(doc(authed('owner'), 'teams', 'legacy')));
	});

	it('denies a disabled buddy and a buddy of a disabled owner', async () => {
		await seedTeams();
		await seed(async (database) => {
			await setDoc(doc(database, 'adminUsers', 'buddy'), disabledBy('admin'));
		});
		await assertFails(getDoc(doc(authed('buddy'), 'teams', 'visible')));
		await assertFails(getDoc(doc(authed('buddy'), 'buddies', pair)));

		await seed(async (database) => {
			await deleteDoc(doc(database, 'adminUsers', 'buddy'));
			await setDoc(doc(database, 'adminUsers', 'owner'), disabledBy('admin'));
		});
		await assertFails(getDoc(doc(authed('buddy'), 'teams', 'visible')));
	});

	it('keeps invite codes, the directory, and blocks off other players', async () => {
		await seed(async (database) => {
			await setDoc(doc(database, 'buddyInvites', 'owner'), { code: 'ABCD234567', displayName: 'Oak' });
			await setDoc(doc(database, 'buddyDirectory', 'owner'), { displayName: 'Oak', displayNameKey: 'oak' });
			await setDoc(doc(database, 'buddyBlocks', 'owner~buddy'), {
				blockerUid: 'owner',
				blockedUid: 'buddy',
				createdAt: NOW
			});
		});
		await assertSucceeds(getDoc(doc(authed('owner'), 'buddyInvites', 'owner')));
		await assertFails(getDoc(doc(authed('buddy'), 'buddyInvites', 'owner')));
		await assertFails(getDocs(collection(authed('buddy'), 'buddyInvites')));
		await assertSucceeds(getDoc(doc(authed('owner'), 'buddyDirectory', 'owner')));
		await assertFails(getDoc(doc(authed('buddy'), 'buddyDirectory', 'owner')));
		await assertFails(getDocs(collection(authed('buddy'), 'buddyDirectory')));
		await assertSucceeds(getDoc(doc(authed('owner'), 'buddyBlocks', 'owner~buddy')));
		await assertFails(getDoc(doc(authed('buddy'), 'buddyBlocks', 'owner~buddy')));
		await assertFails(setDoc(doc(authed('owner'), 'buddyDirectory', 'owner'), { displayName: 'Spoof', email: 'a@b.c' }));
	});

	it('hides email invite tokens from clients', async () => {
		const hash = 'ab'.repeat(32);
		await seed(async (database) => {
			await setDoc(doc(database, 'buddyEmailInvites', 'invite1'), {
				fromUid: 'owner',
				emailHash: hash,
				exp: 1,
				message: '',
				usedAt: null,
				createdAt: NOW
			});
			await setDoc(doc(database, 'buddyEmailOptOuts', hash), { emailHash: hash, fromUid: 'owner', createdAt: NOW });
			await setDoc(doc(database, 'buddyEmailRate', hash), { sentAt: 1 });
			await setDoc(doc(database, 'buddyEmailSuppress', hash), { suppressedAt: NOW });
		});
		const owner = authed('owner');
		for (const name of ['buddyEmailInvites', 'buddyEmailOptOuts', 'buddyEmailRate', 'buddyEmailSuppress']) {
			await assertFails(getDoc(doc(owner, name, name === 'buddyEmailInvites' ? 'invite1' : hash)));
			await assertFails(getDocs(collection(owner, name)));
			await assertFails(setDoc(doc(owner, name, 'planted'), { fromUid: 'owner' }));
		}
	});
});

function photoDoc(uid = 'player') {
	return {
		photoId: 'photo1234',
		userId: uid,
		teamId: 'team1234',
		vehicleId: 'veh123',
		path: `users/${uid}/vehicle-photos/team1234/veh123/photo1234.webp`,
		width: 800,
		height: 600,
		createdAt: NOW,
		caption: 'Red car',
		contentType: 'image/webp'
	};
}

describe('vehicle photos', () => {
	it('lets the owner read, retitle, and delete a photo, and blocks everyone else from creating or reading one', async () => {
		await seed(async (database) => {
			await setDoc(doc(database, 'users', 'player', 'photos', 'photo1234'), photoDoc());
			await setDoc(doc(database, 'roles', 'admin'), roleDoc());
			await setDoc(doc(database, 'buddies', 'buddy~player'), {
				status: 'accepted',
				members: ['buddy', 'player']
			});
		});
		const player = authed('player');
		const photo = doc(player, 'users', 'player', 'photos', 'photo1234');
		await assertSucceeds(getDoc(photo));
		await assertSucceeds(getDocs(collection(player, 'users', 'player', 'photos')));
		await assertSucceeds(updateDoc(photo, { caption: 'Blue car' }));
		await assertFails(updateDoc(photo, { path: 'users/player/vehicle-photos/team1234/veh123/other.webp' }));
		await assertFails(updateDoc(photo, { caption: 'x'.repeat(141) }));
		await assertFails(setDoc(doc(player, 'users', 'player', 'photos', 'photo9999'), photoDoc()));

		await assertFails(getDoc(doc(authed('buddy'), 'users', 'player', 'photos', 'photo1234')));
		await assertFails(getDoc(doc(authed('admin'), 'users', 'player', 'photos', 'photo1234')));
		await assertFails(getDoc(doc(guest(), 'users', 'player', 'photos', 'photo1234')));
		await assertSucceeds(deleteDoc(photo));
	});

	it('lets the owner retitle a photo without changing sharing flags', async () => {
		await seed(async (database) => {
			await setDoc(doc(database, 'users', 'player', 'photos', 'photo1234'), {
				...photoDoc(),
				showToBuddies: false,
				showOnShareLink: false,
				showInGallery: true,
				shareVehicleStats: true
			});
		});
		const photo = doc(authed('player'), 'users', 'player', 'photos', 'photo1234');
		await assertSucceeds(updateDoc(photo, { caption: 'Blue car' }));
		await assertFails(updateDoc(photo, { showInGallery: false }));
		await assertFails(updateDoc(photo, { showToBuddies: true }));
		await assertFails(updateDoc(photo, { shareVehicleStats: false }));
		const saved = await getDoc(photo);
		expect(saved.data()?.showInGallery).toBe(true);
		expect(saved.data()?.shareVehicleStats).toBe(true);
		expect(saved.data()?.caption).toBe('Blue car');
	});

	it('lets the owner retitle a library photo and blocks changes to its attachments', async () => {
		await seed(async (database) => {
			await setDoc(doc(database, 'users', 'player', 'photos', 'photo1234'), {
				...photoDoc(),
				teamId: '',
				vehicleId: '',
				path: 'users/player/photos-library/photo1234.webp',
				attachments: [{ teamId: 'team1234', vehicleId: 'veh123' }],
				contentHash: 'a'.repeat(64),
				shareTeamId: 'team1234',
				shareVehicleId: 'veh123'
			});
		});
		const photo = doc(authed('player'), 'users', 'player', 'photos', 'photo1234');
		await assertSucceeds(updateDoc(photo, { caption: 'Still mine' }));
		await assertFails(updateDoc(photo, { attachments: [] }));
		await assertFails(updateDoc(photo, { contentHash: 'b'.repeat(64) }));
		await assertFails(updateDoc(photo, { path: 'users/player/photos-library/other1234.webp' }));
		const saved = await getDoc(photo);
		expect(saved.data()?.caption).toBe('Still mine');
		expect(saved.data()?.attachments).toEqual([{ teamId: 'team1234', vehicleId: 'veh123' }]);
	});
});

describe('shared gallery photos', () => {
	function sharedPhoto(overrides: Record<string, unknown> = {}) {
		return {
			photoId: 'photo1234',
			displayName: 'Track Name',
			vehicleType: 'Car',
			teamName: 'Racers',
			caption: 'Red',
			createdAt: NOW,
			hidden: false,
			published: true,
			showInGallery: true,
			...overrides
		};
	}

	it('lets anyone read a visible gallery photo and blocks client writes', async () => {
		await seed(async (database) => {
			await setDoc(doc(database, 'sharedPhotos', 'photo1234'), sharedPhoto());
			await setDoc(doc(database, 'sharedPhotos', 'photo9999'), sharedPhoto({ photoId: 'photo9999', hidden: true }));
			await setDoc(doc(database, 'sharedPhotos', 'photo8888'), sharedPhoto({ photoId: 'photo8888', published: false }));
			await setDoc(doc(database, 'roles', 'admin'), roleDoc());
			await setDoc(doc(database, 'sharedPhotoPrivate', 'photo1234'), { ownerUid: 'player' });
			await setDoc(doc(database, 'photoReports', 'photo1234~other'), { photoId: 'photo1234', reporterUid: 'other' });
			await setDoc(doc(database, 'config', 'gallery'), { requireApproval: false });
		});
		const visible = query(
			collection(guest(), 'sharedPhotos'),
			where('showInGallery', '==', true),
			where('hidden', '==', false),
			where('published', '==', true),
			orderBy('createdAt', 'desc')
		);
		await assertSucceeds(getDocs(visible));
		await assertSucceeds(getDoc(doc(guest(), 'sharedPhotos', 'photo1234')));
		await assertFails(getDoc(doc(guest(), 'sharedPhotos', 'photo9999')));
		await assertFails(getDoc(doc(guest(), 'sharedPhotos', 'photo8888')));
		await assertSucceeds(getDoc(doc(authed('admin'), 'sharedPhotos', 'photo9999')));
		await assertFails(setDoc(doc(authed('player'), 'sharedPhotos', 'photo1234'), sharedPhoto({ caption: 'nope' })));
		await assertFails(getDoc(doc(authed('admin'), 'sharedPhotoPrivate', 'photo1234')));
		await assertFails(getDoc(doc(guest(), 'sharedPhotoPrivate', 'photo1234')));
		await assertSucceeds(getDoc(doc(authed('admin'), 'photoReports', 'photo1234~other')));
		await assertFails(getDoc(doc(authed('player'), 'photoReports', 'photo1234~other')));
		await assertFails(setDoc(doc(authed('player'), 'photoReports', 'planted'), { photoId: 'photo1234' }));
		await assertSucceeds(getDoc(doc(authed('admin'), 'config', 'gallery')));
		await assertFails(getDoc(doc(authed('player'), 'config', 'gallery')));
		await assertFails(setDoc(doc(authed('admin'), 'config', 'gallery'), { requireApproval: true }));
		await assertFails(getDoc(doc(authed('player'), 'photoReportRate', 'player')));
	});
});

describe('rules file', () => {
	it('does not name a person as the administrator', () => {
		const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
		expect(rules).not.toContain('@');
		const consent = readFileSync(new URL('../src/lib/privacy/marketingConsent.ts', import.meta.url), 'utf8');
		expect(consent).toContain("NEWSLETTER_CONSENT_VERSION = 'monthly-email-v1'");
		expect(rules).toContain("'monthly-email-v1'");
		const policy = readFileSync(new URL('../src/routes/privacy/+page.svelte', import.meta.url), 'utf8');
		expect(policy).toContain('Unsubscribe from the link');
	});
});
