import { execFileSync, spawn } from 'node:child_process';
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

async function waitForPortsClosed() {
	const started = Date.now();
	while (Date.now() - started < 30_000) {
		const open = await Promise.all([canConnect(9099), canConnect(8080), canConnect(5001), canConnect(9199)]);
		if (open.every((up) => !up)) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error('Firebase emulators are still shutting down. Stop them, then run the UI tests again.');
}

async function waitForEmulators(child: ReturnType<typeof spawn>) {
	let exitCode: number | null = null;
	child.on('exit', (code) => {
		exitCode = code;
	});
	const started = Date.now();
	while (Date.now() - started < 240_000) {
		if (
			(await canConnect(9099)) &&
			(await canConnect(8080)) &&
			(await canConnect(5001)) &&
			(await canConnect(9199)) &&
			emulatorLog().includes('All emulators ready')
		) {
			return;
		}
		if (exitCode !== null) {
			throw new Error(`Firebase emulators exited (${exitCode}) before they were ready.\n${emulatorLog()}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`Firebase emulators did not start.\n${emulatorLog()}`);
}

export default async function globalSetup() {
	if (emulatorLog().includes('Shutting down emulators')) await waitForPortsClosed();
	const authUp = await canConnect(9099);
	const firestoreUp = await canConnect(8080);
	const functionsUp = await canConnect(5001);
	const storageUp = await canConnect(9199);
	if (authUp && firestoreUp && functionsUp && storageUp) return;
	if (authUp || firestoreUp || functionsUp || storageUp) {
		throw new Error('Firebase emulators are only partly running. Stop them, then run the UI tests again.');
	}

	execFileSync('pnpm', ['--dir', 'functions', 'run', 'build'], {
		cwd: repoRoot,
		stdio: 'inherit',
		env: { ...process.env, npm_config_engine_strict: 'false' }
	});

	const log = fs.openSync(logFile, 'w');
	// firebase-tools 13 calls functions.config() while loading a function, and
	// firebase-functions 7 throws on that call, so the Functions emulator never
	// serves getBuddyInvite. 15 loads these callables. The project id has to
	// match the client config: the Functions emulator 404s any other project,
	// while Auth and Firestore accept the request in single-project mode.
	const child = spawn(
		'pnpm',
		[
			'--config.engine-strict=false',
			'dlx',
			'firebase-tools@15.34.0',
			'emulators:start',
			'--only',
			'auth,firestore,functions,storage',
			'--project',
			'gaslandsgarage-74ce6'
		],
		{
			cwd: repoRoot,
			detached: true,
			stdio: ['ignore', log, log],
			env: {
				...process.env,
				npm_config_engine_strict: 'false',
				METADATA_SERVER_DETECTION: 'none',
				// Emulator placeholders so the buddies page can show the email form.
				// These are not Twilio credentials and must not be used outside this process.
				TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
				TWILIO_AUTH_TOKEN: 'emulator-placeholder-token'
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
