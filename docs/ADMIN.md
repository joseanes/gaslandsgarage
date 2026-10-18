# Administrator accounts

Gaslands Garage stores accounts in Firebase Authentication and teams in Cloud Firestore. The site itself still deploys to AWS. Disabling an account also updates Firebase Auth through a Cloud Function. Hosting stays on AWS. See [FUNCTIONS.md](FUNCTIONS.md).

An **Administrator** can open **Admin** in the top bar and use `/admin/users` to:

- search players by email or display name
- see when the account was created and last signed in, when those times have been stored
- see how many teams they have saved
- open a read-only view of those teams and vehicles
- grant or remove the Administrator role
- disable or re-enable an account

Everyone else is a regular user. The Administrator role is the only one that can manage users. The `roles/{uid}` document stores the role name as a string (`Administrator` today) so later roles can be added without a new collection.

A player cannot grant themselves a role. Security rules allow a role write only when the caller's own `roles/{uid}` document has `role == "Administrator"`, and they reject a write where the target id is the caller's id. The same self-check blocks an administrator from disabling their own account.

## Where the data lives

| Document | Who can write it from the browser | Contents |
| --- | --- | --- |
| `users/{uid}` | That signed-in player, on sign-in | `uid`, `email`, `displayName`, `createdAt`, `lastSeenAt`, `lastSignInAt` |
| `roles/{uid}` | An administrator, and never their own document | `role`, `updatedAt`, `updatedBy` |
| `adminUsers/{uid}` | An administrator, and never their own document | `disabled`, `disabledAt`, `disabledBy` |

No `roles` document means a regular user. `disabled: true` on `adminUsers/{uid}` means the account is disabled. The Auth user stays in place. The `syncAuthDisabled` function sets Firebase Auth `disabled` to the same value. It does not delete the user.

The browser cannot list Auth accounts. The users list is the `users` collection. The app writes a player's document when they sign in, and the daily **Usage stats** job (`stats/usersSync.ts`, run by the `publishUsageStats` Cloud Function) upserts one for every Firebase Auth user, so players who have not signed in since this version appear after the next run. The job creates missing documents and, on existing ones, refreshes `email` and `displayName`, moves `lastSignInAt` forward, and fills `uid`, `createdAt`, or `lastSeenAt` only when they are missing. It never changes `lastSeenAt` or `createdAt` once set, and it never writes `roles` or `adminUsers`. Both writers share `app/src/lib/admin/profileShape.ts`. The bootstrap script below also writes a `users` document for the account you name, so that administrator shows up after the rules are live.

## What disable does

Disabling a player:

1. Writes `adminUsers/{uid}` with `disabled: true`, `disabledAt`, and `disabledBy`.
2. The `syncAuthDisabled` Cloud Function sees that write and calls Firebase Auth `updateUser(uid, { disabled: true })`, then `revokeRefreshTokens(uid)`. The Auth user is not deleted. Their teams are not deleted.
3. Existing sessions stop when the refresh token is revoked. The next time that player loads the app, it reads the document, signs them out, and shows **Your account has been disabled**.
4. Firestore rules reject their reads and writes of teams, settings, messages, and their user profile while the flag is set. They can still read their own `adminUsers` document so the app can show that message.

Re-enable writes `disabled: false` and clears `disabledAt` and `disabledBy`. The same function calls `updateUser(uid, { disabled: false })`. It does not revoke tokens again, and it does not delete the user.

Deleting the `adminUsers` document is not allowed from the browser. If a document is removed another way, the function does not delete or disable the Auth user.

An administrator does not see a Disable control on their own row. The rules reject that write even if a modified client sends it.

## Go live

Do these once, in this order. Nothing in CI deploys rules. Merging the app change to `main` still ships the site through the existing AWS Build-and-Deploy workflow.

### 1. Deploy the Firestore rules

From the repository root, with the Firebase CLI logged in:

```bash
firebase deploy --only firestore:rules --project=gaslandsgarage-74ce6
```

That publishes `app/firestore.rules`. Regular players keep the same access to their own teams and settings. Do not paste an older rules sample from `app/FIREBASE-SETUP.md` over the live rules.

Cloud Functions deploy separately, and nothing in CI deploys them. The commands are in [FUNCTIONS.md](FUNCTIONS.md). Hosting stays on the AWS Build-and-Deploy workflow.

### 2. Bootstrap the Administrator role

`jose.anes@gmail.com` has to exist in Firebase Authentication first. Sign in once on the site with that Google account if it has never signed in.

The script uses the Admin SDK. Give it either:

- `FIREBASE_SERVICE_ACCOUNT`: the JSON for a service account, or a path to that file. The usage-stats account already has **Cloud Datastore User** (`roles/datastore.user`) and **Firebase Authentication Viewer** (`roles/firebaseauth.viewer`). Those two roles are enough to look up the user and write `roles/{uid}`. No new IAM role is required for this script.
- or Application Default Credentials (`gcloud auth application-default login`, or `GOOGLE_APPLICATION_CREDENTIALS`)

The daily stats job no longer reads that key. After `publishUsageStats` has run once, the usage-stats JSON key and the GitHub secret `FIREBASE_SERVICE_ACCOUNT` can be deleted. This repository does not delete them. Use Application Default Credentials for this script if the key is already gone. See [FUNCTIONS.md](FUNCTIONS.md).

From the repository root:

```bash
export FIREBASE_SERVICE_ACCOUNT="$(cat /path/to/the-service-account.json)"
pnpm set-admin -- --email jose.anes@gmail.com
```

The email is an argument. It is not written into the client or the rules.

The script sets `roles/{uid}` to `{ role: "Administrator", updatedAt, updatedBy: "bootstrap" }` and merges a `users/{uid}` profile. It does not disable anyone and it does not delete Auth users.

### 3. Confirm

Sign in as that account, reload, and open **Admin**. Another player can be given Administrator from that page. They cannot take the role off the account that is signed in.

## Adding a role later

1. Add the role name to `ASSIGNABLE_ROLES` in `app/src/lib/admin/accountActions.ts`. The stored field is already a string.
2. If the role should be allowed to manage users, teach `isAdmin()` in `app/firestore.rules` about it and deploy the rules again. Until then, only `Administrator` can manage users.

## Deleting a user

Auth deletion is not implemented. The Cloud Functions do not delete Auth users or their Firestore data. There is no `adminActions` queue and no GitHub Action that deletes users.

`planDeleteAuthUser` in `app/src/lib/admin/accountActions.ts` always refuses, including for the signed-in administrator, and the browser never writes a deletion request. Disable is the supported control. The `syncAuthDisabled` function only calls `updateUser` and, on disable, `revokeRefreshTokens`.

The function's runtime identity needs **Firebase Authentication Admin** (`roles/firebaseauth.admin`) for those two Auth calls. That role can also delete users. The checked-in functions do not call delete. Do not add a delete call later without a separate decision.
