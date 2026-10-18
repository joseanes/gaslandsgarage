import { db, initializeFirebase } from '$lib/firebase';
import { coordinatesForSave } from '$lib/players/geocode';
import {
	contactDocId,
	emptyForm,
	planPresence,
	presentMapMarker,
	readStoredProfile,
	validateContact,
	type MapMarker,
	type PlayerForm,
	type StoredProfile
} from '$lib/players/profile';

export type GameContact = {
	id: string;
	fromName: string;
	toName: string;
	message: string;
	createdAt: string;
	read: boolean;
	reply: string;
	repliedAt: string;
	incoming: boolean;
};

const PROFILES = 'playerProfiles';
const OWNERS = 'playerMapOwners';
const PRIVATE = 'playerMapPrivate';
const MAP = 'playerMap';
const OPEN = 'openToGames';
const CONTACTS = 'gameContacts';

async function ready() {
	const init = await initializeFirebase();
	if (!init.success || !db) throw new Error('Database not initialized');
	const api = await import('firebase/firestore');
	return { ...api, database: db };
}

function failure(error: unknown): string {
	console.error(error);
	return 'Could not save that. Check your connection and try again.';
}

export async function loadOwnProfile(uid: string): Promise<StoredProfile | null> {
	const { doc, getDoc, database } = await ready();
	const snap = await getDoc(doc(database, PROFILES, uid));
	if (!snap.exists()) return null;
	return readStoredProfile(snap.data() as Record<string, unknown>);
}

export async function saveOwnProfile(
	uid: string,
	form: PlayerForm,
	previous: StoredProfile | null
): Promise<{ success: true; profile: StoredProfile } | { success: false; error: string }> {
	try {
		const coords = await coordinatesForSave(form.locationLabel, previous);
		if (!coords.ok) return { success: false, error: coords.error };
		const planned = planPresence({
			uid,
			form,
			previous,
			coords,
			now: new Date().toISOString()
		});
		if (!planned.ok) return { success: false, error: planned.error };
		const { doc, getDoc, setDoc, deleteDoc, database } = await ready();
		const plan = planned.plan;

		if (plan.map) {
			await setDoc(doc(database, OWNERS, uid), { entryId: plan.map.entryId, updatedAt: plan.profile.updatedAt });
			const privateRef = doc(database, PRIVATE, plan.map.entryId);
			const existingPrivate = await getDoc(privateRef);
			if (!existingPrivate.exists()) {
				await setDoc(privateRef, { ownerUid: uid });
			} else if (existingPrivate.data().ownerUid !== uid) {
				return { success: false, error: 'That map pin is already taken. Try saving again.' };
			}
			await setDoc(doc(database, MAP, plan.map.entryId), plan.map.entry);
		} else if (plan.removeMapEntryId) {
			const mapRef = doc(database, MAP, plan.removeMapEntryId);
			const privateRef = doc(database, PRIVATE, plan.removeMapEntryId);
			const mapSnap = await getDoc(mapRef);
			if (mapSnap.exists()) await deleteDoc(mapRef);
			const privateSnap = await getDoc(privateRef);
			if (privateSnap.exists()) await deleteDoc(privateRef);
			const ownerSnap = await getDoc(doc(database, OWNERS, uid));
			if (ownerSnap.exists()) await deleteDoc(doc(database, OWNERS, uid));
		}

		const openRef = doc(database, OPEN, uid);
		if (plan.openToGames) {
			await setDoc(openRef, plan.openToGames);
		} else if (plan.removeOpenToGames) {
			const openSnap = await getDoc(openRef);
			if (openSnap.exists()) await deleteDoc(openRef);
		}

		await setDoc(doc(database, PROFILES, uid), plan.profile);
		return { success: true, profile: plan.profile };
	} catch (error) {
		return { success: false, error: failure(error) };
	}
}

export async function loadMapMarkers(): Promise<MapMarker[]> {
	const { collection, getDocs, database } = await ready();
	const snap = await getDocs(collection(database, MAP));
	const markers: MapMarker[] = [];
	for (const item of snap.docs) {
		const marker = presentMapMarker(item.id, item.data() as Record<string, unknown>);
		if (marker) markers.push(marker);
	}
	return markers;
}

export type OpenPlayer = { uid: string; playerName: string; bio: string; playSpots: string };

export async function loadOpenPlayers(): Promise<OpenPlayer[]> {
	const { collection, getDocs, database } = await ready();
	const snap = await getDocs(collection(database, OPEN));
	return snap.docs.map((item) => {
		const data = item.data() as Record<string, unknown>;
		return {
			uid: item.id,
			playerName: typeof data.playerName === 'string' ? data.playerName : 'Player',
			bio: typeof data.bio === 'string' ? data.bio : '',
			playSpots: typeof data.playSpots === 'string' ? data.playSpots : ''
		};
	});
}

function readContact(id: string, data: Record<string, unknown>, uid: string): GameContact {
	return {
		id,
		fromName: typeof data.fromName === 'string' ? data.fromName : 'Player',
		toName: typeof data.toName === 'string' ? data.toName : 'Player',
		message: typeof data.message === 'string' ? data.message : '',
		createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
		read: data.read === true,
		reply: typeof data.reply === 'string' ? data.reply : '',
		repliedAt: typeof data.repliedAt === 'string' ? data.repliedAt : '',
		incoming: data.toUid === uid
	};
}

export async function loadContacts(uid: string): Promise<GameContact[]> {
	const { collection, getDocs, query, where, database } = await ready();
	const [inbox, sent] = await Promise.all([
		getDocs(query(collection(database, CONTACTS), where('toUid', '==', uid))),
		getDocs(query(collection(database, CONTACTS), where('fromUid', '==', uid)))
	]);
	const byId = new Map<string, GameContact>();
	for (const item of [...inbox.docs, ...sent.docs]) {
		byId.set(item.id, readContact(item.id, item.data() as Record<string, unknown>, uid));
	}
	return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function sendGameContact(input: {
	fromUid: string;
	fromName: string;
	toUid: string;
	toName: string;
	message: string;
}): Promise<{ success: true } | { success: false; error: string }> {
	const invalid = validateContact({ fromName: input.fromName, message: input.message });
	if (invalid) return { success: false, error: invalid };
	if (!input.toUid || input.toUid === input.fromUid) {
		return { success: false, error: 'Choose another player.' };
	}
	try {
		const { doc, getDoc, setDoc, updateDoc, database } = await ready();
		const ref = doc(database, CONTACTS, contactDocId(input.fromUid, input.toUid));
		const toName = input.toName.trim().includes('@') ? 'Player' : input.toName.trim() || 'Player';
		const existing = await getDoc(ref);
		if (existing.exists()) {
			await updateDoc(ref, { message: input.message.trim(), fromName: input.fromName.trim() });
		} else {
			await setDoc(ref, {
				fromUid: input.fromUid,
				toUid: input.toUid,
				fromName: input.fromName.trim(),
				toName,
				message: input.message.trim(),
				createdAt: new Date().toISOString(),
				read: false,
				reply: '',
				repliedAt: ''
			});
		}
		return { success: true };
	} catch (error) {
		return { success: false, error: failure(error) };
	}
}

export async function replyToContact(
	id: string,
	reply: string
): Promise<{ success: true } | { success: false; error: string }> {
	const text = reply.trim();
	if (!text) return { success: false, error: 'Write a reply first.' };
	if (text.length > 500) return { success: false, error: 'Keep the reply to 500 characters.' };
	try {
		const { doc, updateDoc, database } = await ready();
		await updateDoc(doc(database, CONTACTS, id), {
			reply: text,
			repliedAt: new Date().toISOString(),
			read: true
		});
		return { success: true };
	} catch (error) {
		return { success: false, error: failure(error) };
	}
}

export async function markContactRead(id: string): Promise<{ success: true } | { success: false; error: string }> {
	try {
		const { doc, updateDoc, database } = await ready();
		await updateDoc(doc(database, CONTACTS, id), { read: true });
		return { success: true };
	} catch (error) {
		return { success: false, error: failure(error) };
	}
}

export { emptyForm };
