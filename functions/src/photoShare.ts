import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type DocumentReference, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentDeleted, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { BUDDY_COLLECTIONS, buddyPairId, chosenBuddyName, uidOk } from '../../app/src/lib/buddies/model.ts';
import {
	PHOTO_ID_PATTERN,
	TEAM_ID_PATTERN,
	UID_PATTERN,
	VEHICLE_ID_PATTERN,
	isPhotoContentType,
	storageBucketForProject,
	type PhotoContentType
} from '../../app/src/lib/photos/model.ts';
import { attachmentsFromData, shareSource } from '../../app/src/lib/photos/library.ts';
import {
	REPORT_HIDE_THRESHOLD,
	anyShareFlag,
	cleanTeamName,
	galleryPublished,
	nextReportWindow,
	photoReportId,
	publicSharedPhoto,
	sanitizeVehicleStats,
	sharedPhotoSearchPatch,
	shareFlags,
	sharedPhotoObjectPath,
	vehicleTypeLabel
} from '../../app/src/lib/photos/share.ts';
import { galleryVehicleTypes } from '../../app/src/lib/photos/galleryQuery.ts';
import { normalizePaintingUrl } from '../../app/src/lib/photos/link.ts';
import { vehicleStatsSnapshot } from '../../app/src/lib/photos/vehicleStats.ts';

const REGION = 'us-central1';
const CALL = { region: REGION, memory: '256MiB', timeoutSeconds: 60, maxInstances: 10 } as const;

export interface VisibleTeamPhoto {
	photoId: string;
	vehicleId: string;
	vehicleType: string;
	teamName: string;
	caption: string;
	displayName: string;
	createdAt: string;
	contentType: PhotoContentType;
}

function httpsError(error: unknown): HttpsError {
	if (error instanceof HttpsError) return error;
	const message = error instanceof Error ? error.message : 'That photo could not be updated.';
	const code = /sign in/i.test(message)
		? 'unauthenticated'
		: /Administrator/i.test(message)
			? 'permission-denied'
			: /enough photos|disabled/i.test(message)
				? 'resource-exhausted'
				: /not available|not found|not on this team|not in the gallery/i.test(message)
					? 'not-found'
					: 'invalid-argument';
	return new HttpsError(code, message);
}

async function assertActive(uid: string | undefined): Promise<string> {
	if (!uid || !UID_PATTERN.test(uid)) throw new HttpsError('unauthenticated', 'Sign in required.');
	const user = await getAuth().getUser(uid).catch((error: { code?: string }) => {
		if (error?.code === 'auth/user-not-found') throw new HttpsError('unauthenticated', 'Sign in required.');
		throw error;
	});
	if (user.disabled) throw new HttpsError('permission-denied', 'This account is disabled.');
	const adminDoc = await getFirestore().doc(`adminUsers/${uid}`).get();
	if (adminDoc.exists && adminDoc.get('disabled') === true) {
		throw new HttpsError('permission-denied', 'This account is disabled.');
	}
	return uid;
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function bucket() {
	return getStorage().bucket(storageBucketForProject(
		process.env.FIREBASE_STORAGE_BUCKET ?? '',
		process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? ''
	));
}

async function ignoreMissingBucket(task: () => Promise<void>): Promise<void> {
	try {
		await task();
	} catch (error) {
		const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : 0;
		if (code === 404) return;
		throw error;
	}
}

async function deleteSharedObject(photoId: string): Promise<void> {
	if (!PHOTO_ID_PATTERN.test(photoId)) return;
	await ignoreMissingBucket(async () => {
		await bucket().file(sharedPhotoObjectPath(photoId)).delete({ ignoreNotFound: true });
	});
}

async function deleteDocs(refs: DocumentReference[]): Promise<void> {
	const db = getFirestore();
	for (let index = 0; index < refs.length; index += 400) {
		const slice = refs.slice(index, index + 400);
		if (slice.length === 0) continue;
		const batch = db.batch();
		for (const ref of slice) batch.delete(ref);
		await batch.commit();
	}
}

async function reportRefs(photoId: string): Promise<DocumentReference[]> {
	const snap = await getFirestore().collection('photoReports').where('photoId', '==', photoId).get();
	return snap.docs.map((item) => item.ref);
}

/** Removes the shared file and both metadata documents. Reports stay unless dropReports is set. */
export async function removeSharedCopy(photoId: string, dropReports = false): Promise<void> {
	if (!PHOTO_ID_PATTERN.test(photoId)) return;
	await deleteSharedObject(photoId);
	const db = getFirestore();
	const refs = [db.doc(`sharedPhotos/${photoId}`), db.doc(`sharedPhotoPrivate/${photoId}`)];
	if (dropReports) refs.push(...(await reportRefs(photoId)));
	await deleteDocs(refs);
}

export async function deleteSharedPhotosForOwner(uid: string): Promise<void> {
	if (!UID_PATTERN.test(uid)) return;
	const snap = await getFirestore().collection('sharedPhotoPrivate').where('ownerUid', '==', uid).get();
	for (const item of snap.docs) await removeSharedCopy(item.id, true);
}

/** Reports this player filed, and their rate-limit record. Their own photos are removed separately. */
export async function deleteReporterPhotoState(uid: string): Promise<void> {
	if (!UID_PATTERN.test(uid)) return;
	const db = getFirestore();
	await db.doc(`photoReportRate/${uid}`).delete().catch(() => undefined);
	const reports = await db.collection('photoReports').where('reporterUid', '==', uid).get();
	await deleteDocs(reports.docs.map((item) => item.ref));
}

async function copySharedObject(sourcePath: string, photoId: string, contentType: PhotoContentType): Promise<void> {
	const source = bucket().file(sourcePath);
	const [exists] = await source.exists();
	if (!exists) throw new Error('Upload the photo before sharing it.');
	const target = bucket().file(sharedPhotoObjectPath(photoId));
	await source.copy(target);
	await target.setMetadata({
		contentType,
		metadata: { firebaseStorageDownloadTokens: '' }
	});
}

async function displayNameFor(uid: string): Promise<string> {
	const db = getFirestore();
	const [invite, profile] = await Promise.all([
		db.doc(`${BUDDY_COLLECTIONS.invites}/${uid}`).get(),
		db.doc(`playerProfiles/${uid}`).get()
	]);
	return chosenBuddyName(invite.get('displayName'), profile.get('playerName'));
}

async function approvalRequired(): Promise<boolean> {
	const config = await getFirestore().doc('config/gallery').get();
	return config.get('requireApproval') === true;
}

function vehicleOnTeam(team: Record<string, unknown> | undefined, vehicleId: string): Record<string, unknown> | null {
	const rows = asRecord(team?.teamData).vehicles;
	if (!Array.isArray(rows)) return null;
	const found = rows.map((entry) => asRecord(entry)).find((entry) => entry.id === vehicleId);
	return found ?? null;
}

export async function setPhotoSharingForUser(
	uid: string,
	input: {
		photoId: unknown;
		showToBuddies: unknown;
		showOnShareLink: unknown;
		showInGallery: unknown;
		shareVehicleStats?: unknown;
		shareTeamId?: unknown;
		shareVehicleId?: unknown;
		vehicleType?: unknown;
		paintingUrl?: unknown;
	}
): Promise<{ shared: boolean; published: boolean; hidden: boolean }> {
	if (!UID_PATTERN.test(uid)) throw new Error('Sign in again before sharing a photo.');
	if (!PHOTO_ID_PATTERN.test(String(input.photoId ?? ''))) throw new Error('That photo was not found.');
	const photoId = String(input.photoId);
	const flags = shareFlags({
		showToBuddies: input.showToBuddies === true,
		showOnShareLink: input.showOnShareLink === true,
		showInGallery: input.showInGallery === true,
		shareVehicleStats: input.shareVehicleStats === true
	});
	const db = getFirestore();
	const photoRef = db.doc(`users/${uid}/photos/${photoId}`);
	const photo = await photoRef.get();
	if (!photo.exists || photo.get('userId') !== uid) throw new Error('That photo was not found.');

	if (!anyShareFlag(flags)) {
		await removeSharedCopy(photoId, false);
		await photoRef.set(
			{
				showToBuddies: false,
				showOnShareLink: false,
				showInGallery: false,
				shareVehicleStats: flags.shareVehicleStats
			},
			{ merge: true }
		);
		return { shared: false, published: false, hidden: false };
	}

	const contentType = photo.get('contentType');
	if (!isPhotoContentType(contentType)) throw new Error('That photo could not be shared.');
	const createdAt = String(photo.get('createdAt') ?? '');
	if (!createdAt || createdAt.length > 40) throw new Error('That photo could not be shared.');

	const attachments = attachmentsFromData(photo.data());
	const askedTeam = String(input.shareTeamId ?? '');
	const askedVehicle = String(input.shareVehicleId ?? '');
	const askedForCar = TEAM_ID_PATTERN.test(askedTeam) && VEHICLE_ID_PATTERN.test(askedVehicle);
	const unlinked = attachments.length === 0 && !askedForCar;
	let teamId = '';
	let vehicleId = '';
	let vehicleType = '';
	let teamName = '';
	let vehicleStats: ReturnType<typeof vehicleStatsSnapshot> | undefined;
	if (unlinked) {
		if (flags.showToBuddies || flags.showOnShareLink || flags.shareVehicleStats) {
			throw new Error('Link this photo to one of your cars before sharing its stats or team.');
		}
		vehicleType = listedGalleryType(input.vehicleType);
	} else {
		const source = shareSource(attachments, input.shareTeamId, input.shareVehicleId);
		teamId = source.teamId;
		vehicleId = source.vehicleId;
		if (!TEAM_ID_PATTERN.test(teamId)) throw new Error('Save this team before sharing a photo.');
		const team = await db.doc(`teams/${teamId}`).get();
		if (!team.exists || team.get('userId') !== uid) throw new Error('Save this team before sharing a photo.');
		const vehicle = vehicleOnTeam(team.data(), vehicleId);
		if (!vehicle) throw new Error('That vehicle is not on this team.');
		vehicleType = vehicleTypeLabel(vehicle.type);
		teamName = cleanTeamName(team.get('teamName'));
		const teamData = asRecord(team.get('teamData'));
		vehicleStats = flags.shareVehicleStats ? vehicleStatsSnapshot(vehicle, teamData.rulesVersion) : undefined;
	}

	const privateRef = db.doc(`sharedPhotoPrivate/${photoId}`);
	const existing = await privateRef.get();
	const reports = await db.collection('photoReports').where('photoId', '==', photoId).get();
	const hidden = existing.get('hidden') === true || reports.size >= REPORT_HIDE_THRESHOLD;
	const published = galleryPublished(flags, await approvalRequired(), {
		showInGallery: existing.get('showInGallery') === true,
		published: existing.get('published') === true
	});
	const displayName = await displayNameFor(uid);
	const caption = typeof photo.get('caption') === 'string' ? photo.get('caption') : '';
	const paintingUrl = paintingUrlForShare(photo.get('paintingUrl'), input.paintingUrl);
	const publicDoc = publicSharedPhoto({
		photoId,
		displayName,
		vehicleType,
		teamName,
		caption,
		createdAt,
		hidden,
		published,
		showInGallery: flags.showInGallery,
		vehicleStats,
		paintingUrl
	});
	const privateDoc = {
		ownerUid: uid,
		teamId,
		vehicleId,
		vehicleType,
		teamName,
		caption: publicDoc.caption,
		displayName,
		contentType,
		createdAt,
		hidden,
		published,
		showToBuddies: flags.showToBuddies,
		showOnShareLink: flags.showOnShareLink,
		showInGallery: flags.showInGallery,
		shareVehicleStats: flags.shareVehicleStats,
		paintingUrl,
		reportCount: reports.size
	};

	await copySharedObject(String(photo.get('path')), photoId, contentType);
	const photoPatch: Record<string, unknown> = { ...flags, paintingUrl };
	if (!unlinked) {
		photoPatch.shareTeamId = teamId;
		photoPatch.shareVehicleId = vehicleId;
		photoPatch.teamId = teamId;
		photoPatch.vehicleId = vehicleId;
	}
	const invite = await db.doc(`${BUDDY_COLLECTIONS.invites}/${uid}`).get();
	const card =
		invite.get('galleryBuddyRequests') === false ? { ...publicDoc, allowGalleryBuddies: false } : publicDoc;
	const batch = db.batch();
	batch.set(db.doc(`sharedPhotos/${photoId}`), card);
	batch.set(privateRef, privateDoc);
	batch.set(photoRef, photoPatch, { merge: true });
	await batch.commit();
	return { shared: true, published, hidden };
}

/** A caller-supplied link replaces the stored one. A missing value keeps what the photo already has. */
function paintingUrlForShare(stored: unknown, override: unknown): string {
	if (override !== undefined) return normalizePaintingUrl(override);
	try {
		return normalizePaintingUrl(stored);
	} catch {
		return '';
	}
}

export async function setPhotoPaintingUrlForUser(uid: string, photoIdInput: unknown, rawUrl: unknown): Promise<{ paintingUrl: string }> {
	if (!UID_PATTERN.test(uid)) throw new Error('Sign in again before saving a link.');
	if (!PHOTO_ID_PATTERN.test(String(photoIdInput ?? ''))) throw new Error('That photo was not found.');
	const paintingUrl = normalizePaintingUrl(rawUrl);
	const photoId = String(photoIdInput);
	const db = getFirestore();
	const photoRef = db.doc(`users/${uid}/photos/${photoId}`);
	const photo = await photoRef.get();
	if (!photo.exists || photo.get('userId') !== uid) throw new Error('That photo was not found.');
	const batch = db.batch();
	batch.set(photoRef, { paintingUrl }, { merge: true });
	const publicRef = db.doc(`sharedPhotos/${photoId}`);
	const published = await publicRef.get();
	if (published.exists) batch.set(publicRef, { paintingUrl }, { merge: true });
	const privateRef = db.doc(`sharedPhotoPrivate/${photoId}`);
	const priv = await privateRef.get();
	if (priv.exists) batch.set(privateRef, { paintingUrl }, { merge: true });
	await batch.commit();
	return { paintingUrl };
}

/** A gallery upload with no car may name a game vehicle type. Anything else is rejected. */
function listedGalleryType(value: unknown): string {
	if (typeof value !== 'string') throw new Error('Choose a vehicle type.');
	const label = value.replace(/[\u0000-\u001f]/g, '').trim().replace(/\s+/g, ' ');
	if (!galleryVehicleTypes().includes(label)) throw new Error('Choose a vehicle type.');
	return label;
}

function visibleCard(item: QueryDocumentSnapshot): VisibleTeamPhoto | null {
	const contentType = item.get('contentType');
	const photoId = PHOTO_ID_PATTERN.test(item.id) ? item.id : '';
	if (!photoId || !isPhotoContentType(contentType)) return null;
	if (item.get('hidden') === true) return null;
	return {
		photoId,
		vehicleId: String(item.get('vehicleId') ?? ''),
		vehicleType: String(item.get('vehicleType') ?? 'Vehicle'),
		teamName: cleanTeamName(item.get('teamName')),
		caption: typeof item.get('caption') === 'string' ? item.get('caption') : '',
		displayName: String(item.get('displayName') ?? ''),
		createdAt: String(item.get('createdAt') ?? ''),
		contentType
	};
}

async function acceptedBuddy(caller: string, ownerUid: string): Promise<boolean> {
	if (!uidOk(caller) || !uidOk(ownerUid) || caller === ownerUid) return false;
	const buddy = await getFirestore().doc(`${BUDDY_COLLECTIONS.buddies}/${buddyPairId(caller, ownerUid)}`).get();
	const members = buddy.get('members');
	return (
		buddy.get('status') === 'accepted' &&
		Array.isArray(members) &&
		members.length === 2 &&
		members.includes(caller) &&
		members.includes(ownerUid)
	);
}

export async function listVisibleTeamPhotosForCaller(
	uid: string | undefined,
	input: { teamId: unknown; audience: unknown }
): Promise<{ photos: VisibleTeamPhoto[] }> {
	const teamId = String(input.teamId ?? '');
	if (!TEAM_ID_PATTERN.test(teamId)) return { photos: [] };
	const audience = input.audience === 'buddies' || input.audience === 'link' ? input.audience : '';
	if (!audience) throw new Error('Those photos are not available.');
	const db = getFirestore();
	const team = await db.doc(`teams/${teamId}`).get();
	if (!team.exists) return { photos: [] };
	const ownerUid = String(team.get('userId') ?? '');
	if (audience === 'buddies') {
		if (!uid || !UID_PATTERN.test(uid)) throw new Error('Sign in to view buddy photos.');
		if (team.get('hiddenFromBuddies') !== false) return { photos: [] };
		const ownerDisabled = await db.doc(`adminUsers/${ownerUid}`).get();
		if (ownerDisabled.get('disabled') === true) return { photos: [] };
		if (!(await acceptedBuddy(uid, ownerUid))) throw new Error('Those photos are not available.');
	}
	const snap = await db.collection('sharedPhotoPrivate').where('teamId', '==', teamId).get();
	const photos = snap.docs
		.map((item) => visibleCard(item))
		.filter((item): item is VisibleTeamPhoto => item != null)
		.filter((item) => {
			const source = snap.docs.find((entry) => entry.id === item.photoId);
			if (!source) return false;
			return audience === 'link' ? source.get('showOnShareLink') === true : source.get('showToBuddies') === true;
		})
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	return { photos };
}

export async function reportPhotoForUser(
	uid: string,
	photoIdInput: unknown,
	nowMs = Date.now()
): Promise<{ alreadyReported: boolean; hidden: boolean }> {
	if (!UID_PATTERN.test(uid)) throw new Error('Sign in again before reporting a photo.');
	if (!PHOTO_ID_PATTERN.test(String(photoIdInput ?? ''))) throw new Error('That photo is not in the gallery.');
	const photoId = String(photoIdInput);
	const db = getFirestore();
	return db.runTransaction(async (tx) => {
		const reportRef = db.doc(`photoReports/${photoReportId(photoId, uid)}`);
		const rateRef = db.doc(`photoReportRate/${uid}`);
		const publicRef = db.doc(`sharedPhotos/${photoId}`);
		const privateRef = db.doc(`sharedPhotoPrivate/${photoId}`);
		const reportQuery = db.collection('photoReports').where('photoId', '==', photoId);
		const [report, rate, publishedDoc, stored, existing] = await Promise.all([
			tx.get(reportRef),
			tx.get(rateRef),
			tx.get(publicRef),
			tx.get(privateRef),
			tx.get(reportQuery)
		]);
		if (!publishedDoc.exists || publishedDoc.get('showInGallery') !== true) throw new Error('That photo is not in the gallery.');
		if (report.exists) return { alreadyReported: true, hidden: publishedDoc.get('hidden') === true };
		const window = nextReportWindow(rate.get('at'), nowMs);
		if (!window.allowed) throw new Error('You have reported enough photos for now. Try again later.');
		const count = existing.size + 1;
		const hidden = publishedDoc.get('hidden') === true || count >= REPORT_HIDE_THRESHOLD;
		tx.set(rateRef, { at: window.stamps });
		tx.set(reportRef, { photoId, reporterUid: uid, createdAt: new Date(nowMs).toISOString() });
		tx.set(publicRef, { hidden }, { merge: true });
		if (stored.exists) tx.set(privateRef, { hidden, reportCount: count }, { merge: true });
		return { alreadyReported: false, hidden };
	});
}

export interface ModerationPhoto {
	photoId: string;
	displayName: string;
	vehicleType: string;
	teamName: string;
	caption: string;
	createdAt: string;
	hidden: boolean;
	published: boolean;
	showInGallery: boolean;
	showToBuddies: boolean;
	showOnShareLink: boolean;
	reportCount: number;
	contentType: PhotoContentType;
	ownerUid: string;
}

async function assertAdmin(uid: string): Promise<void> {
	if (!UID_PATTERN.test(uid)) throw new Error('You need the Administrator role.');
	const db = getFirestore();
	const [role, disabled] = await Promise.all([db.doc(`roles/${uid}`).get(), db.doc(`adminUsers/${uid}`).get()]);
	if (role.get('role') !== 'Administrator' || disabled.get('disabled') === true) {
		throw new Error('You need the Administrator role.');
	}
}

function moderationCard(item: QueryDocumentSnapshot): ModerationPhoto | null {
	const contentType = item.get('contentType');
	if (!isPhotoContentType(contentType)) return null;
	return {
		photoId: item.id,
		displayName: String(item.get('displayName') ?? ''),
		vehicleType: String(item.get('vehicleType') ?? 'Vehicle'),
		teamName: cleanTeamName(item.get('teamName')),
		caption: typeof item.get('caption') === 'string' ? item.get('caption') : '',
		createdAt: String(item.get('createdAt') ?? ''),
		hidden: item.get('hidden') === true,
		published: item.get('published') === true,
		showInGallery: item.get('showInGallery') === true,
		showToBuddies: item.get('showToBuddies') === true,
		showOnShareLink: item.get('showOnShareLink') === true,
		reportCount: typeof item.get('reportCount') === 'number' ? item.get('reportCount') : 0,
		contentType,
		ownerUid: String(item.get('ownerUid') ?? '')
	};
}

export async function moderateGalleryForAdmin(
	uid: string,
	input: Record<string, unknown>
): Promise<{ requireApproval: boolean; photos?: ModerationPhoto[] }> {
	await assertAdmin(uid);
	const db = getFirestore();
	const action = String(input.action ?? 'list');
	if (action === 'setRequireApproval') {
		const enabled = input.requireApproval === true;
		await db.doc('config/gallery').set({ requireApproval: enabled, updatedAt: new Date().toISOString() });
		return { requireApproval: enabled };
	}
	if (action === 'hide' || action === 'approve' || action === 'remove') {
		const photoId = String(input.photoId ?? '');
		if (!PHOTO_ID_PATTERN.test(photoId)) throw new Error('That photo was not found.');
		if (action === 'remove') {
			const stored = await db.doc(`sharedPhotoPrivate/${photoId}`).get();
			const ownerUid = String(stored.get('ownerUid') ?? '');
			await removeSharedCopy(photoId, true);
			if (UID_PATTERN.test(ownerUid)) {
				const owned = db.doc(`users/${ownerUid}/photos/${photoId}`);
				const photo = await owned.get();
				if (photo.exists) {
					await owned.set(
						{ showToBuddies: false, showOnShareLink: false, showInGallery: false, shareVehicleStats: false },
						{ merge: true }
					);
				}
			}
		} else {
			const patch = action === 'hide' ? { hidden: true } : { hidden: false, published: true };
			await db.doc(`sharedPhotos/${photoId}`).set(patch, { merge: true });
			await db.doc(`sharedPhotoPrivate/${photoId}`).set(patch, { merge: true });
		}
	} else if (action !== 'list') {
		throw new Error('That action is not available.');
	}
	const [config, snap] = await Promise.all([
		db.doc('config/gallery').get(),
		db.collection('sharedPhotoPrivate').orderBy('createdAt', 'desc').limit(200).get()
	]);
	return {
		requireApproval: config.get('requireApproval') === true,
		photos: snap.docs.map((item) => moderationCard(item)).filter((item): item is ModerationPhoto => item != null)
	};
}

async function shareCall(request: CallableRequest): Promise<{ shared: boolean; published: boolean; hidden: boolean }> {
	const uid = await assertActive(request.auth?.uid);
	const data = asRecord(request.data);
	return setPhotoSharingForUser(uid, {
		photoId: data.photoId,
		showToBuddies: data.showToBuddies,
		showOnShareLink: data.showOnShareLink,
		showInGallery: data.showInGallery,
		shareVehicleStats: data.shareVehicleStats,
		shareTeamId: data.shareTeamId,
		shareVehicleId: data.shareVehicleId,
		vehicleType: data.vehicleType,
		paintingUrl: 'paintingUrl' in data ? data.paintingUrl : undefined
	});
}

/**
 * Rewrites the public stats snapshot after the saved vehicle changes.
 * Turning stats sharing off removes the field. A missing vehicle does too.
 */
export async function refreshSharedVehicleStatsForTeam(teamId: string, team: Record<string, unknown> | undefined): Promise<void> {
	if (!TEAM_ID_PATTERN.test(teamId)) return;
	const db = getFirestore();
	const snap = await db.collection('sharedPhotoPrivate').where('teamId', '==', teamId).get();
	const rulesVersion = asRecord(team?.teamData).rulesVersion;
	for (const item of snap.docs) {
		if (item.get('shareVehicleStats') !== true) continue;
		const publicRef = db.doc(`sharedPhotos/${item.id}`);
		const published = await publicRef.get();
		if (!published.exists) continue;
		const publishedData = published.data() ?? {};
		const vehicle = team ? vehicleOnTeam(team, String(item.get('vehicleId') ?? '')) : null;
		if (!vehicle) {
			const patch = sharedPhotoSearchPatch({
				caption: publishedData.caption,
				displayName: publishedData.displayName,
				vehicleType: publishedData.vehicleType,
				vehicleStats: null
			});
			await publicRef.update({ vehicleStats: FieldValue.delete(), cans: FieldValue.delete(), keywords: patch.keywords });
			continue;
		}
		const vehicleType = vehicleTypeLabel(vehicle.type);
		const vehicleStats = sanitizeVehicleStats(vehicleStatsSnapshot(vehicle, rulesVersion));
		if (!vehicleStats) {
			const patch = sharedPhotoSearchPatch({
				caption: publishedData.caption,
				displayName: publishedData.displayName,
				vehicleType,
				vehicleStats: null
			});
			await publicRef.update({ vehicleStats: FieldValue.delete(), cans: FieldValue.delete(), keywords: patch.keywords });
			continue;
		}
		const patch = sharedPhotoSearchPatch({
			caption: publishedData.caption,
			displayName: publishedData.displayName,
			vehicleType,
			vehicleStats
		});
		await publicRef.set({ vehicleType, vehicleStats, keywords: patch.keywords, cans: patch.cans }, { merge: true });
		await item.ref.set({ vehicleType }, { merge: true });
	}
}

export const setPhotoSharing = onCall(CALL, async (request) => {
	try {
		return await shareCall(request);
	} catch (error) {
		throw httpsError(error);
	}
});

export const setPhotoPaintingUrl = onCall(CALL, async (request) => {
	try {
		const uid = await assertActive(request.auth?.uid);
		const data = asRecord(request.data);
		return await setPhotoPaintingUrlForUser(uid, data.photoId, data.paintingUrl);
	} catch (error) {
		throw httpsError(error);
	}
});

export const listVisibleTeamPhotos = onCall({ ...CALL, invoker: 'public' }, async (request) => {
	try {
		const data = asRecord(request.data);
		return await listVisibleTeamPhotosForCaller(request.auth?.uid, { teamId: data.teamId, audience: data.audience });
	} catch (error) {
		throw httpsError(error);
	}
});

export const reportPhoto = onCall(CALL, async (request) => {
	try {
		const uid = await assertActive(request.auth?.uid);
		return await reportPhotoForUser(uid, asRecord(request.data).photoId);
	} catch (error) {
		throw httpsError(error);
	}
});

export const moderateGallery = onCall(CALL, async (request) => {
	try {
		const uid = await assertActive(request.auth?.uid);
		return await moderateGalleryForAdmin(uid, asRecord(request.data));
	} catch (error) {
		throw httpsError(error);
	}
});

/** A saved-team write refreshes stats already shared with a photo. */
export const refreshSharedVehicleStats = onDocumentWritten(
	{ document: 'teams/{teamId}', region: REGION, memory: '256MiB', timeoutSeconds: 60, maxInstances: 10 },
	async (event) => {
		const after = event.data?.after;
		await refreshSharedVehicleStatsForTeam(
			String(event.params.teamId ?? ''),
			after?.exists ? (after.data() as Record<string, unknown>) : undefined
		);
	}
);

/** A deleted private photo takes its shared copy with it, including after account deletion. */
export const removeSharedPhotoOnDelete = onDocumentDeleted(
	{ document: 'users/{userId}/photos/{photoId}', region: REGION, memory: '256MiB', timeoutSeconds: 60, maxInstances: 10 },
	async (event) => {
		await removeSharedCopy(String(event.params.photoId ?? ''), true);
	}
);
