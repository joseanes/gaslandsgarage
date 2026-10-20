import { expect, test, type Page } from '@playwright/test';

test('the gallery is the photos page and /photos opens My photos', async ({ page }) => {
	await page.goto('/gallery?fixture=1', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Photos' })).toBeVisible();
	await expect(page.getByTestId('add-photo-sign-in')).toBeVisible();
	await expect(page.getByTestId('add-photo')).toHaveCount(0);
	await page.getByTestId('add-photo-sign-in').click();
	await expect(page.getByRole('dialog', { name: 'Sign in to save' })).toBeVisible();
	await page.getByRole('button', { name: 'Not now' }).click();
	await expect(page.getByTestId('add-photo-dialog')).toHaveCount(0);
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

/** Gallery cards must not collapse: the card has real height and the photo fills its image area. */
async function expectCardImageFills(page: Page, density: 'photos' | 'details') {
	const card = page.getByTestId('gallery-card').first();
	await expect(card).toBeVisible();
	const img = card.locator('img').first();
	const cardBox = await card.boundingBox();
	const imgBox = await img.boundingBox();
	const areaBox = await img.evaluate((el) => {
		const r = el.parentElement!.getBoundingClientRect();
		return { width: r.width, height: r.height };
	});
	expect(cardBox && imgBox).toBeTruthy();
	expect(cardBox!.height).toBeGreaterThan(100);
	expect(imgBox!.height).toBeGreaterThan(100);
	// The image fills its frame (object-fit: cover at full frame size).
	expect(Math.abs(imgBox!.height - areaBox.height)).toBeLessThanOrEqual(2);
	expect(Math.abs(imgBox!.width - areaBox.width)).toBeLessThanOrEqual(2);
	if (density === 'photos') {
		// Square tile: the photo covers the whole card.
		expect(Math.abs(imgBox!.height - cardBox!.height)).toBeLessThanOrEqual(2);
		expect(Math.abs(cardBox!.height - cardBox!.width)).toBeLessThanOrEqual(2);
	} else {
		// 4:3 image area at the top of a taller card.
		expect(Math.abs(imgBox!.height - (imgBox!.width * 3) / 4)).toBeLessThanOrEqual(3);
		expect(cardBox!.height).toBeGreaterThan(imgBox!.height);
	}
}

/** With details: every card in the grid is the same height, whatever its chip count. */
async function expectUniformCardHeights(page: Page) {
	const heights = await page.getByTestId('gallery-card').evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().height));
	expect(heights.length).toBeGreaterThan(1);
	const min = Math.min(...heights);
	const max = Math.max(...heights);
	expect(max - min, `card heights ${heights.map((h) => Math.round(h)).join(', ')}`).toBeLessThanOrEqual(1);
	const pills = await page.getByTestId('gallery-pills').evaluateAll((lists) => lists.map((list) => list.scrollHeight > list.clientHeight + 1 ? 'overflow' : 'ok'));
	expect(pills).not.toContain('overflow');
}

test('photos only hides the stat card and remembers the choice', async ({ page }) => {
	await page.goto('/gallery?fixture=1', { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('gallery-with-details')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('gallery-stats').first()).toBeVisible();

	await page.getByTestId('gallery-photos-only').click();
	await expect(page.getByTestId('gallery-photos-only')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('gallery-grid')).toHaveAttribute('data-density', 'photos');
	await expect(page.getByTestId('gallery-stats')).toHaveCount(0);
	await expect(page.getByTestId('gallery-cans')).toHaveCount(0);
	await expect(page.getByTestId('gallery-type-badge')).toHaveCount(0);
	const meta = page.getByTestId('gallery-hover-meta').first();
	await expect(meta).toHaveCSS('opacity', '0');
	await page.getByTestId('gallery-card').first().hover();
	await expect(meta).toHaveCSS('opacity', '1');
	await expect(meta).toContainText('Rust Rocket');
	await expect(meta).toContainText('Casey');
	await expect(page.getByTestId('gallery-grid').getByTestId('share-facebook')).toHaveCount(0);
	await expectCardImageFills(page, 'photos');

	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('gallery-photos-only')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('gallery-stats')).toHaveCount(0);

	await page.getByTestId('gallery-with-details').click();
	await expect(page.getByTestId('gallery-stats').first()).toBeVisible();
	await expect(page.getByTestId('gallery-grid').getByTestId('share-facebook')).toHaveCount(0);
	await expectCardImageFills(page, 'details');
	await expectUniformCardHeights(page);
	const lightboxShare = page.getByTestId('gallery-card').first();
	await lightboxShare.click();
	const lightbox = page.getByTestId('gallery-lightbox');
	await expect(lightbox.getByRole('link', { name: 'Share on Bluesky' })).toBeVisible();
	await expect(lightbox.getByRole('button', { name: 'Copy link' })).toBeVisible();
});
