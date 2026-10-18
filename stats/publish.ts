import { cert, initializeApp } from 'firebase-admin/app';
import { USAGE_STATS_PROJECT_ID, publishUsageStats } from './job';

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
      projectId: USAGE_STATS_PROJECT_ID,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key
    })
  };
}

/**
 * Manual entry for `pnpm publish-stats`. The daily run is the Cloud Function
 * in `functions/`, which does not use this key.
 */
export async function publishUsageStatsWithServiceAccount(): Promise<void> {
  const { email, credential } = credentialFromEnv();
  initializeApp({ credential, projectId: USAGE_STATS_PROJECT_ID });
  console.log(`Counting usage for ${USAGE_STATS_PROJECT_ID} as ${email}`);
  await publishUsageStats();
}

const isDirectRun = process.argv[1]?.includes('publish');
if (isDirectRun) {
  publishUsageStatsWithServiceAccount().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Usage stats publish failed';
    console.error(message);
    process.exitCode = 1;
  });
}
