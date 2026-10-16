import { expect, test } from '@playwright/test';

test('Save/Load Team opens the teams dialog while signed out', async ({ page }) => {
	await page.goto('/builder');
	await page.getByRole('button', { name: 'Team', exact: true }).click();
	await page.getByRole('button', { name: 'Save and Load' }).click();

	const dialog = page.getByRole('dialog', { name: 'My Teams' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('heading', { name: 'My Teams' })).toBeVisible();
	await expect(dialog.getByText('Please sign in to save and load teams.')).toBeVisible();
});
