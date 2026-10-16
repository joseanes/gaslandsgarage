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

function emulatorLog() {
	return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(-4000) : '';
}

async function waitForEmulators(child: ReturnType<typeof spawn>) {
	let exitCode: number | null = null;
	child.on('exit', (code) => {
		exitCode = code;
	});
	const started = Date.now();
	while (Date.now() - started < 180_000) {
		if ((await canConnect(9099)) && (await canConnect(8080))) return;
		if (exitCode !== null) {
			throw new Error(`Firebase emulators exited (${exitCode}) before they were ready.\n${emulatorLog()}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`Firebase emulators did not start.\n${emulatorLog()}`);
}

export default async function globalSetup() {
	if ((await canConnect(9099)) && (await canConnect(8080))) return;

	const log = fs.openSync(logFile, 'w');
	// CI runs Node 20, and `pnpm test:e2e` inherits engine-strict=true from app/.npmrc.
	// firebase-tools itself supports that Node, but universal-analytics@0.5.4 declares
	// engines.node >=22. Relax the check only for this throwaway dlx install.
	const child = spawn(
		'pnpm',
		[
			'--config.engine-strict=false',
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
			stdio: ['ignore', log, log],
			env: {
				...process.env,
				npm_config_engine_strict: 'false'
			}
		}
	);
	const started = new Promise<void>((resolve, reject) => {
		child.once('spawn', () => resolve());
		child.once('error', reject);
	});
	child.unref();
	await started;
	if (child.pid) fs.writeFileSync(pidFile, String(child.pid));
	await waitForEmulators(child);
}
