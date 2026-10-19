import fs from 'node:fs';
import net from 'node:net';

const pidFile = '/tmp/gaslands-firebase-emulators.pid';
const ports = [9099, 8080, 5001, 9199];

function canConnect(port: number) {
	return new Promise<boolean>((resolve) => {
		const socket = net.connect({ port, host: '127.0.0.1' }, () => {
			socket.end();
			resolve(true);
		});
		socket.on('error', () => resolve(false));
	});
}

function alive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function portsClosed() {
	const open = await Promise.all(ports.map((port) => canConnect(port)));
	return open.every((up) => !up);
}

export default async function globalTeardown() {
	if (!fs.existsSync(pidFile)) return;
	const pid = Number(fs.readFileSync(pidFile, 'utf8'));
	fs.unlinkSync(pidFile);
	if (!pid) return;
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		try {
			process.kill(pid, 'SIGTERM');
		} catch {
			/* the emulator already exited */
		}
	}
	const started = Date.now();
	while (Date.now() - started < 20_000) {
		if (!alive(pid) && (await portsClosed())) return;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	try {
		process.kill(-pid, 'SIGKILL');
	} catch {
		/* the emulator already exited */
	}
}
