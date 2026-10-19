import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { eraseAccount, exportAccount } from './accountPrivacy';
import {
	handleCancelBuddyRequest,
	handleGalleryBuddyOffer,
	handleGetBuddyInvite,
	handleRemoveBuddy,
	handleRespondBuddyRequest,
	handleSaveBuddyProfile,
	handleSearchBuddyPlayers,
	handleSendBuddyRequest,
	handleUnblockBuddy
} from './buddies';
import { listVisibleTeamPhotosForCaller } from './photoShare';
import {
	BUDDY_DECLINE_COOLDOWN_MS,
	BUDDY_FALLBACK_NAME,
	BUDDY_GALLERY_REQUESTS_PER_DAY,
	BUDDY_REQUESTS_PER_HOUR
} from '../../app/src/lib/buddies/model';
import { handleSendBuddyInvite } from './buddyEmailInvite';
import { emailAddressHash } from '../../app/src/lib/buddies/emailInvite';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-gaslands-functions';

function emulatorUrl(host: string | undefined, fallbackPort: number): string {
	const value = host && host.length > 0 ? host : `127.0.0.1:${fallbackPort}`;
	return value.startsWith('http') ? value : `http://${value}`;
}

async function clearEmulators(): Promise<void> {
	const firestore = await fetch(
		`${emulatorUrl(process.env.FIRESTORE_EMULATOR_HOST, 8080)}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
		{ method: 'DELETE' }
	);
	if (!firestore.ok) throw new Error(`Could not clear Firestore (${firestore.status})`);
	const auth = await fetch(
		`${emulatorUrl(process.env.FIREBASE_AUTH_EMULATOR_HOST, 9099)}/emulator/v1/projects/${projectId}/accounts`,
		{ method: 'DELETE' }
	);
	if (!auth.ok) throw new Error(`Could not clear Auth (${auth.status})`);
}

beforeAll(() => {
	process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
	process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
	if (getApps().length === 0) initializeApp({ projectId });
});

beforeEach(async () => {
	await clearEmulators();
});

afterAll(async () => {
	await clearEmulators();
});

async function player(uid: string, name: string): Promise<void> {
	await getAuth().createUser({ uid, email: `${uid}@example.com`, displayName: name });
}

describe('gaming buddies', () => {
	const now = Date.parse('2026-10-18T12:00:00.000Z');

	it('sends by invite, accepts a mutual link, and never stores an email', async () => {
		await player('ada', 'Ada');
		await player('grace', 'Grace');
		await handleSaveBuddyProfile('ada', { displayName: 'Ada Lovelace', discoverable: false }, now);
		await handleSaveBuddyProfile('grace', { displayName: 'Grace Hopper', discoverable: true }, now);
		const invite = await handleGetBuddyInvite('ada', now);
		expect(invite.code).toMatch(/^[A-Z2-9]{10}$/);
		expect(JSON.stringify(invite)).not.toContain('@');

		const lines: string[] = [];
		const spy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
			lines.push(String(message));
		});
		try {
			const sent = await handleSendBuddyRequest('grace', { code: invite.code.toLowerCase() }, now);
			expect(sent.status).toBe('sent');
			const request = (await getFirestore().doc(`buddyRequests/${sent.requestId}`).get()).data();
			expect(request).toMatchObject({
				fromUid: 'grace',
				toUid: 'ada',
				fromName: 'Grace Hopper',
				toName: 'Ada Lovelace',
				status: 'pending'
			});
			expect(JSON.stringify(request)).not.toContain('@');
			expect(Object.keys(request ?? {})).not.toContain('email');

			await expect(handleRespondBuddyRequest('grace', { requestId: sent.requestId, action: 'accept' }, now)).rejects.toMatchObject({
				code: 'permission-denied'
			});
			await handleRespondBuddyRequest('ada', { requestId: sent.requestId, action: 'accept' }, now);
			const buddy = (await getFirestore().doc('buddies/ada~grace').get()).data();
			expect(buddy).toMatchObject({
				members: ['ada', 'grace'],
				status: 'accepted',
				names: { ada: 'Ada Lovelace', grace: 'Grace Hopper' }
			});
			expect(JSON.stringify(buddy)).not.toContain('@');
			expect((await getFirestore().doc(`buddyRequests/${sent.requestId}`).get()).exists).toBe(false);
			expect(lines.join('\n')).not.toContain('ada@example.com');
			expect(lines.join('\n')).not.toContain('Ada Lovelace');
		} finally {
			spy.mockRestore();
		}
	});

	it('refuses a direct id unless that player opted in, and blocks a later request', async () => {
		await player('ada', 'Ada');
		await player('grace', 'Grace');
		await handleSaveBuddyProfile('ada', { displayName: 'Ada', discoverable: false }, now);
		await expect(handleSendBuddyRequest('grace', { targetUid: 'ada' }, now)).rejects.toMatchObject({
			code: 'failed-precondition'
		});
		await handleSaveBuddyProfile('ada', { displayName: 'Ada', discoverable: true }, now);
		const sent = await handleSendBuddyRequest('grace', { targetUid: 'ada' }, now + 1);
		await handleRespondBuddyRequest('ada', { requestId: sent.requestId, action: 'block' }, now);
		await expect(handleSendBuddyRequest('grace', { targetUid: 'ada' }, now + 2)).rejects.toMatchObject({
			code: 'failed-precondition'
		});
		expect((await getFirestore().doc('buddyBlocks/ada~grace').get()).get('blockerUid')).toBe('ada');
		await handleUnblockBuddy('ada', { otherUid: 'grace' });
		const again = await handleSendBuddyRequest('grace', { targetUid: 'ada' }, now + 3);
		expect(again.status).toBe('sent');
	});

	it('removes the link for both people and keeps the other team', async () => {
		await player('ada', 'Ada');
		await player('grace', 'Grace');
		await handleSaveBuddyProfile('ada', { displayName: 'Ada', discoverable: true }, now);
		const sent = await handleSendBuddyRequest('grace', { targetUid: 'ada' }, now);
		await handleRespondBuddyRequest('ada', { requestId: sent.requestId, action: 'accept' }, now);
		await getFirestore().doc('teams/ada-team').set({ userId: 'ada', teamName: 'Racers', hiddenFromBuddies: false });
		await handleRemoveBuddy('grace', { otherUid: 'ada' });
		expect((await getFirestore().doc('buddies/ada~grace').get()).exists).toBe(false);
		expect((await getFirestore().doc('teams/ada-team').get()).get('teamName')).toBe('Racers');
	});

	it('searches display names only and rate limits requests', async () => {
		await player('ada', 'Ada');
		await player('grace', 'Grace');
		await handleSaveBuddyProfile('ada', { displayName: 'Ada Lovelace', discoverable: true }, now);
		await getFirestore().doc('buddyDirectory/ada').set({
			displayName: 'Ada Lovelace',
			displayNameKey: 'ada lovelace',
			email: 'ada@example.com',
			updatedAt: '2026-10-18T12:00:00.000Z'
		});
		const found = await handleSearchBuddyPlayers('grace', { query: 'ada' }, now);
		expect(found.results).toEqual([{ uid: 'ada', displayName: 'Ada Lovelace', relationship: 'none' }]);
		expect(JSON.stringify(found)).not.toContain('ada@example.com');
		await expect(handleSearchBuddyPlayers('grace', { query: 'ada@example.com' }, now)).rejects.toMatchObject({
			code: 'invalid-argument'
		});

		const stamps = Array.from({ length: BUDDY_REQUESTS_PER_HOUR }, (_, index) => now + index);
		await getFirestore().doc('buddyRate/grace').set({ requestAt: stamps });
		await expect(handleSendBuddyRequest('grace', { targetUid: 'ada' }, now + 10)).rejects.toMatchObject({
			code: 'resource-exhausted'
		});
	});

	it('uses the buddy name the player saved and ignores the Google name', async () => {
		await player('ada', 'Ada');
		await player('grace', 'Grace');
		await getAuth().updateUser('ada', { displayName: 'ada@example.com' });
		await getFirestore().doc('users/ada').set({ displayName: 'Google Ada', email: 'ada@example.com' });
		await handleSaveBuddyProfile('grace', { displayName: 'Grace', discoverable: true }, now);
		const sent = await handleSendBuddyRequest('ada', { targetUid: 'grace' }, now);
		expect((await getFirestore().doc(`buddyRequests/${sent.requestId}`).get()).get('fromName')).toBe(BUDDY_FALLBACK_NAME);
		const capture = {
			posted: [] as string[],
			fetchImpl: (async () => {
				return new Response(JSON.stringify({ operationId: 'op' }), { status: 202 });
			}) as typeof fetch
		};
		const wrapped: typeof fetch = async (input, init) => {
			capture.posted.push(String(init?.body));
			return capture.fetchImpl(input, init);
		};
		await handleSendBuddyInvite(
			'ada',
			{ email: 'friend@example.com' },
			{
				accountSid: 'AC00000000000000000000000000000000',
				authToken: 'test-token-value-16',
				fromAddress: 'noreply@gaslandsgarage.com',
				fetchImpl: wrapped,
				nowMs: now
			}
		);
		expect(capture.posted[0]).toContain(BUDDY_FALLBACK_NAME);
		expect(capture.posted[0]).not.toContain('Google Ada');
		expect(capture.posted[0]).not.toContain('ada@example.com invited');
		await handleSaveBuddyProfile('ada', { displayName: 'Track Ada', discoverable: false }, now);
		await handleSendBuddyInvite(
			'ada',
			{ email: 'second@example.com' },
			{
				accountSid: 'AC00000000000000000000000000000000',
				authToken: 'test-token-value-16',
				fromAddress: 'noreply@gaslandsgarage.com',
				fetchImpl: wrapped,
				nowMs: now + 1
			}
		);
		expect(capture.posted[1]).toContain('Track Ada invited you');
		expect(capture.posted[1]).not.toContain('Google Ada');
	});

	it('keeps an invite opt-out when the account is deleted without Twilio configured', async () => {
		await player('ada', 'Ada');
		const hash = emailAddressHash('ada@example.com', 'test-token-value-16');
		await getFirestore().doc(`buddyEmailSuppress/${hash}`).set({ suppressedAt: '2026-10-18T12:00:00.000Z' });
		const previousSid = process.env.TWILIO_ACCOUNT_SID;
		const previousToken = process.env.TWILIO_AUTH_TOKEN;
		process.env.TWILIO_ACCOUNT_SID = 'disabled';
		process.env.TWILIO_AUTH_TOKEN = 'disabled';
		try {
			await eraseAccount('ada');
			expect((await getFirestore().doc(`buddyEmailSuppress/${hash}`).get()).exists).toBe(true);
		} finally {
			if (previousSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
			else process.env.TWILIO_ACCOUNT_SID = previousSid;
			if (previousToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
			else process.env.TWILIO_AUTH_TOKEN = previousToken;
		}
	});

	it('rejects a disabled account and includes buddies in export and delete', async () => {
		await player('ada', 'Ada');
		await player('grace', 'Grace');
		await getAuth().updateUser('ada', { disabled: true });
		await expect(handleGetBuddyInvite('ada', now)).rejects.toMatchObject({ code: 'permission-denied' });
		await getAuth().updateUser('ada', { disabled: false });
		await handleSaveBuddyProfile('ada', { displayName: 'Ada', discoverable: true }, now);
		const sent = await handleSendBuddyRequest('grace', { targetUid: 'ada' }, now);
		await handleCancelBuddyRequest('grace', { requestId: sent.requestId });
		const resent = await handleSendBuddyRequest('grace', { targetUid: 'ada' }, now + 1);
		await handleRespondBuddyRequest('ada', { requestId: resent.requestId, action: 'accept' }, now);
		await getFirestore().doc('teams/grace-team').set({ userId: 'grace', teamName: 'Keepers', hiddenFromBuddies: false });

		const exported = await exportAccount('ada');
		const data = exported.data as Record<string, unknown>;
		expect(JSON.stringify(data.buddies)).toContain('grace');
		expect(JSON.stringify(data.buddyInvites)).toContain('Ada');
		expect(JSON.stringify(exported)).not.toContain('grace@example.com');

		await eraseAccount('ada');
		const db = getFirestore();
		expect((await db.doc('buddies/ada~grace').get()).exists).toBe(false);
		expect((await db.doc('buddyInvites/ada').get()).exists).toBe(false);
		expect((await db.doc('buddyDirectory/ada').get()).exists).toBe(false);
		expect((await db.doc('teams/grace-team').get()).get('teamName')).toBe('Keepers');
		expect((await getAuth().getUser('grace')).email).toBe('grace@example.com');
	});

	it('sends a gallery request without an address, then lets the new buddy see buddy photos', async () => {
		await player('ada', 'Ada');
		await player('grace', 'Grace');
		await handleSaveBuddyProfile('ada', { displayName: 'Ada', discoverable: false }, now);
		await getFirestore().doc('sharedPhotos/photogal1').set({
			photoId: 'photogal1',
			displayName: 'Ada',
			vehicleType: 'Performance Car',
			caption: 'Red racer',
			vehicleStats: { name: 'Rust Rocket', cans: 15, weapons: [] },
			hidden: false,
			published: true,
			showInGallery: true,
			createdAt: '2026-10-18T12:00:00.000Z'
		});
		await getFirestore().doc('sharedPhotoPrivate/photogal1').set({
			ownerUid: 'ada',
			teamId: 'team1234',
			vehicleId: 'veh123',
			vehicleType: 'Performance Car',
			contentType: 'image/webp',
			showToBuddies: true,
			hidden: false,
			caption: 'Red racer',
			createdAt: '2026-10-18T12:00:00.000Z'
		});
		await getFirestore().doc('teams/team1234').set({ userId: 'ada', teamName: 'Racers', hiddenFromBuddies: false });
		await getFirestore().doc('sharedPhotos/photogal2').set({
			photoId: 'photogal2',
			displayName: 'Grace',
			vehicleType: 'Car',
			caption: '',
			hidden: false,
			published: true,
			showInGallery: true,
			createdAt: '2026-10-18T12:00:00.000Z'
		});
		await getFirestore().doc('sharedPhotoPrivate/photogal2').set({ ownerUid: 'grace' });

		expect(await handleGalleryBuddyOffer(undefined, { photoId: 'photogal1' }, now)).toEqual({ offer: 'sign-in' });
		expect(await handleGalleryBuddyOffer('ada', { photoId: 'photogal1' }, now)).toEqual({ offer: 'hidden' });
		expect(await handleGalleryBuddyOffer('grace', { photoId: 'photogal1' }, now)).toEqual({ offer: 'add' });
		await expect(handleSendBuddyRequest('ada', { photoId: 'photogal1' }, now)).rejects.toMatchObject({
			code: 'failed-precondition'
		});
		await expect(
			handleSendBuddyRequest('grace', { photoId: 'photogal1', message: 'ada@example.com' }, now)
		).rejects.toMatchObject({ code: 'invalid-argument' });

		const sent = await handleSendBuddyRequest('grace', { photoId: 'photogal1', message: 'Nice paint' }, now);
		expect(sent.status).toBe('sent');
		const request = (await getFirestore().doc(`buddyRequests/${sent.requestId}`).get()).data();
		expect(request).toMatchObject({
			fromUid: 'grace',
			toUid: 'ada',
			source: 'gallery',
			photoId: 'photogal1',
			carName: 'Rust Rocket',
			message: 'Nice paint',
			status: 'pending'
		});
		expect(request).not.toHaveProperty('email');
		expect(JSON.stringify(request)).not.toContain('grace@example.com');
		const duplicate = await handleSendBuddyRequest('grace', { photoId: 'photogal1', message: 'Again' }, now + 1);
		expect(duplicate.status).toBe('pending');
		expect((await getFirestore().doc(`buddyRequests/${sent.requestId}`).get()).get('message')).toBe('Nice paint');
		expect(await handleGalleryBuddyOffer('grace', { photoId: 'photogal1' }, now)).toEqual({
			offer: 'sent',
			requestId: sent.requestId
		});
		expect((await handleGalleryBuddyOffer('ada', { photoId: 'photogal2' }, now)).offer).toBe('accept');
		await expect(listVisibleTeamPhotosForCaller('grace', { teamId: 'team1234', audience: 'buddies' })).rejects.toThrow(/not available/);

		await handleRespondBuddyRequest('ada', { requestId: sent.requestId, action: 'accept' }, now);
		expect(await handleGalleryBuddyOffer('grace', { photoId: 'photogal1' }, now)).toEqual({ offer: 'buddies' });
		const visible = await listVisibleTeamPhotosForCaller('grace', { teamId: 'team1234', audience: 'buddies' });
		expect(visible.photos.map((photo) => photo.photoId)).toEqual(['photogal1']);
		expect(JSON.stringify(visible)).not.toContain('ownerUid');
	});

	it('hides gallery requests when the player opts out, and holds a decline for 30 days', async () => {
		await player('ada', 'Ada');
		await player('grace', 'Grace');
		await getFirestore().doc('sharedPhotos/photogal1').set({
			photoId: 'photogal1',
			displayName: 'Ada',
			vehicleType: 'Car',
			caption: 'Red',
			hidden: false,
			published: true,
			showInGallery: true,
			createdAt: '2026-10-18T12:00:00.000Z'
		});
		await getFirestore().doc('sharedPhotoPrivate/photogal1').set({ ownerUid: 'ada' });
		await handleSaveBuddyProfile('ada', { displayName: 'Ada', discoverable: false, galleryBuddyRequests: false }, now);
		expect((await getFirestore().doc('buddyInvites/ada').get()).get('galleryBuddyRequests')).toBe(false);
		expect((await getFirestore().doc('sharedPhotos/photogal1').get()).get('allowGalleryBuddies')).toBe(false);
		expect(await handleGalleryBuddyOffer('grace', { photoId: 'photogal1' }, now)).toEqual({ offer: 'hidden' });
		expect(await handleGalleryBuddyOffer(undefined, { photoId: 'photogal1' }, now)).toEqual({ offer: 'hidden' });
		await expect(handleSendBuddyRequest('grace', { photoId: 'photogal1' }, now)).rejects.toMatchObject({
			code: 'failed-precondition'
		});

		await handleSaveBuddyProfile('ada', { displayName: 'Ada', discoverable: false, galleryBuddyRequests: true }, now);
		expect((await getFirestore().doc('sharedPhotos/photogal1').get()).get('allowGalleryBuddies')).toBeUndefined();
		const sent = await handleSendBuddyRequest('grace', { photoId: 'photogal1' }, now + 1);
		await handleRespondBuddyRequest('ada', { requestId: sent.requestId, action: 'decline' }, now);
		await expect(handleSendBuddyRequest('grace', { photoId: 'photogal1' }, now + 2)).rejects.toMatchObject({
			code: 'failed-precondition'
		});
		expect(await handleGalleryBuddyOffer('grace', { photoId: 'photogal1' }, now + 2)).toEqual({ offer: 'declined' });
		const later = await handleSendBuddyRequest('grace', { photoId: 'photogal1' }, now + BUDDY_DECLINE_COOLDOWN_MS + 1);
		expect(later.status).toBe('sent');

		const stamps = Array.from({ length: BUDDY_GALLERY_REQUESTS_PER_DAY }, (_, index) => now + index);
		await getFirestore().doc('buddyRate/grace').set({ galleryRequestAt: stamps, requestAt: [] });
		await expect(handleSendBuddyRequest('grace', { photoId: 'photogal1' }, now + 10)).rejects.toMatchObject({
			code: 'resource-exhausted'
		});
		const hourly = Array.from({ length: BUDDY_REQUESTS_PER_HOUR }, (_, index) => now + BUDDY_DECLINE_COOLDOWN_MS + index);
		await getFirestore().doc('buddyRate/grace').set({ requestAt: hourly, galleryRequestAt: [] });
		await expect(
			handleSendBuddyRequest('grace', { photoId: 'photogal1' }, now + BUDDY_DECLINE_COOLDOWN_MS + 5)
		).rejects.toMatchObject({ code: 'resource-exhausted' });
	});
});
