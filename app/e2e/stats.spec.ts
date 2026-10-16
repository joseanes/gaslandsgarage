import { expect, test } from '@playwright/test';

test('Help menu opens the public usage stats page', async ({ page }) => {
	await page.goto('/builder');
	await page.getByRole('button', { name: 'Help' }).click();
	await page.getByRole('link', { name: 'Usage Stats' }).click();

	await expect(page).toHaveURL(/\/stats$/);
	await expect(page.getByRole('heading', { name: 'Usage Stats' })).toBeVisible();
	await expect(page.getByTestId('stats-loading')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.getByTestId('stats-empty').or(page.getByTestId('stats-totals'))).toBeVisible();
});
