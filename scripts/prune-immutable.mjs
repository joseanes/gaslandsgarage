import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { keysToPrune, DEFAULT_RETAIN_MS, IMMUTABLE_PREFIX } from './retain-hashed-assets.mjs';

function walk(dir) {
	const files = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) files.push(...walk(path));
		else files.push(path);
	}
	return files;
}

function currentKeys(buildDir) {
	const immutableDir = join(buildDir, '_app', 'immutable');
	try {
		return walk(immutableDir).map((file) => relative(buildDir, file).split(sep).join('/'));
	} catch (error) {
		if (error && error.code === 'ENOENT') return [];
		throw error;
	}
}

function aws(args) {
	const result = spawnSync('aws', args, { encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(result.stderr || `aws ${args.join(' ')} failed`);
	}
	return result.stdout;
}

function listRemote(bucket) {
	const objects = [];
	let token = '';
	do {
		const args = [
			's3api', 'list-objects-v2',
			'--bucket', bucket,
			'--prefix', IMMUTABLE_PREFIX,
			'--output', 'json'
		];
		if (token) args.push('--continuation-token', token);
		const page = JSON.parse(aws(args) || '{}');
		for (const obj of page.Contents || []) {
			objects.push({ key: obj.Key, lastModified: obj.LastModified });
		}
		token = page.IsTruncated ? page.NextContinuationToken : '';
	} while (token);
	return objects;
}

function deleteKeys(bucket, keys) {
	for (let i = 0; i < keys.length; i += 1000) {
		const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
		aws([
			's3api', 'delete-objects',
			'--bucket', bucket,
			'--delete', JSON.stringify({ Objects: batch, Quiet: true })
		]);
	}
}

function main() {
	const bucket = process.argv[2];
	const buildDir = process.argv[3] || 'app/build';
	const days = Number(process.argv[4] || 14);
	if (!bucket) {
		console.error('Usage: node scripts/prune-immutable.mjs <bucket> [buildDir] [retainDays]');
		process.exit(1);
	}
	const retainMs = (Number.isFinite(days) && days > 0 ? days : 14) * 24 * 60 * 60 * 1000;
	const remote = listRemote(bucket);
	const doomed = keysToPrune(remote, currentKeys(buildDir), Date.now(), retainMs || DEFAULT_RETAIN_MS);
	if (doomed.length === 0) {
		console.log(`No hashed assets older than ${days} days to prune.`);
		return;
	}
	console.log(`Pruning ${doomed.length} hashed assets older than ${days} days.`);
	deleteKeys(bucket, doomed);
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('prune-immutable.mjs');
if (isDirectRun) main();
