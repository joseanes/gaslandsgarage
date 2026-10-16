import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { aggregateUsage } from './aggregate';

const PROJECT_ID = 'gaslandsgarage-74ce6';
const PAGE_SIZE = 300;

function credentialFromEnv() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw?.trim()) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not set. See stats/README.md.');
  }
  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON.');
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing client_email or private_key.');
  }
  return {
    email: parsed.client_email,
    credential: cert({
      projectId: PROJECT_ID,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key
    })
  };
}

async function countAuthUsers(): Promise<number> {
  const auth = getAuth();
  let total = 0;
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    total += page.users.length;
    pageToken = page.pageToken;
  } while (pageToken);
  return total;
}

async function loadTeams(): Promise<unknown[]> {
  const db = getFirestore();
  const teams: unknown[] = [];
  let last: QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = db.collection('teams').orderBy('__name__').limit(PAGE_SIZE);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;
    for (const doc of snap.docs) teams.push(doc.data());
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }
  return teams;
}

export async function publishUsageStats(): Promise<void> {
  const { email, credential } = credentialFromEnv();
  initializeApp({ credential, projectId: PROJECT_ID });
  console.log(`Counting usage for ${PROJECT_ID} as ${email}`);

  const [totalUsers, teams] = await Promise.all([countAuthUsers(), loadTeams()]);
  const stats = aggregateUsage(teams, totalUsers);
  await getFirestore().doc('stats/public').set(stats);

  console.log(
    `Wrote stats/public at ${stats.updatedAt}: ${stats.totalUsers} users, ${stats.totalTeams} teams, ${stats.totalVehicles} vehicles`
  );
}

const isDirectRun = process.argv[1]?.includes('publish');
if (isDirectRun) {
  publishUsageStats().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Usage stats publish failed';
    console.error(message);
    process.exitCode = 1;
  });
}
