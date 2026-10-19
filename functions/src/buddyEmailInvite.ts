import { randomBytes } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import {
	BUDDY_COLLECTIONS,
	BUDDY_EMAIL_INVITE_TTL_MS,
	BUDDY_EMAIL_INVITE_WINDOW_MS,
	BUDDY_EMAIL_INVITES_PER_DAY,
	BUDDY_EMAIL_RECIPIENT_WINDOW_MS,
	buddyBlockId,
	buddyPairId,
	buddyRequestId,
	rollingWindow
} from '../../app/src/lib/buddies/model.ts';
import {
	acceptInviteUrl,
	buildInviteMail,
	emailAddressHash,
	escapeHtml,
	hashSecret,
	normalizeInviteEmail,
	sanitizeInviteMessage,
	signEmailInvite,
	suppressInviteUrl,
	twilioEmailConfigured,
	verifyEmailInvite
} from '../../app/src/lib/buddies/emailInvite.ts';
import { assertCaller, publicBuddyName, targetIsActive } from './buddies.ts';
import { MAIL_FROM_NAME, postTwilioEmail, type TwilioEmail } from './sendMail.ts';
import { mailFromAddress, twilioAccountSid, twilioAuthToken } from './twilioConfig.ts';

const SENT = { status: 'sent' as const };

export const buddyEmailCallableOptions = {
	region: 'us-central1' as const,
	memory: '256MiB' as const,
	timeoutSeconds: 60,
	maxInstances: 10,
	secrets: [twilioAccountSid, twilioAuthToken]
};

export const suppressHttpsOptions = {
	region: 'us-central1',
	memory: '256MiB' as const,
	timeoutSeconds: 30,
	maxInstances: 10,
	invoker: 'public' as const,
	cors: false as const
};

type TwilioRuntime = {
	accountSid: string;
	authToken: string;
	fromAddress: string;
	fetchImpl?: typeof fetch;
	nowMs?: number;
};

function configured(config: TwilioRuntime): boolean {
	return twilioEmailConfigured(config.accountSid, config.authToken) && Boolean(config.fromAddress.trim());
}

function newId(): string {
	return randomBytes(16).toString('hex');
}

const VERIFY_EMAIL =
	'Verify your email address before accepting this invite. Google sign-in is already verified.';

type PendingInvite = {
	jti: string;
	fromUid: string;
	emailHash: string;
	exp: number;
	message: string;
	createdAt: string;
	optOutId: string;
};

/**
 * Claims the sender's daily slot and, when a message will actually be sent,
 * the address cooldown and the invite document. The invite exists before Twilio
 * is called, so a token that was emailed can be accepted even if the "sent"
 * mark has not landed yet. Two senders cannot both pass the 7-day check.
 * A suppressed or cooling address still consumes a sender slot and returns
 * "skip" so the caller can answer "sent".
 */
async function reserveInvite(
	uid: string,
	hash: string,
	nowMs: number,
	invite: PendingInvite
): Promise<'limited' | 'skip' | 'claimed'> {
	const db = getFirestore();
	const rateRef = db.doc(`${BUDDY_COLLECTIONS.rate}/${uid}`);
	const suppressRef = db.doc(`${BUDDY_COLLECTIONS.emailSuppress}/${hash}`);
	const coolRef = db.doc(`${BUDDY_COLLECTIONS.emailRate}/${hash}`);
	return db.runTransaction(async (tx) => {
		const [rateSnap, suppressSnap, coolSnap] = await Promise.all([tx.get(rateRef), tx.get(suppressRef), tx.get(coolRef)]);
		const next = rollingWindow(
			rateSnap.get('emailInviteAt'),
			nowMs,
			BUDDY_EMAIL_INVITES_PER_DAY,
			BUDDY_EMAIL_INVITE_WINDOW_MS
		);
		if (!next.allowed) return 'limited';
		tx.set(rateRef, { emailInviteAt: next.stamps }, { merge: true });
		if (suppressSnap.exists) return 'skip';
		const sentAt = coolSnap.get('sentAt');
		if (typeof sentAt === 'number' && nowMs - sentAt < BUDDY_EMAIL_RECIPIENT_WINDOW_MS) return 'skip';
		tx.set(coolRef, { sentAt: nowMs, state: 'reserved' });
		tx.set(db.doc(`${BUDDY_COLLECTIONS.emailInvites}/${invite.jti}`), {
			fromUid: invite.fromUid,
			emailHash: invite.emailHash,
			exp: invite.exp,
			message: invite.message,
			usedAt: null,
			createdAt: invite.createdAt
		});
		tx.set(db.doc(`${BUDDY_COLLECTIONS.emailOptOuts}/${invite.optOutId}`), {
			emailHash: invite.emailHash,
			fromUid: invite.fromUid,
			inviteId: invite.jti,
			createdAt: invite.createdAt
		});
		return 'claimed';
	});
}

/** Drops a reservation and the invite after Twilio did not accept the message. */
async function releaseReservation(hash: string, nowMs: number, invite: PendingInvite): Promise<void> {
	const db = getFirestore();
	const ref = db.doc(`${BUDDY_COLLECTIONS.emailRate}/${hash}`);
	await db.runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		if (snap.get('state') === 'reserved' && snap.get('sentAt') === nowMs) tx.delete(ref);
		tx.delete(db.doc(`${BUDDY_COLLECTIONS.emailInvites}/${invite.jti}`));
		tx.delete(db.doc(`${BUDDY_COLLECTIONS.emailOptOuts}/${invite.optOutId}`));
	});
}

export async function handleSendBuddyInvite(
	uid: string | undefined,
	data: unknown,
	config: TwilioRuntime
): Promise<{ status: 'sent' }> {
	const caller = await assertCaller(uid);
	if (!configured(config)) {
		throw new HttpsError('failed-precondition', 'Email invites are not available yet. Share your invite link instead.');
	}
	const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
	const email = normalizeInviteEmail(body.email);
	if (!email) throw new HttpsError('invalid-argument', 'Enter an email address.');
	const message = sanitizeInviteMessage(body.message);
	const nowMs = config.nowMs ?? Date.now();
	const hash = emailAddressHash(email, config.authToken);
	const authUser = await getAuth().getUser(caller);
	const own = normalizeInviteEmail(authUser.email);
	if (own && emailAddressHash(own, config.authToken) === hash) {
		throw new HttpsError('failed-precondition', 'You cannot invite yourself.');
	}
	const jti = newId();
	const exp = nowMs + BUDDY_EMAIL_INVITE_TTL_MS;
	const acceptToken = signEmailInvite({ jti, exp, fromUid: caller }, config.authToken);
	const optOutToken = randomBytes(32).toString('base64url');
	const stamp = new Date(nowMs).toISOString();
	const pending: PendingInvite = {
		jti,
		fromUid: caller,
		emailHash: hash,
		exp,
		message,
		createdAt: stamp,
		optOutId: hashSecret(optOutToken)
	};
	const slot = await reserveInvite(caller, hash, nowMs, pending);
	if (slot === 'limited') {
		throw new HttpsError('resource-exhausted', 'You can send 10 email invites a day. Try again tomorrow.');
	}
	if (slot === 'skip') return SENT;

	const name = await publicBuddyName(caller);
	const mail = buildInviteMail({
		displayName: name,
		message,
		acceptUrl: acceptInviteUrl(acceptToken),
		suppressUrl: suppressInviteUrl(optOutToken)
	});
	const payload: TwilioEmail = {
		from: { address: config.fromAddress.trim(), name: MAIL_FROM_NAME },
		to: [{ address: email }],
		content: mail
	};
	let posted;
	try {
		posted = await postTwilioEmail(
			payload,
			{ accountSid: config.accountSid, authToken: config.authToken },
			config.fetchImpl
		);
	} catch {
		console.info('buddies email-invite failed network');
		await releaseReservation(hash, nowMs, pending);
		throw new HttpsError('internal', 'Could not send that invite. Try again.');
	}
	if (!posted.ok) {
		console.info(`buddies email-invite failed http ${posted.status}`);
		await releaseReservation(hash, nowMs, pending);
		throw new HttpsError('internal', 'Could not send that invite. Try again.');
	}
	const db = getFirestore();
	const batch = db.batch();
	batch.update(db.doc(`${BUDDY_COLLECTIONS.emailInvites}/${jti}`), { sentAt: stamp });
	batch.set(db.doc(`${BUDDY_COLLECTIONS.emailRate}/${hash}`), { sentAt: nowMs, state: 'sent' });
	await batch.commit();
	console.info('buddies email-invite sent');
	return SENT;
}

async function writeAcceptedBuddy(
	fromUid: string,
	toUid: string,
	nowMs: number,
	jti: string
): Promise<'accept' | 'already' | 'used' | 'blocked'> {
	const db = getFirestore();
	const buddyRef = db.doc(`${BUDDY_COLLECTIONS.buddies}/${buddyPairId(fromUid, toUid)}`);
	const inviteRef = db.doc(`${BUDDY_COLLECTIONS.emailInvites}/${jti}`);
	const sentRef = db.doc(`${BUDDY_COLLECTIONS.requests}/${buddyRequestId(fromUid, toUid)}`);
	const reverseRef = db.doc(`${BUDDY_COLLECTIONS.requests}/${buddyRequestId(toUid, fromUid)}`);
	const blockOut = db.doc(`${BUDDY_COLLECTIONS.blocks}/${buddyBlockId(fromUid, toUid)}`);
	const blockIn = db.doc(`${BUDDY_COLLECTIONS.blocks}/${buddyBlockId(toUid, fromUid)}`);
	const fromName = await publicBuddyName(fromUid);
	const toName = await publicBuddyName(toUid);
	const stamp = new Date(nowMs).toISOString();
	return db.runTransaction(async (tx: Transaction) => {
		const [inviteSnap, buddySnap, blockA, blockB] = await Promise.all([
			tx.get(inviteRef),
			tx.get(buddyRef),
			tx.get(blockOut),
			tx.get(blockIn)
		]);
		if (!inviteSnap.exists || inviteSnap.get('fromUid') !== fromUid || inviteSnap.get('usedAt')) return 'used';
		if (blockA.exists || blockB.exists) return 'blocked';
		if (buddySnap.exists && buddySnap.get('status') === 'accepted') {
			tx.update(inviteRef, { usedAt: stamp });
			return 'already';
		}
		tx.set(buddyRef, {
			members: [fromUid, toUid].sort(),
			status: 'accepted',
			names: { [fromUid]: fromName, [toUid]: toName },
			createdAt: buddySnap.get('createdAt') || stamp,
			updatedAt: stamp
		});
		tx.delete(sentRef);
		tx.delete(reverseRef);
		tx.update(inviteRef, { usedAt: stamp });
		return 'accept';
	});
}

export async function handleAcceptBuddyEmailInvite(
	uid: string | undefined,
	data: unknown,
	config: { authToken: string; nowMs?: number; emailVerified?: boolean }
): Promise<{ status: 'accepted' | 'already' }> {
	const caller = await assertCaller(uid);
	if (!twilioEmailConfigured('AC00000000000000000000000000000000', config.authToken)) {
		throw new HttpsError('failed-precondition', 'That invite is not available.');
	}
	const token = data && typeof data === 'object' ? (data as { token?: unknown }).token : undefined;
	const nowMs = config.nowMs ?? Date.now();
	const signed = verifyEmailInvite(token, config.authToken, nowMs);
	if (!signed) throw new HttpsError('not-found', 'That invite is not valid.');
	if (!(await targetIsActive(signed.fromUid))) {
		throw new HttpsError('failed-precondition', 'That player is not available to add.');
	}
	const record = await getAuth().getUser(caller);
	const email = normalizeInviteEmail(record.email);
	const snap = await getFirestore().doc(`${BUDDY_COLLECTIONS.emailInvites}/${signed.jti}`).get();
	if (!snap.exists || snap.get('fromUid') !== signed.fromUid) {
		throw new HttpsError('not-found', 'That invite is not valid.');
	}
	if (config.emailVerified !== true) {
		throw new HttpsError('failed-precondition', VERIFY_EMAIL);
	}
	if (!email || snap.get('emailHash') !== emailAddressHash(email, config.authToken)) {
		throw new HttpsError('failed-precondition', 'Sign in with the email address that received this invite.');
	}
	if (signed.fromUid === caller) throw new HttpsError('failed-precondition', 'You cannot invite yourself.');
	const outcome = await writeAcceptedBuddy(signed.fromUid, caller, nowMs, signed.jti);
	if (outcome === 'used') throw new HttpsError('failed-precondition', 'That invite was already used.');
	if (outcome === 'blocked') throw new HttpsError('failed-precondition', 'That player is not available to add.');
	console.info(`buddies email-accept ${outcome}`);
	return { status: outcome === 'already' ? 'already' : 'accepted' };
}

function page(title: string, body: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 36rem; margin: 2rem auto; padding: 0 1rem; color: #292524;">
<h1 style="font-size: 1.5rem;">${title}</h1>
${body}
</body>
</html>`;
}

function htmlResponse(statusCode: number, body: string): { statusCode: number; headers: Record<string, string>; body: string } {
	return {
		statusCode,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
			'Referrer-Policy': 'no-referrer',
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'"
		},
		body
	};
}

function postedToken(body: unknown): string {
	if (typeof body === 'string') return new URLSearchParams(body).get('token') ?? '';
	if (body && typeof body === 'object' && typeof (body as { token?: unknown }).token === 'string') {
		return (body as { token: string }).token;
	}
	return '';
}

function queryToken(query: unknown): string {
	if (query && typeof query === 'object' && typeof (query as { token?: unknown }).token === 'string') {
		return (query as { token: string }).token;
	}
	return '';
}

export async function handleSuppressBuddyEmailInvite(req: {
	method?: string;
	query?: unknown;
	body?: unknown;
	nowMs?: number;
}): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
	const method = (req.method ?? '').toUpperCase();
	if (method !== 'GET' && method !== 'POST') {
		return {
			statusCode: 405,
			headers: { Allow: 'GET, POST', 'Content-Type': 'text/plain; charset=utf-8' },
			body: 'Method not allowed'
		};
	}
	const token = method === 'POST' ? postedToken(req.body) : queryToken(req.query);
	const snap = token
		? await getFirestore().doc(`${BUDDY_COLLECTIONS.emailOptOuts}/${hashSecret(token)}`).get()
		: null;
	if (!snap?.exists) return htmlResponse(400, page('Link not valid', '<p>This link does not match an invite.</p>'));
	if (method === 'GET') {
		return htmlResponse(
			200,
			page(
				'Stop buddy invite email',
				`<p>Opening this page does not change anything.</p>
<form method="post">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<button type="submit">Don't email me invites again</button>
</form>`
			)
		);
	}
	const hash = snap.get('emailHash');
	if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
		return htmlResponse(400, page('Link not valid', '<p>This link does not match an invite.</p>'));
	}
	await getFirestore()
		.doc(`${BUDDY_COLLECTIONS.emailSuppress}/${hash}`)
		.set({ suppressedAt: new Date(req.nowMs ?? Date.now()).toISOString() });
	console.info('buddies email-suppress');
	return htmlResponse(200, page('Invites stopped', '<p>We will not email buddy invites to that address.</p>'));
}

export const sendBuddyInvite = onCall(buddyEmailCallableOptions, async (request) => {
	return handleSendBuddyInvite(request.auth?.uid, request.data, {
		accountSid: twilioAccountSid.value(),
		authToken: twilioAuthToken.value(),
		fromAddress: mailFromAddress.value()
	});
});

export const acceptBuddyEmailInvite = onCall(buddyEmailCallableOptions, async (request) => {
	return handleAcceptBuddyEmailInvite(request.auth?.uid, request.data, {
		authToken: twilioAuthToken.value(),
		emailVerified: request.auth?.token?.email_verified === true
	});
});

export const suppressBuddyEmailInvites = onRequest(suppressHttpsOptions, async (req, res) => {
	const result = await handleSuppressBuddyEmailInvite({ method: req.method, query: req.query, body: req.body });
	res.status(result.statusCode);
	for (const [name, value] of Object.entries(result.headers)) res.set(name, value);
	res.send(result.body);
});
