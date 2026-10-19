import { expect, test, type Dialog, type Page } from '@playwright/test';

function encodeDraft(draft: unknown) {
	return Buffer.from(encodeURIComponent(JSON.stringify(draft)), 'utf8').toString('base64');
}

async function acceptBeforeUnload(dialog: Dialog) {
	if (dialog.type() === 'beforeunload') await dialog.accept();
	else await dialog.dismiss();
}

test('editing a team, leaving, and coming back keeps the draft', async ({ page }) => {
	await page.goto('/builder');
	await page.locator('#rules-version').selectOption('3');
	await page.getByLabel('Team Name').fill('Hold Me');
	await page.locator('#sponsor-select').selectOption('beverly');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByTestId('vehicle-summary')).toContainText('Buggy');

	await page.getByRole('button', { name: 'Players and Events', exact: true }).click();
	await page.getByRole('link', { name: 'Players Map' }).click();
	await expect(page).toHaveURL(/\/players/);

	await page.goto('/stats');
	await page.getByRole('link', { name: 'Gaslands Garage home' }).click();
	await expect(page).toHaveURL(/\/builder/);
	await expect(page.getByLabel('Team Name')).toHaveValue('Hold Me');
	await expect(page.locator('#sponsor-select')).toHaveValue('beverly');
	await expect(page.locator('#rules-version')).toHaveValue('3');
	await expect(page.getByTestId('vehicle-summary')).toContainText('Buggy');
	await expect(page.getByText('Your team has no vehicles yet')).toHaveCount(0);
});

test('reloading warns about unsaved changes and then restores the draft', async ({ page }) => {
	await page.goto('/builder');
	await page.getByLabel('Team Name').fill('Hold Me');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByTestId('vehicle-summary')).toHaveCount(1);

	const types: string[] = [];
	page.on('dialog', async (dialog) => {
		types.push(dialog.type());
		await dialog.accept();
	});
	await page.reload();
	expect(types).toContain('beforeunload');
	await expect(page.getByLabel('Team Name')).toHaveValue('Hold Me');
	await expect(page.getByTestId('vehicle-summary')).toHaveCount(1);
});

test('a fresh builder reloads without a leave warning', async ({ page }) => {
	await page.goto('/builder');
	await expect(page.getByText('Your team has no vehicles yet')).toBeVisible();
	const types: string[] = [];
	page.on('dialog', async (dialog) => {
		types.push(dialog.type());
		await acceptBeforeUnload(dialog);
	});
	await page.reload();
	expect(types).toEqual([]);
	await expect(page.getByLabel('Team Name')).toHaveValue('My Gaslands Team');
});

test('New is first in the Teams menu and is the way to discard a draft', async ({ page }) => {
	await page.goto('/builder');
	await page.getByLabel('Team Name').fill('Hold Me');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByTestId('vehicle-summary')).toHaveCount(1);

	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	const labels = await page
		.locator('.share-menu-dropdown')
		.getByRole('button')
		.evaluateAll((items) => items.map((item) => item.textContent?.replace(/\s+/g, ' ').trim()));
	expect(labels).toEqual(['New', 'Save/Load Team', 'Print Team', 'Share Team', 'Import Build']);

	page.once('dialog', (dialog) => dialog.dismiss());
	await page.getByRole('button', { name: 'New', exact: true }).click();
	await expect(page.getByLabel('Team Name')).toHaveValue('Hold Me');
	await expect(page.getByTestId('vehicle-summary')).toHaveCount(1);

	page.once('dialog', async (dialog) => {
		expect(dialog.message()).toBe('Discard unsaved changes and start a new team?');
		await dialog.accept();
	});
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'New', exact: true }).click();
	await expect(page.getByLabel('Team Name')).toHaveValue('My Gaslands Team');
	await expect(page.locator('#sponsor-select')).toHaveValue('no_sponsor');
	await expect(page.getByText('Your team has no vehicles yet')).toBeVisible();

	await page.getByRole('button', { name: 'Players and Events', exact: true }).click();
	await page.getByRole('link', { name: 'Players Map' }).click();
	await expect(page).toHaveURL(/\/players/);
	await page.getByRole('link', { name: 'Gaslands Garage home' }).click();
	await expect(page).toHaveURL(/\/builder/);
	await expect(page.getByLabel('Team Name')).toHaveValue('My Gaslands Team');
	await expect(page.getByText('Your team has no vehicles yet')).toBeVisible();
});

test('a clean team can start New without a confirm', async ({ page }) => {
	await page.goto('/builder');
	const types: string[] = [];
	page.on('dialog', async (dialog) => {
		types.push(dialog.type());
		await dialog.dismiss();
	});
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'New', exact: true }).click();
	expect(types).toEqual([]);
	await expect(page.getByLabel('Team Name')).toHaveValue('My Gaslands Team');
});

async function openShareOverDirtyTeam(page: Page, acceptLoad: boolean) {
	await page.goto('/builder');
	await page.getByLabel('Team Name').fill('Keep Me');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByTestId('vehicle-summary')).toHaveCount(1);
	const code = encodeDraft({
		sponsor: 'idris',
		teamName: 'Shared Crew',
		rulesVersion: 2,
		vehicles: [{ id: 's1', type: 'car', name: 'Guest', weapons: [], upgrades: [], perks: [] }]
	});
	page.on('dialog', async (dialog) => {
		if (dialog.type() === 'beforeunload') {
			await dialog.accept();
			return;
		}
		expect(dialog.message()).toBe('Discard unsaved changes and load this team?');
		if (acceptLoad) await dialog.accept();
		else await dialog.dismiss();
	});
	await page.goto(`/builder?draft=${encodeURIComponent(code)}`);
}

test('a share link does not replace an unsaved draft when the confirm is declined', async ({ page }) => {
	await openShareOverDirtyTeam(page, false);
	await expect(page.getByLabel('Team Name')).toHaveValue('Keep Me');
	await expect(page.getByTestId('vehicle-summary')).toHaveCount(1);
});

test('a share link replaces the draft after the confirm', async ({ page }) => {
	await openShareOverDirtyTeam(page, true);
	await expect(page.getByLabel('Team Name')).toHaveValue('Shared Crew');
	await expect(page.getByTestId('vehicle-summary')).toContainText('Guest');
	await expect(page.locator('#sponsor-select')).toHaveValue('idris');
});
