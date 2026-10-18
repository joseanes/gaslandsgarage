import { getApps, initializeApp } from 'firebase-admin/app';
import { defineSecret, defineString } from 'firebase-functions/params';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { USAGE_STATS_SCHEDULE, USAGE_STATS_TIME_ZONE, publishUsageStats as runUsageStats } from '../../stats/job.ts';
import { queueContactEmail } from './contactEmail.ts';
import { handleAdminUsersWrite } from './disableUser.ts';
import { DEFAULT_MAIL_FROM_ADDRESS, deliverQueuedMail, MAIL_FROM_NAME } from './sendMail.ts';

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
 * Queues a mail document when a game request is created and the recipient has
 * opted in. Updates do not queue another email.
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

/** Account SID for Twilio Email HTTP Basic auth. Value lives in Secret Manager. */
export const twilioAccountSid = defineSecret('TWILIO_ACCOUNT_SID');

/** Auth Token for Twilio Email HTTP Basic auth. Value lives in Secret Manager. */
export const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN');

/** From address. The domain must be verified in the Twilio Console. */
export const mailFromAddress = defineString('MAIL_FROM_ADDRESS', {
  default: DEFAULT_MAIL_FROM_ADDRESS,
  description: 'From address for game-request email. The domain must be verified in the Twilio Console.'
});

export const sendQueuedMailOptions = {
  document: 'mail/{id}',
  region: FUNCTIONS_REGION,
  secrets: [twilioAccountSid, twilioAuthToken],
  retry: true
};

/**
 * Sends a queued `mail/{id}` document with Twilio Email.
 * Retries when the handler throws. The handler throws for HTTP 429 and 5xx,
 * network failures, a lease this event still holds, and missing Twilio config.
 * Other HTTP statuses are stored on the document and are not retried.
 */
export const sendQueuedMail = onDocumentCreated(sendQueuedMailOptions, async (event) => {
  if (!event.data) return;
  await deliverQueuedMail(event.params.id, {
    accountSid: twilioAccountSid.value(),
    authToken: twilioAuthToken.value(),
    fromAddress: mailFromAddress.value(),
    fromName: MAIL_FROM_NAME,
    leaseId: event.id
  });
});
