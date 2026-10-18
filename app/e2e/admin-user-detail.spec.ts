import { expect, test, type Locator, type Page } from '@playwright/test';
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

async function expectPanelDirectlyBelow(row: Locator, panel: Locator) {
	await expect(panel).toBeVisible();
	const rowBox = await row.boundingBox();
	const panelBox = await panel.boundingBox();
	expect(rowBox).toBeTruthy();
	expect(panelBox).toBeTruthy();
	if (!rowBox || !panelBox) return;
	const gap = panelBox.y - (rowBox.y + rowBox.height);
	expect(gap).toBeGreaterThanOrEqual(-2);
	expect(gap).toBeLessThan(20);

	const viewport = panel.page().viewportSize();
	expect(viewport).toBeTruthy();
	if (!viewport) return;
	expect(panelBox.y).toBeGreaterThanOrEqual(0);
	expect(panelBox.y).toBeLessThan(viewport.height - 8);
	expect(panelBox.x).toBeGreaterThanOrEqual(-1);
	expect(panelBox.x).toBeLessThan(viewport.width - 8);
	expect(panelBox.width).toBeLessThanOrEqual(viewport.width + 2);
	const visibleHeight = Math.min(panelBox.y + panelBox.height, viewport.height) - panelBox.y;
	expect(visibleHeight).toBeGreaterThan(24);
	expect(rowBox.y).toBeGreaterThanOrEqual(-2);
	expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(viewport.height + 2);
}

test('settings and teams open under a user who is not first in a long list', async ({ page }) => {
	test.setTimeout(120_000);
	const stamp = Date.now();
	const mark = `row-${stamp}`;
	const total = 32;
	const targetIndex = 15;
	const emptyIndex = 20;
	const targetUid = `${mark}-${String(targetIndex).padStart(2, '0')}`;
	const emptyUid = `${mark}-${String(emptyIndex).padStart(2, '0')}`;
	const targetEmail = `${targetUid}@example.com`;
	const emptyEmail = `${emptyUid}@example.com`;
	const adminEmail = `${mark}-admin@example.com`;
	const db = emulatorFirestore();
	const batch = db.batch();

	for (let index = 0; index < total; index += 1) {
		const uid = `${mark}-${String(index).padStart(2, '0')}`;
		batch.set(db.doc(`users/${uid}`), {
			uid,
			email: `${uid}@example.com`,
			displayName: `Driver ${index}`,
			createdAt: '2024-01-01T00:00:00.000Z',
			lastSignInAt: '2024-06-01T00:00:00.000Z',
			lastSeenAt: '2024-06-01T00:00:00.000Z'
		});
	}
	batch.set(db.doc(`userSettings/${targetUid}`), {
		newsletterOptIn: true,
		newsletterOptInAt: '2026-10-01T15:04:00.000Z',
		newsletterConsentText: 'monthly-email-v1',
		receiveUpdates: false,
		allowContactFromPlayers: true,
		showOnPlayersMap: false,
		location: 'Austin, TX'
	});
	batch.set(db.doc(`playerProfiles/${targetUid}`), {
		playerName: 'Ada',
		locationLabel: 'Austin, TX',
		showOnMap: true,
		anonymousOnMap: false,
		openToGames: true,
		updatedAt: '2026-10-02T00:00:00.000Z'
	});
	batch.set(db.doc(`teams/${mark}-team`), {
		userId: targetUid,
		teamName: 'Below The Row',
		teamData: {
			sponsor: 'rutherford',
			rulesVersion: 2,
			maxCans: 50,
			vehicles: [{ id: 'v1', type: 'car', name: 'Hauler', weapons: ['mg'], upgrades: [], perks: [] }]
		},
		createdAt: '2026-10-01T00:00:00.000Z',
		updatedAt: '2026-10-01T00:00:00.000Z'
	});
	await batch.commit();

	const adminUid = await signIn(page, adminEmail);
	await expect.poll(async () => (await db.doc(`users/${adminUid}`).get()).exists).toBe(true);
	await db.doc(`roles/${adminUid}`).set({
		role: 'Administrator',
		updatedAt: '2026-10-01T00:00:00.000Z',
		updatedBy: 'test'
	});
	await page.goto('/admin/users', { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('admin-users')).toBeVisible({ timeout: 15_000 });
	await page.getByTestId('user-search').fill(mark);
	const userRows = page.getByTestId('admin-user-row');
	await expect(userRows).toHaveCount(total + 1);

	const targetRow = userRows.filter({ hasText: targetEmail });
	const firstEmail = ((await userRows.first().innerText()).split('\n')[0] ?? '').trim();
	expect(firstEmail).not.toBe(targetEmail);
	expect(firstEmail.startsWith(`${mark}-`)).toBe(true);

	for (const viewport of [
		{ width: 1280, height: 800 },
		{ width: 375, height: 700 }
	]) {
		await page.setViewportSize(viewport);
		const settingsButton = targetRow.getByRole('button', { name: `View settings for ${targetEmail}` });
		await settingsButton.click();
		const openSettingsButton = targetRow.getByRole('button', { name: `Hide settings for ${targetEmail}` });
		const settings = page.getByTestId('admin-user-settings');
		await expect(settings.getByTestId('newsletter-status')).toHaveText('On');
		await expect(settings.getByTestId('settings-location')).toHaveText('Austin, TX');
		await expect(settings.getByTestId('profile-city')).toHaveText('Austin, TX');
		await expect(settings.getByTestId('settings-loading')).toHaveCount(0);
		await expect(settings.getByTestId('settings-error')).toHaveCount(0);
		const settingsPanel = page.locator(`#user-settings-${targetUid}`);
		await expect(openSettingsButton).toHaveAttribute('aria-expanded', 'true');
		await expect(openSettingsButton).toHaveAttribute('aria-controls', `user-settings-${targetUid}`);
		await expect(settingsPanel).toBeFocused();
		await expect(targetRow.locator('xpath=following-sibling::tr[1]')).toHaveAttribute('data-testid', 'admin-settings-row');
		await expect(page.getByTestId('admin-users').getByTestId('admin-user-settings')).toBeVisible();
		await expectPanelDirectlyBelow(targetRow, settingsPanel);

		await targetRow.getByRole('button', { name: `Hide settings for ${targetEmail}` }).click();
		await expect(settings).toHaveCount(0);

		const teamsButton = targetRow.getByRole('button', { name: `View teams for ${targetEmail}` });
		await teamsButton.click();
		const openTeamsButton = targetRow.getByRole('button', { name: `Hide teams for ${targetEmail}` });
		const teams = page.getByTestId('admin-teams-panel');
		await expect(teams.getByText('Below The Row')).toBeVisible();
		await expect(teams.getByText('Hauler')).toBeVisible();
		await expect(teams.getByTestId('teams-loading')).toHaveCount(0);
		await expect(teams.getByTestId('teams-error')).toHaveCount(0);
		await expect(openTeamsButton).toHaveAttribute('aria-expanded', 'true');
		await expect(openTeamsButton).toHaveAttribute('aria-controls', `user-teams-${targetUid}`);
		await expect(teams).toBeFocused();
		await expect(targetRow.locator('xpath=following-sibling::tr[1]')).toHaveAttribute('data-testid', 'admin-teams-row');
		await expectPanelDirectlyBelow(targetRow, teams);

		await targetRow.getByRole('button', { name: `Hide teams for ${targetEmail}` }).click();
		await expect(teams).toHaveCount(0);

		const emptyRow = userRows.filter({ hasText: emptyEmail });
		await emptyRow.getByRole('button', { name: `View teams for ${emptyEmail}` }).click();
		const emptyTeams = page.getByTestId('admin-teams-panel');
		await expect(emptyTeams.getByTestId('teams-empty')).toHaveText('No saved teams');
		await expect(emptyTeams).toBeFocused();
		await expect(emptyRow.locator('xpath=following-sibling::tr[1]')).toHaveAttribute('data-testid', 'admin-teams-row');
		await expectPanelDirectlyBelow(emptyRow, emptyTeams);
		await emptyRow.getByRole('button', { name: `Hide teams for ${emptyEmail}` }).click();
		await expect(emptyTeams).toHaveCount(0);
	}
});
