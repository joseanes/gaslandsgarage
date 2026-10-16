import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const pidFile = '/tmp/gaslands-firebase-emulators.pid';
const logFile = '/tmp/gaslands-firebase-emulators.log';

function canConnect(port: number) {
	return new Promise<boolean>((resolve) => {
		const socket = net.connect({ port, host: '127.0.0.1' }, () => {
			socket.end();
			resolve(true);
		});
		socket.on('error', () => resolve(false));
	});
}

async function waitForEmulators() {
	const started = Date.now();
	while (Date.now() - started < 180_000) {
		if ((await canConnect(9099)) && (await canConnect(8080))) return;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(-4000) : '';
	throw new Error(`Firebase emulators did not start.\n${log}`);
}

export default async function globalSetup() {
	if ((await canConnect(9099)) && (await canConnect(8080))) return;

	const log = fs.openSync(logFile, 'a');
	const child = spawn(
		'pnpm',
		[
			'dlx',
			'firebase-tools@13.29.1',
			'emulators:start',
			'--only',
			'auth,firestore',
			'--project',
			'demo-gaslands'
		],
		{
			cwd: repoRoot,
			detached: true,
			stdio: ['ignore', log, log]
		}
	);
	const started = new Promise<void>((resolve, reject) => {
		child.once('spawn', () => resolve());
		child.once('error', reject);
	});
	child.unref();
	await started;
	if (child.pid) fs.writeFileSync(pidFile, String(child.pid));
	await waitForEmulators();
}
