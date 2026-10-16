import { expect, test, type Page } from '@playwright/test';

async function addSuggestedVehicle(page: Page) {
	const next = page.getByTestId('coach-next-vehicle');
	await expect(next).toBeVisible();
	const add = next.locator('[data-testid^="coach-add-"]').first();
	await expect(add).toBeVisible();
	const suggestedName = await add.locator('xpath=ancestor::li[1]').locator('span').first().innerText();
	expect(suggestedName.length).toBeGreaterThan(0);
	await add.click();
	await expect(page.getByTestId('vehicle-summary')).toHaveCount(2);
	await expect(page.getByTestId('vehicle-summary').filter({ hasText: suggestedName })).toHaveCount(1);
}

test('coach Add puts the suggested vehicle on the team in both editions', async ({ page }) => {
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByTestId('coach-rules')).toHaveText('Version 2');
	await addSuggestedVehicle(page);

	await page.locator('#rules-version').selectOption('3');
	await page.getByRole('dialog', { name: 'Switch rules version' }).getByRole('button', { name: 'Switch', exact: true }).click();
	await expect(page.locator('#rules-version')).toHaveValue('3');
	await expect(page.getByText('Your team has no vehicles yet')).toBeVisible();

	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByTestId('coach-rules')).toHaveText('Version 3');
	await addSuggestedVehicle(page);
});
