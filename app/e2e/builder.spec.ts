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
	await page.getByRole('button', { name: 'Teams' }).click();
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
	await page.getByRole('button', { name: 'Teams' }).click();
	await page.getByRole('button', { name: 'Import Build' }).click();
	await page.getByPlaceholder('Paste encoded draft here').fill(code);
	await page.getByRole('button', { name: 'Import', exact: true }).click();

	await expect(page.locator('#sponsor-select')).toHaveValue('rustys');
	await expectImportedTrailer(page);

	await page.goto(`/builder?draft=${encodeURIComponent(code)}`);
	await expectImportedTrailer(page);
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
