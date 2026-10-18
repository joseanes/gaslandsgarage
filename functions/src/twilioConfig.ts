import { defineSecret, defineString } from 'firebase-functions/params';
import { DEFAULT_MAIL_FROM_ADDRESS } from './sendMail.ts';

/**
 * Twilio Email credentials. The values live in Secret Manager or the process
 * environment, never in source. PR #25 (cursor/twilio-email-mail-496a) defines
 * the same secret names for queued game-request mail. Keep a single
 * defineSecret per name when that pull request merges.
 */
export const twilioAccountSid = defineSecret('TWILIO_ACCOUNT_SID');
export const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN');

export const mailFromAddress = defineString('MAIL_FROM_ADDRESS', {
	default: DEFAULT_MAIL_FROM_ADDRESS,
	description: 'From address for transactional email. The domain must be verified in the Twilio Console.'
});
