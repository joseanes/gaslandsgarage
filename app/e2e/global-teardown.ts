import fs from 'node:fs';

const pidFile = '/tmp/gaslands-firebase-emulators.pid';

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
}
