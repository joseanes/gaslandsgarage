#!/usr/bin/env node
// Seeds FAKE sample data into the staging Firestore. Never point this at
// production and never copy real user data into staging.
//
//   ACCESS_TOKEN=$(gcloud auth print-access-token) node scripts/seed-staging.mjs
//
// Documents use fixed ids, so running it again overwrites the same samples.
const PROJECT = 'gaslandsgarage-staging';
if ((process.env.SEED_PROJECT ?? PROJECT) !== PROJECT) {
	console.error(`Refusing to seed ${process.env.SEED_PROJECT}: only ${PROJECT} may be seeded.`);
	process.exit(1);
}
const token = process.env.ACCESS_TOKEN;
if (!token) {
	console.error('Set ACCESS_TOKEN (gcloud auth print-access-token).');
	process.exit(1);
}

const now = new Date().toISOString();
const sampleUid = (n) => `staging-sample-racer-${n}`;
const vehicle = (id, type, name, weapons = []) => ({ id, type, name, weapons, upgrades: [], perks: [] });

const teams = [
	{
		id: 'staging-sample-team-1',
		userId: sampleUid(1),
		teamName: 'Sample: Rust Buckets',
		teamData: {
			sponsor: 'rutherford', teamName: 'Sample: Rust Buckets', maxCans: 50, rulesVersion: 2,
			vehicles: [vehicle('v1', 'car', 'Clunker', ['machine_gun']), vehicle('v2', 'buggy', 'Dune Rat')]
		}
	},
	{
		id: 'staging-sample-team-2',
		userId: sampleUid(2),
		teamName: 'Sample: Neon Ghosts',
		teamData: {
			sponsor: 'idris', teamName: 'Sample: Neon Ghosts', maxCans: 50, rulesVersion: 2,
			vehicles: [vehicle('v1', 'performance_car', 'Spark'), vehicle('v2', 'bike', 'Flicker')]
		}
	},
	{
		id: 'staging-sample-team-3',
		userId: sampleUid(3),
		teamName: 'Sample: Big Haulers',
		teamData: {
			sponsor: 'miyazaki', teamName: 'Sample: Big Haulers', maxCans: 100, rulesVersion: 2,
			vehicles: [vehicle('v1', 'truck', 'Mule', ['harpoon']), vehicle('v2', 'car', 'Pup')]
		}
	}
];

function value(v) {
	if (v === null) return { nullValue: null };
	if (Array.isArray(v)) return { arrayValue: { values: v.map(value) } };
	if (typeof v === 'boolean') return { booleanValue: v };
	if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
	if (typeof v === 'object') return { mapValue: { fields: fields(v) } };
	return { stringValue: String(v) };
}
function fields(obj) {
	return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, value(v)]));
}

const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
for (const { id, ...team } of teams) {
	const doc = { ...team, hiddenFromBuddies: false, createdAt: now, updatedAt: now };
	const res = await fetch(`${base}/teams/${id}`, {
		method: 'PATCH',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT },
		body: JSON.stringify({ fields: fields(doc) })
	});
	if (!res.ok) {
		console.error(`teams/${id}: HTTP ${res.status}`);
		process.exit(1);
	}
	console.log(`seeded teams/${id}`);
}
