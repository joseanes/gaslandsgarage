import { expect, test } from '@playwright/test';
import { emulatorFirestore } from './emulatorAdmin';

const CONSENT =
	'Send me the monthly Gaslands Garage email: game tips, car suggestions, and new site features. About once a month. Unsubscribe anytime.';

async function signIn(page: import('@playwright/test').Page, email: string) {
	await page.addInitScript(() => localStorage.setItem('gaslands-firebase-emulators', '1'));
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();
	return page.evaluate(() => window.emulatorAuthState?.()?.uid ?? '');
}

async function openGeneralSettings(page: import('@playwright/test').Page) {
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'General Settings' }).click();
	const dialog = page.getByRole('dialog', { name: 'Settings' });
	await expect(dialog).toBeVisible();
	return dialog;
}

test('the monthly email stays unchecked, separate, and easy to dismiss', async ({ page }) => {
	const email = `news-${Date.now()}@example.com`;
	const uid = await signIn(page, email);
	const prompt = page.getByTestId('newsletter-prompt');
	await expect(prompt).toBeVisible();
	await expect(prompt).toContainText(CONSENT);

	const dialog = await openGeneralSettings(page);
	await expect(dialog.getByText('Keep me up to date')).toHaveCount(0);
	const checkbox = dialog.getByTestId('newsletter-opt-in');
	await expect(checkbox).not.toBeChecked();
	await expect(dialog.getByLabel(CONSENT)).toBeVisible();
	await dialog.getByRole('button', { name: 'Close settings modal without saving' }).click();

	await page.getByTestId('newsletter-dismiss').click();
	await expect(prompt).toHaveCount(0);
	await expect
		.poll(async () => (await emulatorFirestore().doc(`userSettings/${uid}`).get()).get('newsletterPromptDismissedAt'))
		.toEqual(expect.any(String));
	expect((await emulatorFirestore().doc(`userSettings/${uid}`).get()).get('newsletterOptIn')).toBeUndefined();

	await page.reload();
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();
	await expect(page.getByTestId('newsletter-prompt')).toHaveCount(0);
});

test('opting in from the prompt stores the consent version and hides the prompt', async ({ page }) => {
	const email = `news-yes-${Date.now()}@example.com`;
	const uid = await signIn(page, email);
	await expect(page.getByTestId('newsletter-prompt')).toBeVisible();
	await page.getByTestId('newsletter-accept').click();
	await expect(page.getByTestId('newsletter-prompt')).toHaveCount(0);

	await expect
		.poll(async () => (await emulatorFirestore().doc(`userSettings/${uid}`).get()).get('newsletterOptIn'))
		.toBe(true);
	const saved = (await emulatorFirestore().doc(`userSettings/${uid}`).get()).data() ?? {};
	expect(saved.newsletterConsentText).toBe('monthly-email-v1');
	expect(saved.newsletterOptInAt).toEqual(expect.any(String));
	expect(saved.receiveUpdates).not.toBe(true);

	const dialog = await openGeneralSettings(page);
	await expect(dialog.getByTestId('newsletter-opt-in')).toBeChecked();
	await expect(dialog.getByText('Keep me up to date')).toHaveCount(0);
});

test('saving the settings checkbox opts in without the prompt coming back', async ({ page }) => {
	const email = `news-box-${Date.now()}@example.com`;
	const uid = await signIn(page, email);
	await expect(page.getByTestId('newsletter-prompt')).toBeVisible();
	const dialog = await openGeneralSettings(page);
	await dialog.getByTestId('newsletter-opt-in').check();
	await dialog.getByRole('button', { name: 'Save and close settings' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId('newsletter-prompt')).toHaveCount(0);

	const saved = (await emulatorFirestore().doc(`userSettings/${uid}`).get()).data() ?? {};
	expect(saved.newsletterOptIn).toBe(true);
	expect(saved.newsletterConsentText).toBe('monthly-email-v1');
	expect(saved.receiveUpdates).not.toBe(true);

	await page.reload();
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();
	await expect(page.getByTestId('newsletter-prompt')).toHaveCount(0);
	const again = await openGeneralSettings(page);
	await expect(again.getByTestId('newsletter-opt-in')).toBeChecked();
});
