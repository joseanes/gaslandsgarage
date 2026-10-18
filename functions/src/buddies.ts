import { createHash, randomInt } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
	BUDDY_COLLECTIONS,
	BUDDY_RATE_WINDOW_MS,
	BUDDY_REQUESTS_PER_HOUR,
	BUDDY_SEARCHES_PER_HOUR,
	buddyBlockId,
	buddyPairId,
	buddyRequestId,
	createInviteCode,
	displayNameKey,
	normalizeInviteCode,
	normalizeSearchQuery,
	publicDisplayName,
	rollingWindow,
	uidOk
} from '../../app/src/lib/buddies/model.ts';

export const BUDDY_REGION = 'us-central1';
const UNAVAILABLE = 'That player is not available to add.';
const INVITE_INVALID = 'That invite is not valid.';
const RATE_LIMITED = 'Too many requests. Try again later.';
const FALLBACK_NAME = 'Player';

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

async function assertCaller(uid: string | undefined): Promise<string> {
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

async function targetIsActive(uid: string): Promise<boolean> {
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
	const [invite, directory, profile] = await Promise.all([
		db.doc(`${BUDDY_COLLECTIONS.invites}/${uid}`).get(),
		db.doc(`${BUDDY_COLLECTIONS.directory}/${uid}`).get(),
		db.doc(`users/${uid}`).get()
	]);
	const stored =
		publicDisplayName(invite.get('displayName')) ??
		publicDisplayName(directory.get('displayName')) ??
		publicDisplayName(profile.get('displayName'));
	if (stored) return stored;
	try {
		const record = await getAuth().getUser(uid);
		return publicDisplayName(record.displayName) ?? FALLBACK_NAME;
	} catch (error) {
		if (isUserNotFound(error)) return FALLBACK_NAME;
		throw error;
	}
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

export async function handleGetBuddyInvite(uid: string | undefined, nowMs = Date.now()): Promise<{
	code: string;
	displayName: string;
	discoverable: boolean;
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
	return { code, displayName, discoverable: directory.exists };
}

export async function handleSaveBuddyProfile(
	uid: string | undefined,
	data: unknown,
	nowMs = Date.now()
): Promise<{ displayName: string; discoverable: boolean }> {
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
	await db.runTransaction(async (tx) => {
		const invite = await tx.get(inviteRef);
		tx.set(
			inviteRef,
			{
				code: normalizeInviteCode(invite.get('code')) ?? code,
				displayName: name,
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
	});
	return { displayName: name, discoverable };
}

async function consumeRate(
	tx: Transaction,
	ref: DocumentReference,
	field: 'requestAt' | 'searchAt',
	max: number,
	nowMs: number
): Promise<void> {
	const snap = await tx.get(ref);
	const next = rollingWindow(snap.get(field), nowMs, max, BUDDY_RATE_WINDOW_MS);
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
		await consumeRate(tx, rateRef, 'searchAt', BUDDY_SEARCHES_PER_HOUR, nowMs);
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

export async function handleSendBuddyRequest(
	uid: string | undefined,
	data: unknown,
	nowMs = Date.now()
): Promise<{ status: 'pending' | 'sent'; requestId: string }> {
	const caller = await assertCaller(uid);
	const body = asObject(data);
	const hasCode = body.code != null && body.code !== '';
	const hasUid = body.targetUid != null && body.targetUid !== '';
	if (hasCode === hasUid) {
		throw new HttpsError('invalid-argument', 'Send a request with an invite code or a player from search.');
	}
	logBuddy('send', caller);
	const db = getFirestore();
	const rateRef = db.doc(`${BUDDY_COLLECTIONS.rate}/${caller}`);
	await db.runTransaction(async (tx) => {
		await consumeRate(tx, rateRef, 'requestAt', BUDDY_REQUESTS_PER_HOUR, nowMs);
	});
	const target = await resolveTarget(caller, data);
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
		tx.set(requestRef, {
			fromUid: caller,
			toUid: target,
			fromName,
			toName,
			status: 'pending',
			createdAt: stamp,
			updatedAt: stamp
		});
		return 'sent' as const;
	});
	return { status, requestId: requestRef.id };
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

export const getBuddyInvite = onCall(buddyCallableOptions, async (request) => {
	return handleGetBuddyInvite(request.auth?.uid);
});

export const saveBuddyProfile = onCall(buddyCallableOptions, async (request) => {
	return handleSaveBuddyProfile(request.auth?.uid, request.data);
});

export const searchBuddyPlayers = onCall(buddyCallableOptions, async (request) => {
	return handleSearchBuddyPlayers(request.auth?.uid, request.data);
});

export const sendBuddyRequest = onCall(buddyCallableOptions, async (request) => {
	return handleSendBuddyRequest(request.auth?.uid, request.data);
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
