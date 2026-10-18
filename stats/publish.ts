import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { aggregateUsage } from './aggregate';
import { USERS_COLLECTION, syncUserProfiles } from './usersSync';

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

async function listAuthUsers(): Promise<UserRecord[]> {
  const auth = getAuth();
  const users: UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function loadUserProfiles(): Promise<Map<string, Record<string, unknown>>> {
  const db = getFirestore();
  const profiles = new Map<string, Record<string, unknown>>();
  let last: QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = db.collection(USERS_COLLECTION).orderBy('__name__').limit(PAGE_SIZE);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;
    for (const doc of snap.docs) profiles.set(doc.id, doc.data());
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }
  return profiles;
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

  const [authUsers, teams, profiles] = await Promise.all([listAuthUsers(), loadTeams(), loadUserProfiles()]);
  const stats = aggregateUsage(teams, authUsers.length);
  await getFirestore().doc('stats/public').set(stats);

  console.log(
    `Wrote stats/public at ${stats.updatedAt}: ${stats.totalUsers} users, ${stats.totalTeams} teams, ${stats.totalVehicles} vehicles`
  );

  const db = getFirestore();
  const writer = db.bulkWriter();
  const sync = await syncUserProfiles(
    authUsers,
    profiles,
    {
      create: (uid, data) => writer.create(db.doc(`${USERS_COLLECTION}/${uid}`), data),
      update: (uid, data) => writer.update(db.doc(`${USERS_COLLECTION}/${uid}`), data),
      flush: () => writer.flush()
    },
    new Date().toISOString()
  );
  await writer.close();
  console.log(
    `Synced ${USERS_COLLECTION}: ${sync.created} created, ${sync.updated} updated, ${sync.unchanged} unchanged, ${sync.failed} failed`
  );
  if (sync.failed > 0) {
    throw new Error(`${sync.failed} ${USERS_COLLECTION} writes failed`);
  }
}

const isDirectRun = process.argv[1]?.includes('publish');
if (isDirectRun) {
  publishUsageStats().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Usage stats publish failed';
    console.error(message);
    process.exitCode = 1;
  });
}
