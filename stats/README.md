# Usage stats

The public page at `/stats` reads one Firestore document, `stats/public`. Team and user documents stay private.

## Where the daily job runs

`publishUsageStats` in `functions/` writes that document every day at 06:15 America/New_York. The cron expression is `15 6 * * *`, the same expression the GitHub Action used. GitHub ran it at 06:15 UTC. Cloud Scheduler runs it in `America/New_York`. The function uses the default compute identity and no JSON key. Deploy steps and cost are in [docs/FUNCTIONS.md](../docs/FUNCTIONS.md).

The GitHub workflow `.github/workflows/usage-stats.yml` no longer has a schedule. **Run workflow** still calls `stats/publish.ts`, which needs the `FIREBASE_SERVICE_ACCOUNT` secret. That path is only a manual fallback.

After the Cloud Function has published `stats/public` once, these can be deleted:

- the JSON key on the `usage-stats` service account
- the GitHub secret `FIREBASE_SERVICE_ACCOUNT`

Nothing in this repository deletes them. Deleting the secret makes the manual workflow fail. `pnpm set-admin` can use a local key file or Application Default Credentials instead of that secret.

Firestore security rules do not apply to the Admin SDK, so the job can read `teams` and write `stats/public` while browsers still cannot. `aggregateUsage` in `aggregate.ts` is the shared count. `stats/job.ts` is the shared publish, used by the function and by the manual command.

## What gets counted

From the top-level `teams` collection (the documents the builder saves):

- teams
- vehicles (every entry in `teamData.vehicles`)
- teams by rules version (`3` is v3; anything else, including a missing version, is v2)
- teams per sponsor id
- teams whose `createdAt` falls in the rolling 30 days before the job runs

`totalUsers` is the Firebase Authentication user count, not a guess from team documents. The published document has no user ids, emails, team names, or vehicle lists.

## Admin user directory

After writing `stats/public`, the same job upserts `users/{uid}` for every Firebase Auth user so `/admin/users` lists accounts that have not signed in since the admin page shipped. It uses the profile shape the app writes on sign-in (`app/src/lib/admin/profileShape.ts`): missing documents are created; existing ones only get `email`/`displayName` refreshed, a later `lastSignInAt`, and any missing fields. `lastSeenAt` and `createdAt` are never overwritten. Documents for users no longer in Auth are left alone. The function's runtime identity needs Cloud Datastore User and Firebase Authentication Admin (the Admin role covers the list, and the disable function needs it to update users). If any `users` write fails, the job throws after `stats/public` is already written.

## Manual run

The site still ships through the existing Build-and-Deploy workflow. Rules and functions deploy by hand. See [docs/FUNCTIONS.md](../docs/FUNCTIONS.md).

To publish once before the function is deployed, or after a bad day, run Actions → **Usage stats** → **Run workflow**. That still uses the GitHub secret. From a machine with the key in the environment:

```bash
cd stats
FIREBASE_SERVICE_ACCOUNT="$(cat /path/to/the-service-account.json)" pnpm publish-stats
```

Prefer the Cloud Function for the daily run. Do not create a new key for it.
