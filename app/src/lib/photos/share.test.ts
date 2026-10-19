import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUDDY_FALLBACK_NAME } from '../buddies/model';
import {
	GALLERY_SHARE_COPY,
	REPORT_HIDE_THRESHOLD,
	SHARE_BUDDIES_LABEL,
	SHARE_GALLERY_LABEL,
	SHARE_LINK_LABEL,
	SHARE_STATS_LABEL,
	STATS_SHARE_COPY,
	galleryPublished,
	nextReportWindow,
	publicSharedPhoto,
	sanitizeVehicleStats,
	shareFlags,
	sharedPhotoMediaUrl,
	vehicleTypeLabel
} from './share';

describe('photo sharing', () => {
	it('keeps every sharing choice off unless the player turns it on', () => {
		expect(shareFlags(undefined)).toEqual({
			showToBuddies: false,
			showOnShareLink: false,
			showInGallery: false,
			shareVehicleStats: false
		});
		expect(shareFlags({ showInGallery: true })).toEqual({
			showToBuddies: false,
			showOnShareLink: false,
			showInGallery: true,
			shareVehicleStats: false
		});
		expect(REPORT_HIDE_THRESHOLD).toBe(3);
	});

	it('labels a vehicle from its id and builds a public URL with no account id', () => {
		expect(vehicleTypeLabel('performance_car')).toBe('Performance Car');
		expect(vehicleTypeLabel('nope id')).toBe('Vehicle');
		const url = sharedPhotoMediaUrl('gaslandsgarage-74ce6.appspot.com', 'photoshare1');
		expect(url).toBe(
			'https://firebasestorage.googleapis.com/v0/b/gaslandsgarage-74ce6.appspot.com/o/shared-photos%2Fphotoshare1?alt=media'
		);
		expect(url).not.toContain('token');
		expect(url).not.toContain('uid');
		expect(url).not.toContain('ada');
		const photo = publicSharedPhoto({
			photoId: 'photoshare1',
			displayName: 'Track Name',
			vehicleType: 'Car',
			teamName: 'Racers',
			caption: 'Red',
			createdAt: '2026-10-19T00:00:00.000Z',
			hidden: false,
			published: true,
			showInGallery: true
		});
		expect(Object.keys(photo)).not.toContain('ownerUid');
		expect(Object.keys(photo)).not.toContain('userId');
		expect(photo.vehicleStats).toBeUndefined();
		expect(JSON.stringify(photo)).not.toContain('@');
		const withStats = publicSharedPhoto({
			photoId: 'photoshare1',
			displayName: 'Track Name',
			vehicleType: 'Performance Car',
			teamName: 'Racers',
			caption: 'Red',
			createdAt: '2026-10-19T00:00:00.000Z',
			hidden: false,
			published: true,
			showInGallery: true,
			vehicleStats: {
				type: 'Performance Car',
				name: 'ada@gmail.com',
				hull: 10,
				handling: 4,
				crew: 1,
				gear: 6,
				cans: 21,
				weapons: ['Machine Gun'],
				upgrades: ['Armour Plating'],
				perks: [],
				slots: '2/2',
				weight: 'Middleweight',
				armour: '',
				driver: '',
				ownerUid: 'ada'
			}
		});
		expect(withStats.vehicleStats).toBeUndefined();
		expect(sanitizeVehicleStats({ type: 'Car', hull: 8, handling: 3, crew: 1, gear: 5, cans: 12, weapons: [], upgrades: [], perks: [], slots: '0/2', weight: '', armour: '', driver: '' })?.hull).toBe(8);
	});

	it('publishes gallery photos immediately unless an admin requires approval', () => {
		const flags = { showToBuddies: false, showOnShareLink: true, showInGallery: true, shareVehicleStats: false };
		expect(galleryPublished(flags, false, { showInGallery: false, published: false })).toBe(true);
		expect(galleryPublished(flags, true, { showInGallery: false, published: false })).toBe(false);
		expect(galleryPublished(flags, true, { showInGallery: true, published: true })).toBe(true);
		expect(galleryPublished({ ...flags, showInGallery: false }, false, { showInGallery: true, published: true })).toBe(false);
	});

	it('stops a player after ten reports in an hour', () => {
		const now = Date.parse('2026-10-19T12:00:00.000Z');
		const stamps = Array.from({ length: 10 }, (_, index) => now - index);
		expect(nextReportWindow(stamps, now).allowed).toBe(false);
		expect(nextReportWindow(stamps.map((stamp) => stamp - 60 * 60 * 1000), now).allowed).toBe(true);
	});

	it('asks before sharing and explains the gallery on the privacy page', () => {
		const card = readFileSync(resolve(process.cwd(), 'src/lib/components/VehiclePhotos.svelte'), 'utf8');
		const page = readFileSync(resolve(process.cwd(), 'src/routes/privacy/+page.svelte'), 'utf8');
		const admin = readFileSync(resolve(process.cwd(), 'src/routes/admin/gallery/+page.svelte'), 'utf8');
		const menu = readFileSync(resolve(process.cwd(), 'src/routes/+layout.svelte'), 'utf8');
		expect(SHARE_BUDDIES_LABEL).toBe('Show to my Gaming Buddies');
		expect(SHARE_LINK_LABEL).toBe('Show on my team share link');
		expect(SHARE_GALLERY_LABEL).toBe('Show this car in the public Gallery?');
		expect(SHARE_STATS_LABEL).toBe("Share this car's stats with the photo?");
		expect(card).toContain('{SHARE_BUDDIES_LABEL}');
		expect(card).toContain('{SHARE_LINK_LABEL}');
		expect(card).toContain('{SHARE_GALLERY_LABEL}');
		expect(card).toContain('{SHARE_STATS_LABEL}');
		expect(card).toContain('{GALLERY_SHARE_COPY}');
		expect(card).toContain('{STATS_SHARE_COPY}');
		expect(card).toContain('data-testid="upload-share-gallery"');
		expect(card).toContain('data-testid="upload-share-stats"');
		expect(card).not.toContain('checked="checked"');
		expect(page).toContain('GALLERY_SHARE_COPY');
		expect(page).toContain('STATS_SHARE_COPY');
		expect(page).toContain('SHARE_STATS_LABEL');
		const gallery = readFileSync(resolve(process.cwd(), 'src/routes/gallery/+page.svelte'), 'utf8');
		expect(gallery).toContain('data-testid="gallery-stats"');
		expect(page).toContain('never use them for advertising');
		expect(page).toContain('Unsubscribe from the link');
		expect(admin).not.toContain('ownerUid');
		expect(admin).not.toContain('@');
		expect(menu).toContain('data-testid="gallery-link"');
		expect(GALLERY_SHARE_COPY).toContain('Anyone can see photos you share to the Gallery');
		expect(BUDDY_FALLBACK_NAME).not.toContain('@');
	});
});
