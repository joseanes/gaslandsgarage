import { expect, test, type Page } from '@playwright/test';

function watchMaps(page: Page) {
	const urls: string[] = [];
	page.on('request', (request) => {
		const url = request.url();
		if (url.includes('maps.googleapis.com') || url.includes('places.googleapis.com')) urls.push(url);
	});
	return urls;
}

test('the players map does not load Google Maps', async ({ page }) => {
	const urls = watchMaps(page);
	await page.goto('/players');
	await expect(page.getByTestId('players-map')).toBeVisible({ timeout: 15_000 });
	expect(urls).toEqual([]);
});

test('a signed-out profile does not load Google Maps', async ({ page }) => {
	const urls = watchMaps(page);
	await page.goto('/profile');
	await expect(page.getByTestId('profile-signed-out')).toBeVisible();
	expect(urls).toEqual([]);
});
