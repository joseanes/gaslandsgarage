/** Photo sharing choices. Shared by the browser and the Cloud Functions. */

import { PHOTO_ID_PATTERN, UID_PATTERN, cleanCaption } from './model';

export const SHARE_BUDDIES_LABEL = 'Show to my Gaming Buddies';
export const SHARE_LINK_LABEL = 'Show on my team share link';
export const SHARE_GALLERY_LABEL = 'Show this car in the public Gallery?';
export const SHARE_STATS_LABEL = "Share this car's stats with the photo?";
export const SHARE_EVERYWHERE_LABEL = 'Share everywhere';
export const CUSTOMIZE_SHARING_LABEL = 'Customize sharing';
export const SHARE_CHOICES_COPY =
	"Off until you turn it on. The Gallery is public and can include this car's stats. Unshare anytime.";
export const GALLERY_SHARE_COPY =
	'Anyone can see photos you share to the Gallery. You can unshare anytime. Deleting your account removes them.';
export const STATS_SHARE_COPY =
	"The Gallery then shows this car's type, hull, handling, crew, gear, weapons, upgrades, and cans. Turning this off removes those stats. You can change it later.";

/** Distinct signed-in reports that hide a gallery photo until an admin reviews it. */
export const REPORT_HIDE_THRESHOLD = 3;
export const REPORTS_PER_HOUR = 10;
export const REPORT_WINDOW_MS = 60 * 60 * 1000;
/** Public Gallery page size. The next page uses a cursor, not a bigger limit. */
export const GALLERY_PAGE_SIZE = 24;
const KEYWORD_LIMIT = 24;
const KEYWORD_STOP = new Set(['an', 'and', 'for', 'in', 'my', 'of', 'on', 'or', 'the', 'to', 'with']);

export interface ShareFlags {
	showToBuddies: boolean;
	showOnShareLink: boolean;
	showInGallery: boolean;
	shareVehicleStats: boolean;
}

export type ShareChoiceState = 'off' | 'on' | 'mixed';

const SHARE_FLAG_KEYS = ['showToBuddies', 'showOnShareLink', 'showInGallery', 'shareVehicleStats'] as const;

export function shareChoiceState(flags: ShareFlags): ShareChoiceState {
	const on = SHARE_FLAG_KEYS.filter((key) => flags[key]).length;
	if (on === 0) return 'off';
	if (on === SHARE_FLAG_KEYS.length) return 'on';
	return 'mixed';
}

export function shareEverywhere(on: boolean): ShareFlags {
	return {
		showToBuddies: on,
		showOnShareLink: on,
		showInGallery: on,
		shareVehicleStats: on
	};
}

/** Build snapshot stored on the public gallery card. No account id, email, or Google name. */
export interface VehicleStatsSnapshot {
	type: string;
	name: string;
	hull: number;
	handling: number;
	crew: number;
	gear: number;
	cans: number;
	weapons: string[];
	upgrades: string[];
	perks: string[];
	slots: string;
	weight: string;
	armour: string;
	driver: string;
}

export interface PublicSharedPhoto {
	photoId: string;
	displayName: string;
	vehicleType: string;
	teamName: string;
	caption: string;
	createdAt: string;
	hidden: boolean;
	published: boolean;
	showInGallery: boolean;
	keywords: string[];
	/** Present when this car shares its stats, so cans can be ordered without reading the snapshot. */
	cans?: number;
	vehicleStats?: VehicleStatsSnapshot;
}

/** A missing or non-true value stays off. Nothing is shared unless the player turns it on. */
export function shareFlags(input: Partial<ShareFlags> | null | undefined): ShareFlags {
	return {
		showToBuddies: input?.showToBuddies === true,
		showOnShareLink: input?.showOnShareLink === true,
		showInGallery: input?.showInGallery === true,
		shareVehicleStats: input?.shareVehicleStats === true
	};
}

/** Audiences that copy the file. Stats alone stay on the private photo until one of these is on. */
export function anyShareFlag(flags: ShareFlags): boolean {
	return flags.showToBuddies || flags.showOnShareLink || flags.showInGallery;
}

/** Title-case a vehicle id from the saved team. The browser does not choose this label. */
export function vehicleTypeLabel(typeId: unknown): string {
	if (typeof typeId !== 'string') return 'Vehicle';
	const id = typeId.trim();
	if (!/^[A-Za-z0-9_]{1,40}$/.test(id)) return 'Vehicle';
	const label = id
		.split('_')
		.filter((word) => word.length > 0)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(' ');
	return label || 'Vehicle';
}

export function cleanTeamName(value: unknown): string {
	if (typeof value !== 'string') return '';
	return value.replace(/[\u0000-\u001f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

export function sharedPhotoObjectPath(photoId: string): string {
	if (!PHOTO_ID_PATTERN.test(photoId)) throw new Error('That photo is not available.');
	return `shared-photos/${photoId}`;
}

/**
 * Rules-backed media URL. No account id and no download token, so Storage
 * rules decide on every request.
 */
export function sharedPhotoMediaUrl(bucket: string, photoId: string, emulatorHost = ''): string {
	const name = bucket.trim().replace(/^gs:\/\//, '');
	if (!/^[a-z0-9][a-z0-9.-]{1,200}$/i.test(name)) throw new Error('Photos are not available right now.');
	const objectPath = encodeURIComponent(sharedPhotoObjectPath(photoId));
	if (emulatorHost) {
		const host = emulatorHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
		if (!/^[a-z0-9.-]+:\d+$/i.test(host)) throw new Error('Photos are not available right now.');
		return `http://${host}/v0/b/${name}/o/${objectPath}?alt=media`;
	}
	return `https://firebasestorage.googleapis.com/v0/b/${name}/o/${objectPath}?alt=media`;
}

export function photoReportId(photoId: string, uid: string): string {
	if (!PHOTO_ID_PATTERN.test(photoId) || !UID_PATTERN.test(uid)) throw new Error('That report could not be saved.');
	return `${photoId}~${uid}`;
}

export function nextReportWindow(previous: unknown, nowMs: number): { allowed: boolean; stamps: number[] } {
	const recent = Array.isArray(previous)
		? previous.filter((value): value is number => typeof value === 'number' && nowMs - value < REPORT_WINDOW_MS)
		: [];
	if (recent.length >= REPORTS_PER_HOUR) return { allowed: false, stamps: recent };
	return { allowed: true, stamps: [...recent, nowMs] };
}

/**
 * Gallery publication. Approval mode holds a new gallery share. Turning the
 * kill switch on does not unpublish a photo that was already approved.
 * Buddy and share-link visibility do not use this flag.
 */
export function galleryPublished(
	flags: ShareFlags,
	requireApproval: boolean,
	previous: { showInGallery: boolean; published: boolean }
): boolean {
	if (!flags.showInGallery) return false;
	if (!requireApproval) return true;
	return previous.showInGallery && previous.published;
}

const STAT_TEXT = 80;

function cleanStatText(value: unknown, max = STAT_TEXT): string {
	if (typeof value !== 'string') return '';
	const text = value.replace(/[\u0000-\u001f]/g, '').trim().replace(/\s+/g, ' ').slice(0, max);
	if (text.includes('@')) return '';
	return text;
}

function statNumber(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
	return Math.max(-20, Math.min(999, Math.round(value)));
}

function statList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const names: string[] = [];
	for (const item of value) {
		const text = cleanStatText(item);
		if (text) names.push(text);
		if (names.length >= 24) break;
	}
	return names;
}

/** Keeps only the build fields the Gallery shows. Anything else, including an account id, is dropped. */
export function sanitizeVehicleStats(raw: unknown): VehicleStatsSnapshot | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const row = raw as Record<string, unknown>;
	const allowed = new Set([
		'type',
		'name',
		'hull',
		'handling',
		'crew',
		'gear',
		'cans',
		'weapons',
		'upgrades',
		'perks',
		'slots',
		'weight',
		'armour',
		'driver'
	]);
	if (Object.keys(row).some((key) => !allowed.has(key) || /uid|email|user/i.test(key))) return null;
	return {
		type: cleanStatText(row.type) || 'Vehicle',
		name: cleanStatText(row.name),
		hull: statNumber(row.hull),
		handling: statNumber(row.handling),
		crew: statNumber(row.crew),
		gear: statNumber(row.gear),
		cans: statNumber(row.cans),
		weapons: statList(row.weapons),
		upgrades: statList(row.upgrades),
		perks: statList(row.perks),
		slots: cleanStatText(row.slots, 16),
		weight: cleanStatText(row.weight, 32),
		armour: cleanStatText(row.armour, 32),
		driver: cleanStatText(row.driver)
	};
}

function assertNoIdentity(value: unknown): void {
	if (!value || typeof value !== 'object') return;
	for (const [key, child] of Object.entries(value)) {
		if (/uid|email|user/i.test(key)) throw new Error('That photo could not be shared.');
		assertNoIdentity(child);
	}
}

function searchableText(value: unknown): string {
	if (typeof value !== 'string') return '';
	return value
		.replace(/[^\s@]+@[^\s@]+/g, ' ')
		.replace(/[\u0000-\u001f]/g, ' ')
		.trim();
}

/** Lowercased words for one `array-contains` search. Addresses are removed before splitting. */
export function galleryKeywords(input: {
	caption?: unknown;
	carName?: unknown;
	vehicleType?: unknown;
	weapons?: unknown;
	displayName?: unknown;
}): string[] {
	const weapons = Array.isArray(input.weapons) ? input.weapons.map((item) => searchableText(item)).join(' ') : '';
	const sources = [input.carName, input.caption, input.vehicleType, weapons, input.displayName];
	const keywords: string[] = [];
	const seen = new Set<string>();
	for (const source of sources) {
		const text = searchableText(source).toLowerCase();
		for (const token of text.split(/[^\p{L}\p{N}]+/u)) {
			if (token.length < 2 || token.length > 24 || KEYWORD_STOP.has(token) || seen.has(token)) continue;
			seen.add(token);
			keywords.push(token);
			if (keywords.length >= KEYWORD_LIMIT) return keywords;
		}
	}
	return keywords;
}

/** One search word. Several words use the longest, because a query can contain only one array. */
export function gallerySearchToken(raw: unknown): string {
	const keywords = galleryKeywords({ caption: raw });
	return keywords.slice().sort((a, b) => b.length - a.length || a.localeCompare(b))[0] ?? '';
}

/**
 * Fields written with the public card. `cans` is omitted when stats are not
 * shared, so a cans sort does not treat a photo-only card as costing zero.
 */
export function sharedPhotoSearchPatch(input: {
	caption?: unknown;
	displayName?: unknown;
	vehicleType?: unknown;
	vehicleStats?: VehicleStatsSnapshot | null;
}): { keywords: string[]; cans?: number } {
	const stats = input.vehicleStats ?? null;
	const keywords = galleryKeywords({
		caption: input.caption,
		carName: stats?.name ?? '',
		vehicleType: input.vehicleType,
		weapons: stats?.weapons ?? [],
		displayName: input.displayName
	});
	return stats ? { keywords, cans: stats.cans } : { keywords };
}

/** Public gallery document. The account id is not a field. Stats are omitted unless sharing them is on. */
export function publicSharedPhoto(input: {
	photoId: string;
	displayName: string;
	vehicleType: string;
	teamName: string;
	caption: string;
	createdAt: string;
	hidden: boolean;
	published: boolean;
	showInGallery: boolean;
	vehicleStats?: unknown;
}): PublicSharedPhoto {
	if (!PHOTO_ID_PATTERN.test(input.photoId)) throw new Error('That photo could not be shared.');
	const caption = cleanCaption(input.caption);
	const stats = sanitizeVehicleStats(input.vehicleStats);
	const search = sharedPhotoSearchPatch({
		caption,
		displayName: input.displayName,
		vehicleType: input.vehicleType,
		vehicleStats: stats
	});
	const photo: PublicSharedPhoto = {
		photoId: input.photoId,
		displayName: input.displayName,
		vehicleType: input.vehicleType,
		teamName: cleanTeamName(input.teamName),
		caption,
		createdAt: input.createdAt,
		hidden: input.hidden === true,
		published: input.published === true,
		showInGallery: input.showInGallery === true,
		keywords: search.keywords
	};
	if (stats && search.cans !== undefined) {
		photo.vehicleStats = stats;
		photo.cans = search.cans;
	}
	assertNoIdentity(photo);
	return photo;
}
