import { getApps, initializeApp } from 'firebase-admin/app';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { USAGE_STATS_SCHEDULE, USAGE_STATS_TIME_ZONE, publishUsageStats as runUsageStats } from '../../stats/job.ts';
import { deleteMyAccount, exportMyData } from './accountPrivacy.ts';
import { acceptBuddyEmailInvite, sendBuddyInvite, suppressBuddyEmailInvites } from './buddyEmailInvite.ts';
import {
	cancelBuddyRequest,
	getBuddyInvite,
	removeBuddy,
	respondBuddyRequest,
	saveBuddyProfile,
	searchBuddyPlayers,
	sendBuddyRequest,
	unblockBuddy
} from './buddies.ts';
import { syncNewsletterToken, unsubscribeNewsletter } from './newsletter.ts';
import { queueContactEmail } from './contactEmail.ts';
import { handleAdminUsersWrite } from './disableUser.ts';
import { MAIL_FROM_NAME, deliverQueuedMail } from './sendMail.ts';
import { mailFromAddress, twilioAccountSid, twilioAuthToken } from './twilioConfig.ts';

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

/**
 * Sends a queued game-request email through Twilio and keeps the mail document.
 * The document id is the idempotency key. If a Trigger Email extension is also
 * installed on `mail`, disable it or each request is sent twice.
 */
export const deliverGameContactEmail = onDocumentCreated(
  {
    document: 'mail/{mailId}',
    region: FUNCTIONS_REGION,
    retry: true,
    secrets: [twilioAccountSid, twilioAuthToken]
  },
  async (event) => {
    const mailId = event.params.mailId;
    if (!mailId.startsWith('gameContact_')) return;
    await deliverQueuedMail(mailId, {
      accountSid: twilioAccountSid.value(),
      authToken: twilioAuthToken.value(),
      fromAddress: mailFromAddress.value(),
      fromName: MAIL_FROM_NAME,
      leaseId: event.id
    });
  }
);

/**
 * Self-service download and deletion for the signed-in account.
 * `deleteMyAccount` is the only function that deletes an Auth user, and only
 * that caller's user. Admin disable does not delete anyone.
 */
export { deleteMyAccount, exportMyData };

/**
 * Painted-car photos. The signed-in player reserves a metadata document here.
 * The browser then uploads the image. Clients cannot create the document
 * themselves, so the 3-per-vehicle and 100-per-account limits hold.
 */
export { reserveVehiclePhoto } from './vehiclePhotos.ts';

/**
 * Gaming buddies. Links are created only here, with the Admin SDK.
 * Clients cannot write `buddies`, requests, blocks, invites, or the directory.
 */
export {
	cancelBuddyRequest,
	getBuddyInvite,
	removeBuddy,
	respondBuddyRequest,
	saveBuddyProfile,
	searchBuddyPlayers,
	sendBuddyRequest,
	unblockBuddy
};

/**
 * Email buddy invites. `sendBuddyInvite` and `acceptBuddyEmailInvite` require
 * a signed-in account. `suppressBuddyEmailInvites` is a public HTTPS link.
 * GET shows a confirm page and changes nothing. POST stops future invite mail
 * to that address. Tokens are not readable by clients.
 */
export { acceptBuddyEmailInvite, sendBuddyInvite, suppressBuddyEmailInvites };

/**
 * Monthly-email unsubscribe. `syncNewsletterToken` stores a random token when
 * a player opts in. `unsubscribeNewsletter` is a public HTTPS link, with no
 * sign-in. GET only asks the reader to confirm. POST sets `newsletterOptIn`
 * to false for that token. It does not send the monthly email.
 */
export { syncNewsletterToken, unsubscribeNewsletter };

/**
 * Server-side map offset. The signed-in player sends a city or ZIP point.
 * The function stores only the 2–8 km approximate point. Clients cannot write it.
 */
export { placeMapPoint } from './mapPlacement.ts';
