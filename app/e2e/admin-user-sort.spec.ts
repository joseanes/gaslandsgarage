import { expect, test, type Page } from '@playwright/test';
import { emulatorFirestore } from './emulatorAdmin';

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

async function emailsInOrder(page: Page): Promise<string[]> {
	const cells = page.getByTestId('admin-users').locator('tbody tr td:first-child');
	const count = await cells.count();
	const emails: string[] = [];
	for (let index = 0; index < count; index += 1) {
		const text = await cells.nth(index).innerText();
		emails.push(text.split('\n')[0]?.trim() ?? '');
	}
	return emails;
}

test('user headers sort the full list and keep working with search', async ({ page }) => {
	test.setTimeout(90_000);
	const stamp = Date.now();
	const mark = `sort-${stamp}`;
	const oldEmail = `${mark}-a@example.com`;
	const midEmail = `${mark}-m@example.com`;
	const noneEmail = `${mark}-z@example.com`;
	const adminEmail = `${mark}-admin@example.com`;
	const db = emulatorFirestore();

	await db.doc(`users/${mark}-old`).set({
		uid: `${mark}-old`,
		email: oldEmail,
		displayName: 'Sort Old',
		createdAt: '2020-01-01T00:00:00.000Z',
		lastSignInAt: '2020-01-01T00:00:00.000Z',
		lastSeenAt: '2020-01-01T00:00:00.000Z'
	});
	await db.doc(`users/${mark}-mid`).set({
		uid: `${mark}-mid`,
		email: midEmail,
		displayName: 'Sort Mid',
		createdAt: '2022-01-01T00:00:00.000Z',
		lastSignInAt: '2024-06-01T00:00:00.000Z',
		lastSeenAt: '2024-06-01T00:00:00.000Z'
	});
	await db.doc(`users/${mark}-none`).set({
		uid: `${mark}-none`,
		email: noneEmail,
		displayName: 'Sort None',
		createdAt: '2023-01-01T00:00:00.000Z'
	});
	await db.collection('teams').add({
		userId: `${mark}-mid`,
		teamName: 'One',
		teamData: { sponsor: 'rutherford', rulesVersion: 2, vehicles: [] },
		createdAt: '2024-01-01T00:00:00.000Z'
	});
	await db.collection('teams').add({
		userId: `${mark}-mid`,
		teamName: 'Two',
		teamData: { sponsor: 'rutherford', rulesVersion: 2, vehicles: [] },
		createdAt: '2024-01-02T00:00:00.000Z'
	});
	await db.collection('teams').add({
		userId: `${mark}-none`,
		teamName: 'Solo',
		teamData: { sponsor: 'rutherford', rulesVersion: 2, vehicles: [] },
		createdAt: '2024-01-03T00:00:00.000Z'
	});

	const adminUid = await signIn(page, adminEmail);
	await expect.poll(async () => (await db.doc(`users/${adminUid}`).get()).exists).toBe(true);
	await db.doc(`roles/${adminUid}`).set({
		role: 'Administrator',
		updatedAt: '2026-10-01T00:00:00.000Z',
		updatedBy: 'test'
	});
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.goto('/admin/users');
	await expect(page.getByTestId('admin-users')).toBeVisible({ timeout: 15_000 });

	const emailHeader = page.getByRole('columnheader', { name: 'Email' });
	await expect(emailHeader).toHaveAttribute('aria-sort', 'ascending');
	await expect(page.getByTestId('sort-email')).toContainText('▲');
	await expect(page.getByRole('columnheader', { name: 'Last sign-in' })).toHaveAttribute('aria-sort', 'none');

	await page.getByTestId('user-search').fill(mark);
	await expect.poll(async () => emailsInOrder(page)).toEqual([oldEmail, adminEmail, midEmail, noneEmail]);

	await page.getByTestId('sort-lastSignIn').click();
	await expect(page.getByRole('columnheader', { name: 'Last sign-in' })).toHaveAttribute('aria-sort', 'ascending');
	await expect.poll(async () => emailsInOrder(page)).toEqual([oldEmail, midEmail, adminEmail, noneEmail]);

	await page.getByTestId('sort-lastSignIn').focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('columnheader', { name: 'Last sign-in' })).toHaveAttribute('aria-sort', 'descending');
	await expect(page.getByTestId('sort-lastSignIn')).toContainText('▼');
	await expect.poll(async () => emailsInOrder(page)).toEqual([adminEmail, midEmail, oldEmail, noneEmail]);

	await page.getByTestId('user-search').fill('Sort Mid');
	await expect.poll(async () => emailsInOrder(page)).toEqual([midEmail]);
	await page.getByTestId('user-search').fill(mark);
	await expect.poll(async () => emailsInOrder(page)).toEqual([adminEmail, midEmail, oldEmail, noneEmail]);

	await page.getByTestId('sort-teams').focus();
	await page.keyboard.press(' ');
	await expect(page.getByRole('columnheader', { name: 'Teams' })).toHaveAttribute('aria-sort', 'ascending');
	await expect.poll(async () => emailsInOrder(page)).toEqual([oldEmail, adminEmail, noneEmail, midEmail]);
});
