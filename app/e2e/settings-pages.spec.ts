import { expect, test, type Page } from '@playwright/test';
import { emulatorFirestore } from './emulatorAdmin';

function watchDialogs(page: Page) {
	const messages: string[] = [];
	page.on('dialog', async (dialog) => {
		messages.push(dialog.message());
		await dialog.accept();
	});
	return messages;
}

async function openSettingsItem(page: Page, name: 'General Settings' | 'Print Settings') {
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name, exact: true }).click();
	return page.getByRole('dialog', { name: 'Settings' });
}

test('general settings open from the users page without an alert', async ({ page }) => {
	const messages = watchDialogs(page);
	await page.goto('/admin/users', { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('admin-signed-out')).toBeVisible();
	const dialog = await openSettingsItem(page, 'General Settings');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('General Settings', { exact: true })).toBeVisible();
	await expect(dialog.getByLabel('I have the Gaslands Refuelled rulebook')).toBeVisible();
	await expect(dialog.getByTestId('newsletter-setting')).toHaveCount(0);
	expect(messages).toEqual([]);
});

test('general and print settings open from usage stats without an alert', async ({ page }) => {
	const messages = watchDialogs(page);
	await page.goto('/stats', { waitUntil: 'domcontentloaded' });
	const general = await openSettingsItem(page, 'General Settings');
	await expect(general.getByText('General Settings', { exact: true })).toBeVisible();
	await general.getByRole('button', { name: 'Close settings modal without saving' }).click();
	await expect(general).toHaveCount(0);

	const print = await openSettingsItem(page, 'Print Settings');
	await expect(print.getByText('Print Settings', { exact: true })).toBeVisible();
	await expect(print.getByLabel('Classic')).toBeVisible();
	expect(messages).toEqual([]);
});

async function signIn(page: Page, email: string) {
	await page.addInitScript(() => localStorage.setItem('gaslands-firebase-emulators', '1'));
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();
	await page.waitForFunction(() => window.emulatorAuthState?.()?.uid);
	return page.evaluate(() => window.emulatorAuthState?.()?.uid ?? '');
}

test('an administrator can view settings and cannot edit them', async ({ page }) => {
	test.setTimeout(90_000);
	const stamp = Date.now();
	const playerEmail = `crew-${stamp}@example.com`;
	const adminEmail = `boss-${stamp}@example.com`;
	const db = emulatorFirestore();

	const playerUid = await signIn(page, playerEmail);
	await expect.poll(async () => (await db.doc(`users/${playerUid}`).get()).exists).toBe(true);
	await expect.poll(async () => (await db.doc(`userSettings/${playerUid}`).get()).exists).toBe(true);
	const adminUid = await page.evaluate(async (address) => {
		await window.signOutEmulatorUser?.();
		await window.signInEmulatorUser!(address, 'password123');
		return window.emulatorAuthState?.()?.uid ?? '';
	}, adminEmail);
	await expect(page.getByRole('button', { name: adminEmail.split('@')[0] })).toBeVisible();
	await expect.poll(async () => (await db.doc(`users/${adminUid}`).get()).exists).toBe(true);

	await db.doc(`roles/${adminUid}`).set({
		role: 'Administrator',
		updatedAt: '2026-10-01T00:00:00.000Z',
		updatedBy: 'test'
	});
	await db.doc(`userSettings/${playerUid}`).set({
		newsletterOptIn: true,
		newsletterOptInAt: '2026-10-01T15:04:00.000Z',
		newsletterConsentText: 'monthly-email-v1',
		receiveUpdates: true,
		receiveUpdatesChangedAt: '2026-09-01T12:00:00.000Z',
		allowContactFromPlayers: true,
		showOnPlayersMap: false,
		location: 'Austin, TX',
		printStyle: 'dashboard',
		darkMode: true
	});
	await db.doc(`playerProfiles/${playerUid}`).set({
		playerName: 'Ada',
		bio: 'private bio',
		locationLabel: 'Austin, TX',
		playSpots: '',
		latE2: 3011,
		lngE2: -9802,
		showOnMap: true,
		anonymousOnMap: false,
		openToGames: true,
		mapEntryId: 'aaaaaaaaaaaaaaaaaaaa',
		updatedAt: '2026-10-02T00:00:00.000Z'
	});

	await page.goto('/admin/users', { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('admin-users')).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: `View settings for ${playerEmail}` }).click();
	const panel = page.getByTestId('admin-user-settings');
	await expect(panel).toBeVisible();
	await expect(panel.getByText('Read-only. An administrator cannot change these choices.')).toBeVisible();
	await expect(panel.getByTestId('newsletter-status')).toHaveText('On');
	await expect(panel.getByTestId('newsletter-given')).toContainText('2026');
	await expect(panel.getByTestId('newsletter-given')).toContainText('monthly-email-v1');
	await expect(panel.getByText('Keep me up to date')).toHaveCount(0);
	await expect(panel.getByTestId('updates-status')).toHaveCount(0);
	await expect(panel.getByTestId('game-request-email')).toHaveText('On');
	await expect(panel.getByTestId('analytics-consent')).toHaveText('Not stored on the account');
	await expect(panel.getByTestId('ads-consent')).toContainText('Denied');
	await expect(panel.getByTestId('gpc-status')).toContainText('Honored in the browser');
	await expect(panel.getByTestId('sms-opt-in')).toHaveText('Not collected');
	await expect(panel.getByTestId('profile-city')).toHaveText('Austin, TX');
	await expect(panel.getByTestId('profile-visibility')).toHaveText('On the map as Ada');
	await expect(panel.getByTestId('profile-open-to-games')).toHaveText('Yes');
	await expect(panel.getByTestId('settings-location')).toHaveText('Austin, TX');
	await expect(panel.getByTestId('account-status')).toHaveText('Active');
	await expect(panel.getByTestId('account-created')).not.toHaveText('Not recorded');
	await expect(panel.getByTestId('account-last-sign-in')).not.toHaveText('Not recorded');
	await expect(panel.locator('input, textarea, select, button')).toHaveCount(0);
	await expect(panel.getByText('dashboard')).toHaveCount(0);
	await expect(panel.getByText('private bio')).toHaveCount(0);
	await expect(panel.getByText('3011')).toHaveCount(0);

	const before = (await db.doc(`userSettings/${playerUid}`).get()).data();
	expect(before?.newsletterOptIn).toBe(true);
	expect(before?.receiveUpdates).toBe(true);
	expect(before?.printStyle).toBe('dashboard');
});
