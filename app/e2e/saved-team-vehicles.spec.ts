import { expect, test, type Page } from '@playwright/test';

function encodeDraft(draft: unknown) {
	return Buffer.from(encodeURIComponent(JSON.stringify(draft)), 'utf8').toString('base64');
}

async function importBuild(page: Page, draft: unknown) {
	await page.goto('/builder');
	await page.getByRole('button', { name: 'Teams' }).click();
	await page.getByRole('button', { name: 'Import Build' }).click();
	await page.getByPlaceholder('Paste encoded draft here').fill(encodeDraft(draft));
	await page.getByRole('button', { name: 'Import', exact: true }).click();
}

const beverlyAnchor = {
	sponsor: 'beverly',
	teamName: 'My Gaslands Team 2',
	maxCans: 50,
	rulesVersion: 3,
	vehicles: [
		{
			id: 'anchor',
			type: 'war_rig',
			name: 'Anchor',
			weapons: ['bfg_abc', 'machine_gun_def'],
			upgrades: ['extra_armour', 'ram'],
			perks: [] as string[],
			weaponFacings: { bfg_abc: 'front', machine_gun_def: 'side' }
		}
	]
};

test('a saved version 3 Beverly team shows its vehicle', async ({ page }) => {
	await importBuild(page, beverlyAnchor);

	await expect(page.locator('#rules-version')).toHaveValue('3');
	await expect(page.locator('#sponsor-select')).toHaveValue('beverly');
	await expect(page.getByTestId('vehicle-limit')).toContainText('1/2 toward the limit');
	await expect(page.getByText('Your team has no vehicles yet')).toHaveCount(0);
	await expect(page.getByTestId('vehicle-summary')).toContainText('War Rig');
	await expect(page.getByTestId('vehicle-summary')).toContainText('Anchor');
	await expect(page.getByTestId('legal-banner')).toBeVisible();
});

test('a vehicle the rules list does not know stays on the team with a warning', async ({ page }) => {
	await importBuild(page, {
		...beverlyAnchor,
		vehicles: [
			{
				...beverlyAnchor.vehicles[0],
				id: 'spirit',
				type: 'ghost_rider',
				name: 'Spirit',
				weapons: [] as string[],
				upgrades: [] as string[]
			}
		]
	});

	await expect(page.getByText('Your team has no vehicles yet')).toHaveCount(0);
	await expect(page.getByTestId('vehicle-summary')).toContainText('ghost_rider');
	await expect(page.getByTestId('vehicle-summary')).toContainText('Spirit');
	await expect(page.getByTestId('vehicle-warning')).toContainText("isn't in the current rules list");
	await expect(page.getByTestId('vehicle-limit')).toContainText('1/2 toward the limit');
});

test('two saved vehicles that share an id both render', async ({ page }) => {
	const shared = beverlyAnchor.vehicles[0];
	await importBuild(page, {
		...beverlyAnchor,
		vehicles: [shared, { ...shared, name: 'Outrider', type: 'buggy', weapons: [], upgrades: [] }]
	});

	await expect(page.getByTestId('vehicle-summary')).toHaveCount(2);
	await expect(page.getByTestId('vehicle-summary').nth(0)).toContainText('Anchor');
	await expect(page.getByTestId('vehicle-summary').nth(1)).toContainText('Outrider');
	await expect(page.getByTestId('vehicle-limit')).toContainText('2/2 toward the limit');
});
