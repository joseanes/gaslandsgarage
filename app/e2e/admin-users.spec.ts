import { expect, test, type Page } from '@playwright/test';
import { emulatorFirestore } from './emulatorAdmin';

async function signIn(page: Page, email: string) {
	await page.addInitScript(() => localStorage.setItem('gaslands-firebase-emulators', '1'));
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();
	await page.waitForFunction(() => window.emulatorAuthState?.()?.uid);
	const uid = await page.evaluate(() => window.emulatorAuthState!()?.uid ?? '');
	expect(uid).toBeTruthy();
	return uid;
}

async function switchUser(page: Page, email: string) {
	await page.evaluate(async (address) => {
		await window.signOutEmulatorUser?.();
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();
	await page.waitForFunction((address) => window.emulatorAuthState?.()?.email === address, email);
	return page.evaluate(() => window.emulatorAuthState!()?.uid ?? '');
}

test('the admin page is hidden from signed-out players and regular users', async ({ page }) => {
	await page.goto('/builder');
	await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);

	await page.goto('/admin/users');
	await expect(page.getByTestId('admin-loading')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.getByTestId('admin-signed-out')).toHaveText('Sign in to manage users.');
	await expect(page.getByTestId('admin-users')).toHaveCount(0);

	const email = `player-${Date.now()}@example.com`;
	await signIn(page, email);
	await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);
	await page.goto('/admin/users');
	await expect(page.getByTestId('admin-forbidden')).toHaveText('You need the Administrator role to manage users.', {
		timeout: 15_000
	});
	await expect(page.getByTestId('admin-users')).toHaveCount(0);
});

test('an administrator can review teams, change a role, and disable an account', async ({ page }) => {
	test.setTimeout(90_000);
	const stamp = Date.now();
	const playerEmail = `crew-${stamp}@example.com`;
	const adminEmail = `boss-${stamp}@example.com`;
	const db = emulatorFirestore();

	const playerUid = await signIn(page, playerEmail);
	await expect.poll(async () => (await db.doc(`users/${playerUid}`).get()).exists).toBe(true);
	const adminUid = await switchUser(page, adminEmail);
	await expect.poll(async () => (await db.doc(`users/${adminUid}`).get()).exists).toBe(true);

	await db.doc(`roles/${adminUid}`).set({
		role: 'Administrator',
		updatedAt: new Date().toISOString(),
		updatedBy: 'test'
	});
	await db.collection('teams').add({
		userId: playerUid,
		teamName: 'Rust Runners',
		teamData: {
			sponsor: 'rutherford',
			rulesVersion: 2,
			maxCans: 50,
			vehicles: [
				{
					id: 'v1',
					type: 'car',
					name: 'Hauler',
					weapons: ['mg'],
					upgrades: ['ram'],
					perks: ['powder_keg']
				}
			]
		},
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	});

	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('link', { name: 'Admin', exact: true })).toBeVisible();
	await page.getByRole('link', { name: 'Admin', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
	await expect(page.getByTestId('admin-users')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByText(playerEmail)).toBeVisible();
	await expect(page.getByText('This account stays active.')).toBeVisible();
	await expect(page.getByRole('button', { name: `Disable ${adminEmail}` })).toHaveCount(0);

	await page.getByTestId('user-search').fill(playerEmail);
	await expect(page.getByText(adminEmail)).toHaveCount(0);
	await expect(page.getByText(playerEmail)).toBeVisible();

	await page.getByRole('button', { name: `View teams for ${playerEmail}` }).click();
	await expect(page.getByText('Rust Runners')).toBeVisible();
	await expect(page.getByText('Hauler')).toBeVisible();
	await expect(page.getByText('Machine Gun')).toBeVisible();
	await expect(page.getByText('Rutherford')).toBeVisible();

	await page.getByRole('button', { name: `Change role for ${playerEmail}` }).click();
	const roleDialog = page.getByRole('dialog', { name: 'Change role' });
	await roleDialog.getByLabel('Role').selectOption('Administrator');
	await roleDialog.getByRole('button', { name: 'Change role' }).click();
	await expect(roleDialog).toHaveCount(0);
	await expect.poll(async () => (await db.doc(`roles/${playerUid}`).get()).data()?.role).toBe('Administrator');
	const playerRow = page.getByRole('row').filter({ hasText: playerEmail });
	await expect(playerRow.getByRole('cell', { name: 'Administrator', exact: true })).toBeVisible();

	await page.getByRole('button', { name: `Change role for ${playerEmail}` }).click();
	const clearDialog = page.getByRole('dialog', { name: 'Change role' });
	await clearDialog.getByLabel('Role').selectOption('User');
	await clearDialog.getByRole('button', { name: 'Change role' }).click();
	await expect.poll(async () => (await db.doc(`roles/${playerUid}`).get()).exists).toBe(false);

	await page.getByRole('button', { name: `Disable ${playerEmail}` }).click();
	const disableDialog = page.getByRole('dialog', { name: 'Disable account' });
	await expect(disableDialog.getByText(playerEmail, { exact: true })).toBeVisible();
	await disableDialog.getByLabel(`Type ${playerEmail} to confirm`).fill('wrong@example.com');
	await expect(disableDialog.getByRole('button', { name: 'Disable account' })).toBeDisabled();
	await disableDialog.getByLabel(`Type ${playerEmail} to confirm`).fill(playerEmail);
	await disableDialog.getByRole('button', { name: 'Disable account' }).click();
	await expect(disableDialog).toHaveCount(0);
	await expect(page.getByText('Disabled', { exact: true })).toBeVisible();
	await expect.poll(async () => (await db.doc(`adminUsers/${playerUid}`).get()).data()?.disabled).toBe(true);
	expect((await db.doc(`adminUsers/${playerUid}`).get()).data()?.disabledBy).toBe(adminUid);

	await page.getByRole('button', { name: `Re-enable ${playerEmail}` }).click();
	await page.getByRole('dialog', { name: 'Re-enable account' }).getByRole('button', { name: 'Re-enable account' }).click();
	await expect.poll(async () => (await db.doc(`adminUsers/${playerUid}`).get()).data()?.disabled).toBe(false);
});

test('a disabled player is signed out and told the account is disabled', async ({ page }) => {
	const email = `blocked-${Date.now()}@example.com`;
	const uid = await signIn(page, email);
	await emulatorFirestore().doc(`adminUsers/${uid}`).set({
		disabled: true,
		disabledAt: new Date().toISOString(),
		disabledBy: 'test'
	});

	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('account-disabled')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByRole('heading', { name: 'Your account has been disabled' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
	await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);
});
