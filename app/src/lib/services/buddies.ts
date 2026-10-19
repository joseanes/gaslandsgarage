import { auth, db, initializeFirebase } from '$lib/firebase';
import { browser } from '$app/environment';
import { PRIVACY_FUNCTIONS_REGION } from '$lib/privacy/accountShared';
import { galleryBuddyContext } from '$lib/buddies/gallery';
import { BUDDY_COLLECTIONS, buddyCopyTeamName, buddyPairId, buddyRequestMessage, publicCarLabel, publicDisplayName } from '$lib/buddies/model';
import { PHOTO_ID_PATTERN } from '$lib/photos/model';
import { getUserTeams } from '$lib/services/team';

export { buddyCopyTeamName, publicDisplayName };

export type BuddyLink = {
	id: string;
	uid: string;
	displayName: string;
};

export type BuddyRequest = {
	id: string;
	fromUid: string;
	toUid: string;
	fromName: string;
	toName: string;
	status: string;
	createdAt: string;
	source: string;
	photoId: string;
	carName: string;
	message: string;
	context: string;
};

export type BuddyBlock = {
	id: string;
	blockedUid: string;
};

export type BuddyTeam = {
	id: string;
	teamName: string;
	updatedAt: string;
	hiddenFromBuddies: boolean;
	teamData: Record<string, unknown>;
};

export type BuddyProfile = {
	code: string;
	displayName: string;
	discoverable: boolean;
	emailInvites: boolean;
	galleryBuddyRequests: boolean;
};

export type GalleryBuddyOffer = {
	offer: 'hidden' | 'sign-in' | 'add' | 'sent' | 'buddies' | 'accept' | 'declined';
	requestId: string;
};

export type SearchResult = {
	uid: string;
	displayName: string;
	relationship: string;
};

function callableError(error: unknown): string {
	const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
	const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
	if (code.endsWith('resource-exhausted')) return message || 'Too many requests. Try again later.';
	if (
		message &&
		(code.endsWith('invalid-argument') ||
			code.endsWith('failed-precondition') ||
			code.endsWith('already-exists') ||
			code.endsWith('not-found') ||
			code.endsWith('permission-denied') ||
			code.endsWith('unauthenticated'))
	) {
		return message;
	}
	if (message && (message.includes('Failed to fetch') || message.includes('internal'))) {
		return 'The buddy service is not available yet. Try again in a moment.';
	}
	return message || 'That did not work. Try again.';
}

async function callBuddy<T>(name: string, data?: object): Promise<T> {
	const ready = await initializeFirebase();
	if (!ready.success || !auth?.app) throw new Error('Firebase is not ready. Refresh the page and try again.');
	const { getFunctions, httpsCallable } = await import('firebase/functions');
	const functions = getFunctions(auth.app, PRIVACY_FUNCTIONS_REGION);
	const result = await httpsCallable(functions, name)(data ?? {});
	return result.data as T;
}

export async function loadBuddyProfile(): Promise<BuddyProfile> {
	const profile = await callBuddy<BuddyProfile>('getBuddyInvite');
	return {
		...profile,
		emailInvites: profile.emailInvites === true,
		galleryBuddyRequests: profile.galleryBuddyRequests !== false
	};
}

export async function saveBuddyProfile(input: {
	displayName: string;
	discoverable: boolean;
	galleryBuddyRequests?: boolean;
}): Promise<BuddyProfile> {
	const saved = await callBuddy<{ displayName: string; discoverable: boolean; galleryBuddyRequests?: boolean }>(
		'saveBuddyProfile',
		input
	);
	const current = await loadBuddyProfile();
	return {
		...current,
		displayName: saved.displayName,
		discoverable: saved.discoverable,
		galleryBuddyRequests: saved.galleryBuddyRequests !== false
	};
}

export async function galleryBuddyOffer(photoId: string): Promise<GalleryBuddyOffer> {
	const result = await callBuddy<{ offer?: string; requestId?: string }>('galleryBuddyOffer', { photoId });
	const offer = result.offer;
	const known = offer === 'sign-in' || offer === 'add' || offer === 'sent' || offer === 'buddies' || offer === 'accept' || offer === 'declined';
	return {
		offer: known ? offer : 'hidden',
		requestId: typeof result.requestId === 'string' ? result.requestId : ''
	};
}

export async function searchBuddyPlayers(query: string): Promise<SearchResult[]> {
	const result = await callBuddy<{ results: SearchResult[] }>('searchBuddyPlayers', { query });
	return (result.results ?? []).map((item) => ({
		uid: item.uid,
		displayName: publicDisplayName(item.displayName) ?? 'Player',
		relationship: item.relationship
	}));
}

export async function sendBuddyRequest(input: {
	code?: string;
	targetUid?: string;
	photoId?: string;
	message?: string;
}): Promise<void> {
	await callBuddy('sendBuddyRequest', input);
}

export async function sendBuddyEmailInvite(email: string, message: string): Promise<void> {
	await callBuddy('sendBuddyInvite', { email, message });
}

export async function acceptBuddyEmailInvite(token: string): Promise<void> {
	await callBuddy('acceptBuddyEmailInvite', { token });
}

export async function respondBuddyRequest(requestId: string, action: 'accept' | 'decline' | 'block'): Promise<void> {
	await callBuddy('respondBuddyRequest', { requestId, action });
}

export async function cancelBuddyRequest(requestId: string): Promise<void> {
	await callBuddy('cancelBuddyRequest', { requestId });
}

export async function removeBuddy(otherUid: string): Promise<void> {
	await callBuddy('removeBuddy', { otherUid });
}

export async function unblockBuddy(otherUid: string): Promise<void> {
	await callBuddy('unblockBuddy', { otherUid });
}

export function buddyErrorMessage(error: unknown): string {
	return callableError(error);
}

async function readyDb() {
	if (!browser) throw new Error('Cannot run on server');
	const ready = await initializeFirebase();
	if (!ready.success || !db || !auth?.currentUser) throw new Error('Sign in required.');
	return { database: db, uid: auth.currentUser.uid };
}

export async function loadBuddyLinks(): Promise<BuddyLink[]> {
	const { database, uid } = await readyDb();
	const { collection, getDocs, query, where } = await import('firebase/firestore');
	const snap = await getDocs(
		query(
			collection(database, BUDDY_COLLECTIONS.buddies),
			where('members', 'array-contains', uid),
			where('status', '==', 'accepted')
		)
	);
	return snap.docs
		.map((item) => {
			const data = item.data();
			const members = Array.isArray(data.members) ? data.members.filter((member) => typeof member === 'string') : [];
			const other = members.find((member) => member !== uid) ?? '';
			const names = data.names && typeof data.names === 'object' ? (data.names as Record<string, unknown>) : {};
			return {
				id: item.id,
				uid: other,
				displayName: publicDisplayName(names[other]) ?? 'Player'
			};
		})
		.filter((item) => item.uid)
		.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function loadBuddyRequests(): Promise<{ incoming: BuddyRequest[]; outgoing: BuddyRequest[] }> {
	const { database, uid } = await readyDb();
	const { collection, getDocs, query, where } = await import('firebase/firestore');
	const [incomingSnap, outgoingSnap] = await Promise.all([
		getDocs(query(collection(database, BUDDY_COLLECTIONS.requests), where('toUid', '==', uid))),
		getDocs(query(collection(database, BUDDY_COLLECTIONS.requests), where('fromUid', '==', uid)))
	]);
	const mapRequest = (id: string, data: Record<string, unknown>): BuddyRequest => {
		const source = data.source === 'gallery' ? 'gallery' : '';
		const photoId = typeof data.photoId === 'string' && PHOTO_ID_PATTERN.test(data.photoId) ? data.photoId : '';
		const carName = source === 'gallery' ? publicCarLabel({ caption: data.carName }) : '';
		const message = buddyRequestMessage(data.message) ?? '';
		return {
			id,
			fromUid: String(data.fromUid ?? ''),
			toUid: String(data.toUid ?? ''),
			fromName: publicDisplayName(data.fromName) ?? 'Player',
			toName: publicDisplayName(data.toName) ?? 'Player',
			status: String(data.status ?? ''),
			createdAt: String(data.createdAt ?? ''),
			source,
			photoId,
			carName,
			message,
			context: source === 'gallery' ? galleryBuddyContext(carName) : ''
		};
	};
	const incoming = incomingSnap.docs
		.map((item) => mapRequest(item.id, item.data()))
		.filter((item) => item.status === 'pending');
	const outgoing = outgoingSnap.docs
		.map((item) => mapRequest(item.id, item.data()))
		.filter((item) => item.status === 'pending');
	return { incoming, outgoing };
}

export async function loadBuddyBlocks(): Promise<BuddyBlock[]> {
	const { database, uid } = await readyDb();
	const { collection, getDocs, query, where } = await import('firebase/firestore');
	const snap = await getDocs(query(collection(database, BUDDY_COLLECTIONS.blocks), where('blockerUid', '==', uid)));
	return snap.docs.map((item) => ({ id: item.id, blockedUid: String(item.data().blockedUid ?? '') }));
}

export async function loadAcceptedBuddy(otherUid: string): Promise<{ displayName: string } | null> {
	const { database, uid } = await readyDb();
	const { doc, getDoc } = await import('firebase/firestore');
	let pair = '';
	try {
		pair = buddyPairId(uid, otherUid);
	} catch {
		return null;
	}
	const snap = await getDoc(doc(database, BUDDY_COLLECTIONS.buddies, pair));
	if (!snap.exists() || snap.data().status !== 'accepted') return null;
	const names = snap.data().names;
	const stored = names && typeof names === 'object' ? (names as Record<string, unknown>)[otherUid] : null;
	return { displayName: publicDisplayName(stored) ?? 'Player' };
}

export async function loadBuddyTeams(ownerUid: string): Promise<BuddyTeam[]> {
	const { database } = await readyDb();
	const { collection, getDocs, query, where } = await import('firebase/firestore');
	const snap = await getDocs(
		query(
			collection(database, 'teams'),
			where('userId', '==', ownerUid),
			where('hiddenFromBuddies', '==', false)
		)
	);
	return snap.docs
		.map((item) => {
			const data = item.data();
			const teamData = data.teamData && typeof data.teamData === 'object' ? (data.teamData as Record<string, unknown>) : {};
			return {
				id: item.id,
				teamName: typeof data.teamName === 'string' && data.teamName.trim() ? data.teamName : 'Untitled team',
				updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
				hiddenFromBuddies: data.hiddenFromBuddies === true,
				teamData
			};
		})
		.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
}

export async function stageBuddyTeamCopy(team: BuddyTeam, buddyName: string): Promise<string> {
	const existing = await getUserTeams();
	const names = existing.success && existing.teams ? existing.teams.map((item) => String(item.teamName ?? '')) : [];
	const teamName = buddyCopyTeamName(team.teamName, buddyName, names);
	const draft = {
		...team.teamData,
		sponsor: team.teamData.sponsor || team.teamData.sponsorId,
		teamName,
		vehicles: Array.isArray(team.teamData.vehicles) ? team.teamData.vehicles : []
	};
	localStorage.setItem('gaslands-team-data', JSON.stringify(draft));
	sessionStorage.setItem('gaslands-buddy-copy-banner', '1');
	return teamName;
}
