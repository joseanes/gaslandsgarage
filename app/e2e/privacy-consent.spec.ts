import { expect, test } from '@playwright/test';

test('footer Privacy settings reopens equal Accept and Reject choices', async ({ page }) => {
	await page.goto('/builder');
	await expect(page.getByTestId('consent-banner')).toHaveCount(0);
	await page.getByTestId('privacy-settings').click();
	const banner = page.getByTestId('consent-banner');
	await expect(banner).toBeVisible();
	await expect(banner.getByRole('heading', { name: 'Analytics cookies' })).toBeVisible();
	const reject = banner.getByRole('button', { name: 'Reject' });
	const accept = banner.getByRole('button', { name: 'Accept' });
	const rejectBox = await reject.boundingBox();
	const acceptBox = await accept.boundingBox();
	expect(rejectBox).toBeTruthy();
	expect(acceptBox).toBeTruthy();
	expect(Math.abs((rejectBox?.width ?? 0) - (acceptBox?.width ?? 0))).toBeLessThan(2);
	expect(Math.abs((rejectBox?.height ?? 0) - (acceptBox?.height ?? 0))).toBeLessThan(2);
	await reject.click();
	await expect(banner).toHaveCount(0);
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('gaslands.analyticsConsent.v1')))
		.toContain('"choice":"rejected"');

	const commands = await page.evaluate(() =>
		(window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>))
	);
	const defaults = commands.filter((entry) => entry[0] === 'consent' && entry[1] === 'default');
	expect(defaults.length).toBeGreaterThanOrEqual(2);
	const config = commands.find((entry) => entry[0] === 'config' && entry[1] === 'G-EKPMXMY097');
	expect(config?.[2]).toMatchObject({
		allow_google_signals: false,
		allow_ad_personalization_signals: false
	});
	const update = commands.find((entry) => entry[0] === 'consent' && entry[1] === 'update');
	expect(update?.[2]).toMatchObject({
		analytics_storage: 'denied',
		ad_storage: 'denied',
		ad_user_data: 'denied',
		ad_personalization: 'denied'
	});
});

test.describe('a visitor likely in the EEA', () => {
	test.use({ timezoneId: 'Europe/Berlin' });

	test('sees the banner before choosing', async ({ page }) => {
		await page.goto('/builder');
		await expect(page.getByTestId('consent-banner')).toBeVisible();
		await page.getByRole('button', { name: 'Accept' }).click();
		await expect(page.getByTestId('consent-banner')).toHaveCount(0);
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem('gaslands.analyticsConsent.v1')))
			.toContain('"choice":"accepted"');
	});
});

test('Global Privacy Control denies analytics', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, get: () => true });
	});
	await page.goto('/builder');
	const update = await page.evaluate(() => {
		const commands = (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
		return commands.find((entry) => entry[0] === 'consent' && entry[1] === 'update')?.[2];
	});
	expect(update).toMatchObject({
		analytics_storage: 'denied',
		ad_storage: 'denied',
		ad_user_data: 'denied',
		ad_personalization: 'denied'
	});
});

test('signed-out settings hide the account download', async ({ page }) => {
	await page.goto('/builder');
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'General Settings' }).click();
	const dialog = page.getByRole('dialog', { name: 'Settings' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId('download-my-data')).toHaveCount(0);
});

test('a signed-in player can open download and must type DELETE', async ({ page }) => {
	const email = `privacy-${Date.now()}@example.com`;
	await page.addInitScript(() => localStorage.setItem('gaslands-firebase-emulators', '1'));
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'General Settings' }).click();
	const dialog = page.getByRole('dialog', { name: 'Settings' });
	await expect(dialog.getByTestId('download-my-data')).toBeVisible();
	const remove = dialog.getByTestId('delete-my-account');
	await expect(remove).toBeDisabled();
	await dialog.getByLabel('Type DELETE to confirm').fill('delete');
	await expect(remove).toBeDisabled();
	await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
	await expect(remove).toBeEnabled();
});
