import { expect, test, type Page } from '@playwright/test';

async function openBuilder(page: Page, width: number, height: number) {
	await page.addInitScript(() => {
		localStorage.setItem('gaslands-firebase-emulators', '1');
		localStorage.setItem(
			'gaslands.analyticsConsent.v1',
			JSON.stringify({ choice: 'rejected', at: '2026-01-01T00:00:00.000Z', gpc: false })
		);
	});
	await page.setViewportSize({ width, height });
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('button', { name: 'Teams', exact: true })).toBeVisible();
}

async function onScreen(page: Page, selector: string, width: number) {
	await expect
		.poll(async () => {
			const box = await page.locator(selector).boundingBox();
			return !!box && box.x >= -0.5 && box.x + box.width <= width + 0.5;
		})
		.toBe(true);
}

for (const viewport of [
	{ width: 1280, height: 800 },
	{ width: 375, height: 812 }
]) {
	test(`top nav order and Players and Events at ${viewport.width}px`, async ({ page }) => {
		await openBuilder(page, viewport.width, viewport.height);
		const labels = await page
			.locator('header nav button[aria-haspopup="true"]')
			.evaluateAll((items) => items.map((item) => item.textContent?.replace(/\s+/g, ' ').trim()));
		expect(labels.slice(0, 4)).toEqual(['Teams', 'Players and Events', 'Settings', 'Help']);

		await page.getByRole('button', { name: 'Players and Events', exact: true }).click();
		const menu = page.locator('.players-menu-dropdown');
		await expect(menu.getByRole('link', { name: 'Players Map' })).toHaveAttribute('href', '/players');
		await expect(menu.getByRole('link', { name: 'Gaming Buddies' })).toHaveCount(1);
		const events = menu.getByTestId('wargaming-events-link');
		await expect(events).toHaveAttribute('target', '_blank');
		await expect(events).toHaveAttribute('rel', 'noopener noreferrer');
		const href = new URL((await events.getAttribute('href')) ?? '');
		expect(href.origin).toBe('https://wargamingevents.com');
		expect(href.searchParams.get('system')).toBe('gaslands');
		expect(href.searchParams.get('utm_source')).toBe('gaslandsgarage');
		await onScreen(page, '.players-menu-dropdown', viewport.width);
	});

	test(`Share Team holds the share actions at ${viewport.width}px`, async ({ page }) => {
		await openBuilder(page, viewport.width, viewport.height);
		await page.getByRole('button', { name: 'Teams', exact: true }).click();
		const teams = page.locator('.share-menu-dropdown');
		await expect(teams.getByRole('button', { name: 'Save/Load Team' })).toBeVisible();
		await expect(teams.getByRole('button', { name: 'Import Build' })).toBeVisible();
		await expect(teams.getByRole('button', { name: 'Share Link', exact: true })).toHaveCount(0);

		const trigger = teams.getByRole('button', { name: 'Share Team', exact: true });
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
		await trigger.click();
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');
		const submenu = page.locator('#share-team-submenu');
		for (const name of ['Copy to Clipboard', 'Share Link', 'Generate QR Code']) {
			await expect(submenu.getByRole('button', { name, exact: true })).toBeVisible();
		}
		await onScreen(page, '#share-team-submenu', viewport.width);
		await onScreen(page, '.share-menu-dropdown', viewport.width);

		const sub = await submenu.boundingBox();
		const parent = await teams.boundingBox();
		if (viewport.width > 640) {
			// Flyout beside the menu.
			expect(sub!.x).toBeGreaterThanOrEqual(parent!.x + parent!.width - 4);
		} else {
			// Expandable group inside the menu.
			expect(sub!.x).toBeGreaterThanOrEqual(parent!.x);
			expect(sub!.x + sub!.width).toBeLessThanOrEqual(parent!.x + parent!.width + 1);
		}

		await trigger.click();
		await expect(submenu).toHaveCount(0);
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	});
}

test('Share Team works from the keyboard', async ({ page }) => {
	await openBuilder(page, 1280, 800);
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	const trigger = page.getByRole('button', { name: 'Share Team', exact: true });
	await trigger.focus();
	await page.keyboard.press('ArrowRight');
	const submenu = page.locator('#share-team-submenu');
	await expect(submenu.getByRole('button', { name: 'Copy to Clipboard' })).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(submenu.getByRole('button', { name: 'Share Link' })).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await expect(submenu.getByRole('button', { name: 'Copy to Clipboard' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(submenu).toHaveCount(0);
	await expect(trigger).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(submenu).toBeVisible();
	await page.keyboard.press('ArrowDown');
	await expect(submenu.getByRole('button', { name: 'Copy to Clipboard' })).toBeFocused();
});

test('Share Team opens on hover on desktop', async ({ page }) => {
	await openBuilder(page, 1280, 800);
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Share Team', exact: true }).hover();
	const submenu = page.locator('#share-team-submenu');
	await expect(submenu).toBeVisible();
	await submenu.getByRole('button', { name: 'Generate QR Code' }).hover();
	await expect(submenu).toBeVisible();
	await page.getByRole('button', { name: 'Import Build' }).hover();
	await expect(submenu).toHaveCount(0);
});
