import { expect, test } from '@playwright/test';

test('the gallery is the photos page and /photos opens My photos', async ({ page }) => {
	await page.goto('/gallery?fixture=1', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Photos' })).toBeVisible();
	await expect(page.getByTestId('photo-view')).toHaveValue('all');
	await expect(page.getByTestId('photo-usage')).toHaveCount(0);
	await expect(page.getByTestId('gallery-sort')).toContainText('Cans, high');
	await expect(page.getByTestId('gallery-card')).toHaveCount(24);
	const first = page.getByTestId('gallery-card').first();
	await expect(first).toContainText('Rust Rocket');
	await expect(first.getByTestId('gallery-type-badge')).toHaveText('Performance Car');
	await expect(first.getByTestId('gallery-cans')).toContainText('50');
	await expect(first.getByTestId('gallery-stats')).toContainText('Hull');
	await expect(page.getByTestId('gallery-photo-only').first()).toBeVisible();
	await expect(page.getByTestId('gallery-load-more')).toBeVisible();

	await first.click();
	const lightbox = page.getByTestId('gallery-lightbox');
	await expect(lightbox).toBeVisible();
	await expect(lightbox.getByTestId('report-photo')).toBeVisible();
	await expect(lightbox.getByTestId('share-car')).toBeVisible();
	await expect(lightbox.getByTestId('share-copy')).toBeVisible();
	await expect(lightbox.getByTestId('share-x')).toBeVisible();
	await expect(lightbox.getByTestId('share-link')).toBeVisible();
	await expect(lightbox.getByTestId('car-page-link')).toBeVisible();
	await page.getByRole('button', { name: 'Close' }).click();
	await expect(lightbox).toHaveCount(0);

	await page.getByTestId('gallery-load-more').click();
	await expect(page.getByTestId('gallery-card')).toHaveCount(30);

	await page.getByTestId('gallery-search').fill('rocket');
	await page.getByTestId('gallery-search').press('Enter');
	await expect(page).toHaveURL(/q=rocket/);
	await expect(page.getByTestId('gallery-card')).toHaveCount(1);
	await expect(page.getByTestId('gallery-card')).toContainText('Rust Rocket');
	await page.getByTestId('gallery-search').fill('');
	await page.getByTestId('gallery-search').press('Enter');
	await expect(page.getByTestId('gallery-card')).toHaveCount(24);

	await page.getByTestId('photo-view').selectOption('player');
	await expect(page.getByTestId('player-name')).toBeVisible();
	await page.getByTestId('player-name').fill('Casey');
	await page.getByTestId('player-name').press('Enter');
	await expect(page).toHaveURL(/view=player/);
	await expect(page).toHaveURL(/name=Casey/);
	await expect(page.getByTestId('gallery-card')).toHaveCount(7);
	await expect(page.getByTestId('gallery-card').first()).toContainText('Casey');

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
	await expect(page.getByTestId('gallery-card').first()).toBeVisible();
});
