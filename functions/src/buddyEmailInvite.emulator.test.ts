import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { eraseAccount, exportAccount } from './accountPrivacy';
import {
	handleAcceptBuddyEmailInvite,
	handleSendBuddyInvite,
	handleSuppressBuddyEmailInvite
} from './buddyEmailInvite';
import { BUDDY_EMAIL_INVITES_PER_DAY, BUDDY_EMAIL_INVITE_TTL_MS } from '../../app/src/lib/buddies/model';
import { emailAddressHash, twilioEmailConfigured } from '../../app/src/lib/buddies/emailInvite';
import { TWILIO_EMAIL_URL, twilioAuthorization } from './sendMail';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-gaslands-functions';
const SID = 'AC00000000000000000000000000000000';
const TOKEN = 'test-token-value-16';
const FROM = 'noreply@gaslandsgarage.com';
const now = Date.parse('2026-10-18T12:00:00.000Z');

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

type Posted = { url: string; authorization: string; body: Record<string, unknown> };

function mailCapture(): { fetchImpl: typeof fetch; posted: Posted[]; setFail: (value: 'network' | number) => void } {
	const posted: Posted[] = [];
	let fail: 'network' | number | undefined;
	const fetchImpl: typeof fetch = async (input, init) => {
		if (fail === 'network') throw new Error('network down');
		const headers = new Headers(init?.headers);
		posted.push({
			url: String(input),
			authorization: headers.get('authorization') ?? '',
			body: JSON.parse(String(init?.body)) as Record<string, unknown>
		});
		if (typeof fail === 'number') return new Response('secret-body', { status: fail });
		return new Response(JSON.stringify({ operationId: 'op_test' }), {
			status: 202,
			headers: { 'content-type': 'application/json' }
		});
	};
	return {
		fetchImpl,
		posted,
		setFail(value) {
			fail = value;
		}
	};
}

function runtime(fetchImpl: typeof fetch, nowMs = now, authToken = TOKEN, accountSid = SID) {
	return { accountSid, authToken, fromAddress: FROM, fetchImpl, nowMs };
}

function linksFrom(posted: Posted): { accept: string; suppress: string } {
	const content = posted.body.content as { text: string; html: string; subject: string };
	const accept = content.text.match(/emailInvite=(\S+)/)?.[1];
	const suppress = content.text.match(/[?&]token=(\S+)/)?.[1];
	if (!accept || !suppress) throw new Error('Invite mail is missing a link.');
	return { accept: decodeURIComponent(accept), suppress: decodeURIComponent(suppress) };
}

async function player(uid: string, email: string, name = uid): Promise<void> {
	await getAuth().createUser({ uid, email, displayName: name });
}

describe('buddy email invites', () => {
	it('posts a transactional invite and stores only a salted hash', async () => {
		await player('ada', 'ada@example.com', 'Ada');
		const capture = mailCapture();
		const lines: string[] = [];
		const spy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
			lines.push(String(message));
		});
		try {
			const sent = await handleSendBuddyInvite(
				'ada',
				{ email: 'Friend@Example.com', message: 'See you https://evil.test <b>soon</b>' },
				runtime(capture.fetchImpl)
			);
			expect(sent).toEqual({ status: 'sent' });
			expect(capture.posted).toHaveLength(1);
			expect(capture.posted[0].url).toBe(TWILIO_EMAIL_URL);
			expect(capture.posted[0].authorization).toBe(twilioAuthorization(SID, TOKEN));
			const payload = JSON.stringify(capture.posted[0].body);
			expect(payload).toContain('Friend@Example.com'.toLowerCase());
			expect(payload).not.toContain('openSettingsTab');
			expect(payload).not.toContain('Allow other players');
			expect(payload).not.toContain('https://evil.test');
			expect(payload).toContain('&lt;b&gt;soon&lt;/b&gt;');
			const hash = emailAddressHash('friend@example.com', TOKEN);
			const invites = await getFirestore().collection('buddyEmailInvites').get();
			expect(invites.size).toBe(1);
			const stored = JSON.stringify(invites.docs[0].data());
			expect(stored).toContain(hash);
			expect(stored).not.toContain('friend@example.com');
			expect(stored).not.toContain(TOKEN);
			expect((await getFirestore().doc(`buddyEmailRate/${hash}`).get()).get('sentAt')).toBe(now);
			expect(lines.join('\n')).toContain('buddies email-invite sent');
			expect(lines.join('\n')).not.toContain('friend@example.com');
			expect(lines.join('\n')).not.toContain(TOKEN);
			expect(lines.join('\n')).not.toContain('soon');
		} finally {
			spy.mockRestore();
		}
	});

	it('returns the same sent status for a new address and an existing account', async () => {
		await player('ada', 'ada@example.com', 'Ada');
		await player('taken', 'taken@example.com', 'Taken');
		const capture = mailCapture();
		const first = await handleSendBuddyInvite('ada', { email: 'taken@example.com' }, runtime(capture.fetchImpl));
		const second = await handleSendBuddyInvite(
			'ada',
			{ email: 'fresh@example.com' },
			runtime(capture.fetchImpl, now + 1)
		);
		expect(first).toEqual({ status: 'sent' });
		expect(second).toEqual(first);
		expect(JSON.stringify(first)).not.toContain('taken');
		expect(JSON.stringify(second)).not.toContain('exists');
		expect(capture.posted).toHaveLength(2);
	});

	it('does not send again to the same address inside 7 days, or to a suppressed address', async () => {
		await player('ada', 'ada@example.com', 'Ada');
		const capture = mailCapture();
		await handleSendBuddyInvite('ada', { email: 'friend@example.com' }, runtime(capture.fetchImpl));
		const again = await handleSendBuddyInvite(
			'ada',
			{ email: 'friend@example.com' },
			runtime(capture.fetchImpl, now + 1000)
		);
		expect(again).toEqual({ status: 'sent' });
		expect(capture.posted).toHaveLength(1);

		const hash = emailAddressHash('quiet@example.com', TOKEN);
		await getFirestore().doc(`buddyEmailSuppress/${hash}`).set({ suppressedAt: '2026-10-18T12:00:00.000Z' });
		const quiet = await handleSendBuddyInvite('ada', { email: 'quiet@example.com' }, runtime(capture.fetchImpl, now + 2000));
		expect(quiet).toEqual({ status: 'sent' });
		expect(capture.posted).toHaveLength(1);
	});

	it('stops the sender after 10 invites in a day', async () => {
		await player('ada', 'ada@example.com', 'Ada');
		const capture = mailCapture();
		for (let index = 0; index < BUDDY_EMAIL_INVITES_PER_DAY; index += 1) {
			await handleSendBuddyInvite(
				'ada',
				{ email: `person${index}@example.com` },
				runtime(capture.fetchImpl, now + index)
			);
		}
		await expect(
			handleSendBuddyInvite('ada', { email: 'overflow@example.com' }, runtime(capture.fetchImpl, now + 20))
		).rejects.toMatchObject({ code: 'resource-exhausted' });
		expect(capture.posted).toHaveLength(BUDDY_EMAIL_INVITES_PER_DAY);
	});

	it('rejects a disabled sender, a self invite, a bad address, and an unconfigured Twilio account', async () => {
		await player('ada', 'ada@example.com', 'Ada');
		const capture = mailCapture();
		await getAuth().updateUser('ada', { disabled: true });
		await expect(handleSendBuddyInvite('ada', { email: 'friend@example.com' }, runtime(capture.fetchImpl))).rejects.toMatchObject({
			code: 'permission-denied'
		});
		await getAuth().updateUser('ada', { disabled: false });
		await expect(handleSendBuddyInvite('ada', { email: 'Ada@Example.com' }, runtime(capture.fetchImpl))).rejects.toMatchObject({
			code: 'failed-precondition'
		});
		await expect(handleSendBuddyInvite('ada', { email: 'not-an-email' }, runtime(capture.fetchImpl))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
		await expect(
			handleSendBuddyInvite('ada', { email: 'friend@example.com' }, runtime(capture.fetchImpl, now, 'disabled'))
		).rejects.toMatchObject({ code: 'failed-precondition' });
		expect(capture.posted).toHaveLength(0);
		expect(twilioEmailConfigured(SID, 'disabled')).toBe(false);
	});

	it('logs a Twilio failure without the address or the response body', async () => {
		await player('ada', 'ada@example.com', 'Ada');
		const capture = mailCapture();
		capture.setFail(500);
		const lines: string[] = [];
		const spy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
			lines.push(String(message));
		});
		try {
			await expect(
				handleSendBuddyInvite('ada', { email: 'friend@example.com', message: 'TABLESIDE' }, runtime(capture.fetchImpl))
			).rejects.toMatchObject({ code: 'internal' });
			expect(lines.join('\n')).toContain('failed http 500');
			expect(lines.join('\n')).not.toContain('friend@example.com');
			expect(lines.join('\n')).not.toContain('TABLESIDE');
			expect(lines.join('\n')).not.toContain('secret-body');
			capture.setFail('network');
			await expect(
				handleSendBuddyInvite('ada', { email: 'other@example.com' }, runtime(capture.fetchImpl, now + 1))
			).rejects.toMatchObject({ code: 'internal' });
			expect(lines.join('\n')).toContain('failed network');
			expect((await getFirestore().collection('buddyEmailRate').get()).empty).toBe(true);
		} finally {
			spy.mockRestore();
		}
	});

	it('accepts once for the invited address and rejects a different account', async () => {
		await player('ada', 'ada@example.com', 'Ada');
		await player('friend', 'friend@example.com', 'Friend');
		await player('other', 'other@example.com', 'Other');
		const capture = mailCapture();
		await handleSendBuddyInvite('ada', { email: 'friend@example.com' }, runtime(capture.fetchImpl));
		const { accept } = linksFrom(capture.posted[0]);
		await expect(
			handleAcceptBuddyEmailInvite('other', { token: accept }, { authToken: TOKEN, nowMs: now + 1000 })
		).rejects.toThrow(/Sign in with the email address/);
		const invite = (await getFirestore().collection('buddyEmailInvites').get()).docs[0];
		expect(invite.get('usedAt')).toBeNull();
		expect(JSON.stringify(invite.data())).not.toContain('friend@example.com');

		const accepted = await handleAcceptBuddyEmailInvite('friend', { token: accept }, { authToken: TOKEN, nowMs: now + 2000 });
		expect(accepted).toEqual({ status: 'accepted' });
		expect((await getFirestore().doc('buddies/ada~friend').get()).get('status')).toBe('accepted');
		expect((await getFirestore().collection('buddyEmailInvites').get()).docs[0].get('usedAt')).toBeTruthy();
		await expect(
			handleAcceptBuddyEmailInvite('friend', { token: accept }, { authToken: TOKEN, nowMs: now + 3000 })
		).rejects.toMatchObject({ code: 'failed-precondition' });

		const tampered = `${accept.slice(0, -1)}${accept.endsWith('a') ? 'b' : 'a'}`;
		await expect(
			handleAcceptBuddyEmailInvite('friend', { token: tampered }, { authToken: TOKEN, nowMs: now + 4000 })
		).rejects.toMatchObject({ code: 'not-found' });
	});

	it('rejects an expired token without marking it used', async () => {
		await player('ada', 'ada@example.com', 'Ada');
		await player('friend', 'friend@example.com', 'Friend');
		const capture = mailCapture();
		await handleSendBuddyInvite('ada', { email: 'friend@example.com' }, runtime(capture.fetchImpl));
		const { accept } = linksFrom(capture.posted[0]);
		await expect(
			handleAcceptBuddyEmailInvite(
				'friend',
				{ token: accept },
				{ authToken: TOKEN, nowMs: now + BUDDY_EMAIL_INVITE_TTL_MS }
			)
		).rejects.toMatchObject({ code: 'not-found' });
		expect((await getFirestore().collection('buddyEmailInvites').get()).docs[0].get('usedAt')).toBeNull();
	});

	it('confirms before suppressing, then skips later sends', async () => {
		await player('ada', 'ada@example.com', 'Ada');
		const capture = mailCapture();
		await handleSendBuddyInvite('ada', { email: 'friend@example.com' }, runtime(capture.fetchImpl));
		const { suppress } = linksFrom(capture.posted[0]);
		const hash = emailAddressHash('friend@example.com', TOKEN);
		const viewed = await handleSuppressBuddyEmailInvite({ method: 'GET', query: { token: suppress }, nowMs: now });
		expect(viewed.statusCode).toBe(200);
		expect(viewed.body).toContain("Don't email me invites again");
		expect(viewed.body).toContain('does not change anything');
		expect((await getFirestore().doc(`buddyEmailSuppress/${hash}`).get()).exists).toBe(false);

		const confirmed = await handleSuppressBuddyEmailInvite({
			method: 'POST',
			body: `token=${encodeURIComponent(suppress)}`,
			nowMs: now + 1
		});
		expect(confirmed.statusCode).toBe(200);
		expect(confirmed.body).toContain('Invites stopped');
		expect((await getFirestore().doc(`buddyEmailSuppress/${hash}`).get()).exists).toBe(true);

		const later = await handleSendBuddyInvite(
			'ada',
			{ email: 'friend@example.com' },
			runtime(capture.fetchImpl, now + BUDDY_EMAIL_INVITE_TTL_MS)
		);
		expect(later).toEqual({ status: 'sent' });
		expect(capture.posted).toHaveLength(1);

		const unknown = await handleSuppressBuddyEmailInvite({ method: 'GET', query: { token: 'missing' } });
		expect(unknown.statusCode).toBe(400);
		expect(unknown.body).not.toContain('friend@example.com');
	});

	it('exports the sent invite without the address and deletes the sender records', async () => {
		await player('ada', 'ada@example.com', 'Ada');
		await player('grace', 'grace@example.com', 'Grace');
		const capture = mailCapture();
		await handleSendBuddyInvite('ada', { email: 'friend@example.com', message: 'Hello' }, runtime(capture.fetchImpl));
		const previousSid = process.env.TWILIO_ACCOUNT_SID;
		const previousToken = process.env.TWILIO_AUTH_TOKEN;
		process.env.TWILIO_ACCOUNT_SID = SID;
		process.env.TWILIO_AUTH_TOKEN = TOKEN;
		try {
			const adaHash = emailAddressHash('ada@example.com', TOKEN);
			const otherHash = 'cd'.repeat(32);
			await getFirestore().doc(`buddyEmailRate/${adaHash}`).set({ sentAt: now });
			await getFirestore().doc(`buddyEmailSuppress/${adaHash}`).set({ suppressedAt: '2026-10-18T12:00:00.000Z' });
			await getFirestore().doc(`buddyEmailSuppress/${otherHash}`).set({ suppressedAt: '2026-10-01T00:00:00.000Z' });
			await getFirestore().doc('buddyEmailInvites/to-ada').set({
				fromUid: 'grace',
				emailHash: adaHash,
				exp: now,
				message: '',
				usedAt: null,
				createdAt: '2026-10-18T12:00:00.000Z'
			});

			const exported = await exportAccount('ada');
			const packed = JSON.stringify(exported);
			expect(packed).toContain('buddyEmailInvites');
			expect(packed).toContain('Hello');
			expect(packed).not.toContain('friend@example.com');
			expect(packed).not.toContain(TOKEN);

			await eraseAccount('ada');
			const db = getFirestore();
			expect((await db.collection('buddyEmailInvites').where('fromUid', '==', 'ada').get()).empty).toBe(true);
			expect((await db.collection('buddyEmailOptOuts').where('fromUid', '==', 'ada').get()).empty).toBe(true);
			expect((await db.doc('buddyEmailInvites/to-ada').get()).exists).toBe(false);
			expect((await db.doc(`buddyEmailRate/${adaHash}`).get()).exists).toBe(false);
			expect((await db.doc(`buddyEmailSuppress/${adaHash}`).get()).exists).toBe(false);
			expect((await db.doc(`buddyEmailSuppress/${otherHash}`).get()).exists).toBe(true);
			expect((await db.doc(`buddyEmailRate/${emailAddressHash('friend@example.com', TOKEN)}`).get()).exists).toBe(true);
		} finally {
			if (previousSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
			else process.env.TWILIO_ACCOUNT_SID = previousSid;
			if (previousToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
			else process.env.TWILIO_AUTH_TOKEN = previousToken;
		}
	});
});
