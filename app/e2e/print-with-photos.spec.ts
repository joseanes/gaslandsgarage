import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Frame, type Page } from '@playwright/test';

/** 1×1 PNG. The builder re-encodes it before the reserved upload. */
const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

const PROXY_PORT = 8888;
const STORAGE_PORT = 8443;
const REDIRECTED_PHOTO = 'https://storage.googleapis.com/gaslands-e2e/painted-car.png';

// The download redirect has to be a real network response. Intercepting it with
// Playwright aborts the photo request, so the proxy both redirects Storage
// downloads and attaches the live Content-Security-Policy.
test.use({
	proxy: { server: `http://127.0.0.1:${PROXY_PORT}` },
	ignoreHTTPSErrors: true,
	launchOptions: {
		args: [
			'--disable-features=LocalNetworkAccessChecks',
			'--ignore-certificate-errors',
			'--proxy-bypass-list=<-loopback>'
		]
	}
});

let proxyServer: http.Server | undefined;
let storageServer: https.Server | undefined;
let storageDownloads = 0;
let activePolicy = '';

function listen(server: http.Server | https.Server, port: number) {
	return new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', () => resolve());
	});
}

function closeServer(server: http.Server | https.Server | undefined) {
	return new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
}

test.beforeAll(async () => {
	const dir = mkdtempSync(join(tmpdir(), 'gaslands-storage-cert-'));
	const key = join(dir, 'key.pem');
	const cert = join(dir, 'cert.pem');
	const made = spawnSync(
		'openssl',
		['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert, '-days', '1', '-nodes', '-subj', '/CN=storage.googleapis.com'],
		{ stdio: 'ignore' }
	);
	if (made.status !== 0) throw new Error('openssl could not create a certificate for the Storage download host.');

	storageDownloads = 0;
	storageServer = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
		const headers = {
			'Access-Control-Allow-Origin': req.headers.origin || '*',
			'Access-Control-Allow-Headers': '*',
			'Access-Control-Allow-Methods': 'GET, OPTIONS, HEAD',
			'Content-Type': 'image/png',
			Vary: 'Origin'
		};
		if (req.method === 'OPTIONS') {
			res.writeHead(204, headers);
			res.end();
			return;
		}
		storageDownloads += 1;
		res.writeHead(200, headers);
		res.end(TINY_PNG);
	});

	proxyServer = http.createServer((req, res) => {
		let target: URL;
		try {
			target = new URL(req.url || '');
		} catch {
			res.writeHead(400);
			res.end();
			return;
		}
		const authorizedDownload = target.port === '9199' && req.method === 'GET' && (req.url || '').includes('alt=media') && Boolean(req.headers.authorization);
		if (authorizedDownload) {
			res.writeHead(302, {
				Location: REDIRECTED_PHOTO,
				'Access-Control-Allow-Origin': req.headers.origin || 'http://127.0.0.1:4173',
				'Access-Control-Allow-Headers': '*',
				'Access-Control-Allow-Methods': 'GET, OPTIONS, HEAD',
				Vary: 'Origin'
			});
			res.end();
			return;
		}
		const headers = { ...req.headers, host: target.host };
		delete headers['proxy-connection'];
		const upstream = http.request(
			{
				hostname: target.hostname,
				port: target.port || 80,
				path: `${target.pathname}${target.search}`,
				method: req.method,
				headers
			},
			(response) => {
				const headers = { ...response.headers };
				const type = String(headers['content-type'] || '');
				if (activePolicy && target.port === '4173' && type.includes('text/html')) headers['content-security-policy'] = activePolicy;
				res.writeHead(response.statusCode || 502, headers);
				response.pipe(res);
			}
		);
		upstream.on('error', () => {
			if (!res.headersSent) res.writeHead(502);
			res.end();
		});
		req.pipe(upstream);
	});
	proxyServer.on('connect', (req, socket) => {
		const [host, portValue] = String(req.url || '').split(':');
		const destHost = host === 'storage.googleapis.com' ? '127.0.0.1' : host;
		const destPort = host === 'storage.googleapis.com' ? STORAGE_PORT : Number(portValue || 443);
		const upstream = net.connect(destPort, destHost, () => {
			socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
			upstream.pipe(socket);
			socket.pipe(upstream);
		});
		upstream.on('error', () => socket.end());
		socket.on('error', () => upstream.destroy());
	});

	await listen(storageServer, STORAGE_PORT);
	await listen(proxyServer, PROXY_PORT);
});

test.afterAll(async () => {
	await closeServer(proxyServer);
	await closeServer(storageServer);
});

/**
 * The same policy CloudFront sends, plus the local emulator hosts.
 * Vite's dev server needs eval. Production does not.
 */
function liveContentSecurityPolicy(): string {
	const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../infra/lib/garage-stack.ts'), 'utf8');
	const block = source.match(/const contentSecurityPolicy = \[([\s\S]*?)\]\.join\('; '\)/);
	if (!block) throw new Error('Could not read the production Content-Security-Policy.');
	const directives = [...block[1].matchAll(/["`]([^"`]+)["`]/g)].map((match) =>
		match[1].replaceAll('${firebaseProjectId}', 'gaslandsgarage-74ce6')
	);
	if (directives.length < 8) throw new Error('The production Content-Security-Policy did not parse.');
	const emulators = 'http://127.0.0.1:9099 http://127.0.0.1:8080 http://127.0.0.1:9199 http://127.0.0.1:5001 ws://127.0.0.1:8080 ws://127.0.0.1:9150';
	return directives
		.map((directive) => {
			if (directive.startsWith('script-src ')) return directive.replace("'unsafe-inline'", "'unsafe-inline' 'unsafe-eval'");
			if (directive.startsWith('connect-src ')) return `${directive} ${emulators}`;
			if (directive.startsWith('img-src ')) return `${directive} http://127.0.0.1:9199`;
			return directive;
		})
		.join('; ');
}

function directiveHosts(policy: string, name: string): string[] {
	const directive = policy.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `));
	return directive ? directive.split(/\s+/).slice(1) : [];
}

/** Drops the download host from connect-src. img-src still allows it, matching a policy that forgets the redirect. */
function policyWithoutStorageConnect(): string {
	return liveContentSecurityPolicy().replace(/connect-src [^;]*/, (directive) =>
		directive.replace(' https://storage.googleapis.com', '')
	);
}

function watchDialogs(page: Page) {
	const messages: string[] = [];
	page.on('dialog', async (dialog) => {
		messages.push(dialog.message());
		await dialog.accept();
	});
	return messages;
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
	// The print sheet is a new page, so the stub has to live on the browser context.
	await page.context().addInitScript(() => {
		const pageWindow = window as Window & { __printCalled?: boolean; __csp?: string[] };
		pageWindow.__csp = [];
		document.addEventListener('securitypolicyviolation', (event) => {
			pageWindow.__csp?.push(`${event.violatedDirective} ${event.blockedURI}`);
		});
		// Headless print() can stall the popup. Record the call and return.
		window.print = () => {
			pageWindow.__printCalled = true;
		};
		localStorage.setItem('gaslands-firebase-emulators', '1');
		localStorage.setItem('hasRules', 'true');
		localStorage.setItem('printRulesPromptSeen', 'true');
	});
});

async function saveTeamWithPhoto(page: Page) {
	const messages = watchDialogs(page);
	const email = `print-photos-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
	const response = await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();

	await page.getByLabel('Team Name').fill('Photo Racers');
	await page.locator('#sponsor-select').selectOption('rutherford');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Save/Load Team', exact: true }).click();
	const saving = page.getByRole('dialog', { name: 'My Teams' });
	await saving.getByRole('button', { name: 'Save', exact: true }).click();
	await expect.poll(() => messages.some((message) => message.includes('Team saved successfully'))).toBeTruthy();
	await saving.getByRole('button', { name: 'Close teams modal' }).click();

	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	const photos = page.getByTestId('vehicle-photos');
	await photos.locator('summary').click();
	await photos.getByTestId('vehicle-photo-input').setInputFiles({
		name: 'painted-car.png',
		mimeType: 'image/png',
		buffer: TINY_PNG
	});
	await expect(photos.getByRole('img', { name: 'Painted car' })).toBeVisible({ timeout: 30_000 });
	return response;
}

/**
 * The finished sheet is either a popup whose address is the blob URL, or the
 * same-tab frame used when the popup is blocked. A window left at about:blank
 * is the blank page José saw.
 */
async function openPhotoSheet(page: Page, timeout: number) {
	const popups: Page[] = [];
	page.on('popup', (popup) => popups.push(popup));
	const frameAttached = page.getByTestId('print-sheet-frame').waitFor({ state: 'attached', timeout }).then(() => 'frame' as const);
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Print with photos', exact: true }).click();

	// Listen before the click returns so a blank window opened inside the click is caught.
	const surface = await Promise.any([
		(async () => {
			const deadline = Date.now() + timeout;
			while (Date.now() < deadline) {
				const popup = popups[0];
				if (popup) return { kind: 'popup' as const, popup };
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			throw new Error('print did not open a window');
		})(),
		frameAttached.then(() => ({ kind: 'frame' as const }))
	]);

	if (surface.kind === 'popup') {
		await expect.poll(() => surface.popup.url(), { timeout: 5_000 }).toMatch(/^blob:/);
		expect(surface.popup.url()).not.toBe('about:blank');
		await expect(surface.popup.locator('body')).not.toContainText('Preparing your sheet');
		await expect(surface.popup.locator('h1')).toHaveText('Photo Racers');
		return { ...surface, popups };
	}

	const frame = page.frameLocator('[data-testid="print-sheet-frame"]');
	await expect(frame.locator('h1')).toHaveText('Photo Racers');
	for (const popup of popups) {
		expect(popup.url(), 'a print popup stayed at about:blank').not.toBe('about:blank');
	}
	return { kind: 'frame' as const, popups };
}

async function sheetFrame(page: Page): Promise<Frame> {
	let found: Frame | undefined;
	await expect.poll(() => {
		found = page.frames().find((frame) => frame.url().startsWith('blob:'));
		return Boolean(found);
	}).toBeTruthy();
	return found!;
}

test('print with photos follows the live Storage redirect', async ({ page }) => {
	test.setTimeout(120_000);
	activePolicy = liveContentSecurityPolicy();
	const response = await saveTeamWithPhoto(page);
	expect(response?.headers()['content-security-policy'] || '').toContain('https://storage.googleapis.com');
	const violations = () =>
		page.evaluate(() => (window as Window & { __csp?: string[] }).__csp?.filter((entry) => entry.includes('storage.googleapis.com')) ?? []);

	const downloadsBeforePrint = storageDownloads;
	const sheet = await openPhotoSheet(page, 20_000);
	expect(await violations()).toEqual([]);
	expect(storageDownloads).toBeGreaterThan(downloadsBeforePrint);

	if (sheet.kind === 'popup') {
		const printed = sheet.popup.locator('.vehicle-photos img');
		await expect(printed).toHaveCount(1);
		await expect.poll(async () => printed.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBeTruthy();
		await expect(sheet.popup.getByRole('button', { name: 'Print', exact: true })).toBeVisible();
		await expect.poll(() => sheet.popup.evaluate(() => Boolean((window as Window & { __printCalled?: boolean }).__printCalled))).toBeTruthy();
		await sheet.popup.close();
		return;
	}

	const frame = page.frameLocator('[data-testid="print-sheet-frame"]');
	const printed = frame.locator('.vehicle-photos img');
	await expect(printed).toHaveCount(1);
	await expect.poll(async () => printed.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBeTruthy();
	await expect.poll(async () => (await sheetFrame(page)).evaluate(() => Boolean((window as Window & { __printCalled?: boolean }).__printCalled))).toBeTruthy();
	await page.getByTestId('close-print-preview').click();
	await expect(page.getByTestId('print-sheet-frame')).toHaveCount(0);
});

test('a blocked photo download still prints the team and never leaves about:blank', async ({ page }) => {
	test.setTimeout(120_000);
	const policy = policyWithoutStorageConnect();
	expect(directiveHosts(policy, 'connect-src')).not.toContain('https://storage.googleapis.com');
	expect(directiveHosts(policy, 'img-src')).toContain('https://storage.googleapis.com');
	activePolicy = policy;
	const response = await saveTeamWithPhoto(page);
	const header = response?.headers()['content-security-policy'] || '';
	expect(directiveHosts(header, 'connect-src')).not.toContain('https://storage.googleapis.com');

	const consoleViolations: string[] = [];
	page.on('console', (msg) => {
		const text = msg.text();
		if (text.includes('storage.googleapis.com') && /content security policy|connect-src/i.test(text)) consoleViolations.push(text);
	});
	const sheet = await openPhotoSheet(page, 45_000);
	const violations = await page.evaluate(
		() => (window as Window & { __csp?: string[] }).__csp?.filter((entry) => entry.includes('storage.googleapis.com')) ?? []
	);
	const reported = [...violations, ...consoleViolations];
	expect(reported, `expected a connect-src violation for the Storage redirect, saw: ${reported.join(' | ')}`).toEqual(
		expect.arrayContaining([expect.stringMatching(/connect-src/i)])
	);

	if (sheet.kind === 'popup') {
		await expect(sheet.popup.locator('.vehicle-photos img')).toHaveCount(0);
		await expect(sheet.popup.locator('body')).toContainText('Photo Racers');
		await sheet.popup.close();
		return;
	}
	await expect(page.frameLocator('[data-testid="print-sheet-frame"]').locator('.vehicle-photos img')).toHaveCount(0);
	await page.getByTestId('close-print-preview').click();
});

test('a blocked popup prints the photo sheet in this tab', async ({ page }) => {
	test.setTimeout(120_000);
	activePolicy = liveContentSecurityPolicy();
	await saveTeamWithPhoto(page);
	// Replace open after load. An init-script stub is overwritten by the browser's own popup tracking.
	await page.evaluate(() => {
		window.open = () => null;
	});
	const popups: Page[] = [];
	page.on('popup', (popup) => popups.push(popup));
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Print with photos', exact: true }).click();

	const frame = page.frameLocator('[data-testid="print-sheet-frame"]');
	await expect(frame.locator('h1')).toHaveText('Photo Racers', { timeout: 20_000 });
	const printed = frame.locator('.vehicle-photos img');
	await expect(printed).toHaveCount(1);
	await expect.poll(async () => printed.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBeTruthy();
	await expect.poll(async () => (await sheetFrame(page)).evaluate(() => Boolean((window as Window & { __printCalled?: boolean }).__printCalled))).toBeTruthy();
	expect(popups).toEqual([]);
	await page.getByTestId('close-print-preview').click();
	await expect(page.getByTestId('print-sheet-frame')).toHaveCount(0);
});
