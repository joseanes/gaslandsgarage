import { browser } from '$app/environment';
import { auth, db, initializeFirebase } from '../firebase';
import { PRIVACY_FUNCTIONS_REGION } from '../privacy/accountShared';
import { storageBucketName } from '../photos/model';
import { GALLERY_PAGE_LIMIT, sanitizeVehicleStats, sharedPhotoMediaUrl, type ShareFlags, type VehicleStatsSnapshot } from '../photos/share';

export interface SharedVehiclePhoto {
	photoId: string;
	vehicleId: string;
	vehicleType: string;
	teamName: string;
	caption: string;
	displayName: string;
	createdAt: string;
	url: string;
}

export interface GalleryPhoto {
	photoId: string;
	displayName: string;
	vehicleType: string;
	teamName: string;
	caption: string;
	createdAt: string;
	url: string;
	vehicleStats: VehicleStatsSnapshot | null;
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
	contentType: string;
}

function plainError(error: unknown, fallback: string): Error {
	const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
	const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
	if (
		code.includes('resource-exhausted') ||
		code.includes('invalid-argument') ||
		code.includes('not-found') ||
		code.includes('permission-denied') ||
		code.includes('unauthenticated')
	) {
		return new Error(message || fallback);
	}
	if (message && !message.startsWith('Firebase')) return new Error(message);
	return new Error(fallback);
}

function emulatorHost(): string {
	if (browser && localStorage.getItem('gaslands-firebase-emulators') === '1') return '127.0.0.1:9199';
	return '';
}

export function sharedPhotoUrl(photoId: string): string {
	const configured = auth?.app?.options.storageBucket;
	const bucket = storageBucketName(typeof configured === 'string' ? configured : '');
	return sharedPhotoMediaUrl(bucket, photoId, emulatorHost());
}

async function appInstance() {
	if (!browser) throw new Error('Photos can be opened in the browser.');
	const ready = await initializeFirebase();
	if (!ready.success || !auth?.app) throw new Error('Photos are not available right now.');
	return auth.app;
}

async function call<T>(name: string, data: unknown, fallback: string): Promise<T> {
	try {
		const app = await appInstance();
		const { getFunctions, httpsCallable } = await import('firebase/functions');
		const fn = httpsCallable(getFunctions(app, PRIVACY_FUNCTIONS_REGION), name);
		const result = await fn(data);
		return result.data as T;
	} catch (error) {
		throw plainError(error, fallback);
	}
}

export async function setPhotoSharing(
	photoId: string,
	flags: ShareFlags,
	source?: { teamId: string; vehicleId: string }
): Promise<void> {
	await call(
		'setPhotoSharing',
		{ photoId, ...flags, shareTeamId: source?.teamId, shareVehicleId: source?.vehicleId },
		'That sharing choice could not be saved.'
	);
}

export async function clearPhotoSharing(photoId: string): Promise<void> {
	await setPhotoSharing(photoId, {
		showToBuddies: false,
		showOnShareLink: false,
		showInGallery: false,
		shareVehicleStats: false
	});
}

function withUrl(photo: Omit<SharedVehiclePhoto, 'url'>): SharedVehiclePhoto {
	return { ...photo, url: sharedPhotoUrl(photo.photoId) };
}

export async function listVisibleTeamPhotos(teamId: string, audience: 'buddies' | 'link'): Promise<SharedVehiclePhoto[]> {
	const data = await call<{ photos?: Omit<SharedVehiclePhoto, 'url'>[] }>(
		'listVisibleTeamPhotos',
		{ teamId, audience },
		'Those photos could not be loaded.'
	);
	return (data.photos ?? []).filter((photo) => typeof photo.photoId === 'string').map((photo) => withUrl(photo));
}

export async function reportSharedPhoto(photoId: string): Promise<{ alreadyReported: boolean; hidden: boolean }> {
	return call('reportPhoto', { photoId }, 'That report could not be saved.');
}

export async function listGalleryPhotos(): Promise<GalleryPhoto[]> {
	await appInstance();
	if (!db) throw new Error('The gallery is not available right now.');
	const { collection, getDocs, limit, orderBy, query, where } = await import('firebase/firestore');
	const snap = await getDocs(
		query(
			collection(db, 'sharedPhotos'),
			where('showInGallery', '==', true),
			where('hidden', '==', false),
			where('published', '==', true),
			orderBy('createdAt', 'desc'),
			limit(GALLERY_PAGE_LIMIT)
		)
	);
	const photos: GalleryPhoto[] = [];
	for (const item of snap.docs) {
		const data = item.data();
		if (data.hidden === true || data.published !== true || data.showInGallery !== true) continue;
		if ('ownerUid' in data || 'userId' in data || 'email' in data) continue;
		photos.push({
			photoId: item.id,
			displayName: typeof data.displayName === 'string' ? data.displayName : '',
			vehicleType: typeof data.vehicleType === 'string' ? data.vehicleType : 'Vehicle',
			teamName: typeof data.teamName === 'string' ? data.teamName : '',
			caption: typeof data.caption === 'string' ? data.caption : '',
			createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
			url: sharedPhotoUrl(item.id),
			vehicleStats: sanitizeVehicleStats(data.vehicleStats)
		});
	}
	return photos;
}

export async function loadModeration(): Promise<{ requireApproval: boolean; photos: ModerationPhoto[] }> {
	const data = await call<{ requireApproval?: boolean; photos?: Array<ModerationPhoto & { ownerUid?: string }> }>(
		'moderateGallery',
		{ action: 'list' },
		'Photo reports could not be loaded.'
	);
	return {
		requireApproval: data.requireApproval === true,
		photos: (data.photos ?? []).map((photo) => ({
			photoId: photo.photoId,
			displayName: photo.displayName,
			vehicleType: photo.vehicleType,
			teamName: photo.teamName,
			caption: photo.caption,
			createdAt: photo.createdAt,
			hidden: photo.hidden === true,
			published: photo.published === true,
			showInGallery: photo.showInGallery === true,
			showToBuddies: photo.showToBuddies === true,
			showOnShareLink: photo.showOnShareLink === true,
			reportCount: typeof photo.reportCount === 'number' ? photo.reportCount : 0,
			contentType: photo.contentType
		}))
	};
}

export async function moderatePhoto(
	action: 'hide' | 'remove' | 'approve' | 'setRequireApproval',
	extra: { photoId?: string; requireApproval?: boolean } = {}
): Promise<void> {
	await call('moderateGallery', { action, ...extra }, 'That moderation change could not be saved.');
}

/** Authenticated read for an administrator, including a hidden photo. */
export async function adminPhotoObjectUrl(photoId: string): Promise<string> {
	const app = await appInstance();
	const { getBlob, getStorage, ref } = await import('firebase/storage');
	const blob = await getBlob(ref(getStorage(app), `shared-photos/${photoId}`));
	return URL.createObjectURL(blob);
}
