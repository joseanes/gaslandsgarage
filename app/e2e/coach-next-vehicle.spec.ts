import { expect, test, type Page } from '@playwright/test';

async function addSuggestedVehicle(page: Page) {
	const next = page.getByTestId('coach-next-vehicle');
	await expect(next).toBeVisible();
	const add = next.locator('[data-testid^="coach-add-"]').first();
	await expect(add).toBeVisible();
	const testId = await add.getAttribute('data-testid');
	const typeId = testId?.replace('coach-add-', '') ?? '';
	expect(typeId.length).toBeGreaterThan(0);
	await add.click();
	await expect(page.locator('select[id^="vehicle-type-"]')).toHaveCount(2);
	const values = await page.locator('select[id^="vehicle-type-"]').evaluateAll((elements) =>
		elements.map((element) => (element as HTMLSelectElement).value)
	);
	expect(values).toContain(typeId);
}

test('coach Add puts the suggested vehicle on the team in both editions', async ({ page }) => {
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByTestId('coach-rules')).toHaveText('Version 2');
	await addSuggestedVehicle(page);

	page.once('dialog', (dialog) => dialog.accept());
	await page.locator('#rules-version').selectOption('3');
	await expect(page.locator('#rules-version')).toHaveValue('3');
	await expect(page.getByText('Your team has no vehicles yet')).toBeVisible();

	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByTestId('coach-rules')).toHaveText('Version 3');
	await addSuggestedVehicle(page);
});
