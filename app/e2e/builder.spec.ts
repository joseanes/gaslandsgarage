import { expect, test, type Page } from '@playwright/test';

function encodeDraft(draft: unknown) {
	return Buffer.from(encodeURIComponent(JSON.stringify(draft)), 'utf8').toString('base64');
}

const trailerDraft = {
	sponsor: 'rustys',
	teamName: 'Hauler Crew',
	maxCans: 50,
	vehicles: [
		{
			id: 'v1',
			type: 'car',
			name: 'Hauler',
			weapons: [] as string[],
			upgrades: ['trailerlw'],
			perks: [] as string[]
		}
	]
};

function cansValue(page: Page) {
	return page.locator('b', { hasText: 'Cans:' }).locator('xpath=following-sibling::span[1]');
}

test('builds a car, adds Powder Keg, and shares the link', async ({ page }) => {
	await page.goto('/builder');
	await page.locator('#sponsor-select').selectOption('rutherford');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();

	await expect(cansValue(page)).toHaveText('12');
	await page.getByLabel('Add a perk').selectOption({ label: 'Powder Keg (1 cans)' });
	await expect(page.getByRole('listitem').filter({ hasText: 'Powder Keg' })).toBeVisible();
	await expect(cansValue(page)).toHaveText('13');
	await expect(page.getByText('Your team is legal and ready to race!')).toBeVisible();

	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Share', exact: true }).click();
	await page.getByRole('button', { name: 'Share Link' }).click();
	await expect(page).toHaveURL(/draft=/);

	await page.reload();
	await expect(page.locator('#sponsor-select')).toHaveValue('rutherford');
	await expect(page.getByRole('listitem').filter({ hasText: 'Powder Keg' })).toBeVisible();
	await expect(cansValue(page)).toHaveText('13');
});

test('pasted build codes and ?draft= links both merge upgrade perks', async ({ page }) => {
	const code = encodeDraft(trailerDraft);

	await page.goto('/builder');
	await page.getByRole('button', { name: 'Share', exact: true }).click();
	await page.getByRole('button', { name: 'Import Build' }).click();
	await page.getByPlaceholder('Paste encoded draft here').fill(code);
	await page.getByRole('button', { name: 'Import', exact: true }).click();

	await expect(page.locator('#sponsor-select')).toHaveValue('rustys');
	await expectImportedTrailer(page);

	await page.goto(`/builder?draft=${encodeURIComponent(code)}`);
	await expectImportedTrailer(page);
});

test('switching rules versions clears the team, and cancelling keeps it', async ({ page }) => {
	await page.goto('/builder');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByLabel('Vehicle Name')).toBeVisible();

	await page.locator('#rules-version').selectOption('3');
	const switchDialog = page.getByRole('dialog', { name: 'Switch rules version' });
	await expect(switchDialog).toBeVisible();
	await switchDialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.locator('#rules-version')).toHaveValue('2');
	await expect(page.getByLabel('Vehicle Name')).toBeVisible();
	await expect(page.getByTestId('vehicle-limit')).toHaveCount(0);

	await page.locator('#rules-version').selectOption('3');
	await switchDialog.getByRole('button', { name: 'Switch', exact: true }).click();
	await expect(page.locator('#rules-version')).toHaveValue('3');
	await expect(page.getByText('Your team has no vehicles yet')).toBeVisible();
	await expect(page.getByTestId('vehicle-limit')).toHaveText('Up to 2 vehicles at 50 cans. The first bike is free.');
	await expect(page.locator('#sponsor-select')).toHaveValue('no_sponsor');

	await page.reload();
	await expect(page.locator('#rules-version')).toHaveValue('2');
	await expect(page.getByText('Your team has no vehicles yet')).toBeVisible();
});

test('a shared draft does not come back after the rules version changes', async ({ page }) => {
	await page.goto('/builder');
	await page.locator('#sponsor-select').selectOption('rutherford');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Share', exact: true }).click();
	await page.getByRole('button', { name: 'Share Link' }).click();
	await expect(page).toHaveURL(/draft=/);

	await page.locator('#rules-version').selectOption('3');
	await page.getByRole('dialog', { name: 'Switch rules version' }).getByRole('button', { name: 'Switch', exact: true }).click();
	await expect(page).not.toHaveURL(/draft=/);
	await expect(page.getByText('Your team has no vehicles yet')).toBeVisible();
	await expect(page.locator('#sponsor-select')).toHaveValue('rutherford');

	await page.reload();
	await expect(page.locator('#rules-version')).toHaveValue('2');
	await expect(page.getByText('Your team has no vehicles yet')).toBeVisible();
});

test('an empty team can switch versions without a confirm', async ({ page }) => {
	await page.goto('/builder');
	let dialogs = 0;
	page.on('dialog', () => {
		dialogs += 1;
	});
	await page.locator('#rules-version').selectOption('3');
	await expect(page.getByRole('dialog', { name: 'Switch rules version' })).toHaveCount(0);
	await expect(page.locator('#rules-version')).toHaveValue('3');
	await expect(page.getByTestId('vehicle-limit')).toHaveText('Up to 2 vehicles at 50 cans. The first bike is free.');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByTestId('coach-rules')).toHaveText('Version 3');
	await expect(page.getByTestId('coach-lead')).toContainText(/driver/i);
	await expect(page.getByText(/counted vehicles/)).toHaveCount(0);
	await expect(page.getByText('Your team has low attack power')).toHaveCount(0);
	await page.getByRole('button', { name: 'Show details' }).click();
	await expect(page.getByText(/counted vehicles/)).toBeVisible();
	await expect(page.getByText('Attack dice per can.')).toBeVisible();
	expect(dialogs).toBe(0);
});

test('lowering the can limit updates the banner next to the cans field', async ({ page }) => {
	await page.goto('/builder');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByText('Your team is legal and ready to race!')).toBeVisible();
	await page.getByLabel('Maximum Cans').fill('10');
	await expect(page.getByTestId('legal-banner').getByText('Team exceeds 10 cans limit')).toBeVisible();
	await expect(page.getByText('Your team is legal and ready to race!')).toHaveCount(0);
	const cans = await page.getByLabel('Maximum Cans').boundingBox();
	const banner = await page.getByTestId('legal-banner').boundingBox();
	expect(cans).toBeTruthy();
	expect(banner).toBeTruthy();
	expect(banner!.y).toBeGreaterThan(cans!.y);
});

test('quick save while signed out opens sign-in next to save and load', async ({ page }) => {
	await page.goto('/builder');
	await page.getByRole('button', { name: 'Team', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Save and Load' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Lock list for the table' })).toBeVisible();
	await page.getByRole('button', { name: 'Quick Save' }).click();
	const dialog = page.getByRole('dialog', { name: 'Sign in to save' });
	await expect(dialog.getByText('Teams are stored on your Google account.')).toBeVisible();
	await dialog.getByRole('button', { name: 'Not now' }).click();
	await expect(dialog).toHaveCount(0);
});

test('save a copy keeps the list, and a sponsor that exists in both editions stays', async ({ page }) => {
	await page.goto('/builder');
	await page.locator('#sponsor-select').selectOption('rutherford');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await page.locator('#rules-version').selectOption('3');
	const dialog = page.getByRole('dialog', { name: 'Switch rules version' });
	await dialog.getByRole('button', { name: 'Save a copy' }).click();
	await expect(page.getByRole('dialog', { name: 'Sign in to save' })).toBeVisible();
	await expect(page.locator('#rules-version')).toHaveValue('2');
	await expect(page.getByLabel('Vehicle Name')).toBeVisible();

	await page.getByRole('dialog', { name: 'Sign in to save' }).getByRole('button', { name: 'Not now' }).click();
	await dialog.getByRole('button', { name: 'Switch', exact: true }).click();
	await expect(page.locator('#rules-version')).toHaveValue('3');
	await expect(page.locator('#sponsor-select')).toHaveValue('rutherford');
	await expect(page.getByText('Your team has no vehicles yet')).toBeVisible();
});

test('a sponsor missing from the other edition is cleared on switch', async ({ page }) => {
	await page.goto('/builder');
	await page.locator('#sponsor-select').selectOption('rustys');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await page.locator('#rules-version').selectOption('3');
	await page.getByRole('dialog', { name: 'Switch rules version' }).getByRole('button', { name: 'Switch', exact: true }).click();
	await expect(page.locator('#sponsor-select')).toHaveValue('no_sponsor');
	await expect(page.getByText('Your team has no vehicles yet')).toBeVisible();
});

test('the team menu on a phone stays above the rules and name fields', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/builder');
	const name = await page.getByLabel('Team Name').boundingBox();
	const builder = await page.locator('#builder-ui').boundingBox();
	expect(name && builder && name.width > builder.width * 0.6).toBeTruthy();

	await page.getByRole('button', { name: 'Team', exact: true }).click();
	const sheet = await page.getByTestId('menu-sheet').boundingBox();
	const rules = await page.getByText('Rules:', { exact: true }).boundingBox();
	expect(sheet && rules && rules.y >= sheet.y + sheet.height - 2).toBeTruthy();
	await expect(page.getByRole('button', { name: 'Quick Save' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Play Mode' })).toHaveCount(0);
});

async function expectImportedTrailer(page: Page) {
	const perk = page.getByRole('listitem').filter({
		has: page.getByRole('button', { name: 'Remove perk' })
	});
	await expect(page.locator('#sponsor-select')).toHaveValue('rustys');
	await expect(page.getByLabel('Vehicle Name')).toHaveValue('Hauler');
	await expect(perk.filter({ hasText: 'Stowage' })).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: 'Trailer (Lightweight)' })).toBeVisible();
}
