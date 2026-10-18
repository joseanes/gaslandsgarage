# Privacy operations

This is an operator checklist for Gaslands Garage. It describes what the software does. It is not legal advice. Have a lawyer review a real request or a suspected breach before you rely on the clocks below.

The site stays on AWS S3 and CloudFront. Accounts, teams, and profiles stay in Firebase. Nothing in CI deploys functions, rules, or hosting. Do not deploy Firebase Hosting.

Contact for privacy requests: `jose.anes@gmail.com`.

## Analytics consent

Google Analytics `G-EKPMXMY097` still loads. Consent Mode v2 defaults run before `gtag.js`:

- In the EEA, the UK (`GB`), and Switzerland, `analytics_storage` is denied until the visitor chooses. `wait_for_update` is 500 milliseconds.
- Everywhere else, `analytics_storage` is granted unless the visitor rejects it or Global Privacy Control is on.
- `ad_storage`, `ad_user_data`, and `ad_personalization` are denied everywhere. The site does not show ads. `ads.txt` does not place an ad.
- The Google tag is configured with `allow_google_signals: false` and `allow_ad_personalization_signals: false`.

The banner is shown to visitors who have not chosen and who look likely to be in the EEA, the UK, or Switzerland. The check uses `Intl` timezone (`Europe/*`, `Atlantic/Reykjavik`, the Atlantic islands of Portugal and Spain, Ceuta, Svalbard, Cyprus, and EU outermost regions). A two-letter `<meta name="viewer-country">` value wins over the timezone when it is present.

CloudFront does not forward `CloudFront-Viewer-Country` to the browser. `infra/lib` has no viewer-country header or cookie, and this change does not add one. Google's own region list still denies analytics in the EEA, UK, and Switzerland even if the banner's timezone guess is wrong. A visitor can always use the footer **Privacy settings** link to accept or reject.

The choice is stored in `localStorage` under `gaslands.analyticsConsent.v1` and sent with `gtag('consent', 'update')`. Accept and Reject use the same button style. Global Privacy Control (`navigator.globalPrivacyControl`) denies analytics unless the visitor explicitly accepts while that signal is on.

## Marketing consent

`userSettings.receiveUpdates` is the "Keep me up to date" checkbox. It does not send mail. When a signed-in player turns it on or off, `saveUserSettings` writes `receiveUpdatesChangedAt` as an ISO timestamp. The first save of the default off state does not write a timestamp. A later save that leaves the checkbox alone keeps the previous timestamp.

The player writes their own `userSettings` document. The rules do not whitelist every field. A modified client could set the timestamp. The normal settings screen does not.

## Monthly email

`userSettings.newsletterOptIn` is a separate checkbox. The label is: "Send me the monthly Gaslands Garage email: game tips, car suggestions, and new site features. About once a month. Unsubscribe anytime." It is unchecked until the player opts in. It is not "Keep me up to date" (`receiveUpdates`) and it is not "Allow other players to contact me to setup a game" (`allowContactFromPlayers`).

| Field | Meaning |
| --- | --- |
| `newsletterOptIn` | `true` only after an explicit opt-in. Absent means they have not answered. `false` means they opted out. |
| `newsletterOptInAt` | ISO time of the latest opt-in. Kept when they later opt out. |
| `newsletterOptOutAt` | ISO time of the latest opt-out, including the unsubscribe link. |
| `newsletterConsentText` | `monthly-email-v1`, the version of the sentence above. |
| `newsletterPromptDismissedAt` | ISO time they closed the one-time prompt without answering. The prompt is not shown again. |
| `newsletterSource` | Where they last changed the choice. `profile` is the player profile page. Absent when the choice came from settings or the prompt. |

Firestore rules let only that player write these fields, and only with those types. Opt-in requires `newsletterConsentText == monthly-email-v1` and a string `newsletterOptInAt`. Another player cannot read `userSettings`. An administrator can read the document and cannot change it. Firestore returns every field on that read; the Users page shows consent, email choices, and map preferences, and it does not show precise map coordinates. `newsletterTokens` stays unreadable, including to administrators.

A signed-in player who has never answered sees a small prompt on the page. It is not a dialog and it does not block the builder. "No thanks" only writes `newsletterPromptDismissedAt`. "Send me the monthly email" opts in. After either one, or after they save the checkbox, the prompt stays hidden.

The same choice is on the signed-in player profile, under **Monthly Gaslands Garage email**. Subscribe and Unsubscribe call `saveNewsletterChoice` and store `newsletterSource` as `profile`, with consent version `monthly-email-v1`. That control stays in step with the General Settings checkbox. It does not change **Keep me up to date**.

This change does not send the monthly email. Send it later with Twilio Email, and only after the sending domain is verified.

### How a future sender must select people

Use the Admin SDK. A player cannot read another player's settings. An administrator's signed-in session can read `userSettings` for the Users page and cannot write it. The sender should still use the Admin SDK, not the browser.

1. Query `userSettings` where `newsletterOptIn == true`. Do not use `receiveUpdates`. Do not use `allowContactFromPlayers`.
2. For each document id (the account uid), read `newsletterTokens/{uid}`. The field `token` is a 43-character random string. If that document is missing, skip the person for this run. Do not generate a token in the sender and do not send without one.
3. Load the address with `auth.getUser(uid)`. Skip a disabled user and an account with no email.
4. Send one message per person per month. The body has to include a working unsubscribe link and a postal line. The link is the HTTPS URL of the `unsubscribeNewsletter` function plus `?token=` and the token, URL-encoded. After deploy, copy that URL from the function. Do not guess a Cloud Run hostname.
5. The visible text of every message has to include the link. Also send both of these headers, using that same URL:
   `List-Unsubscribe: <the url>`
   `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
   A mailbox provider then POSTs `List-Unsubscribe=One-Click` to that URL and the token stays in the query string. That POST unsubscribes without the confirm page. A GET does not. The link has to keep working after they opt out, which is why the token is not deleted on opt-out.
6. End every message with the operator's name, email, and current postal address:

```
José Anés
jose.anes@gmail.com
[current postal address]
```

The privacy policy does not publish a street address. Do not invent one in the template. Put the real postal address in before the first send. CAN-SPAM and CASL expect that line in a commercial email.

Opening the unsubscribe link does not change the subscription. The page shows a Confirm unsubscribe button, and that button POSTs the token. The success page says you're unsubscribed and links to the player profile so they can opt in again. The page loads no images, fonts, or analytics. `Referrer-Policy` is `no-referrer`, so the token is not sent when someone follows the profile link. Do not paste function logs that contain `?token=` into a ticket or a chat.

`unsubscribeNewsletter` is public because the reader is not signed in. The token is the credential. A second POST stays unsubscribed and does not change `newsletterOptOutAt`. A bad token changes nothing and does not say whether an account exists. The invalid page is the same for a GET and a POST.

`syncNewsletterToken` runs on every `userSettings/{uid}` write. It creates `newsletterTokens/{uid}` only when `newsletterOptIn` is exactly `true`, and it does not rotate an existing token. It retries if the write fails. Clients cannot read or write `newsletterTokens`.

`exportMyData` copies the newsletter fields on `userSettings` and the token document. `deleteMyAccount` deletes both. After deletion the old link says it is not valid.

## Access and erasure

Signed-in players use **Settings → General Settings** on the team builder:

- **Download my data** calls `exportMyData` and saves a JSON file.
- **Delete my account** asks them to type `DELETE`, opens the Google sign-in prompt again, then calls `deleteMyAccount`.

Both callables run as the signed-in user only. An administrator still only disables another account (`adminUsers`). Disable does not delete data and does not delete the Auth user.

Details of the export, the deletion order, the rate limit (5 calls per action per hour), and the log line are in `docs/FUNCTIONS.md`.

### Someone who cannot sign in

1. Ask them to write from the Google address on the account, or to sign in and use the buttons.
2. If the account is disabled, an administrator can re-enable it. That still does not delete anything. After they sign in, they delete it themselves.
3. If they cannot sign in at all, do the same erasure the function does, in the Firebase console, for that one uid:
   - In one transaction, remove their key from `playerMapBoard/public` `markers` and from `openToGamesBoard/public` `players`.
   - Delete their `teams` (where `userId` is theirs), `users/{uid}` including `users/{uid}/teams`, `userSettings`, `newsletterTokens/{uid}`, `playerProfiles`, `playerMapOwners`, their `playerMap` and `playerMapPrivate` pin, `openToGames`, `roles`, and `adminUsers`.
   - Delete buddy links where `members` contains them, buddy requests where they are `fromUid` or `toUid`, blocks where they are `blockerUid` or `blockedUid`, `buddyInvites/{uid}`, `buddyDirectory/{uid}`, and `buddyRate/{uid}`.
   - Anonymize their side of `gameContacts` and `messages`. Leave the other person's text. Do not delete the other person's account.
   - Delete `mail` documents addressed to them and `mail/gameContact_*` documents for their requests.
   - Delete the Auth user last.
4. Do not put a service-account JSON key in the repository or in CI. Do not log the email address.
5. Answer access and erasure requests without undue delay. The GDPR's usual window is one month from the request (Article 12). Confirm the current rule with counsel.

A disabled account cannot obtain an ID token, so the callable cannot run until the person can sign in.

## Retention

| Data | How long it stays |
| --- | --- |
| Profile, teams, settings, player profile, map pin, open-to-games card | Until the person deletes the account, or until a verified request is completed |
| `receiveUpdatesChangedAt` | With `userSettings`, until the account is deleted |
| `newsletterOptIn`, `newsletterOptInAt`, `newsletterOptOutAt`, `newsletterConsentText`, `newsletterPromptDismissedAt`, `newsletterSource` | With `userSettings`, until the account is deleted |
| `newsletterTokens/{uid}` | Until the account is deleted. Opting out does not delete it, so an old unsubscribe link still works |
| Analytics choice | In `localStorage` on that browser until they change it or clear site data. It is not stored in Firestore |
| `gameContacts` after deletion | The thread stays for the other player. The departing name and text are replaced |
| Contact-form `messages` after deletion | Email, subject, and body removed. `userId` set to `deleted` |
| `mail` queue | Deleted on account deletion. Otherwise `expireAt` is 30 days after the queue write. Firestore TTL deletes it only after the `mail.expireAt` policy is enabled, and not at the exact minute |
| `adminUsers` disable | Does not delete the account or the data |
| `stats/public` | Aggregate counts. No account id, email, or team name |
| `privacyRate/{uid}` | Timestamps of export and delete attempts. Removed when the account is deleted |
| Buddy links, requests, blocks, invite code, findable name | Until either person removes them, or until the account is deleted. Deletion removes the shared link |

Public map pins are approximate. Street addresses are not stored. Game requests do not store an email. The recipient address exists only on the `mail` document, and only when `allowContactFromPlayers` is true.

## Collections audited

Firestore rules collections: `adminUsers`, `buddies`, `buddyBlocks`, `buddyDirectory`, `buddyInvites`, `buddyRequests`, `gameContacts`, `messages`, `newsletterTokens`, `openToGames`, `openToGamesBoard`, `playerMap`, `playerMapBoard`, `playerMapOwners`, `playerMapPrivate`, `playerProfiles`, `roles`, `stats`, `teams`, `userSettings`, `users`.

Also handled, and denied to clients by the default rule: `mail`, `privacyRate`, `buddyRate`, and the legacy subcollection `users/{uid}/teams`. Clients cannot write buddy links, requests, blocks, invites, or the directory. A callable creates those with the Admin SDK.

`stats` is not part of a personal download. A test reads `app/firestore.rules` and fails if a rules collection is missing from `functions/src/accountPrivacy.ts`.

## Breach checklist

Record the time the operator became aware, what data may be involved, and what was done. Do not put passwords, tokens, or rulebook files in the notes or in a notice.

### GDPR, Article 33 and Article 34

If a personal-data breach is unlikely to result in a risk to people, the authority notice is not required. Otherwise notify the competent supervisory authority without undue delay and, where feasible, not later than **72 hours** after becoming aware. If the notice is late, include the reason. If the breach is likely to result in a high risk to people, also tell those people without undue delay. Which authority is competent, and whether an EU representative is required, is a legal question for the operator in Florida who offers the site to people in the EEA and the UK.

### Florida Statutes section 501.171

For a breach of security that affects personal information of individuals in Florida:

- Notify each affected individual in Florida as expeditiously as practicable and without unreasonable delay, and **no later than 30 days** after the determination that a breach occurred.
- If the breach affects **500 or more** individuals in Florida, also give written notice to the Florida Department of Legal Affairs (the Attorney General) **no later than 30 days** after that determination. The statute lists what that notice has to contain, including the number of individuals in Florida affected and the services the person is offered.
- Law enforcement can delay notice. Keep the request.

"Personal information" in that statute is narrower than the GDPR's personal data. Read the current text of section 501.171 before deciding that a given incident is, or is not, covered.

### After the notices

- Confirm whether Firebase Auth, Firestore, the `mail` queue, Google Analytics, or an administrator's machine was involved.
- Revoke sessions if account tokens may have leaked (`revokeRefreshTokens` is what disable already does).
- Keep the `stats/public` page aggregate. Do not publish account ids there.

## Deploy

Do this by hand after the pull request is merged. Do not add it to the AWS deploy workflow. Do not deploy Firebase Hosting.

From the repository root, logged in to Firebase as someone who can deploy `gaslandsgarage-74ce6`:

```bash
pnpm install
firebase deploy --only functions --force --project=gaslandsgarage-74ce6
```

`--force` is required because `syncAuthDisabled`, `queueGameContactEmail`, and `syncNewsletterToken` retry. `unsubscribeNewsletter` deploys with the same command. The predeploy hook builds `functions/lib/index.js`. Node.js 22 comes from `functions/package.json`.

`privacyRate` and `mail` stay denied to clients, with no allow rule. The monthly-email change does edit `app/firestore.rules`: `userSettings` writes must pass the newsletter field types, and `newsletterTokens` is an explicit deny. Deploy the rules by hand with the functions. Do not add either deploy to the AWS workflow.

```bash
firebase deploy --only firestore:rules --project=gaslandsgarage-74ce6
```

The website updates through the existing AWS workflow when `main` changes. Merging this pull request is what publishes the banner, the footer, and the settings buttons. Do not run `cdk deploy` from this branch.

The compute service account already needs `roles/datastore.user` and `roles/firebaseauth.admin` for the functions that shipped earlier. `deleteMyAccount` uses the Auth admin role to delete the signed-in user. Do not create a new key. See `docs/FUNCTIONS.md` for the account email and the grant commands if a fresh project is missing those roles.

## Tests

```bash
cd app && pnpm test
cd functions && pnpm check && pnpm build && pnpm test
```

`functions` tests need Java and Node.js 22. They start the Auth and Firestore emulators. They do not deploy.
