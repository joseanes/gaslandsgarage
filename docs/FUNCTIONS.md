# Cloud Functions

Firebase project `gaslandsgarage-74ce6` is on the Blaze plan. Auth and Firestore stay in Firebase. The website stays on AWS S3 and CloudFront. Nothing in CI deploys functions, rules, or hosting.

The functions are 2nd gen, Node.js 22, TypeScript, in `functions/`. Node.js 20 is retired on 30 October 2026, so the runtime in `functions/package.json` is `22`. They use `firebase-admin` 14 and `firebase-functions` 7 with the default compute runtime identity. No function takes a service account key or a pinned runtime account. Twilio Email credentials are Secret Manager values (`TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`), not source.

| Function | Trigger | What it does |
| --- | --- | --- |
| `publishUsageStats` | Cloud Scheduler `15 6 * * *` in `America/New_York` | Writes `stats/public` and upserts `users/{uid}`. Same job as `stats/job.ts`. |
| `syncAuthDisabled` | `adminUsers/{uid}` write | Sets Firebase Auth `disabled` to match the document. On disable, revokes refresh tokens. Does not delete the user. |
| `queueGameContactEmail` | `gameContacts/{contactId}` create | Queues one Trigger Email document when the recipient opted in. |
| `exportMyData` | Callable, signed-in user | JSON of that account's Firestore data, including a list of painted-car photos. |
| `deleteMyAccount` | Callable, signed-in user | Deletes that account, including every Storage object under `users/{uid}/`, the photo metadata, and any shared photo copies. Requires a fresh sign-in and the confirmation `DELETE`. |
| `reserveVehiclePhoto` | Callable, signed-in user | Reserves one library file at `users/{uid}/photos-library/{photoId}.webp` (or `.jpg`). Counts library files toward 100 per account and attachments toward 3 per car. The same bytes attach to the existing photo instead of creating another file. The browser uploads only when this is a new file. |
| `setPhotoSharing` | Callable, signed-in user | Turns sharing on or off for one of the caller's photos, including the Gallery and the vehicle stats snapshot. A shared photo is copied to `shared-photos/{photoId}`. The public document has no account id. Stats are copied from the car the photo is shared from. One attached car is used automatically. Several attached cars require `shareTeamId` and `shareVehicleId`. A photo with no car can still be shown in the Gallery when `vehicleType` is one of the game's vehicle types. That card has no stats, no cans, and no team. Stats, Gaming Buddies, and the team share link still require a linked car. A caller-supplied type is ignored when a car is linked. The public card copies `paintingUrl` from the private photo. A caller can send `paintingUrl` to replace it. Anything that is not an empty string or an http(s) URL of at most 300 characters is rejected. A blank link is not filled from the profile. |
| `setPhotoPaintingUrl` | Callable, signed-in user | Saves or clears the painting-guide link on one of the caller's photos. The same value is copied onto `sharedPhotos` when that photo is already public. An empty string clears it. The profile website is not read. |
| `attachLibraryPhoto` | Callable, signed-in user | Attaches one library photo to a car on the caller's saved team. A car can show 3 photos. |
| `detachLibraryPhoto` | Callable, signed-in user | Takes one photo off one car. The file stays. If that car was the share source, the shared copy is removed. |
| `detachVehiclePhotos` | Callable, signed-in user | Takes every library photo off one car. Files stay in My Photos. |
| `detachTeamPhotos` | Callable, signed-in user | Takes every library photo off every car on one team. Files stay in My Photos. |
| `renameLibraryPhoto` | Callable, signed-in user | Changes the caption on the library photo and on its shared copy. Attachments stay. |
| `preparePhotoReplace` | Callable, signed-in user | Points the photo at the replacement library path. The browser uploads after this returns. Attachments stay. |
| `replaceLibraryPhoto` | Callable, signed-in user | Records the new size and hash after the replacement upload, refreshes a shared copy, and deletes the previous file for that photo. |
| `migratePhotoLibrary` | Callable, signed-in user | Copies the caller's older `vehicle-photos` files into `photos-library` when `apply` is true. A false `apply` only lists the moves. |
| `cleanupOrphanPhotos` | Callable, signed-in user | Deletes a reservation that never received a file, and a file whose photo document is already gone, after 15 minutes. |
| `listVisibleTeamPhotos` | Callable, public | Lists photos a player chose to show on a team share link, or to an accepted buddy. The response has no account id and no download token. |
| `reportPhoto` | Callable, signed-in user | Records one report per player. Ten reports an hour. Three different reports hide the gallery photo until an administrator reviews it. |
| `moderateGallery` | Callable, administrator | Lists shared photos, hides or removes one, approves one, or sets the gallery approval kill switch. |
| `refreshSharedVehicleStats` | `teams/{teamId}` write | Refreshes the public stats snapshot when a saved vehicle changes. Removes that snapshot when the vehicle is gone. |
| `removeSharedPhotoOnDelete` | `users/{uid}/photos/{photoId}` delete | Removes the shared copy when the private photo document is deleted. |
| `renderSharedCar` | Public HTTPS `GET` or `HEAD` | HTML for a public car page and its embed, including Open Graph and Twitter card tags. Reads `sharedPhotos/{photoId}` only. Returns a "no longer shared" page when the photo is not a published, visible gallery share. A painting-guide link is shown only when that photo stored an http(s) URL. The link is escaped and uses `rel="nofollow ugc noopener noreferrer"`. |
| `syncNewsletterToken` | `userSettings/{uid}` write | When `newsletterOptIn` is true, stores one random unsubscribe token. Does not send mail. |
| `unsubscribeNewsletter` | Public HTTPS `GET` or `POST` | GET shows a confirm page and changes nothing. POST with the token sets `newsletterOptIn` to false. An RFC 8058 one-click POST is accepted on the same URL. No sign-in. |
| `getBuddyInvite` | Callable, signed-in user | Returns or creates that account's invite code, whether email invites are on, and whether Gallery buddy requests are allowed. That last flag defaults to allowed when it has never been saved. |
| `sendBuddyInvite` | Callable, signed-in user | Sends one transactional buddy invite through Twilio Email. 10 a day per sender. |
| `acceptBuddyEmailInvite` | Callable, signed-in user | Accepts a signed email-invite token and writes the buddy link. Single use. |
| `suppressBuddyEmailInvites` | Public HTTPS `GET` or `POST` | GET shows a confirm page and changes nothing. POST stops future buddy-invite mail to that address. No sign-in. |
| `saveBuddyProfile` | Callable, signed-in user | Stores the display name buddies see, the opt-in directory card, and Allow buddy requests from the Gallery. Turning that off writes `allowGalleryBuddies: false` onto that player's existing public gallery cards. Turning it on removes the field. Absence still means allowed. |
| `searchBuddyPlayers` | Callable, signed-in user | Prefix search of opted-in display names. No email. 30 searches per hour. |
| `sendBuddyRequest` | Callable, signed-in user | Sends a request by invite code, by a findable player, or by a public gallery photo id. 10 requests per hour. A gallery photo adds a second cap of 20 a day. A declined request cannot be sent again for 30 days, from any of those doors. The gallery path does not take an email address and does not send mail. |
| `galleryBuddyOffer` | Callable, optional sign-in | Tells the Gallery or car page which buddy button to show for one public photo. The response has no email address. Signed-out viewers get a sign-in prompt, or nothing when Gallery requests are off. |
| `respondBuddyRequest` | Callable, signed-in user | Accept, decline, or block an incoming request. Accept writes `buddies/{pairId}`. |
| `cancelBuddyRequest` | Callable, signed-in user | Cancels a request the caller sent. |
| `removeBuddy` | Callable, signed-in user | Deletes the accepted link. Access ends immediately. |
| `unblockBuddy` | Callable, signed-in user | Removes a block the caller created. |

Region is `us-central1`. `publishUsageStats` uses 256MiB, a 300 second timeout, and one instance. `syncAuthDisabled`, `queueGameContactEmail`, and `syncNewsletterToken` retry on failure. `syncAuthDisabled` and `queueGameContactEmail` use the platform defaults. `syncNewsletterToken` uses the platform memory and timeout. `exportMyData`, `deleteMyAccount`, `reserveVehiclePhoto`, the photo library callables, the photo-sharing callables, and the gaming-buddy callables use 256MiB, a 60 second timeout, and at most 10 instances. `listVisibleTeamPhotos` also sets `invoker: public` so a team share link can list photos without a sign-in. `unsubscribeNewsletter`, `suppressBuddyEmailInvites`, and `renderSharedCar` use 256MiB, a 30 second timeout, at most 10 instances, and `invoker: public`. The first two are email links. `renderSharedCar` is the public car page CloudFront fetches. None keep a warm instance.

`getBuddyInvite`, `sendBuddyInvite`, `acceptBuddyEmailInvite`, `exportMyData`, and `deleteMyAccount` declare the Twilio secrets. The other buddy callables do not. Email sending stays off until both secrets look like real Twilio credentials (an Account SID starting with `AC`, and an auth token). The placeholder value `disabled` keeps the feature off. The buddies page still shows the copyable invite link and says email invites are coming soon.

A Gallery buddy request reuses `buddyRequests`. The browser sends the public photo id. `sendBuddyRequest` reads `sharedPhotoPrivate` with the Admin SDK to find the owner. It does not return an email address or a separate owner field. The existing request id is still `fromUid~toUid`, and the Gallery does not render it. The request can store `source: gallery`, the photo id, the public car name, and an optional note of at most 200 characters. A note that contains `@` is rejected. The same request shows on Gaming Buddies with the line "found you through your painted car" and the public photo as a thumbnail. Accept, decline, and block are the existing actions. Accept still writes `buddies/{pairId}`, so photos already shared with Show to my Gaming Buddies become visible through `listVisibleTeamPhotos`. No second photo list is created.

In-app requests, including gallery ones, do not send email. There is no recipient switch that turns email on for them. `sendBuddyInvite` is unchanged: the sender types an address, the daily cap stays 10, and `suppressBuddyEmailInvites` plus the opt-out list still apply to that mail only. `allowContactFromPlayers` is the game-request setting and is not consulted here.

No Firestore rules change and no new index. Clients still cannot write `buddyRequests`, `buddyInvites`, `buddyRate`, or `sharedPhotos`. The caps and the 30-day decline window are enforced in `sendBuddyRequest`. Deploy the callables before the button can reach a live project:

```bash
firebase deploy --only functions:sendBuddyRequest,functions:galleryBuddyOffer,functions:saveBuddyProfile,functions:getBuddyInvite,functions:setPhotoSharing --project=gaslandsgarage-74ce6
```

`setPhotoSharing` is in that list so a player who already turned Gallery requests off does not publish a new card that still offers the button. `renderSharedCar` reads `allowGalleryBuddies` from the public card it already loads. It does not read `sharedPhotoPrivate`. Redeploy it only if the public car HTML should gain or lose the "Add as buddy" link:

```bash
firebase deploy --only functions:renderSharedCar --project=gaslandsgarage-74ce6
```

## Photo library

A photo belongs to the account, not to a car. New files are stored at `users/{uid}/photos-library/{photoId}.webp` or `.jpg`. The photo document stays at `users/{uid}/photos/{photoId}` and keeps an `attachments` list of `{ teamId, vehicleId }`. Clients still cannot create that document. Older files at `users/{uid}/vehicle-photos/...` keep working. My Photos calls `migratePhotoLibrary` with `apply: true` so a signed-in player is moved as they open the page.

Removing a car or a team only detaches the photo. The file and the document stay. If that car was the one the Gallery, buddies, or the share link used, that shared copy is removed. Deleting the photo from My Photos removes the file, the document, every attachment, and every shared copy.

`functions/scripts/migrate-photo-library.mjs` is the operator copy of that move. Dry-run is the default. `--apply` copies the files. Run it from `functions/` with Application Default Credentials.

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

On create of `gameContacts/{id}`, the function reads `userSettings/{toUid}`. It queues mail only when `allowContactFromPlayers` is exactly `true`. That setting defaults to false. A stored `receiveUpdates` value is the retired "Keep me up to date" checkbox. It does not send this mail, and it does not opt the player into the monthly email. An `openToGames` card lets another player send an in-app request. It is not consent to email, and the profile copy says the address is not shared.

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

`exportMyData` returns JSON for `users`, `users/{uid}/teams`, `teams`, `userSettings` (including the monthly-email fields), `newsletterTokens`, `playerProfiles`, `playerMapOwners`, `playerMapPrivate`, `playerMap`, that account's key on `playerMapBoard/public` and `openToGamesBoard/public`, `openToGames`, game requests sent and received, `messages`, `roles`, `adminUsers`, `mail` (another person's address is left out), `privacyRate`, buddy links, buddy requests sent and received, blocks, the invite code, the findable-name card, `buddyRate`, email invites that account sent (a salted hash, not the address), the opt-out tokens it created, and that account's own email-invite rate and opt-out hash when Twilio is configured. `buddyEmailSuppress` is included in that download when the hash can be computed, and account deletion leaves it in place. `stats/public` is aggregate and is not copied. The callable response has to stay under Cloud Functions' 10 MB limit.

`deleteMyAccount` checks that `confirmation` is exactly `DELETE` and that the ID token `auth_time` is less than five minutes old. It then, in order:

1. Writes a deletion marker and revokes refresh tokens, so a still-valid ID token cannot recreate data.
2. Removes this account's key from `playerMapBoard/public` and `openToGamesBoard/public` in one transaction.
3. Deletes the account's documents, including teams, the legacy `users/{uid}/teams` subcollection, and `newsletterTokens/{uid}`.
4. Anonymizes this account's side of `gameContacts` and `messages`. The other person's text stays. Names become `Deleted player`. Contact-form messages lose their email and body, and `userId` becomes `deleted`. The request document is removed only when both players are gone.
5. Deletes queued `mail` documents for those requests and any mail addressed to this account.
6. Deletes buddy links, requests, blocks, the invite, the findable-name card, `buddyRate/{uid}`, email invites that account sent, and opt-out link tokens it created. When Twilio is configured, it also deletes `buddyEmailRate` for the salted hash of that account's own address. It does not delete `buddyEmailSuppress`. That opt-out stays after deletion whether or not Twilio is configured. A placeholder secret of `disabled` skips only the rate-hash lookup. The invitee's address is not stored.
7. Deletes `privacyRate/{uid}` and `gameContactEmailRate/{uid}`.
8. Deletes painted-car photos: shared copies and their documents, every Storage object under `users/{uid}/` (library files and older vehicle-photos files), and the photo metadata. The account export lists each photo's storage path and caption. It does not include a public link.
9. Deletes the Auth user. A missing Auth user is success, so a retry can finish leftover documents.
10. Scans again for map keys and documents created while the account was being deleted.

Logs are `privacy <event> ref=<sha256 prefix>`. They do not include the uid, email, or display name. Deleting `adminUsers/{uid}` makes `syncAuthDisabled` see a deleted document and leave Auth alone. The Auth delete is only step 9.

The browser calls these from Settings → General Settings after Google sign-in. Download does not ask for a second sign-in. Delete opens the Google prompt again, then calls the function. See `docs/PRIVACY-OPS.md` for requests, retention, and the breach checklist.

## Shared car pages

`renderSharedCar` is the page a link preview fetches. The site is a static SPA, so a crawler that only reads the first HTML response would otherwise see the builder title and the default icon. CloudFront Functions cannot make a network call, so they cannot look up the car. Lambda@Edge would need a second set of credentials and a us-east-1 build. This function already runs next to Firestore with the default compute identity, so `/car/*` and `/embed/*` are routed to it.

The CloudFront change is in `infra/lib/garage-stack.ts`. It is not applied by this repository's workflow. Do not deploy it until the function below is live, or those URLs return an origin error.

What the function does:

- `GET` or `HEAD` `/car/<photoId>` renders the car page. `GET` or `HEAD` `/embed/car/<photoId>` renders the small card.
- It loads `sharedPhotos/<photoId>` and nothing else. It does not read `sharedPhotoPrivate`, Auth, or email.
- The page is public only when `showInGallery`, `published`, and `hidden == false` are all set the way the Gallery requires. Unsharing, hiding, or a report takedown (three reports, or an admin hide) returns **410** with "This car is no longer shared." and no photo. 410 is used so CloudFront's existing 404 mapping does not replace that notice with `/404.html`.
- The HTML includes `og:title`, `og:image`, `og:description`, `og:url`, and `twitter:card` = `summary_large_image`. A crawler does not need JavaScript.
- The car page sends `X-Frame-Options: DENY`. The embed does not, and its content security policy allows `frame-ancestors *`. These behaviors must not use the site response-headers policy, which would block the iframe.
- `Cache-Control: no-store`, and the CloudFront behavior uses the managed CachingDisabled policy, so a takedown is visible on the next request.
- `invoker: public`. CloudFront does not sign the request. The response is the same public card the Gallery already shows.

No Firestore rules change and no new index for a car page. A car page is one document read by id. The browser page uses the existing `sharedPhotos` read rule, which already requires a published, visible gallery photo. Storage rules already allow the image only in that same case.

The Photos page (Gallery under Players and Events, and My Photos in Settings, which opens that page with your photos selected) lists the public Gallery 24 photos at a time. Each page is `showInGallery == true`, `hidden == false`, `published == true`, then any of vehicle type, display name, and one `keywords` `array-contains`, ordered by `createdAt` or `cans`. The cursor is `startAfter` the last snapshot. `keywords` is a list of lowercase words from the caption, car name, vehicle type, weapons, and display name, written when the photo is published or when its caption or shared stats are saved. There is no backfill job. A photo shared before that field existed still appears in the newest and oldest lists. It is missing from search and from a cans sort until the next save. Likes are not stored, so there is no most-liked sort. My photos stays the account library (100 photos) and is not this query.

`firestore.indexes.json` has every composite index those combinations need on collection `sharedPhotos` (32 indexes: the filters above, each with `createdAt` and `cans` ascending and descending). Deploy them before the site that pages the Gallery is published:

```bash
firebase deploy --only firestore:indexes --project=gaslandsgarage-74ce6
```

A photo added from the Photos page with no linked car is stored in that player's library and counts toward the same 100-photo limit. Publishing it to the Gallery uses `setPhotoSharing` with a vehicle type from the game list and no stats. Firestore rules are unchanged: clients still cannot write `sharedPhotos`. That gallery-only branch is not live until `setPhotoSharing` is deployed by hand:

```bash
firebase deploy --only functions:setPhotoSharing --project=gaslandsgarage-74ce6
```

A painting-guide link is optional on the private profile (`playerProfiles.website`) and on each photo (`paintingUrl`). The profile field is not copied onto a photo unless the player keeps it or presses "Use my profile website". Firestore rules allow the profile field and a client update of `paintingUrl` on `users/{uid}/photos/{photoId}` only when the value is empty or an http(s) URL of at most 300 characters. Clients still cannot write `sharedPhotos`. `setPhotoPaintingUrl` and `setPhotoSharing` apply that same check before the Admin SDK writes the public card. No new index. The link is not on the live car page or embed until `renderSharedCar` is deployed, and a saved link is not copied onto a public card until `setPhotoPaintingUrl` and `setPhotoSharing` are deployed:

```bash
firebase deploy --only firestore:rules --project=gaslandsgarage-74ce6
firebase deploy --only functions:setPhotoPaintingUrl,functions:setPhotoSharing,functions:renderSharedCar --project=gaslandsgarage-74ce6
```

The car page markup and CSS live in `app/src/lib/photos/carPage.ts`. The function imports that module, so a header, hero, stat card, or share-icon change is not live until `renderSharedCar` is deployed by hand. CI does not deploy functions. Hosting stays on AWS. Deploy the function by hand, from the repository root, before the CloudFront change:

```bash
firebase deploy --only functions:renderSharedCar --project=gaslandsgarage-74ce6
```

A deploy of every function still needs `--force` because other functions retry. `renderSharedCar` itself does not. If the project policy blocks public invoke, allow unauthenticated invoke for this function only. Do not put a key in the source or in the URL.

Then review and deploy the stack when you mean to:

```bash
cd infra && npx cdk diff && npx cdk deploy
```

Until that deploy, `/car/<id>` and `/embed/car/<id>` are ordinary SPA routes. The page works in the browser, and the embed is blocked by the site's frame policy. Link previews start working after the behavior is live.

`renderSharedCar` uses 256MiB, a 30 second timeout, and at most 10 instances. It does not keep a warm instance.

## Deploy

From the repository root, with the Firebase CLI logged in as someone who can deploy this project. Do this by hand. Do not add it to the AWS deploy workflow.

Create the Twilio secrets before the first deploy that includes these functions. `firebase deploy --only functions` fails if a declared secret does not exist. Until the sending domain is verified, set both values to the word `disabled`. Email invites stay off. The UI still offers the copyable invite link.

```bash
firebase functions:secrets:set TWILIO_ACCOUNT_SID --project=gaslandsgarage-74ce6
firebase functions:secrets:set TWILIO_AUTH_TOKEN --project=gaslandsgarage-74ce6
```

`MAIL_FROM_ADDRESS` defaults to `noreply@gaslandsgarage.com`. The domain has to be verified in the Twilio Console before a real send succeeds. This branch vendors `functions/src/sendMail.ts` from PR #25 (`cursor/twilio-email-mail-496a`). Do not add a second Twilio client. When that pull request merges, keep one `defineSecret('TWILIO_ACCOUNT_SID')`, one `defineSecret('TWILIO_AUTH_TOKEN')`, and one `MAIL_FROM_ADDRESS` param (`functions/src/twilioConfig.ts`). Buddy invites call `postTwilioEmail` only. They do not append the game-request settings footer, and they do not register `sendQueuedMail`.

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
