import { getApps, initializeApp } from 'firebase-admin/app';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { USAGE_STATS_SCHEDULE, USAGE_STATS_TIME_ZONE, publishUsageStats as runUsageStats } from '../../stats/job.ts';
import { queueContactEmail } from './contactEmail.ts';
import { handleAdminUsersWrite } from './disableUser.ts';

if (getApps().length === 0) {
  initializeApp();
}

/** Pinned so a deploy does not move regions under an existing trigger. */
export const FUNCTIONS_REGION = 'us-central1';

/**
 * Daily usage totals. Same cron as the old GitHub Action, in America/New_York.
 * Do not pin a runtime account or a JSON key. Cloud Functions uses the default
 * compute identity.
 */
export const publishUsageStatsOptions = {
  schedule: USAGE_STATS_SCHEDULE,
  timeZone: USAGE_STATS_TIME_ZONE,
  region: FUNCTIONS_REGION,
  memory: '256MiB',
  timeoutSeconds: 300,
  maxInstances: 1
} as const;

export const publishUsageStats = onSchedule(publishUsageStatsOptions, async () => {
  await runUsageStats();
});

/** Mirrors `adminUsers/{uid}.disabled` onto Firebase Auth. Does not delete users. */
export const syncAuthDisabled = onDocumentWritten(
  {
    document: 'adminUsers/{uid}',
    region: FUNCTIONS_REGION,
    retry: true
  },
  async (event) => {
    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;
    await handleAdminUsersWrite(
      event.params.uid,
      beforeSnap?.exists ? (beforeSnap.data() as Record<string, unknown>) : null,
      afterSnap?.exists ? (afterSnap.data() as Record<string, unknown>) : null
    );
  }
);

/**
 * Queues a Trigger Email document when a game request is created and the
 * recipient has opted in. Updates do not send another email.
 */
export const queueGameContactEmail = onDocumentCreated(
  {
    document: 'gameContacts/{contactId}',
    region: FUNCTIONS_REGION,
    retry: true
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    await queueContactEmail(event.params.contactId, snap.data() as Record<string, unknown>);
  }
);
