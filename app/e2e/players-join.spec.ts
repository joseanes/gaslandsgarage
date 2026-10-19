import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOW_ON_MAP = 'Show me on the players map. Off unless you turn this on.';

async function useEmulator(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem('gaslands-firebase-emulators', '1');
		localStorage.setItem(
			'gaslands.analyticsConsent.v1',
			JSON.stringify({ choice: 'rejected', at: '2026-01-01T00:00:00.000Z', gpc: false })
		);
	});
}

async function signIn(page: Page, email: string) {
	await useEmulator(page);
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();
	await page.waitForFunction(() => window.emulatorAuthState?.()?.uid);
}

async function fillLocation(page: Page, text: string) {
	const status = page.getByTestId('profile-location-status');
	await expect(status).toBeVisible();
	await expect(status).not.toHaveAttribute('data-state', 'loading', { timeout: 12_000 });
	if ((await status.getAttribute('data-state')) === 'places') {
		const suggest = page.getByTestId('profile-location-suggest');
		await suggest.click();
		await page.keyboard.press('Control+A');
		await page.keyboard.type(text);
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('profile-location')).toHaveValue(text);
		return;
	}
	await page.getByTestId('profile-location').fill(text);
}

async function openPlayers(page: Page) {
	await page.goto('/players', { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('players-loading')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.getByTestId('players-error')).toHaveCount(0);
	await expect(page.getByTestId('players-map')).toBeVisible();
}

test('a signed-out visitor does not see the join banner', async ({ page }) => {
	await useEmulator(page);
	await openPlayers(page);
	await expect(page.getByTestId('join-map-banner')).toHaveCount(0);
	await expect(page.getByText('Want to appear on the players map?')).toHaveCount(0);
	await expect(page.getByTestId('open-signed-out')).toBeVisible();
});

test('the join banner follows sign-in, an existing opt-in, and dismissal', async ({ page }) => {
	const stamp = Date.now();
	const email = `join-state-${stamp}@example.com`;
	const name = `State ${stamp}`;

	await signIn(page, email);
	await openPlayers(page);
	await expect(page.getByTestId('join-map-banner')).toBeVisible();
	await expect(page.getByText('Want to appear on the players map?')).toBeVisible();
	await expect(page.getByTestId('join-map-open')).toHaveText('Join the map');
	await expect(page.getByTestId('join-map-dismiss')).toHaveText('Not now');

	await page.getByTestId('join-map-dismiss').click();
	await expect(page.getByTestId('join-map-banner')).toHaveCount(0);

	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('players-loading')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.getByTestId('join-map-banner')).toHaveCount(0);

	await page.evaluate(() => {
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith('gaslands.playersMapJoin.dismissed')) localStorage.removeItem(key);
		}
	});
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('players-loading')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.getByTestId('join-map-banner')).toBeVisible();

	await page.goto('/profile', { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('profile-form')).toBeVisible({ timeout: 15_000 });
	await page.getByTestId('profile-player-name').fill(name);
	await fillLocation(page, '78701');
	await page.getByTestId('profile-show-on-map').check();
	await page.getByTestId('profile-save').click();
	await expect(page.getByTestId('profile-notice')).toHaveText('Profile saved.', { timeout: 20_000 });

	await openPlayers(page);
	await expect(page.getByTestId('join-map-banner')).toHaveCount(0);
	await expect(page.getByTestId('named-players')).toContainText(name);
});

test('joining without a location asks for one and does not pre-check consent', async ({ page }) => {
	test.setTimeout(60_000);
	const stamp = Date.now();
	const email = `join-new-${stamp}@example.com`;
	const name = `Nova ${stamp}`;

	await signIn(page, email);
	await openPlayers(page);
	await page.getByTestId('join-map-open').click();
	await expect(page.getByTestId('join-map-panel')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('join-map-panel')).toHaveCount(0);
	await expect(page.getByTestId('join-map-open')).toBeFocused();

	await page.getByTestId('join-map-open').click();
	const consent = page.getByTestId('join-map-consent');
	await expect(consent).not.toBeChecked();
	await expect(page.getByTestId('join-map-anonymous')).toBeDisabled();
	await expect(page.getByTestId('join-map-panel')).toContainText(SHOW_ON_MAP);
	await expect(page.getByTestId('join-map-panel')).toContainText('Pins are approximate. Amber pins include a name.');
	await expect(page.getByTestId('join-map-location-label')).toHaveCount(0);
	await fillLocation(page, '78701');
	await page.getByTestId('join-player-name').fill(name);

	await page.getByTestId('join-map-save').click();
	await expect(page.getByTestId('join-map-notice')).toHaveText('Turn on "Show me on the players map" before joining.');
	await expect(consent).not.toBeChecked();
	await expect(page.getByText(name)).toHaveCount(0);

	await consent.check();
	await expect(page.getByTestId('join-map-anonymous')).toBeEnabled();
	await page.getByTestId('join-map-save').click();
	await expect(page.getByTestId('join-map-confirmed')).toBeVisible({ timeout: 20_000 });
	await expect(page.getByTestId('join-map-confirmed').getByRole('link', { name: 'Change or remove it on your profile.' })).toHaveAttribute(
		'href',
		'/profile'
	);
	await expect(page.getByTestId('join-map-banner')).toHaveCount(0);
	await expect(page.getByTestId('join-map-panel')).toHaveCount(0);
	await expect(page.getByTestId('named-players')).toContainText(name);
	await expect(page.locator(`.player-marker-dot[data-player-name="${name}"]`)).toHaveCount(1);
});

test('joining with a saved location shows that label and still requires consent', async ({ page }) => {
	test.setTimeout(60_000);
	const stamp = Date.now();
	const email = `join-located-${stamp}@example.com`;
	const name = `Locus ${stamp}`;

	await signIn(page, email);
	await page.goto('/profile', { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('profile-form')).toBeVisible({ timeout: 15_000 });
	await page.getByTestId('profile-player-name').fill(name);
	await page.getByTestId('profile-bio').fill('Keeps this bio');
	await fillLocation(page, '78701');
	await page.getByTestId('profile-spots').fill('Guild hall');
	await expect(page.getByTestId('profile-show-on-map')).not.toBeChecked();
	await page.getByTestId('profile-save').click();
	await expect(page.getByTestId('profile-notice')).toHaveText('Profile saved.', { timeout: 20_000 });

	await openPlayers(page);
	await expect(page.getByTestId('join-map-banner')).toBeVisible();
	await page.getByTestId('join-map-open').click();
	await expect(page.getByTestId('join-map-consent')).not.toBeChecked();
	await expect(page.getByTestId('join-player-name')).toHaveValue(name);
	await expect(page.getByTestId('join-map-location-label')).toHaveText('78701');
	await expect(page.getByTestId('profile-location')).toHaveCount(0);

	await page.getByTestId('join-map-change-location').click();
	await expect(page.getByTestId('profile-location')).toHaveValue('78701');
	await expect(page.getByText('The stored pin is shifted a few miles')).toBeVisible();

	await page.getByTestId('join-map-consent').check();
	await page.getByTestId('join-map-save').click();
	await expect(page.getByTestId('join-map-confirmed')).toBeVisible({ timeout: 20_000 });
	await expect(page.getByTestId('named-players')).toContainText(name);
	await expect(page.getByTestId('named-players')).toContainText('Keeps this bio');
	await expect(page.getByTestId('named-players')).toContainText('Guild hall');
	await expect(page.locator(`.player-marker-dot[data-player-name="${name}"]`)).toHaveCount(1);
});

test('capture the join banner and panel in light and dark', async ({ page }) => {
	test.skip(!process.env.CAPTURE_JOIN_MAP, 'set CAPTURE_JOIN_MAP=1 to write screenshots');
	const dir = '/opt/cursor/artifacts';
	fs.mkdirSync(dir, { recursive: true });
	const stamp = Date.now();
	await signIn(page, `join-shot-${stamp}@example.com`);

	for (const theme of ['light', 'dark'] as const) {
		for (const width of [1280, 375] as const) {
			await page.setViewportSize({ width, height: width === 1280 ? 800 : 812 });
			await openPlayers(page);
			await page.locator('.leaflet-tile-loaded').first().waitFor({ state: 'attached', timeout: 15_000 });
			// Account settings load after navigation and can clear a dark-mode flag set too early.
			await page.evaluate((dark) => {
				document.documentElement.classList.toggle('dark', dark);
				document.documentElement.classList.toggle('dark-mode', dark);
			}, theme === 'dark');
			const banner = page.getByTestId('join-map-banner');
			await expect(banner).toBeVisible();
			if (theme === 'dark') {
				await expect.poll(async () => banner.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(31, 41, 55)');
			}
			await banner.evaluate((el) => el.scrollIntoView({ block: 'center' }));
			await page.screenshot({ path: `${dir}/join_banner_${width}_${theme}.png` });

			await page.getByTestId('join-map-open').click();
			const panel = page.getByTestId('join-map-panel');
			await expect(panel).toBeVisible();
			await expect(page.getByTestId('join-map-consent')).not.toBeChecked();
			await page.evaluate((dark) => {
				document.documentElement.classList.toggle('dark', dark);
				document.documentElement.classList.toggle('dark-mode', dark);
			}, theme === 'dark');
			await panel.evaluate((el) => el.scrollIntoView({ block: 'start' }));
			await page.screenshot({ path: `${dir}/join_panel_${width}_${theme}.png` });
			await page.keyboard.press('Escape');
		}
	}
});
