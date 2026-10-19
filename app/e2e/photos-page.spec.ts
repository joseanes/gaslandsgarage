import { expect, test } from '@playwright/test';

test('the gallery is the photos page and /photos opens My photos', async ({ page }) => {
	await page.goto('/gallery?fixture=1', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Photos' })).toBeVisible();
	await expect(page.getByTestId('photo-view')).toHaveValue('all');
	await expect(page.getByTestId('photo-usage')).toHaveCount(0);
	await expect(page.getByTestId('gallery-stats')).toContainText('Rust Rocket');
	await expect(page.getByTestId('share-car')).toBeVisible();
	await expect(page.getByTestId('share-copy')).toBeVisible();
	await expect(page.getByTestId('car-page-link')).toBeVisible();
	await expect(page.getByTestId('gallery-sort')).toContainText('Most used');

	await page.getByTestId('gallery-card').click();
	const lightbox = page.getByTestId('gallery-lightbox');
	await expect(lightbox).toBeVisible();
	await expect(lightbox.getByTestId('report-photo')).toBeVisible();
	await expect(lightbox.getByTestId('share-x')).toBeVisible();
	await expect(lightbox.getByTestId('share-link')).toBeVisible();
	await page.getByRole('button', { name: 'Close' }).click();

	await page.getByTestId('photo-view').selectOption('player');
	await expect(page.getByTestId('player-name')).toBeVisible();
	await page.getByTestId('player-name').fill('Casey');
	await page.getByTestId('player-name').press('Enter');
	await expect(page).toHaveURL(/view=player/);
	await expect(page).toHaveURL(/name=Casey/);
	await expect(page.getByTestId('gallery-card')).toContainText('Casey');

	await page.getByTestId('player-name').fill('Nobody');
	await page.getByTestId('player-name').press('Enter');
	await expect(page.getByText('No shared photos for that player.')).toBeVisible();
	await expect(page.getByTestId('gallery-card')).toHaveCount(0);

	await page.goto('/photos', { waitUntil: 'domcontentloaded' });
	await expect(page).toHaveURL(/\/gallery\?view=mine/);
	await expect(page.getByTestId('photo-view')).toHaveValue('mine');
	await expect(page.getByRole('button', { name: 'Sign in to see your photos' })).toBeVisible();
	await expect(page.getByTestId('photo-usage')).toHaveCount(0);

	await page.goto('/gallery?fixture=1', { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('photo-view')).toHaveValue('all');
	await expect(page.getByTestId('photo-usage')).toHaveCount(0);
	await expect(page.getByTestId('gallery-card')).toBeVisible();
});
