import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { parseSetAdminArgs } from '../app/src/lib/admin/bootstrapArgs.ts';

const PROJECT_ID = 'gaslandsgarage-74ce6';

type ServiceAccount = {
	client_email: string;
	private_key: string;
};

function serviceAccountFromEnv(): ServiceAccount | null {
	const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
	if (!raw) return null;
	const text = raw.startsWith('{') ? raw : readFileSync(raw, 'utf8');
	let parsed: Partial<ServiceAccount>;
	try {
		parsed = JSON.parse(text) as Partial<ServiceAccount>;
	} catch {
		throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON.');
	}
	if (!parsed.client_email || !parsed.private_key) {
		throw new Error('FIREBASE_SERVICE_ACCOUNT is missing client_email or private_key.');
	}
	return { client_email: parsed.client_email, private_key: parsed.private_key };
}

function iso(value: string | undefined, fallback: string): string {
	if (!value) return fallback;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return fallback;
	return parsed.toISOString();
}

export async function setAdministrator(email: string): Promise<void> {
	const account = serviceAccountFromEnv();
	if (account) {
		initializeApp({
			credential: cert({
				projectId: PROJECT_ID,
				clientEmail: account.client_email,
				privateKey: account.private_key
			}),
			projectId: PROJECT_ID
		});
		console.log(`Using service account ${account.client_email}`);
	} else {
		initializeApp({ projectId: PROJECT_ID });
		console.log('Using Application Default Credentials.');
	}

	let user;
	try {
		user = await getAuth().getUserByEmail(email);
	} catch (error) {
		const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
		if (code === 'auth/user-not-found') {
			throw new Error(
				`No Firebase Auth user for ${email}. Sign in to Gaslands Garage once with that account, then run this script again.`
			);
		}
		throw error;
	}

	const now = new Date().toISOString();
	const createdAt = iso(user.metadata.creationTime, now);
	const lastSignInAt = iso(user.metadata.lastSignInTime, createdAt);
	const db = getFirestore();
	await db.doc(`roles/${user.uid}`).set({
		role: 'Administrator',
		updatedAt: now,
		updatedBy: 'bootstrap'
	});

	const profile = db.doc(`users/${user.uid}`);
	const existing = await profile.get();
	const data: Record<string, string> = {
		uid: user.uid,
		email: user.email ?? email,
		displayName: user.displayName ?? '',
		lastSignInAt
	};
	if (!existing.exists || typeof existing.get('createdAt') !== 'string') data.createdAt = createdAt;
	if (!existing.exists || typeof existing.get('lastSeenAt') !== 'string') data.lastSeenAt = lastSignInAt;
	await profile.set(data, { merge: true });

	console.log(`Set roles/${user.uid} to Administrator for ${user.email ?? email}.`);
}

async function main(): Promise<void> {
	try {
		const { email } = parseSetAdminArgs(process.argv.slice(2));
		await setAdministrator(email);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Could not set the administrator.';
		console.error(message);
		process.exitCode = 1;
	}
}

const isDirectRun = process.argv[1]?.includes('set-admin');
if (isDirectRun) {
	void main();
}
