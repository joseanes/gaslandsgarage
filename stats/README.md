# Usage stats

The public page at `/stats` reads one Firestore document, `stats/public`. A scheduled GitHub Action writes that document. Team and user documents stay private.

## Why this is a GitHub Action

A scheduled Firebase Cloud Function in `gaslandsgarage-74ce6` would keep the credential inside Google: the function's service account writes `stats/public`, and no private key sits in GitHub. Scheduled functions use Cloud Scheduler, and Cloud Functions for Firebase require the **Blaze** plan. This repo has no checked-in functions (`functions/` is gitignored), and enabling billing is a separate decision.

The Action uses the Admin SDK, which works without Blaze. Firestore security rules do not apply to the Admin SDK, so the job can read `teams` and write `stats/public` while browsers still cannot. The tradeoff is a long-lived service account key stored as a GitHub secret. Give that account only the two roles below, and delete the key if you later move the job into a Cloud Function.

The page and the rules do not change if you switch later. `aggregateUsage` in `aggregate.ts` is the shared count.

## What gets counted

From the top-level `teams` collection (the documents the builder saves):

- teams
- vehicles (every entry in `teamData.vehicles`)
- teams by rules version (`3` is v3; anything else, including a missing version, is v2)
- teams per sponsor id
- teams whose `createdAt` falls in the rolling 30 days before the job runs

`totalUsers` is the Firebase Authentication user count, not a guess from team documents. The published document has no user ids, emails, team names, or vehicle lists.

## Admin user directory

After writing `stats/public`, the same job upserts `users/{uid}` for every Firebase Auth user so `/admin/users` lists accounts that have not signed in since the admin page shipped. It uses the profile shape the app writes on sign-in (`app/src/lib/admin/profileShape.ts`): missing documents are created; existing ones only get `email`/`displayName` refreshed, a later `lastSignInAt`, and any missing fields. `lastSeenAt` and `createdAt` are never overwritten. Documents for users no longer in Auth are left alone. The two existing roles cover this (Cloud Datastore User writes `users`, Firebase Authentication Viewer lists accounts). If any `users` write fails, the job exits non-zero after `stats/public` is already written.

## What José needs to deploy

Do this once. Nothing in CI deploys rules or hosting.

1. In Google Cloud for project `gaslandsgarage-74ce6`, create a service account, for example `usage-stats@gaslandsgarage-74ce6.iam.gserviceaccount.com`.
2. Grant only:
   - **Cloud Datastore User** (`roles/datastore.user`) so it can read `teams` and write `stats/public`
   - **Firebase Authentication Viewer** (`roles/firebaseauth.viewer`) so it can count users
3. Create a JSON key for that account. Do not commit it. The repo ignores `*firebase-adminsdk*.json` and `service-account*.json`.
4. In GitHub, add a repository secret named `FIREBASE_SERVICE_ACCOUNT` whose value is the entire JSON file.
5. Deploy the rules from the repo root:

   ```bash
   firebase deploy --only firestore:rules --project=gaslandsgarage-74ce6
   ```

   That allows public read of `stats/public` and denies client writes. It does not change the owner checks on `teams`, `userSettings`, or `messages`.

6. Run the workflow once: Actions → **Usage stats** → **Run workflow**. After that it runs every day at 06:15 UTC.

Do not run `firebase deploy --only functions`. This setup does not use Cloud Functions.

The site itself still ships through the existing Build-and-Deploy workflow when the app change reaches `main`. The stats page shows an empty state until step 5 and step 6 have both succeeded.
