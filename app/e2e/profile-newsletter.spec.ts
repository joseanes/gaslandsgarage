import { expect, test, type Page } from '@playwright/test';
import { emulatorFirestore } from './emulatorAdmin';

const CONSENT =
	'Send me the monthly Gaslands Garage email: game tips, car suggestions, and new site features. About once a month. Unsubscribe anytime.';

async function signIn(page: Page, email: string) {
	await page.addInitScript(() => localStorage.setItem('gaslands-firebase-emulators', '1'));
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	const uid = await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
		return window.emulatorAuthState?.()?.uid ?? '';
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();
	return uid;
}

async function openGeneralSettings(page: Page) {
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'General Settings', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Settings' });
	await expect(dialog).toBeVisible();
	return dialog;
}

test('the player profile can subscribe, unsubscribe, and re-subscribe to the monthly email', async ({ page }) => {
	const email = `profile-news-${Date.now()}@example.com`;
	const uid = await signIn(page, email);
	const db = emulatorFirestore();

	await page.goto('/profile');
	const section = page.getByTestId('profile-newsletter');
	await expect(section).toBeVisible();
	await expect(section.getByRole('heading', { name: 'Monthly Gaslands Garage email' })).toBeVisible();
	await expect(section).toContainText(CONSENT);
	await expect(section.getByText('Keep me up to date')).toHaveCount(0);
	await expect(section.getByTestId('profile-newsletter-status')).toHaveText('Not subscribed');
	await expect(section.getByTestId('profile-newsletter-opt-in')).not.toBeChecked();

	await expect.poll(async () => (await db.doc(`userSettings/${uid}`).get()).exists).toBe(true);

	await section.getByTestId('profile-newsletter-toggle').click();
	await expect(section.getByTestId('profile-newsletter-status')).toContainText('Subscribed since');
	await expect(section.getByTestId('profile-newsletter-opt-in')).toBeChecked();
	await expect(section.getByTestId('profile-newsletter-toggle')).toHaveText('Unsubscribe');
	await expect(page.getByTestId('newsletter-prompt')).toHaveCount(0);

	let saved = (await db.doc(`userSettings/${uid}`).get()).data() ?? {};
	expect(saved.newsletterOptIn).toBe(true);
	expect(saved.newsletterConsentText).toBe('monthly-email-v1');
	expect(saved.newsletterSource).toBe('profile');
	expect(saved.newsletterOptInAt).toEqual(expect.any(String));
	expect(saved.receiveUpdates).not.toBe(true);

	let dialog = await openGeneralSettings(page);
	await expect(dialog.getByTestId('newsletter-opt-in')).toBeChecked();
	await expect(dialog.getByText('Keep me up to date')).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Close settings modal without saving' }).click();

	await section.getByTestId('profile-newsletter-toggle').click();
	await expect(section.getByTestId('profile-newsletter-status')).toHaveText('Not subscribed');
	await expect(section.getByTestId('profile-newsletter-opt-in')).not.toBeChecked();
	await expect(section.getByTestId('profile-newsletter-toggle')).toHaveText('Subscribe');
	saved = (await db.doc(`userSettings/${uid}`).get()).data() ?? {};
	expect(saved.newsletterOptIn).toBe(false);
	expect(saved.newsletterOptOutAt).toEqual(expect.any(String));
	expect(saved.newsletterConsentText).toBe('monthly-email-v1');
	expect(saved.newsletterSource).toBe('profile');
	expect(saved.receiveUpdates).not.toBe(true);

	dialog = await openGeneralSettings(page);
	await expect(dialog.getByTestId('newsletter-opt-in')).not.toBeChecked();
	await dialog.getByRole('button', { name: 'Close settings modal without saving' }).click();

	await section.getByTestId('profile-newsletter-opt-in').click();
	await expect(section.getByTestId('profile-newsletter-status')).toContainText('Subscribed since');
	await expect(section.getByTestId('profile-newsletter-toggle')).toHaveText('Unsubscribe');
	saved = (await db.doc(`userSettings/${uid}`).get()).data() ?? {};
	expect(saved.newsletterOptIn).toBe(true);
	expect(saved.newsletterConsentText).toBe('monthly-email-v1');
	expect(saved.newsletterSource).toBe('profile');
	expect(saved.receiveUpdates).not.toBe(true);

	dialog = await openGeneralSettings(page);
	await expect(dialog.getByTestId('newsletter-opt-in')).toBeChecked();
	await expect(dialog.getByText('Keep me up to date')).toHaveCount(0);
});
