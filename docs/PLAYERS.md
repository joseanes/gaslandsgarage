# Players map

`/players` shows two public directories:

- map pins, including for signed-out visitors
- players who are open to a game, only after sign-in

Hosting stays on AWS. This feature does not use Cloud Functions.

## Why a visit does not list the collections

`playerMap` and `openToGames` used to be read with a collection query. Each visit billed one read per document, and `playerMap` allowed that list with `allow read: if true`.

The page now reads one document per directory:

| Document | Who can read it | What a player may change |
| --- | --- | --- |
| `playerMapBoard/public` | Anyone | Only the `markers` key claimed in their `playerMapOwners` document, and only while `playerMapPrivate` names them |
| `openToGamesBoard/public` | A signed-in player who is not disabled | Only the `players` key equal to their own uid |

The individual `playerMap/{entryId}` and `openToGames/{uid}` documents are still written. Game requests still require the `openToGames/{uid}` document to exist. Clients cannot list either collection. A direct read of one known pin is unchanged.

Security rules reject a board write that adds, edits, or removes any other player's key, deletes the board document, or stores an email or an extra field. A board stops accepting new keys at 500 entries so it stays under Firestore's 1 MiB document limit. An existing player can still update or remove their own key after that.

The browser keeps the last successful read in `sessionStorage` for five minutes, and clears that cache when the signed-in player saves a profile in the same tab.

## Deploy

Deploy the rules before, or in the same window as, the site build that contains this client. Nothing in CI deploys rules. Until `playerMapBoard` and `openToGamesBoard` are allowed, `/players` cannot read the directories.

```bash
firebase deploy --only firestore:rules --project=gaslandsgarage-74ce6
```

`firebase.json` has no Cloud Functions codebase. Do not run `firebase deploy --only functions`.

## Pins saved before this change

A pin that exists only as `playerMap/{entryId}` or `openToGames/{uid}` is not copied automatically. It appears on `/players` the next time that player saves their profile. Saving writes their key into the board and leaves every other key alone.

`scripts/backfill-boards.ts` rebuilds both boards from those collections once, with a user OAuth token and no service account key. It checks each entry against the rules limits and skips a pin that has no `playerMapPrivate` owner:

```bash
GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token) npx tsx scripts/backfill-boards.ts          # dry run
GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token) npx tsx scripts/backfill-boards.ts --write
```

It was run on 2026-10-18 before the rules deploy. Production had no `playerMap` or `openToGames` documents yet, so both boards started empty.

## Trigger we did not add

A Cloud Firestore trigger could keep the boards in sync without a client write:

1. On create or update of `playerMap/{entryId}`, load `playerMapPrivate/{entryId}` and set `playerMapBoard/public.markers.{entryId}` to the public fields.
2. On delete of that pin, delete only that map key.
3. Do the same for `openToGames/{uid}` and `openToGamesBoard/public.players.{uid}`.
4. Run one Admin SDK backfill that lists each source collection once and writes the two boards.

The function would use the Admin SDK, which bypasses security rules, so the trigger code itself would be the only thing allowed to touch another player's key. Scheduled functions need the Blaze plan. This repo does not add a `functions/` codebase, and hosting stays on AWS.

The client write plus the rules above cover the same per-player update without that trigger. Partial saves can leave a pin document and the board out of sync until the player saves again. That is a consistency gap, not a way to edit someone else's entry. A trigger is the way to close the gap later. It is not required for the rules to prevent spoofing or deletion.
