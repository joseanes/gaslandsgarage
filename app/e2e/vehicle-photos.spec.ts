import { expect, test, type Page } from '@playwright/test';

/** 1×1 PNG. The builder re-encodes it before the reserved upload. */
const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
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

test('a signed-in player can upload, view, print, and delete a vehicle photo', async ({ page }) => {
	test.setTimeout(120_000);
	const messages = watchDialogs(page);
	const email = `photos-${Date.now()}@example.com`;
	await page.addInitScript(() => {
		localStorage.setItem('gaslands-firebase-emulators', '1');
		localStorage.setItem('hasRules', 'true');
		localStorage.setItem('printRulesPromptSeen', 'true');
	});
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();

	await page.getByLabel('Team Name').fill('Photo Racers');
	await page.locator('#sponsor-select').selectOption('rutherford');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Save/Load Team', exact: true }).click();
	const saving = page.getByRole('dialog', { name: 'My Teams' });
	await saving.getByRole('button', { name: 'Save', exact: true }).click();
	await expect.poll(() => messages.some((message) => message.includes('Team saved successfully'))).toBeTruthy();
	await saving.getByRole('button', { name: 'Close teams modal' }).click();

	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	const photos = page.getByTestId('vehicle-photos');
	await expect(photos).toBeVisible();
	await photos.locator('summary').first().click();
	await expect(photos.getByText('Photos on this car (0/3)')).toBeVisible();
	await expect(photos.getByRole('heading', { name: 'Add a photo' })).toBeVisible();
	await expect(photos.getByText('When this photo is added')).toHaveCount(0);
	await expect(photos.getByRole('link', { name: 'Learn more' })).toHaveAttribute('href', '/privacy#photos');
	await expect(photos.getByTestId('upload-share-everywhere')).toHaveCount(0);

	await photos.getByTestId('vehicle-photo-input').setInputFiles({
		name: 'painted-car.png',
		mimeType: 'image/png',
		buffer: TINY_PNG
	});
	const uploadDialog = photos.getByTestId('car-upload-dialog');
	await expect(uploadDialog).toBeVisible();
	const uploadEverywhere = uploadDialog.getByTestId('upload-share-everywhere');
	await expect(uploadEverywhere).not.toBeChecked();
	await expect(uploadEverywhere).toHaveJSProperty('indeterminate', false);
	await expect(uploadDialog.getByTestId('upload-share-gallery')).toBeHidden();
	await expect(uploadDialog.getByTestId('upload-share-gallery')).not.toBeChecked();
	await expect(uploadDialog.getByTestId('upload-share-stats')).not.toBeChecked();
	await uploadDialog.getByTestId('confirm-car-upload').click();

	const thumbnail = photos.getByRole('img', { name: 'Painted car' });
	await expect(thumbnail).toBeVisible({ timeout: 30_000 });
	await expect(photos.getByRole('alert')).toHaveCount(0);
	await expect(photos.getByTestId('share-status')).toHaveText('Private');
	await photos.getByTestId('car-photo-thumb').click();
	const saved = photos.getByTestId('car-photo-editor');
	await expect(saved).toBeVisible();
	const everywhere = saved.getByTestId('share-everywhere');
	await expect(everywhere).not.toBeChecked();
	await expect(everywhere).toHaveJSProperty('indeterminate', false);
	await expect(saved.getByTestId('share-buddies')).toBeHidden();
	await saved.getByTestId('customize-sharing').click();
	await everywhere.click();
	await expect(saved.getByTestId('share-buddies')).toBeChecked({ timeout: 20_000 });
	await expect(saved.getByTestId('share-link')).toBeChecked();
	await expect(saved.getByTestId('share-gallery')).toBeChecked();
	await expect(saved.getByTestId('share-stats')).toBeChecked();
	await expect(everywhere).toBeChecked();
	await expect(everywhere).toHaveJSProperty('indeterminate', false);

	await saved.getByTestId('share-stats').click();
	await expect(everywhere).not.toBeChecked();
	await expect(everywhere).toHaveJSProperty('indeterminate', true, { timeout: 20_000 });
	await everywhere.click();
	await expect(saved.getByTestId('share-stats')).toBeChecked({ timeout: 20_000 });
	await expect(everywhere).toBeChecked();
	await everywhere.click();
	await expect(saved.getByTestId('share-buddies')).not.toBeChecked({ timeout: 20_000 });
	await expect(saved.getByTestId('share-gallery')).not.toBeChecked();
	await expect(everywhere).not.toBeChecked();
	await expect(everywhere).toHaveJSProperty('indeterminate', false);
	await saved.getByRole('button', { name: 'Close' }).click();
	await expect(saved).toHaveCount(0);

	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	const popupPromise = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'Print with photos', exact: true }).click();
	const popup = await popupPromise;
	const printed = popup.locator('.vehicle-photos img');
	await expect(printed).toHaveCount(1, { timeout: 30_000 });
	await expect.poll(async () => printed.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBeTruthy();
	await popup.close();

	await photos.getByTestId('car-photo-thumb').click();
	await expect(saved).toBeVisible();
	await saved.getByRole('button', { name: 'Remove from this car' }).click();
	await expect.poll(() => messages.some((message) => message.includes('Remove this photo from this car?'))).toBeTruthy();
	await expect(thumbnail).toHaveCount(0);
	await expect(photos.getByRole('alert')).toHaveCount(0);
});

test('an unsaved team asks the player to save before photos and still draws the car', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const email = `photos-unsaved-${Date.now()}@example.com`;
	await page.addInitScript(() => {
		localStorage.setItem('gaslands-firebase-emulators', '1');
		localStorage.setItem('hasRules', 'true');
	});
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();

	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	const card = page.locator('.vehicle-card').filter({ has: page.getByRole('button', { name: 'Collapse vehicle' }) });
	await expect(card.getByRole('textbox', { name: 'Vehicle Name' })).toBeVisible();
	await expect(page.getByText('could not be drawn')).toHaveCount(0);
	const photos = page.getByTestId('vehicle-photos');
	await expect(photos.getByTestId('photos-need-save').first()).toBeVisible();
	await expect(photos.getByTestId('photos-need-save').first()).toHaveText('Save the team to add photos');
	await expect(photos.getByTestId('vehicle-photo-input')).toHaveCount(0);
	expect(errors).toEqual([]);
});
