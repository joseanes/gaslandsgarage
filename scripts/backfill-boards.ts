/**
 * One-time backfill for the /players boards (see docs/PLAYERS.md).
 *
 * Reads every playerMap/{entryId} and openToGames/{uid} document once and
 * writes playerMapBoard/public { markers } and openToGamesBoard/public { players }
 * in the shape app/firestore.rules accepts. Each entry is checked against the
 * same limits as the rules; anything that would not pass is skipped and counted.
 * A pin is only copied when playerMapPrivate/{entryId} exists, so the board
 * never holds a key that nobody owns.
 *
 * It uses the Firestore REST API with a user OAuth token. No service account key.
 *
 *   GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token) npx tsx scripts/backfill-boards.ts          # dry run
 *   GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token) npx tsx scripts/backfill-boards.ts --write  # replace both boards
 *
 * Running it again rebuilds both boards from the source collections. It prints
 * counts only, never names or text.
 */

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'gaslandsgarage-74ce6';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const MAX_BOARD_KEYS = 500;
const MAX_BOARD_BYTES = 800_000;

type Value = Record<string, unknown>;
type Fields = Record<string, Value>;
type Doc = { name: string; fields?: Fields };

const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN?.trim();
const write = process.argv.includes('--write');

if (!token) {
	console.error('Set GOOGLE_OAUTH_ACCESS_TOKEN, for example $(gcloud auth print-access-token).');
	process.exit(1);
}

const headers = {
	authorization: `Bearer ${token}`,
	'content-type': 'application/json',
	'x-goog-user-project': PROJECT_ID
};

async function listAll(collection: string): Promise<Doc[]> {
	const docs: Doc[] = [];
	let pageToken = '';
	do {
		const url = `${BASE}/${collection}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
		const response = await fetch(url, { headers });
		if (!response.ok) throw new Error(`List ${collection} failed (${response.status})`);
		const body = (await response.json()) as { documents?: Doc[]; nextPageToken?: string };
		docs.push(...(body.documents ?? []));
		pageToken = body.nextPageToken ?? '';
	} while (pageToken);
	return docs;
}

function idOf(doc: Doc): string {
	return doc.name.split('/').pop() ?? '';
}

function str(value: Value | undefined): string | null {
	return value && typeof value.stringValue === 'string' ? value.stringValue : null;
}

function int(value: Value | undefined): number | null {
	if (!value || typeof value.integerValue !== 'string') return null;
	const parsed = Number(value.integerValue);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function bool(value: Value | undefined): boolean | null {
	return value && typeof value.booleanValue === 'boolean' ? value.booleanValue : null;
}

/** Mirrors shortText(): a string with no at-sign, at most max characters. */
function shortText(value: Value | undefined, max: number): boolean {
	const text = str(value);
	return text !== null && !text.includes('@') && [...text].length <= max;
}

function hasOnly(fields: Fields, allowed: string[]): boolean {
	return Object.keys(fields).every((key) => allowed.includes(key));
}

function coarsePoint(fields: Fields): boolean {
	const lat = int(fields.latE2);
	const lng = int(fields.lngE2);
	const updatedAt = str(fields.updatedAt);
	return (
		lat !== null && lat >= -9000 && lat <= 9000 &&
		lng !== null && lng >= -18000 && lng <= 18000 &&
		updatedAt !== null && updatedAt.length < 40
	);
}

function validPin(fields: Fields): boolean {
	const anonymous = bool(fields.anonymous);
	if (anonymous === true) {
		return hasOnly(fields, ['anonymous', 'latE2', 'lngE2', 'updatedAt']) && coarsePoint(fields);
	}
	if (anonymous === false) {
		return (
			hasOnly(fields, ['anonymous', 'playerName', 'bio', 'playSpots', 'locationLabel', 'latE2', 'lngE2', 'openToGames', 'updatedAt']) &&
			shortText(fields.playerName, 60) &&
			(str(fields.playerName) ?? '').length > 0 &&
			shortText(fields.bio, 280) &&
			shortText(fields.playSpots, 280) &&
			shortText(fields.locationLabel, 80) &&
			bool(fields.openToGames) !== null &&
			coarsePoint(fields)
		);
	}
	return false;
}

function validCard(fields: Fields): boolean {
	const updatedAt = str(fields.updatedAt);
	return (
		hasOnly(fields, ['playerName', 'bio', 'playSpots', 'updatedAt']) &&
		shortText(fields.playerName, 60) &&
		(str(fields.playerName) ?? '').length > 0 &&
		shortText(fields.bio, 280) &&
		shortText(fields.playSpots, 280) &&
		updatedAt !== null &&
		updatedAt.length < 40
	);
}

async function replaceBoard(collection: string, field: string, entries: Fields): Promise<void> {
	const body = {
		writes: [
			{
				update: {
					name: `projects/${PROJECT_ID}/databases/(default)/documents/${collection}/public`,
					fields: { [field]: { mapValue: { fields: entries } } }
				}
			}
		]
	};
	const response = await fetch(`${BASE}:commit`, { method: 'POST', headers, body: JSON.stringify(body) });
	if (!response.ok) throw new Error(`Write ${collection}/public failed (${response.status})`);
}

async function readBoardCount(collection: string, field: string): Promise<number> {
	const response = await fetch(`${BASE}/${collection}/public`, { headers });
	if (response.status === 404) return 0;
	if (!response.ok) throw new Error(`Read ${collection}/public failed (${response.status})`);
	const doc = (await response.json()) as Doc;
	const map = doc.fields?.[field]?.mapValue as { fields?: Fields } | undefined;
	return Object.keys(map?.fields ?? {}).length;
}

async function main(): Promise<void> {
	const [pins, owners, cards] = await Promise.all([listAll('playerMap'), listAll('playerMapPrivate'), listAll('openToGames')]);
	const owned = new Set(owners.map(idOf));

	const markers: Fields = {};
	let pinsInvalid = 0;
	let pinsUnowned = 0;
	for (const pin of pins) {
		const id = idOf(pin);
		const fields = pin.fields ?? {};
		if (!/^[A-Za-z0-9]{20,40}$/.test(id) || !validPin(fields)) {
			pinsInvalid += 1;
			continue;
		}
		if (!owned.has(id)) {
			pinsUnowned += 1;
			continue;
		}
		markers[id] = { mapValue: { fields } };
	}

	const players: Fields = {};
	let cardsInvalid = 0;
	for (const card of cards) {
		const uid = idOf(card);
		const fields = card.fields ?? {};
		if (!uid || uid.length > 128 || !validCard(fields)) {
			cardsInvalid += 1;
			continue;
		}
		players[uid] = { mapValue: { fields } };
	}

	const markerCount = Object.keys(markers).length;
	const playerCount = Object.keys(players).length;
	const mapBytes = JSON.stringify(markers).length;
	const openBytes = JSON.stringify(players).length;

	console.log(`playerMap: ${pins.length} docs -> ${markerCount} markers (${pinsInvalid} invalid, ${pinsUnowned} without playerMapPrivate). About ${mapBytes} bytes of JSON.`);
	console.log(`openToGames: ${cards.length} docs -> ${playerCount} cards (${cardsInvalid} invalid). About ${openBytes} bytes of JSON.`);

	if (markerCount > MAX_BOARD_KEYS || playerCount > MAX_BOARD_KEYS || mapBytes > MAX_BOARD_BYTES || openBytes > MAX_BOARD_BYTES) {
		console.error('A board would be over the rules limits. Nothing was written.');
		process.exit(1);
	}

	if (!write) {
		console.log('Dry run. Pass --write to replace playerMapBoard/public and openToGamesBoard/public.');
	} else {
		await replaceBoard('playerMapBoard', 'markers', markers);
		await replaceBoard('openToGamesBoard', 'players', players);
		const [mapAfter, openAfter] = await Promise.all([
			readBoardCount('playerMapBoard', 'markers'),
			readBoardCount('openToGamesBoard', 'players')
		]);
		console.log(`Wrote playerMapBoard/public with ${mapAfter} markers and openToGamesBoard/public with ${openAfter} cards.`);
		if (mapAfter !== markerCount || openAfter !== playerCount) {
			console.error('Read-back counts do not match.');
			process.exit(1);
		}
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : 'Backfill failed');
	process.exit(1);
});
