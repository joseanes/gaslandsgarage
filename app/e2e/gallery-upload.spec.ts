import { expect, test, type Page } from '@playwright/test';

/** 1×1 PNGs. Different pixels so the library keeps two photos. */
const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);
const OTHER_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64'
);

function watchDialogs(page: Page) {
	const messages: string[] = [];
	page.on('dialog', async (dialog) => {
		messages.push(dialog.message());
		await dialog.accept();
	});
	return messages;
}

test('a signed-in player can add a gallery photo, with or without a car', async ({ page }) => {
	test.setTimeout(180_000);
	const messages = watchDialogs(page);
	const stamp = Date.now().toString(36);
	const loose = `zloose${stamp}`;
	const linkedWord = `zlink${stamp}`;
	const email = `gallery-add-${stamp}@example.com`;
	await page.addInitScript(() => {
		localStorage.setItem('gaslands-firebase-emulators', '1');
		localStorage.setItem('hasRules', 'true');
		localStorage.setItem('printRulesPromptSeen', 'true');
	});
	await page.goto('/gallery', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByTestId('add-photo')).toBeVisible();
	await expect(page.getByTestId('add-photo-sign-in')).toHaveCount(0);

	await page.getByTestId('add-photo').click();
	const dialog = page.getByTestId('add-photo-dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId('add-photo-usage')).toContainText('0 of 100 used');
	await expect(dialog.getByTestId('add-photo-drop')).toBeVisible();
	await expect(dialog.getByTestId('add-photo-camera')).toHaveAttribute('capture', 'environment');
	await expect(dialog.getByTestId('add-photo-no-cars')).toBeVisible();
	await dialog.getByTestId('add-customize-sharing').click();
	await expect(dialog.getByTestId('add-share-gallery')).toBeChecked();
	await expect(dialog.getByTestId('add-share-stats')).toBeDisabled();
	await expect(dialog.getByTestId('add-share-buddies')).toBeDisabled();
	await expect(dialog.getByTestId('add-share-link')).toBeDisabled();
	await expect(dialog.getByTestId('add-share-everywhere')).toBeChecked();

	await dialog.getByTestId('add-photo-file').setInputFiles({
		name: 'loose-car.png',
		mimeType: 'image/png',
		buffer: TINY_PNG
	});
	await expect(dialog.getByTestId('add-photo-preview')).toBeVisible();
	await dialog.getByTestId('add-photo-caption').fill(loose);
	await dialog.getByTestId('add-photo-type').selectOption('Performance Car');
	await dialog.getByTestId('add-photo-submit').click();
	await expect(page.getByText('Your photo is in the Gallery.')).toBeVisible({ timeout: 30_000 });
	await expect(dialog).toHaveCount(0);

	await page.getByTestId('gallery-search').fill(loose);
	await page.getByTestId('gallery-search').press('Enter');
	await expect(page.getByTestId('gallery-card')).toHaveCount(1);
	const looseCard = page.getByTestId('gallery-card');
	await expect(looseCard).toContainText(loose);
	await expect(looseCard.getByTestId('gallery-photo-only')).toBeVisible();
	await expect(looseCard.getByTestId('gallery-type-badge')).toHaveText('Performance Car');
	await expect(looseCard.getByTestId('gallery-stats')).toHaveCount(0);
	await expect(looseCard.getByTestId('gallery-cans')).toHaveCount(0);

	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.getByLabel('Team Name').fill('Add Photo Team');
	await page.locator('#sponsor-select').selectOption('rutherford');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	const vehicle = page.locator('.vehicle-card').nth(0);
	await vehicle.getByRole('button', { name: 'Expand vehicle' }).click();
	await vehicle.getByLabel('Vehicle Name').fill('Linked Car');
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Save/Load Team', exact: true }).click();
	const saving = page.getByRole('dialog', { name: 'My Teams' });
	await saving.getByRole('button', { name: 'Save', exact: true }).click();
	await expect.poll(() => messages.some((message) => message.includes('Team saved successfully'))).toBeTruthy();
	await saving.getByRole('button', { name: 'Close teams modal' }).click();

	await page.goto('/gallery', { waitUntil: 'domcontentloaded' });
	await page.getByTestId('add-photo').click();
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId('add-photo-usage')).toContainText('1 of 100 used');
	await dialog.getByTestId('add-photo-team').selectOption({ label: 'Add Photo Team' });
	await dialog.getByTestId('add-photo-car').selectOption({ label: 'Linked Car' });
	await expect(dialog.getByTestId('add-photo-type')).toBeDisabled();
	await expect(dialog.getByTestId('add-photo-type')).toHaveValue('Car');
	await dialog.getByTestId('add-customize-sharing').click();
	await expect(dialog.getByTestId('add-share-stats')).toBeEnabled();
	await expect(dialog.getByTestId('add-share-stats')).not.toBeChecked();
	await dialog.getByTestId('add-share-everywhere').click();
	await expect(dialog.getByTestId('add-share-stats')).toBeChecked();
	await expect(dialog.getByTestId('add-share-gallery')).toBeChecked();
	await expect(dialog.getByTestId('add-share-buddies')).toBeChecked();
	await expect(dialog.getByTestId('add-share-link')).toBeChecked();
	await dialog.getByTestId('add-photo-file').setInputFiles({
		name: 'linked-car.png',
		mimeType: 'image/png',
		buffer: OTHER_PNG
	});
	await dialog.getByTestId('add-photo-caption').fill(linkedWord);
	await dialog.getByTestId('add-photo-submit').click();
	await expect(page.getByText('Your photo is in the Gallery.')).toBeVisible({ timeout: 30_000 });

	await page.getByTestId('gallery-search').fill(linkedWord);
	await page.getByTestId('gallery-search').press('Enter');
	await expect(page.getByTestId('gallery-card')).toHaveCount(1);
	const linkedCard = page.getByTestId('gallery-card');
	await expect(linkedCard.getByTestId('gallery-type-badge')).toHaveText('Car');
	await expect(linkedCard.getByTestId('gallery-stats')).toBeVisible();
	await expect(linkedCard.getByTestId('gallery-photo-only')).toHaveCount(0);

	await page.goto('/gallery?view=mine', { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('photo-usage')).toContainText('2 of 100 used');
	await expect(page.getByTestId('photo-used-by').filter({ hasText: 'no cars' })).toHaveCount(1);
	await expect(page.getByTestId('photo-used-by').filter({ hasText: 'Add Photo Team: Linked Car' })).toHaveCount(1);
});
