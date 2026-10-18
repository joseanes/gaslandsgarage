# Cloud Functions

Firebase project `gaslandsgarage-74ce6` is on the Blaze plan. Auth and Firestore stay in Firebase. The website stays on AWS S3 and CloudFront. Nothing in CI deploys functions, rules, or hosting.

The functions are 2nd gen, Node.js 22, TypeScript, in `functions/`. Node.js 20 is retired on 30 October 2026, so the runtime in `functions/package.json` is `22`. They use `firebase-admin` 14 and `firebase-functions` 7 with the default compute runtime identity. No function takes a service account key, a secret, or a pinned runtime account.

| Function | Trigger | What it does |
| --- | --- | --- |
| `publishUsageStats` | Cloud Scheduler `15 6 * * *` in `America/New_York` | Writes `stats/public` and upserts `users/{uid}`. Same job as `stats/job.ts`. |
| `syncAuthDisabled` | `adminUsers/{uid}` write | Sets Firebase Auth `disabled` to match the document. On disable, revokes refresh tokens. Does not delete the user. |
| `queueGameContactEmail` | `gameContacts/{contactId}` create | Queues one Trigger Email document when the recipient opted in. |
| `exportMyData` | Callable, signed-in user | JSON of that account's Firestore data. |
| `deleteMyAccount` | Callable, signed-in user | Deletes that account. Requires a fresh sign-in and the confirmation `DELETE`. |
| `syncNewsletterToken` | `userSettings/{uid}` write | When `newsletterOptIn` is true, stores one random unsubscribe token. Does not send mail. |
| `unsubscribeNewsletter` | Public HTTPS `GET` or `POST` | GET shows a confirm page and changes nothing. POST with the token sets `newsletterOptIn` to false. An RFC 8058 one-click POST is accepted on the same URL. No sign-in. |
| `getBuddyInvite` | Callable, signed-in user | Returns or creates that account's invite code. |
| `saveBuddyProfile` | Callable, signed-in user | Stores the display name buddies see, and the opt-in directory card. |
| `searchBuddyPlayers` | Callable, signed-in user | Prefix search of opted-in display names. No email. 30 searches per hour. |
| `sendBuddyRequest` | Callable, signed-in user | Sends a request by invite code or by a findable player. 10 requests per hour. |
| `respondBuddyRequest` | Callable, signed-in user | Accept, decline, or block an incoming request. Accept writes `buddies/{pairId}`. |
| `cancelBuddyRequest` | Callable, signed-in user | Cancels a request the caller sent. |
| `removeBuddy` | Callable, signed-in user | Deletes the accepted link. Access ends immediately. |
| `unblockBuddy` | Callable, signed-in user | Removes a block the caller created. |

Region is `us-central1`. `publishUsageStats` uses 256MiB, a 300 second timeout, and one instance. `syncAuthDisabled`, `queueGameContactEmail`, and `syncNewsletterToken` retry on failure. `syncAuthDisabled` and `queueGameContactEmail` use the platform defaults. `syncNewsletterToken` uses the platform memory and timeout. `exportMyData`, `deleteMyAccount`, and the gaming-buddy callables use 256MiB, a 60 second timeout, and at most 10 instances. `unsubscribeNewsletter` uses 256MiB, a 30 second timeout, at most 10 instances, and `invoker: public` so the email link works without a Google sign-in. None keep a warm instance.

## Usage stats

The GitHub Action cron in `.github/workflows/usage-stats.yml` is removed. **Run workflow** remains as a manual fallback that still needs the `FIREBASE_SERVICE_ACCOUNT` secret.

The function runs the same five-field cron at 06:15 America/New_York. The old Action ran that cron at 06:15 UTC, because GitHub Actions has no timezone. The count is `aggregateUsage` in `stats/aggregate.ts` plus the user upsert in `stats/usersSync.ts`. It does not write `roles` or `adminUsers`.

After `publishUsageStats` has published once, these are unused by the daily job and can be deleted:

- the JSON key on the `usage-stats` service account
- the GitHub Actions secret `FIREBASE_SERVICE_ACCOUNT`

This repository does not delete them. Deleting the secret makes **Run workflow** fail. `pnpm set-admin` can still use a key file in your shell, or Application Default Credentials. That local variable is not the GitHub secret.

## Disable and re-enable

The admin page writes `adminUsers/{uid}` (`app/src/lib/admin/api.ts`). The function calls `auth.updateUser(uid, { disabled })`. A change to `disabled: true` also calls `auth.revokeRefreshTokens(uid)`. A change to `disabled: false` re-enables the Auth user and does not revoke tokens. A repeated write of the same flag does nothing. Removing the document does nothing to Auth.

`syncAuthDisabled` never calls `deleteUser`. Teams, profiles, and the Auth user stay. Self-service deletion is a separate callable, `deleteMyAccount`, and it only deletes the signed-in account. An administrator still cannot delete someone else.

## Game-request email

On create of `gameContacts/{id}`, the function reads `userSettings/{toUid}`. It queues mail only when `allowContactFromPlayers` is exactly `true`. That setting defaults to false. `receiveUpdates` is marketing consent and does not send this mail. An `openToGames` card lets another player send an in-app request. It is not consent to email, and the profile copy says the address is not shared.

The recipient address is loaded with `auth.getUser(toUid)`. It is written only as the `to` field of `mail/gameContact_{contactId}`, which is the [Trigger Email extension](https://firebase.google.com/docs/extensions/official/firestore-send-email) document:

```json
{
  "to": ["player@example.com"],
  "message": {
    "subject": "Ada sent a Gaslands game request",
    "text": "..."
  },
  "expireAt": "Firestore timestamp, 30 days after the write"
}
```

`expireAt` is a Firestore timestamp 30 days after the queue write. It is not an email address. A TTL policy on that field deletes the `mail` document, which is the only stored copy of the recipient address. The policy is not created by `firebase deploy`. Turn it on once:

```bash
gcloud firestore fields ttls update expireAt --collection-group=mail --enable-ttl --project=gaslandsgarage-74ce6
```

Firestore does not delete the document at the exact timestamp. Expect the purge within about a day after `expireAt`. Until the policy is enabled, `expireAt` is only a field.

The address is not written onto `gameContacts`, `users`, `playerProfiles`, or `userSettings`. The message body does not include it. A second delivery for the same contact id is ignored. Updates and replies do not queue another message. A disabled Auth user, or an account with no email, is skipped.

Clients cannot read or write `mail`. Firestore rules are default deny, and there is no allow rule for that collection. The queued address is not visible to the browser.

Deploying functions does not install the extension and does not send mail. Without the extension, opted-in requests only create `mail` documents. Install and configure SMTP later if those messages should actually go out:

```bash
firebase ext:install firebase/firestore-send-email --project=gaslandsgarage-74ce6
```

Point the extension at the `mail` collection. Leave its sender address in the extension config. Do not put a recipient address in source.

## Export and delete

`exportMyData` and `deleteMyAccount` are HTTPS callables in `us-central1`. Both require a signed-in Firebase user and act only on `request.auth.uid`. A uid in the request body is ignored. Each allows 5 calls per rolling hour, stored on `privacyRate/{uid}` (`exportAt` and `deleteAt`). Clients cannot read or write that collection. The default deny rule covers it, so no rules change is required.

`exportMyData` returns JSON for `users`, `users/{uid}/teams`, `teams`, `userSettings` (including the monthly-email fields), `newsletterTokens`, `playerProfiles`, `playerMapOwners`, `playerMapPrivate`, `playerMap`, that account's key on `playerMapBoard/public` and `openToGamesBoard/public`, `openToGames`, game requests sent and received, `messages`, `roles`, `adminUsers`, `mail` (another person's address is left out), `privacyRate`, buddy links, buddy requests sent and received, blocks, the invite code, the findable-name card, and `buddyRate`. `stats/public` is aggregate and is not copied. The callable response has to stay under Cloud Functions' 10 MB limit.

`deleteMyAccount` checks that `confirmation` is exactly `DELETE` and that the ID token `auth_time` is less than five minutes old. It then, in order:

1. Removes this account's key from `playerMapBoard/public` and `openToGamesBoard/public` in one transaction.
2. Deletes the account's documents, including teams, the legacy `users/{uid}/teams` subcollection, and `newsletterTokens/{uid}`.
3. Anonymizes this account's side of `gameContacts` and `messages`. The other person's text stays. Names become `Deleted player`. Contact-form messages lose their email and body, and `userId` becomes `deleted`.
4. Deletes queued `mail` documents for those requests and any mail addressed to this account.
5. Deletes buddy links, requests, blocks, the invite, the findable-name card, and `buddyRate/{uid}`.
6. Deletes `privacyRate/{uid}`.
7. Deletes the Auth user last. A missing Auth user is success, so a retry can finish leftover documents.

Logs are `privacy <event> ref=<sha256 prefix>`. They do not include the uid, email, or display name. Deleting `adminUsers/{uid}` makes `syncAuthDisabled` see a deleted document and leave Auth alone. The Auth delete is only step 7.

The browser calls these from Settings → General Settings after Google sign-in. Download does not ask for a second sign-in. Delete opens the Google prompt again, then calls the function. See `docs/PRIVACY-OPS.md` for requests, retention, and the breach checklist.

## Deploy

From the repository root, with the Firebase CLI logged in as someone who can deploy this project. Do this by hand. Do not add it to the AWS deploy workflow.

```bash
pnpm install
firebase deploy --only functions --force --project=gaslandsgarage-74ce6
```

`syncAuthDisabled`, `queueGameContactEmail`, and `syncNewsletterToken` set `retry: true`, so failed events are retried. The Firebase CLI stops and asks before deploying a function that retries. Those retrying functions require `firebase deploy --only functions --force`. `--force` accepts that prompt, including in a non-interactive shell. Without it, a deploy that includes any of them does not finish. `publishUsageStats` and `unsubscribeNewsletter` are on the same deploy.

`unsubscribeNewsletter` does not send the monthly email. The query a future sender has to use, the unsubscribe link, and the postal line are in `docs/PRIVACY-OPS.md`. Deploy the rules in that same checklist. `newsletterTokens` is denied to clients.

The predeploy hook runs `pnpm --dir functions run build`, which bundles `functions/lib/index.js`. `lib/` is gitignored and is not in the functions ignore list, so the bundle is uploaded. Node.js 22 comes from `functions/package.json` `engines.node`.

Rules and indexes stay a separate command. Gaming buddies need both. The team list query uses `userId` and `hiddenFromBuddies`. The buddy list query uses `status` and `members`.

```bash
firebase deploy --only firestore:rules,firestore:indexes --project=gaslandsgarage-74ce6
```

Deploy the functions, rules, and indexes before the site build that contains Gaming Buddies is published. Index builds can take a few minutes. Until they are ready, the buddy list and a buddy's team list fail even though a single-team read still works.

Do not deploy Firebase Hosting. The site ships through the existing AWS workflow when `main` changes.

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

`roles/firebaseauth.admin` is broader than a disable. `deleteMyAccount` uses it to delete the signed-in Auth user, and only that user. `syncAuthDisabled` still does not delete anyone. Do not download a key for this account.

## Tests

```bash
cd functions
pnpm check
pnpm build
pnpm test
```

`pnpm test` starts the Auth and Firestore emulators with `firebase-tools@13.29.1` and project `demo-gaslands-functions`. It needs Java and Node.js 22, because `firebase-admin` 14 does not run on Node.js 20. The test script sets `METADATA_SERVER_DETECTION=none` so the Admin SDK does not wait on the Compute Engine metadata server. The tests call the same handlers the triggers call. They do not deploy.

The UI tests start Auth, Firestore, and Functions together with `firebase-tools@15.34.0` and project `gaslandsgarage-74ce6`, the same project id as the web app. Tools 13 cannot load these functions: it calls `functions.config()`, which firebase-functions 7 rejects. The Functions emulator only answers that project id.

## Cost

Prices below are the public list prices as of October 2026. Check [Cloud Run pricing](https://cloud.google.com/run/pricing), [Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing), [Cloud Functions pricing](https://cloud.google.com/functions/pricing), and [Eventarc pricing](https://cloud.google.com/eventarc/pricing) before a large change. 2nd gen functions are billed as Cloud Run.

This project does not set a minimum instance count, so there is no idle charge.

| Piece | This project | Expected bill |
| --- | --- | --- |
| `publishUsageStats` | 1 run per day. Budget about 20 seconds at 1 vCPU and 256MiB: about 600 vCPU-seconds and 150 GiB-seconds a month. | $0 inside the Cloud Run free tier (240,000 vCPU-seconds and 450,000 GiB-seconds per month). List price past that is about $0.000018 per vCPU-second and $0.000002 per GiB-second, so this job is about $0.01 a month even with no free tier. |
| Cloud Scheduler | 1 job. | $0 while the billing account is under 3 jobs. Otherwise $0.10 per job per month. A paused job still counts. |
| Disable and contact triggers | A handful of Eventarc deliveries. | Covered by the Eventarc and Cloud Run free tiers at this size. |
| `exportMyData` and `deleteMyAccount` | Occasional callable requests at 256MiB. | Covered by the Cloud Run free tier at this size. Firestore reads and writes for one account stay inside the Firestore free tier. |
| Firestore | The daily job reads `teams` and `users` and writes `stats/public` plus changed user profiles. Each opted-in contact adds one settings read and one `mail` write. | $0 while under the Firestore free tier (50,000 reads and 20,000 writes per day). Past that, reads are $0.06 and writes are $0.18 per 100,000. |
| Auth | `listUsers`, `getUser`, `updateUser`, `revokeRefreshTokens`. | No Firebase Auth charge for these calls. |
| Artifact Registry and Cloud Build | Image storage and the deploy build. | $0 inside the Artifact Registry 0.5 GB free tier and the Cloud Build 120 minutes per day free tier. |
| Trigger Email extension | Not installed by the functions deploy. | SMTP is whatever the extension's mail provider charges. No messages send until the extension is installed. |

A normal month for this site is **$0**, or **$0.10** if the billing account already has its three free Cloud Scheduler jobs.
