import { expect, test, type Page } from '@playwright/test';

async function useEmulator(page: Page) {
	await page.addInitScript(() => localStorage.setItem('gaslands-firebase-emulators', '1'));
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

async function switchUser(page: Page, email: string) {
	await page.evaluate(async (address) => {
		await window.signOutEmulatorUser?.();
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();
	await page.waitForFunction((address) => window.emulatorAuthState?.()?.email === address, email);
}

test('the players map loads for a signed-out visitor', async ({ page }) => {
	await useEmulator(page);
	await page.goto('/players');
	await expect(page.getByRole('heading', { name: 'Players map' })).toBeVisible();
	await expect(page.getByTestId('players-loading')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.getByTestId('players-error')).toHaveCount(0);
	await expect(page.getByTestId('players-map')).toBeVisible();
	await expect(page.getByTestId('open-signed-out')).toBeVisible();
});

test('saving a profile publishes and removes that player without listing every pin', async ({ page }) => {
	test.setTimeout(90_000);
	const stamp = Date.now();
	const name = `Ada ${stamp}`;
	const email = `ada-${stamp}@example.com`;
	const other = `bea-${stamp}@example.com`;

	await signIn(page, email);
	await page.goto('/profile');
	await expect(page.getByTestId('profile-form')).toBeVisible({ timeout: 15_000 });
	await page.getByTestId('profile-player-name').fill(name);
	await page.getByTestId('profile-bio').fill('Rookie');
	await fillLocation(page, '78701');
	await page.getByTestId('profile-spots').fill('At home');
	await page.getByTestId('profile-show-on-map').check();
	await page.getByTestId('profile-open-to-games').check();
	await page.getByTestId('profile-save').click();
	await expect(page.getByTestId('profile-notice')).toHaveText('Profile saved.', { timeout: 20_000 });

	await page.goto('/players');
	await expect(page.getByTestId('players-loading')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.getByTestId('players-error')).toHaveCount(0);
	await expect(page.getByTestId('named-players')).toContainText(name);

	await switchUser(page, other);
	await page.goto('/players');
	await expect(page.getByTestId('players-loading')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.getByTestId('open-players')).toContainText(name);

	await switchUser(page, email);
	await page.goto('/profile');
	await expect(page.getByTestId('profile-player-name')).toHaveValue(name, { timeout: 15_000 });
	await page.getByTestId('profile-show-on-map').uncheck();
	await page.getByTestId('profile-open-to-games').uncheck();
	await page.getByTestId('profile-save').click();
	await expect(page.getByTestId('profile-notice')).toHaveText('Profile saved.', { timeout: 20_000 });

	await switchUser(page, other);
	await page.goto('/players');
	await expect(page.getByTestId('players-loading')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.getByTestId('players-error')).toHaveCount(0);
	await expect(page.getByText(name)).toHaveCount(0);
});
