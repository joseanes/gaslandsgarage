import { createHash, randomInt } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { twilioAccountSid, twilioAuthToken } from './twilioConfig.ts';
import { twilioEmailConfigured } from '../../app/src/lib/buddies/emailInvite.ts';
import { type GalleryBuddyOfferName } from '../../app/src/lib/buddies/gallery.ts';
import {
	BUDDY_COLLECTIONS,
	BUDDY_GALLERY_RATE_WINDOW_MS,
	BUDDY_GALLERY_REQUESTS_PER_DAY,
	BUDDY_RATE_WINDOW_MS,
	BUDDY_REQUESTS_PER_HOUR,
	BUDDY_SEARCHES_PER_HOUR,
	buddyBlockId,
	buddyPairId,
	buddyRequestId,
	buddyRequestMessage,
	chosenBuddyName,
	createInviteCode,
	declineCooldownActive,
	displayNameKey,
	galleryBuddyRequestsAllowed,
	normalizeInviteCode,
	normalizeSearchQuery,
	publicCarLabel,
	publicDisplayName,
	rollingWindow,
	uidOk
} from '../../app/src/lib/buddies/model.ts';
import { PHOTO_ID_PATTERN } from '../../app/src/lib/photos/model.ts';

export const BUDDY_REGION = 'us-central1';
const UNAVAILABLE = 'That player is not available to add.';
const INVITE_INVALID = 'That invite is not valid.';
const RATE_LIMITED = 'Too many requests. Try again later.';

export const buddyCallableOptions = {
	region: BUDDY_REGION,
	memory: '256MiB',
	timeoutSeconds: 60,
	maxInstances: 10
} as const;

type BuddyAction = 'accept' | 'decline' | 'block';

function logBuddy(event: string, uid: string): void {
	const ref = createHash('sha256').update(uid).digest('hex').slice(0, 12);
	console.info(`buddies ${event} ref=${ref}`);
}

function errorCode(error: unknown): string {
	if (error && typeof error === 'object' && 'code' in error) return String(error.code);
	return '';
}

function isUserNotFound(error: unknown): boolean {
	return errorCode(error) === 'auth/user-not-found';
}

function iso(nowMs: number): string {
	return new Date(nowMs).toISOString();
}

function asObject(data: unknown): Record<string, unknown> {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
	return data as Record<string, unknown>;
}

async function callerIsDisabled(uid: string): Promise<boolean> {
	const adminDoc = await getFirestore().doc(`adminUsers/${uid}`).get();
	return adminDoc.exists && adminDoc.get('disabled') === true;
}

export async function assertCaller(uid: string | undefined): Promise<string> {
	if (!uidOk(uid)) throw new HttpsError('unauthenticated', 'Sign in required.');
	let record;
	try {
		record = await getAuth().getUser(uid);
	} catch (error) {
		if (isUserNotFound(error)) throw new HttpsError('unauthenticated', 'Sign in required.');
		throw error;
	}
	if (record.disabled || (await callerIsDisabled(uid))) {
		throw new HttpsError('permission-denied', 'This account is disabled.');
	}
	return uid;
}

export async function targetIsActive(uid: string): Promise<boolean> {
	try {
		const record = await getAuth().getUser(uid);
		if (record.disabled) return false;
	} catch (error) {
		if (isUserNotFound(error)) return false;
		throw error;
	}
	const adminDoc = await getFirestore().doc(`adminUsers/${uid}`).get();
	return !(adminDoc.exists && adminDoc.get('disabled') === true);
}

export async function publicBuddyName(uid: string): Promise<string> {
	const db = getFirestore();
	const [invite, directory] = await Promise.all([
		db.doc(`${BUDDY_COLLECTIONS.invites}/${uid}`).get(),
		db.doc(`${BUDDY_COLLECTIONS.directory}/${uid}`).get()
	]);
	return chosenBuddyName(invite.get('displayName'), directory.get('displayName'));
}

async function freshInviteCode(): Promise<string> {
	const db = getFirestore();
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const code = createInviteCode((upper) => randomInt(upper));
		const existing = await db.collection(BUDDY_COLLECTIONS.invites).where('code', '==', code).limit(1).get();
		if (existing.empty) return code;
	}
	throw new HttpsError('internal', 'Could not create an invite link. Try again.');
}

export async function handleGetBuddyInvite(
	uid: string | undefined,
	nowMs = Date.now(),
	emailInvites = false
): Promise<{
	code: string;
	displayName: string;
	discoverable: boolean;
	emailInvites: boolean;
	galleryBuddyRequests: boolean;
}> {
	const caller = await assertCaller(uid);
	logBuddy('invite', caller);
	const db = getFirestore();
	const ref = db.doc(`${BUDDY_COLLECTIONS.invites}/${caller}`);
	const snap = await ref.get();
	let code = normalizeInviteCode(snap.get('code'));
	const displayName = publicDisplayName(snap.get('displayName')) ?? '';
	if (!code) {
		code = await freshInviteCode();
		const stamp = iso(nowMs);
		await ref.set(
			{
				code,
				displayName,
				createdAt: snap.get('createdAt') || stamp,
				updatedAt: stamp
			},
			{ merge: true }
		);
	}
	const directory = await db.doc(`${BUDDY_COLLECTIONS.directory}/${caller}`).get();
	return {
		code,
		displayName,
		discoverable: directory.exists,
		emailInvites,
		galleryBuddyRequests: galleryBuddyRequestsAllowed(snap.get('galleryBuddyRequests'))
	};
}

export async function handleSaveBuddyProfile(
	uid: string | undefined,
	data: unknown,
	nowMs = Date.now()
): Promise<{ displayName: string; discoverable: boolean; galleryBuddyRequests: boolean }> {
	const caller = await assertCaller(uid);
	const body = asObject(data);
	const discoverable = body.discoverable === true;
	const name = publicDisplayName(body.displayName) ?? '';
	if (discoverable && !name) {
		throw new HttpsError('invalid-argument', 'Enter a name without an email address to be findable.');
	}
	if (body.displayName != null && body.displayName !== '' && !name) {
		throw new HttpsError('invalid-argument', 'Enter a name without an email address.');
	}
	logBuddy('profile', caller);
	const db = getFirestore();
	const stamp = iso(nowMs);
	const inviteRef = db.doc(`${BUDDY_COLLECTIONS.invites}/${caller}`);
	const directoryRef = db.doc(`${BUDDY_COLLECTIONS.directory}/${caller}`);
	const existing = await inviteRef.get();
	const code = normalizeInviteCode(existing.get('code')) ?? (await freshInviteCode());
	const galleryBuddyRequests = await db.runTransaction(async (tx) => {
		const invite = await tx.get(inviteRef);
		const allowed =
			body.galleryBuddyRequests === false
				? false
				: body.galleryBuddyRequests === true
					? true
					: galleryBuddyRequestsAllowed(invite.get('galleryBuddyRequests'));
		tx.set(
			inviteRef,
			{
				code: normalizeInviteCode(invite.get('code')) ?? code,
				displayName: name,
				galleryBuddyRequests: allowed,
				createdAt: invite.get('createdAt') || stamp,
				updatedAt: stamp
			},
			{ merge: true }
		);
		if (discoverable) {
			tx.set(directoryRef, { displayName: name, displayNameKey: displayNameKey(name), updatedAt: stamp });
		} else {
			tx.delete(directoryRef);
		}
		return allowed;
	});
	await syncGalleryBuddyFlag(caller, galleryBuddyRequests);
	return { displayName: name, discoverable, galleryBuddyRequests };
}

/** Public cards pick up the opt-out. Absence of the field still means allowed. */
async function syncGalleryBuddyFlag(uid: string, allowed: boolean): Promise<void> {
	const db = getFirestore();
	const owned = await db.collection('sharedPhotoPrivate').where('ownerUid', '==', uid).get();
	if (owned.empty) return;
	const pubs = await db.getAll(...owned.docs.map((item) => db.doc(`sharedPhotos/${item.id}`)));
	let batch = db.batch();
	let writes = 0;
	const commit = async () => {
		if (writes === 0) return;
		await batch.commit();
		batch = db.batch();
		writes = 0;
	};
	for (const pub of pubs) {
		if (!pub.exists) continue;
		const current = pub.get('allowGalleryBuddies');
		if (allowed) {
			if (current === undefined) continue;
			batch.set(pub.ref, { allowGalleryBuddies: FieldValue.delete() }, { merge: true });
		} else if (current !== false) {
			batch.set(pub.ref, { allowGalleryBuddies: false }, { merge: true });
		} else {
			continue;
		}
		writes += 1;
		if (writes === 400) await commit();
	}
	await commit();
}

async function consumeRate(
	tx: Transaction,
	ref: DocumentReference,
	field: 'requestAt' | 'searchAt' | 'galleryRequestAt',
	max: number,
	nowMs: number,
	windowMs: number
): Promise<void> {
	const snap = await tx.get(ref);
	const next = rollingWindow(snap.get(field), nowMs, max, windowMs);
	if (!next.allowed) throw new HttpsError('resource-exhausted', RATE_LIMITED);
	tx.set(ref, { [field]: next.stamps }, { merge: true });
}

export async function handleSearchBuddyPlayers(
	uid: string | undefined,
	data: unknown,
	nowMs = Date.now()
): Promise<{ results: { uid: string; displayName: string; relationship: string }[] }> {
	const caller = await assertCaller(uid);
	const queryText = normalizeSearchQuery(asObject(data).query);
	if (!queryText) {
		throw new HttpsError('invalid-argument', 'Enter at least two letters of a display name. Email search is not available.');
	}
	logBuddy('search', caller);
	const db = getFirestore();
	const rateRef = db.doc(`${BUDDY_COLLECTIONS.rate}/${caller}`);
	await db.runTransaction(async (tx) => {
		await consumeRate(tx, rateRef, 'searchAt', BUDDY_SEARCHES_PER_HOUR, nowMs, BUDDY_RATE_WINDOW_MS);
	});
	const snap = await db
		.collection(BUDDY_COLLECTIONS.directory)
		.orderBy('displayNameKey')
		.startAt(queryText)
		.endAt(`${queryText}\uf8ff`)
		.limit(12)
		.get();
	const results: { uid: string; displayName: string; relationship: string }[] = [];
	for (const item of snap.docs) {
		if (results.length >= 8) break;
		if (item.id === caller || !uidOk(item.id)) continue;
		const displayName = publicDisplayName(item.get('displayName'));
		if (!displayName) continue;
		if (!(await targetIsActive(item.id))) continue;
		results.push({ uid: item.id, displayName, relationship: await relationship(caller, item.id) });
	}
	return { results };
}

async function relationship(caller: string, other: string): Promise<string> {
	const db = getFirestore();
	const [buddy, outgoing, incoming, block] = await Promise.all([
		db.doc(`${BUDDY_COLLECTIONS.buddies}/${buddyPairId(caller, other)}`).get(),
		db.doc(`${BUDDY_COLLECTIONS.requests}/${buddyRequestId(caller, other)}`).get(),
		db.doc(`${BUDDY_COLLECTIONS.requests}/${buddyRequestId(other, caller)}`).get(),
		db.doc(`${BUDDY_COLLECTIONS.blocks}/${buddyBlockId(caller, other)}`).get()
	]);
	if (buddy.exists && buddy.get('status') === 'accepted') return 'buddy';
	if (block.exists) return 'blocked';
	if (outgoing.exists && outgoing.get('status') === 'pending') return 'outgoing';
	if (incoming.exists && incoming.get('status') === 'pending') return 'incoming';
	return 'none';
}

async function resolveTarget(caller: string, data: unknown): Promise<string> {
	const body = asObject(data);
	const hasCode = body.code != null && body.code !== '';
	const hasUid = body.targetUid != null && body.targetUid !== '';
	if (hasCode === hasUid) {
		throw new HttpsError('invalid-argument', 'Send a request with an invite code or a player from search.');
	}
	const db = getFirestore();
	if (hasCode) {
		const code = normalizeInviteCode(body.code);
		if (!code) throw new HttpsError('invalid-argument', INVITE_INVALID);
		const found = await db.collection(BUDDY_COLLECTIONS.invites).where('code', '==', code).limit(1).get();
		if (found.empty) throw new HttpsError('not-found', INVITE_INVALID);
		const target = found.docs[0].id;
		if (!uidOk(target)) throw new HttpsError('not-found', INVITE_INVALID);
		if (target === caller) throw new HttpsError('failed-precondition', 'That invite is yours. Share it with someone else.');
		return target;
	}
	const target = body.targetUid;
	if (!uidOk(target) || target === caller) {
		throw new HttpsError('invalid-argument', 'You cannot add yourself.');
	}
	const directory = await db.doc(`${BUDDY_COLLECTIONS.directory}/${target}`).get();
	if (!directory.exists || !publicDisplayName(directory.get('displayName'))) {
		throw new HttpsError('failed-precondition', UNAVAILABLE);
	}
	return target;
}

type GalleryTarget = { target: string; photoId: string; carName: string };

function requestModes(body: Record<string, unknown>): { code: boolean; uid: boolean; photo: boolean } {
	return {
		code: body.code != null && body.code !== '',
		uid: body.targetUid != null && body.targetUid !== '',
		photo: body.photoId != null && body.photoId !== ''
	};
}

async function resolveGalleryTarget(caller: string, photoId: unknown): Promise<GalleryTarget> {
	if (typeof photoId !== 'string' || !PHOTO_ID_PATTERN.test(photoId)) {
		throw new HttpsError('not-found', 'That photo is not in the gallery.');
	}
	const db = getFirestore();
	const [published, stored] = await Promise.all([
		db.doc(`sharedPhotos/${photoId}`).get(),
		db.doc(`sharedPhotoPrivate/${photoId}`).get()
	]);
	const owner = stored.get('ownerUid');
	const visible =
		published.exists &&
		published.get('hidden') === false &&
		published.get('published') === true &&
		published.get('showInGallery') === true;
	if (!visible || !uidOk(owner)) throw new HttpsError('not-found', 'That photo is not in the gallery.');
	if (owner === caller) throw new HttpsError('failed-precondition', 'That is your photo.');
	const invite = await db.doc(`${BUDDY_COLLECTIONS.invites}/${owner}`).get();
	if (!galleryBuddyRequestsAllowed(invite.get('galleryBuddyRequests'))) {
		throw new HttpsError('failed-precondition', UNAVAILABLE);
	}
	return {
		target: owner,
		photoId,
		carName: publicCarLabel({
			vehicleType: published.get('vehicleType'),
			caption: published.get('caption'),
			vehicleStats: published.get('vehicleStats')
		})
	};
}

export async function handleSendBuddyRequest(
	uid: string | undefined,
	data: unknown,
	nowMs = Date.now()
): Promise<{ status: 'pending' | 'sent'; requestId: string }> {
	const caller = await assertCaller(uid);
	const body = asObject(data);
	const modes = requestModes(body);
	const chosen = Number(modes.code) + Number(modes.uid) + Number(modes.photo);
	if (chosen !== 1) {
		throw new HttpsError('invalid-argument', 'Send a request with an invite code, a player from search, or a gallery photo.');
	}
	let message = '';
	if (modes.photo) {
		const note = buddyRequestMessage(body.message);
		if (note == null) throw new HttpsError('invalid-argument', 'Use a short note without an email address.');
		message = note;
	} else if (body.message != null && body.message !== '') {
		throw new HttpsError('invalid-argument', 'A note can only be sent with a gallery photo.');
	}
	logBuddy('send', caller);
	const db = getFirestore();
	const rateRef = db.doc(`${BUDDY_COLLECTIONS.rate}/${caller}`);
	await db.runTransaction(async (tx) => {
		const snap = await tx.get(rateRef);
		const hourly = rollingWindow(snap.get('requestAt'), nowMs, BUDDY_REQUESTS_PER_HOUR, BUDDY_RATE_WINDOW_MS);
		if (!hourly.allowed) throw new HttpsError('resource-exhausted', RATE_LIMITED);
		const patch: { requestAt: number[]; galleryRequestAt?: number[] } = { requestAt: hourly.stamps };
		if (modes.photo) {
			const daily = rollingWindow(
				snap.get('galleryRequestAt'),
				nowMs,
				BUDDY_GALLERY_REQUESTS_PER_DAY,
				BUDDY_GALLERY_RATE_WINDOW_MS
			);
			if (!daily.allowed) throw new HttpsError('resource-exhausted', RATE_LIMITED);
			patch.galleryRequestAt = daily.stamps;
		}
		tx.set(rateRef, patch, { merge: true });
	});
	const gallery = modes.photo ? await resolveGalleryTarget(caller, body.photoId) : null;
	const target = gallery ? gallery.target : await resolveTarget(caller, data);
	if (!(await targetIsActive(target))) throw new HttpsError('failed-precondition', UNAVAILABLE);
	const requestRef = db.doc(`${BUDDY_COLLECTIONS.requests}/${buddyRequestId(caller, target)}`);
	const reverseRef = db.doc(`${BUDDY_COLLECTIONS.requests}/${buddyRequestId(target, caller)}`);
	const buddyRef = db.doc(`${BUDDY_COLLECTIONS.buddies}/${buddyPairId(caller, target)}`);
	const blockOutRef = db.doc(`${BUDDY_COLLECTIONS.blocks}/${buddyBlockId(caller, target)}`);
	const blockInRef = db.doc(`${BUDDY_COLLECTIONS.blocks}/${buddyBlockId(target, caller)}`);
	const inviteRef = db.doc(`${BUDDY_COLLECTIONS.invites}/${target}`);
	const code = normalizeInviteCode(body.code);
	const fromName = await publicBuddyName(caller);
	const toName = await publicBuddyName(target);
	const stamp = iso(nowMs);
	const status = await db.runTransaction(async (tx) => {
		const [requestSnap, reverseSnap, buddySnap, blockOut, blockIn, inviteSnap] = await Promise.all([
			tx.get(requestRef),
			tx.get(reverseRef),
			tx.get(buddyRef),
			tx.get(blockOutRef),
			tx.get(blockInRef),
			tx.get(inviteRef)
		]);
		if (code && normalizeInviteCode(inviteSnap.get('code')) !== code) {
			throw new HttpsError('not-found', INVITE_INVALID);
		}
		if (gallery && !galleryBuddyRequestsAllowed(inviteSnap.get('galleryBuddyRequests'))) {
			throw new HttpsError('failed-precondition', UNAVAILABLE);
		}
		if (blockOut.exists) {
			throw new HttpsError('failed-precondition', 'You blocked this player. Unblock them before sending a request.');
		}
		if (blockIn.exists) throw new HttpsError('failed-precondition', UNAVAILABLE);
		if (buddySnap.exists && buddySnap.get('status') === 'accepted') {
			throw new HttpsError('already-exists', 'You are already gaming buddies.');
		}
		if (reverseSnap.exists && reverseSnap.get('status') === 'pending') {
			throw new HttpsError('failed-precondition', 'That player already sent you a request. Accept it from Gaming Buddies.');
		}
		if (requestSnap.exists && requestSnap.get('status') === 'pending') return 'pending' as const;
		if (
			requestSnap.exists &&
			requestSnap.get('status') === 'declined' &&
			declineCooldownActive(requestSnap.get('updatedAt'), nowMs)
		) {
			throw new HttpsError('failed-precondition', 'That player declined a request. You can try again in 30 days.');
		}
		const payload: Record<string, unknown> = {
			fromUid: caller,
			toUid: target,
			fromName,
			toName,
			status: 'pending',
			createdAt: stamp,
			updatedAt: stamp
		};
		if (gallery) {
			payload.source = 'gallery';
			payload.photoId = gallery.photoId;
			payload.carName = gallery.carName;
			if (message) payload.message = message;
		}
		tx.set(requestRef, payload);
		return 'sent' as const;
	});
	return { status, requestId: requestRef.id };
}

export async function handleGalleryBuddyOffer(
	uid: string | undefined,
	data: unknown,
	nowMs = Date.now()
): Promise<{ offer: GalleryBuddyOfferName; requestId?: string }> {
	const photoId = asObject(data).photoId;
	if (typeof photoId !== 'string' || !PHOTO_ID_PATTERN.test(photoId)) return { offer: 'hidden' };
	const db = getFirestore();
	const [published, stored] = await Promise.all([
		db.doc(`sharedPhotos/${photoId}`).get(),
		db.doc(`sharedPhotoPrivate/${photoId}`).get()
	]);
	const owner = stored.get('ownerUid');
	const visible =
		published.exists &&
		published.get('hidden') === false &&
		published.get('published') === true &&
		published.get('showInGallery') === true;
	if (!visible || !uidOk(owner)) return { offer: 'hidden' };
	const invite = await db.doc(`${BUDDY_COLLECTIONS.invites}/${owner}`).get();
	const allowed = galleryBuddyRequestsAllowed(invite.get('galleryBuddyRequests'));
	if (!uid) return { offer: allowed ? 'sign-in' : 'hidden' };
	const caller = await assertCaller(uid);
	if (caller === owner) return { offer: 'hidden' };
	const [buddy, outgoing, incoming, blockOut, blockIn] = await Promise.all([
		db.doc(`${BUDDY_COLLECTIONS.buddies}/${buddyPairId(caller, owner)}`).get(),
		db.doc(`${BUDDY_COLLECTIONS.requests}/${buddyRequestId(caller, owner)}`).get(),
		db.doc(`${BUDDY_COLLECTIONS.requests}/${buddyRequestId(owner, caller)}`).get(),
		db.doc(`${BUDDY_COLLECTIONS.blocks}/${buddyBlockId(caller, owner)}`).get(),
		db.doc(`${BUDDY_COLLECTIONS.blocks}/${buddyBlockId(owner, caller)}`).get()
	]);
	if (blockOut.exists || blockIn.exists) return { offer: 'hidden' };
	if (buddy.exists && buddy.get('status') === 'accepted') return { offer: 'buddies' };
	if (outgoing.exists && outgoing.get('status') === 'pending') {
		return { offer: 'sent', requestId: outgoing.id };
	}
	if (incoming.exists && incoming.get('status') === 'pending') {
		return { offer: 'accept', requestId: incoming.id };
	}
	if (!allowed) return { offer: 'hidden' };
	if (outgoing.exists && outgoing.get('status') === 'declined' && declineCooldownActive(outgoing.get('updatedAt'), nowMs)) {
		return { offer: 'declined' };
	}
	return { offer: 'add' };
}

export async function handleRespondBuddyRequest(
	uid: string | undefined,
	data: unknown,
	nowMs = Date.now()
): Promise<{ status: BuddyAction }> {
	const caller = await assertCaller(uid);
	const body = asObject(data);
	const action = body.action;
	if (action !== 'accept' && action !== 'decline' && action !== 'block') {
		throw new HttpsError('invalid-argument', 'Choose accept, decline, or block.');
	}
	const requestId = body.requestId;
	if (typeof requestId !== 'string' || !requestId.includes('~')) {
		throw new HttpsError('invalid-argument', 'That request was not found.');
	}
	logBuddy(action, caller);
	const db = getFirestore();
	const requestRef = db.doc(`${BUDDY_COLLECTIONS.requests}/${requestId}`);
	const preview = await requestRef.get();
	if (!preview.exists) throw new HttpsError('not-found', 'That request was not found.');
	if (preview.get('toUid') !== caller) throw new HttpsError('permission-denied', 'You cannot respond to that request.');
	const fromUid = preview.get('fromUid');
	if (!uidOk(fromUid)) throw new HttpsError('not-found', 'That request was not found.');
	if (action === 'accept' && !(await targetIsActive(fromUid))) {
		throw new HttpsError('failed-precondition', UNAVAILABLE);
	}
	const fromName = publicDisplayName(preview.get('fromName')) ?? (await publicBuddyName(fromUid));
	const toName = publicDisplayName(preview.get('toName')) ?? (await publicBuddyName(caller));
	const stamp = iso(nowMs);
	const buddyRef = db.doc(`${BUDDY_COLLECTIONS.buddies}/${buddyPairId(caller, fromUid)}`);
	const blockRef = db.doc(`${BUDDY_COLLECTIONS.blocks}/${buddyBlockId(caller, fromUid)}`);
	const outcome = await db.runTransaction(async (tx) => {
		const requestSnap = await tx.get(requestRef);
		const buddySnap = await tx.get(buddyRef);
		if (!requestSnap.exists) return 'missing';
		if (requestSnap.get('toUid') !== caller || requestSnap.get('fromUid') !== fromUid) return 'forbidden';
		if (requestSnap.get('status') !== 'pending') return 'not-pending';
		if (action === 'accept') {
			tx.set(buddyRef, {
				members: [caller, fromUid].sort(),
				status: 'accepted',
				names: { [caller]: toName, [fromUid]: fromName },
				createdAt: buddySnap.get('createdAt') || stamp,
				updatedAt: stamp
			});
			tx.delete(requestRef);
			return 'accept';
		}
		if (action === 'decline') {
			tx.update(requestRef, { status: 'declined', updatedAt: stamp });
			return 'decline';
		}
		tx.set(blockRef, { blockerUid: caller, blockedUid: fromUid, createdAt: stamp });
		tx.update(requestRef, { status: 'blocked', updatedAt: stamp });
		if (buddySnap.exists) tx.delete(buddyRef);
		return 'block';
	});
	if (outcome === 'missing') throw new HttpsError('not-found', 'That request was not found.');
	if (outcome === 'forbidden') throw new HttpsError('permission-denied', 'You cannot respond to that request.');
	if (outcome === 'not-pending') throw new HttpsError('failed-precondition', 'That request is no longer pending.');
	return { status: outcome };
}

export async function handleCancelBuddyRequest(
	uid: string | undefined,
	data: unknown
): Promise<{ status: 'cancelled' }> {
	const caller = await assertCaller(uid);
	const requestId = asObject(data).requestId;
	if (typeof requestId !== 'string' || !requestId.includes('~')) {
		throw new HttpsError('invalid-argument', 'That request was not found.');
	}
	logBuddy('cancel', caller);
	const ref = getFirestore().doc(`${BUDDY_COLLECTIONS.requests}/${requestId}`);
	const outcome = await getFirestore().runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		if (!snap.exists) return 'missing';
		if (snap.get('fromUid') !== caller) return 'forbidden';
		if (snap.get('status') !== 'pending') return 'not-pending';
		tx.delete(ref);
		return 'cancelled';
	});
	if (outcome === 'forbidden') throw new HttpsError('permission-denied', 'You cannot cancel that request.');
	if (outcome === 'not-pending') throw new HttpsError('failed-precondition', 'That request is no longer pending.');
	return { status: 'cancelled' };
}

export async function handleRemoveBuddy(
	uid: string | undefined,
	data: unknown
): Promise<{ status: 'removed' }> {
	const caller = await assertCaller(uid);
	const otherUid = asObject(data).otherUid;
	if (!uidOk(otherUid) || otherUid === caller) {
		throw new HttpsError('invalid-argument', 'Choose a buddy to remove.');
	}
	logBuddy('remove', caller);
	const db = getFirestore();
	const buddyRef = db.doc(`${BUDDY_COLLECTIONS.buddies}/${buddyPairId(caller, otherUid)}`);
	const sentRef = db.doc(`${BUDDY_COLLECTIONS.requests}/${buddyRequestId(caller, otherUid)}`);
	const receivedRef = db.doc(`${BUDDY_COLLECTIONS.requests}/${buddyRequestId(otherUid, caller)}`);
	const outcome = await db.runTransaction(async (tx) => {
		const [buddySnap, sentSnap, receivedSnap] = await Promise.all([
			tx.get(buddyRef),
			tx.get(sentRef),
			tx.get(receivedRef)
		]);
		if (buddySnap.exists) {
			const members = buddySnap.get('members');
			if (!Array.isArray(members) || !members.includes(caller)) return 'forbidden';
			tx.delete(buddyRef);
		}
		if (sentSnap.exists && sentSnap.get('fromUid') === caller) tx.delete(sentRef);
		if (receivedSnap.exists && receivedSnap.get('toUid') === caller) tx.delete(receivedRef);
		return buddySnap.exists ? 'removed' : 'missing';
	});
	if (outcome === 'forbidden') throw new HttpsError('permission-denied', 'You cannot remove that buddy.');
	return { status: 'removed' };
}

export async function handleUnblockBuddy(
	uid: string | undefined,
	data: unknown
): Promise<{ status: 'unblocked' }> {
	const caller = await assertCaller(uid);
	const otherUid = asObject(data).otherUid;
	if (!uidOk(otherUid) || otherUid === caller) {
		throw new HttpsError('invalid-argument', 'Choose a player to unblock.');
	}
	logBuddy('unblock', caller);
	const ref = getFirestore().doc(`${BUDDY_COLLECTIONS.blocks}/${buddyBlockId(caller, otherUid)}`);
	const snap = await ref.get();
	if (snap.exists && snap.get('blockerUid') === caller) await ref.delete();
	return { status: 'unblocked' };
}

export const getBuddyInvite = onCall(
	{ ...buddyCallableOptions, secrets: [twilioAccountSid, twilioAuthToken] },
	async (request) => {
		return handleGetBuddyInvite(
			request.auth?.uid,
			Date.now(),
			twilioEmailConfigured(twilioAccountSid.value(), twilioAuthToken.value())
		);
	}
);

export const saveBuddyProfile = onCall(buddyCallableOptions, async (request) => {
	return handleSaveBuddyProfile(request.auth?.uid, request.data);
});

export const searchBuddyPlayers = onCall(buddyCallableOptions, async (request) => {
	return handleSearchBuddyPlayers(request.auth?.uid, request.data);
});

export const sendBuddyRequest = onCall(buddyCallableOptions, async (request) => {
	return handleSendBuddyRequest(request.auth?.uid, request.data);
});

export const galleryBuddyOffer = onCall(buddyCallableOptions, async (request) => {
	return handleGalleryBuddyOffer(request.auth?.uid, request.data);
});

export const respondBuddyRequest = onCall(buddyCallableOptions, async (request) => {
	return handleRespondBuddyRequest(request.auth?.uid, request.data);
});

export const cancelBuddyRequest = onCall(buddyCallableOptions, async (request) => {
	return handleCancelBuddyRequest(request.auth?.uid, request.data);
});

export const removeBuddy = onCall(buddyCallableOptions, async (request) => {
	return handleRemoveBuddy(request.auth?.uid, request.data);
});

export const unblockBuddy = onCall(buddyCallableOptions, async (request) => {
	return handleUnblockBuddy(request.auth?.uid, request.data);
});
