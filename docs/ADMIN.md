# Administrator accounts

Gaslands Garage stores accounts in Firebase Authentication and teams in Cloud Firestore. The site itself still deploys to AWS. This feature does not move hosting, and it does not use Cloud Functions.

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

No `roles` document means a regular user. `disabled: true` on `adminUsers/{uid}` means the account is disabled. The Auth user is left in place.

The browser cannot list Auth accounts. The users list is the `users` collection, which the app writes the first time someone signs in with this version. Players who have not signed in since then do not appear until they do. The bootstrap script below also writes a `users` document for the account you name, so that administrator shows up after the rules are live.

## What disable does

Disabling a player:

1. Writes `adminUsers/{uid}` with `disabled: true`, `disabledAt`, and `disabledBy`.
2. The next time that player loads the app, it reads that document, signs them out, and shows **Your account has been disabled**.
3. Firestore rules reject their reads and writes of teams, settings, messages, and their user profile while the flag is set. They can still read their own `adminUsers` document so the app can show that message.

Re-enable writes `disabled: false` and clears `disabledAt` and `disabledBy`. Their teams were not deleted.

An administrator does not see a Disable control on their own row. The rules reject that write even if a modified client sends it.

## Go live

Do these once, in this order. Nothing in CI deploys rules. Merging the app change to `main` still ships the site through the existing AWS Build-and-Deploy workflow.

### 1. Deploy the Firestore rules

From the repository root, with the Firebase CLI logged in:

```bash
firebase deploy --only firestore:rules --project=gaslandsgarage-74ce6
```

That publishes `app/firestore.rules`. Regular players keep the same access to their own teams and settings. Do not paste an older rules sample from `app/FIREBASE-SETUP.md` over the live rules.

Do not run `firebase deploy --only functions`.

### 2. Bootstrap the Administrator role

`jose.anes@gmail.com` has to exist in Firebase Authentication first. Sign in once on the site with that Google account if it has never signed in.

The script uses the Admin SDK. Give it either:

- `FIREBASE_SERVICE_ACCOUNT`: the JSON for a service account, or a path to that file. The usage-stats account already has **Cloud Datastore User** (`roles/datastore.user`) and **Firebase Authentication Viewer** (`roles/firebaseauth.viewer`). Those two roles are enough to look up the user and write `roles/{uid}`. No new IAM role is required.
- or Application Default Credentials (`gcloud auth application-default login`, or `GOOGLE_APPLICATION_CREDENTIALS`)

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

## Deleting a user later

Auth deletion is not implemented. The project can stay on the Spark plan: there is no `adminActions` queue, no GitHub Action that deletes users, and no need for the **Firebase Authentication Admin** role (`roles/firebaseauth.admin`).

When Blaze is available, add a Cloud Function that:

1. Checks the caller is an Administrator and is not deleting themselves.
2. Deletes that player's Auth user.
3. Deletes their Firestore data (`users`, `roles`, `adminUsers`, `userSettings`, their `teams`, and their `messages`).

`planDeleteAuthUser` in `app/src/lib/admin/accountActions.ts` is the reserved client-side shape. It always refuses, including for the signed-in administrator, and the browser never writes a deletion request. The function should use the Admin SDK, which bypasses security rules. Keep the three account-control fields the rules already allow; the function does not need the browser to enqueue work.

Until that function exists, disable the account instead.
