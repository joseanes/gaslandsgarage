import { expect, test, type Page } from '@playwright/test';

const vehicleAlert = /need to add at least one vehicle|add a vehicle to this team/i;

function watchDialogs(page: Page) {
	const messages: string[] = [];
	page.on('dialog', async (dialog) => {
		messages.push(dialog.message());
		await dialog.accept();
	});
	return messages;
}

async function leaveBuilderAndReturn(page: Page) {
	await page.getByRole('button', { name: 'Help' }).click();
	await page.getByRole('link', { name: 'Usage Stats' }).click();
	await page.waitForURL(/\/stats/);
	await page.goBack();
	await page.waitForURL(/\/builder/);
}

async function addUnnamedCarWithBazooka(page: Page) {
	await page.locator('#sponsor-select').selectOption('maxxine');
	await page.getByLabel('Team Name').fill('My Gaslands Tear');
	await page.locator('#rules-version').selectOption('2');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	await page.getByLabel('Vehicle Name').fill('');
	await page.locator('select[id^="add-weapon-"]').selectOption('bazooka');
	await expect(page.getByText('16/50 cans').first()).toBeVisible();
}

test('the wordmark links home without dropping the team on screen', async ({ page }) => {
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	const logo = page.getByRole('link', { name: 'Gaslands Garage home' });
	await expect(logo).toBeVisible();
	const before = await logo.boundingBox();
	await page.evaluate(() => {
		const active = document.activeElement;
		if (active instanceof HTMLElement) active.blur();
	});
	for (let i = 0; i < 6 && !(await logo.evaluate((el) => el === document.activeElement)); i++) {
		await page.keyboard.press('Tab');
	}
	await expect(logo).toBeFocused();
	const outline = await logo.evaluate((el) => getComputedStyle(el).outlineStyle);
	expect(outline).not.toBe('none');
	expect(await logo.boundingBox()).toEqual(before);

	await page.goto('/stats', { waitUntil: 'domcontentloaded' });
	await logo.click();
	await expect(page).toHaveURL(/\/builder\/?$/);

	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByTestId('vehicle-summary')).toContainText('Car');
	await logo.click();
	await expect(page.getByTestId('vehicle-summary')).toContainText('Car');
	await expect(page).toHaveURL(/\/builder/);
});

test('printing a car does not say a vehicle is missing', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const messages = watchDialogs(page);
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await leaveBuilderAndReturn(page);
	await addUnnamedCarWithBazooka(page);

	const popupPromise = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Print Team', exact: true }).click();
	const popup = await popupPromise;
	await popup.waitForLoadState('domcontentloaded');
	await expect(popup.locator('body')).toContainText('Bazooka');
	await expect(page.getByTestId('team-action-notice')).toHaveCount(0);
	expect(messages.filter((message) => vehicleAlert.test(message))).toEqual([]);
	await popup.close();

	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Copy to Clipboard', exact: true }).click();
	await expect.poll(() => messages.some((message) => message.includes('Draft copied'))).toBeTruthy();

	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Share Link', exact: true }).click();
	await expect.poll(() => messages.some((message) => message.includes('Link updated'))).toBeTruthy();

	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Generate QR Code', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'QR Code' })).toBeVisible();
	expect(messages.filter((message) => vehicleAlert.test(message))).toEqual([]);
	await expect(page.getByTestId('team-action-notice')).toHaveCount(0);
});

test('an empty team shows the notice and does not open a sheet', async ({ page }) => {
	const messages = watchDialogs(page);
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await leaveBuilderAndReturn(page);
	let popups = 0;
	page.on('popup', () => {
		popups += 1;
	});
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Print Team', exact: true }).click();
	await expect(page.getByTestId('team-action-notice')).toHaveText(
		'Add a vehicle to this team before printing.'
	);
	await expect(page.getByRole('dialog', { name: 'Rulebook' })).toHaveCount(0);
	expect(popups).toBe(0);
	expect(messages).toEqual([]);
});
