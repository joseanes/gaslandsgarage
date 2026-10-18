# Cloud Functions

Firebase project `gaslandsgarage-74ce6` is on the Blaze plan. Auth and Firestore stay in Firebase. The website stays on AWS S3 and CloudFront. Nothing in CI deploys functions, rules, or hosting.

The functions are 2nd gen, Node.js 22, TypeScript, in `functions/`. Node.js 20 is retired on 30 October 2026, so the runtime in `functions/package.json` is `22`. They use `firebase-admin` 14 and `firebase-functions` 7 with the default compute runtime identity. No function takes a service account key or a pinned runtime account. `sendQueuedMail` is the only function that reads secrets.

| Function | Trigger | What it does |
| --- | --- | --- |
| `publishUsageStats` | Cloud Scheduler `15 6 * * *` in `America/New_York` | Writes `stats/public` and upserts `users/{uid}`. Same job as `stats/job.ts`. |
| `syncAuthDisabled` | `adminUsers/{uid}` write | Sets Firebase Auth `disabled` to match the document. On disable, revokes refresh tokens. Does not delete the user. |
| `queueGameContactEmail` | `gameContacts/{contactId}` create | Queues one `mail` document when the recipient opted in. |
| `sendQueuedMail` | `mail/{id}` create | Sends that document with Twilio Email. |

Region is `us-central1`. `publishUsageStats` uses 256MiB, a 300 second timeout, and one instance. The Firestore triggers use the platform defaults and retry on failure. None keep a warm instance. `sendQueuedMail` throws, and so retries, only for HTTP 429, HTTP 5xx, a network failure, a lease this event still holds, or missing Twilio config. Any other HTTP status is stored on the document and is not retried.

## Usage stats

The GitHub Action cron in `.github/workflows/usage-stats.yml` is removed. **Run workflow** remains as a manual fallback that still needs the `FIREBASE_SERVICE_ACCOUNT` secret.

The function runs the same five-field cron at 06:15 America/New_York. The old Action ran that cron at 06:15 UTC, because GitHub Actions has no timezone. The count is `aggregateUsage` in `stats/aggregate.ts` plus the user upsert in `stats/usersSync.ts`. It does not write `roles` or `adminUsers`.

After `publishUsageStats` has published once, these are unused by the daily job and can be deleted:

- the JSON key on the `usage-stats` service account
- the GitHub Actions secret `FIREBASE_SERVICE_ACCOUNT`

This repository does not delete them. Deleting the secret makes **Run workflow** fail. `pnpm set-admin` can still use a key file in your shell, or Application Default Credentials. That local variable is not the GitHub secret.

## Disable and re-enable

The admin page writes `adminUsers/{uid}` (`app/src/lib/admin/api.ts`). The function calls `auth.updateUser(uid, { disabled })`. A change to `disabled: true` also calls `auth.revokeRefreshTokens(uid)`. A change to `disabled: false` re-enables the Auth user and does not revoke tokens. A repeated write of the same flag does nothing. Removing the document does nothing to Auth.

The function never calls `deleteUser`. Teams, profiles, and the Auth user stay.

## Game-request email

On create of `gameContacts/{id}`, the function reads `userSettings/{toUid}`. It queues mail only when `allowContactFromPlayers` is exactly `true`. That setting defaults to false. `receiveUpdates` is marketing consent and does not send this mail. An `openToGames` card lets another player send an in-app request. It is not consent to email, and the profile copy says the address is not shared.

The recipient address is loaded with `auth.getUser(toUid)`. It is written only as the `to` field of `mail/gameContact_{contactId}`:

```json
{
  "to": ["player@example.com"],
  "toName": "Grace",
  "message": {
    "subject": "Ada sent a Gaslands game request",
    "text": "Ada sent you a game request in Gaslands Garage.\n\n...\n\nTo turn off player contact, open your settings and clear \"Allow other players to contact me to setup a game\":\nhttps://gaslandsgarage.com/builder?openSettingsTab=general",
    "html": "<p>Ada sent you a game request in Gaslands Garage.</p><p>...</p><p>To turn off player contact, open your <a href=\"https://gaslandsgarage.com/builder?openSettingsTab=general\">settings</a> and clear \"Allow other players to contact me to setup a game\".</p>"
  },
  "expireAt": "Firestore timestamp, 30 days after the write"
}
```

The text and HTML both include `https://gaslandsgarage.com/builder?openSettingsTab=general`. That opens the builder settings, where the player can clear **Allow other players to contact me to setup a game**. The address is not in the subject or the body. `toName` is omitted when the contact has no display name, or when that name contains `@`.

`expireAt` is a Firestore timestamp 30 days after the queue write. It is not an email address. A TTL policy on that field deletes the `mail` document, which is the only stored copy of the recipient address. The policy is not created by `firebase deploy`. Turn it on once:

```bash
gcloud firestore fields ttls update expireAt --collection-group=mail --enable-ttl --project=gaslandsgarage-74ce6
```

Firestore does not delete the document at the exact timestamp. Expect the purge within about a day after `expireAt`. Until the policy is enabled, `expireAt` is only a field. `sendQueuedMail` updates `state`, `operationId`, and `error` on the same document and does not change `expireAt`.

The address is not written onto `gameContacts`, `users`, `playerProfiles`, or `userSettings`. A second delivery for the same contact id is ignored. Updates and replies do not queue another message. A disabled Auth user, or an account with no email, is skipped.

Clients cannot read or write `mail`. Firestore rules are default deny, and there is no allow rule for that collection. The queued address is not visible to the browser.

## Twilio Email

`sendQueuedMail` runs on create of `mail/{id}`. It sends with `POST https://comms.twilio.com/v1/Emails` ([mail send](https://www.twilio.com/docs/email/api/reference/mail-send-resource)). Auth is HTTP Basic, using the Twilio Account SID and Auth Token. The JSON body is:

```json
{
  "from": { "address": "noreply@gaslandsgarage.com", "name": "Gaslands Garage" },
  "to": [{ "address": "player@example.com", "name": "Grace" }],
  "content": { "subject": "...", "html": "...", "text": "..." }
}
```

`MAIL_FROM_NAME` is `Gaslands Garage`. `MAIL_FROM_ADDRESS` is a parameter whose default is `noreply@gaslandsgarage.com`. A 202 response carries `operationId`. The function writes that id and `state: sent`. It does not store the response body.

Delivery is idempotent. A transaction leases the document (`state: sending`, `leaseId`, `leaseExpiresAt` 90 seconds out) before the POST. A document that is already `sent`, or that already has `operationId`, is left alone. A lease held by another id is left alone. A retry of the same event, while its own lease is still current, throws so Cloud Functions tries again after the lease expires instead of sending a second copy. A 429 or 5xx clears the lease, writes `error`, and throws. Any other HTTP status clears the lease, writes `error` with `retryable: false`, and returns. The event is then finished. Network failures are treated like 5xx. Missing Account SID, Auth Token, or from address throws before a write, so a deploy that gains the secrets can still send.

`error` looks like this. It has the status and a fixed sentence. It does not include the Twilio body, the recipient, or the message:

```json
{ "status": 503, "message": "Twilio Email returned HTTP 503", "retryable": true }
```

Logs are the mail id and an outcome such as `sent` or `failed http 503 retry`. They do not include addresses, message bodies, the Account SID, or the Auth Token.

### Domain verification

Twilio will not send from `noreply@gaslandsgarage.com` until `gaslandsgarage.com` is an authenticated domain. Do this in the Twilio Console before the first deploy of `sendQueuedMail`. The steps match [Authenticate email messages using DNS](https://www.twilio.com/docs/email/security/domains):

1. Open the Twilio Console and go to **Communications → Email → Domains**.
2. Create an authenticated domain for `gaslandsgarage.com`.
3. Add the DNS records Twilio shows. They are a return-path CNAME, two DKIM CNAMEs, and a DMARC TXT record. Add them at the DNS host for `gaslandsgarage.com`. Leave the AWS CloudFront hosting stack as it is. These records authenticate mail. They do not move the website.
4. Wait until the domain status is **Verified**.

### Secrets

The Account SID and Auth Token stay in Secret Manager. Set them from a shell where the Firebase CLI is logged in. The commands prompt for the value. Paste each one from the Twilio Console account dashboard. Do not commit them, and do not pass them on the command line.

```bash
firebase functions:secrets:set TWILIO_ACCOUNT_SID --project=gaslandsgarage-74ce6
firebase functions:secrets:set TWILIO_AUTH_TOKEN --project=gaslandsgarage-74ce6
```

Deploy functions after both secrets exist and the domain is Verified. The Firebase CLI grants the default compute service account access to those secrets. To use a from address other than the default, put `MAIL_FROM_ADDRESS` in `functions/.env.gaslandsgarage-74ce6` before deploy. Do not put the Auth Token in that file.

An opted-in game request only creates a `mail` document until this function is deployed with those secrets. A 4xx from Twilio, including 401 for a wrong token, is stored on that document and is not retried. Fix the secret, then delete that `mail` document and create it again if that one message should still go out. `onDocumentCreated` does not run again for an update.

## Deploy

From the repository root, with the Firebase CLI logged in as someone who can deploy this project. Do this by hand. Do not add it to the AWS deploy workflow.

```bash
pnpm install
firebase deploy --only functions --force --project=gaslandsgarage-74ce6
```

`syncAuthDisabled`, `queueGameContactEmail`, and `sendQueuedMail` set `retry: true`, so failed events are retried. The Firebase CLI stops and asks before deploying a function that retries. Those retrying functions require `firebase deploy --only functions --force`. `--force` accepts that prompt, including in a non-interactive shell. Without it, a deploy that includes any of them does not finish. `publishUsageStats` is on the same deploy. Set the Twilio secrets before this deploy. Hosting stays on AWS. Do not deploy Firebase Hosting.

The predeploy hook runs `pnpm --dir functions run build`, which bundles `functions/lib/index.js`. `lib/` is gitignored and is not in the functions ignore list, so the bundle is uploaded. Node.js 22 comes from `functions/package.json` `engines.node`.

Rules stay a separate command:

```bash
firebase deploy --only firestore:rules --project=gaslandsgarage-74ce6
```

The site ships through the existing AWS workflow when `main` changes. This functions deploy does not publish the site.

The first functions deploy can ask to enable Cloud Functions, Cloud Build, Artifact Registry, Cloud Run, Eventarc, Cloud Scheduler, and Pub/Sub, and to grant roles to the Google service agents. Accept those prompts. Do not create a JSON key for the runtime account.

### Runtime identity

2nd gen functions run as the default compute service account:

`PROJECT_NUMBER-compute@developer.gserviceaccount.com`

Find the number with:

```bash
gcloud projects describe gaslandsgarage-74ce6 --format='value(projectNumber)'
```

If that account does not already have Editor, grant only:

- **Cloud Datastore User** (`roles/datastore.user`) so the stats job can read `teams` and `users` and write `stats/public`, `users`, and `mail`
- **Firebase Authentication Admin** (`roles/firebaseauth.admin`) so the stats job can list users and the disable function can update a user and revoke refresh tokens

```bash
PROJECT_NUMBER=$(gcloud projects describe gaslandsgarage-74ce6 --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding gaslandsgarage-74ce6 \
  --member="serviceAccount:${SA}" \
  --role="roles/datastore.user"
gcloud projects add-iam-policy-binding gaslandsgarage-74ce6 \
  --member="serviceAccount:${SA}" \
  --role="roles/firebaseauth.admin"
```

`roles/firebaseauth.admin` is broader than the calls in this code: it can also delete users. The functions do not. Do not download a key for this account.

## Tests

```bash
cd functions
pnpm check
pnpm build
pnpm test
```

`pnpm test` starts the Auth and Firestore emulators with `firebase-tools@13.29.1` and project `demo-gaslands-functions`. It needs Java and Node.js 22, because `firebase-admin` 14 does not run on Node.js 20. The test script sets `METADATA_SERVER_DETECTION=none` so the Admin SDK does not wait on the Compute Engine metadata server. The tests call the same handlers the triggers call. They do not deploy.

## Cost

Prices below are the public list prices as of October 2026. Check [Cloud Run pricing](https://cloud.google.com/run/pricing), [Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing), [Cloud Functions pricing](https://cloud.google.com/functions/pricing), and [Eventarc pricing](https://cloud.google.com/eventarc/pricing) before a large change. 2nd gen functions are billed as Cloud Run.

This project does not set a minimum instance count, so there is no idle charge.

| Piece | This project | Expected bill |
| --- | --- | --- |
| `publishUsageStats` | 1 run per day. Budget about 20 seconds at 1 vCPU and 256MiB: about 600 vCPU-seconds and 150 GiB-seconds a month. | $0 inside the Cloud Run free tier (240,000 vCPU-seconds and 450,000 GiB-seconds per month). List price past that is about $0.000018 per vCPU-second and $0.000002 per GiB-second, so this job is about $0.01 a month even with no free tier. |
| Cloud Scheduler | 1 job. | $0 while the billing account is under 3 jobs. Otherwise $0.10 per job per month. A paused job still counts. |
| Disable and contact triggers | A handful of Eventarc deliveries. | Covered by the Eventarc and Cloud Run free tiers at this size. |
| Firestore | The daily job reads `teams` and `users` and writes `stats/public` plus changed user profiles. Each opted-in contact adds one settings read and one `mail` write. | $0 while under the Firestore free tier (50,000 reads and 20,000 writes per day). Past that, reads are $0.06 and writes are $0.18 per 100,000. |
| Auth | `listUsers`, `getUser`, `updateUser`, `revokeRefreshTokens`. | No Firebase Auth charge for these calls. |
| Artifact Registry and Cloud Build | Image storage and the deploy build. | $0 inside the Artifact Registry 0.5 GB free tier and the Cloud Build 120 minutes per day free tier. |
| Twilio Email | One accepted send per opted-in game request. | [$0.0013 per email](https://www.twilio.com/en-us/products/email-api/twilio-pricing) on the August 2026 list price. A handful of game requests stays under a cent. New Twilio Email accounts also get a 30-day trial of 100 free emails per day. |

A normal month for Cloud Functions, Scheduler, Firestore, and Auth is **$0**, or **$0.10** if the billing account already has its three free Cloud Scheduler jobs. Twilio Email is billed on the Twilio account, separate from GCP.
