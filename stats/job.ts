import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { aggregateUsage } from './aggregate';
import { USERS_COLLECTION, syncUserProfiles } from './usersSync';

/** Firebase project that owns Auth and Firestore. Hosting stays on AWS. */
export const USAGE_STATS_PROJECT_ID = 'gaslandsgarage-74ce6';

/**
 * Same five-field cron as `.github/workflows/usage-stats.yml`.
 * GitHub Actions always runs that cron in UTC. Cloud Scheduler runs it in
 * `USAGE_STATS_TIME_ZONE`, which is 06:15 in New York.
 */
export const USAGE_STATS_SCHEDULE = '15 6 * * *';
export const USAGE_STATS_TIME_ZONE = 'America/New_York';

const PAGE_SIZE = 300;

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

/**
 * The Cloud Function and the manual workflow each initialize the Admin SDK
 * before calling this. Tests that load this file through a second copy of
 * firebase-admin initialize that copy here. No service account key is read.
 */
function ensureApp(projectId: string): void {
  if (getApps().length > 0) return;
  initializeApp({ projectId });
}

/**
 * Writes `stats/public` and upserts `users/{uid}` from Firebase Auth.
 * The scheduled function uses the default runtime identity. The manual
 * workflow still passes a service account. This module does not read a key.
 */
export async function publishUsageStats(): Promise<void> {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || USAGE_STATS_PROJECT_ID;
  ensureApp(projectId);
  console.log(`Counting usage for ${projectId}`);

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
