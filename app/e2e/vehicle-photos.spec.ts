import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

mkdirSync('/opt/cursor/artifacts/screenshots', { recursive: true });

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
	await photos.locator('summary').click();
	await expect(photos.getByTestId('upload-share-gallery')).not.toBeChecked();
	await expect(photos.getByTestId('upload-share-stats')).not.toBeChecked();

	await photos.getByTestId('vehicle-photo-input').setInputFiles({
		name: 'painted-car.png',
		mimeType: 'image/png',
		buffer: TINY_PNG
	});
	const thumbnail = photos.getByRole('img', { name: 'Painted car' });
	await expect(thumbnail).toBeVisible({ timeout: 30_000 });
	await expect(photos.getByRole('alert')).toHaveCount(0);
	await expect(photos.getByTestId('upload-share-gallery')).not.toBeChecked();
	await expect(photos.getByTestId('upload-share-stats')).not.toBeChecked();

	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	const popupPromise = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'Print with photos', exact: true }).click();
	const popup = await popupPromise;
	const printed = popup.locator('.vehicle-photos img');
	await expect(printed).toHaveCount(1, { timeout: 30_000 });
	await expect.poll(async () => printed.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBeTruthy();
	await popup.close();

	await photos.getByRole('button', { name: 'Remove from this car' }).click();
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

async function signInPlayer(page: Page, label: string) {
	const messages = watchDialogs(page);
	const email = `${label}-${Date.now()}@example.com`;
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
	return messages;
}

async function saveCurrentTeam(page: Page, messages: string[]) {
	await page.getByRole('button', { name: 'Quick Save' }).scrollIntoViewIfNeeded();
	await page.getByRole('button', { name: 'Quick Save' }).click();
	await expect.poll(() => messages.filter((message) => message.includes('Team saved successfully')).length).toBeGreaterThan(0);
}

test.describe('photos on a car the saved team does not have yet', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('a never-saved team asks for a name instead of opening the file picker', async ({ page }) => {
		await signInPlayer(page, 'photos-first-save');
		await page.getByRole('button', { name: '+ Add Vehicle' }).click();
		await page.getByRole('button', { name: 'Expand vehicle' }).click();
		const photos = page.getByTestId('vehicle-photos');
		await photos.locator('summary').click();
		await photos.getByTestId('add-photo-needs-save').click();
		const modal = page.getByTestId('save-for-photos-modal');
		await expect(modal.getByRole('heading', { name: 'Save the team first' })).toBeVisible();
		await expect(modal.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
		await expect(modal.getByRole('button', { name: 'Quick Save' })).toHaveCount(0);
		await expect(photos.getByTestId('vehicle-photo-input')).toHaveCount(0);
		await modal.screenshot({ path: '/opt/cursor/artifacts/screenshots/save-the-team-first.png' });
		await modal.getByTestId('cancel-photo-save').click();
		await expect(modal).toBeHidden();
	});

	test('adding a photo to a new car saves the team, then attaches that photo', async ({ page }) => {
		test.setTimeout(120_000);
		const messages = await signInPlayer(page, 'photos-second-car');
		await page.getByLabel('Team Name').fill('Photo Racers');
		await page.locator('#sponsor-select').selectOption('rutherford');
		await page.getByRole('button', { name: '+ Add Vehicle' }).click();
		await saveCurrentTeam(page, messages);

		await page.getByRole('button', { name: '+ Add Vehicle' }).click();
		const second = page.locator('.vehicle-card').nth(1);
		await second.getByRole('button', { name: 'Expand vehicle' }).click();
		await second.getByRole('textbox', { name: 'Vehicle Name' }).fill('Second car');
		const photos = second.getByTestId('vehicle-photos');
		await photos.locator('summary').click();
		await photos.getByTestId('vehicle-photo-input').setInputFiles({
			name: 'second-car.png',
			mimeType: 'image/png',
			buffer: TINY_PNG
		});

		const modal = page.getByTestId('save-for-photos-modal');
		await expect(modal.getByRole('heading', { name: 'Save your team to add photos' })).toBeVisible();
		await expect(modal.getByRole('button', { name: 'Quick Save' })).toBeVisible();
		await expect(modal.getByRole('button', { name: 'Save as new team' })).toBeVisible();
		await expect(page.getByText('That vehicle is not on this team.')).toHaveCount(0);
		await modal.screenshot({ path: '/opt/cursor/artifacts/screenshots/save-team-before-photo-modal.png' });

		await modal.getByTestId('quick-save-for-photos').click();
		await expect(modal).toBeHidden({ timeout: 20_000 });
		await expect(page.getByRole('heading', { name: 'Saving will remove or replace vehicles' })).toHaveCount(0);
		const thumbnail = photos.getByRole('img', { name: 'Painted car' });
		await expect(thumbnail).toBeVisible({ timeout: 30_000 });
		await expect(photos.getByRole('alert')).toHaveCount(0);
		await expect(page.getByText('That vehicle is not on this team.')).toHaveCount(0);
		await photos.screenshot({ path: '/opt/cursor/artifacts/screenshots/photo-attached-after-quick-save.png' });

		await page.getByRole('button', { name: 'Teams', exact: true }).click();
		await page.getByRole('button', { name: 'Save/Load Team', exact: true }).click();
		const teams = page.getByRole('dialog', { name: 'My Teams' });
		await expect(teams.getByText('Photo Racers', { exact: true })).toHaveCount(1);
	});

	test('choosing a library photo on a new car opens the picker after quick save', async ({ page }) => {
		test.setTimeout(120_000);
		const messages = await signInPlayer(page, 'photos-library-new-car');
		await page.getByLabel('Team Name').fill('Library Racers');
		await page.locator('#sponsor-select').selectOption('rutherford');
		await page.getByRole('button', { name: '+ Add Vehicle' }).click();
		await saveCurrentTeam(page, messages);

		const first = page.locator('.vehicle-card').first();
		await first.getByRole('button', { name: 'Expand vehicle' }).click();
		const firstPhotos = first.getByTestId('vehicle-photos');
		await firstPhotos.locator('summary').click();
		await firstPhotos.getByTestId('vehicle-photo-input').setInputFiles({
			name: 'first-car.png',
			mimeType: 'image/png',
			buffer: TINY_PNG
		});
		await expect(firstPhotos.getByRole('img', { name: 'Painted car' })).toBeVisible({ timeout: 30_000 });

		await page.getByRole('button', { name: '+ Add Vehicle' }).click();
		const second = page.locator('.vehicle-card').nth(1);
		await second.getByRole('button', { name: 'Expand vehicle' }).click();
		const photos = second.getByTestId('vehicle-photos');
		await photos.locator('summary').click();
		await photos.getByTestId('choose-library-photo').click();
		const modal = page.getByTestId('save-for-photos-modal');
		await expect(modal.getByRole('heading', { name: 'Save your team to add photos' })).toBeVisible();
		await expect(photos.getByTestId('library-picker')).toHaveCount(0);
		await modal.getByTestId('quick-save-for-photos').click();
		await expect(modal).toBeHidden({ timeout: 20_000 });
		await expect(photos.getByTestId('library-picker')).toBeVisible();
		await photos.getByTestId('library-pick').click();
		await expect(photos.getByRole('img', { name: 'Painted car' })).toBeVisible({ timeout: 20_000 });
		await expect(photos.getByRole('alert')).toHaveCount(0);
		await expect(page.getByText('That vehicle is not on this team.')).toHaveCount(0);
	});

	test('quick save warns before it removes a saved car', async ({ page }) => {
		test.setTimeout(120_000);
		const messages = await signInPlayer(page, 'photos-overwrite');
		await page.getByLabel('Team Name').fill('Keep Rusty');
		await page.locator('#sponsor-select').selectOption('rutherford');
		await page.getByRole('button', { name: '+ Add Vehicle' }).click();
		await page.getByRole('button', { name: 'Expand vehicle' }).click();
		await page.getByRole('textbox', { name: 'Vehicle Name' }).fill('Rusty');
		await saveCurrentTeam(page, messages);

		await page.getByRole('button', { name: '+ Add Vehicle' }).click();
		await page.getByRole('button', { name: 'Quick Save' }).click();
		await expect(page.getByTestId('save-for-photos-modal')).toHaveCount(0);
		await expect.poll(() => messages.filter((message) => message.includes('Team saved successfully')).length).toBe(2);

		await page.getByRole('button', { name: 'Remove vehicle' }).first().click();
		await page.getByRole('button', { name: 'Quick Save' }).click();
		const modal = page.getByTestId('save-for-photos-modal');
		await expect(modal.getByRole('heading', { name: 'Saving will remove or replace vehicles' })).toBeVisible();
		await expect(modal.getByText('Rusty will be removed.')).toBeVisible();
		await expect(modal.getByRole('button', { name: 'Save anyway' })).toBeVisible();
		await expect(modal.getByRole('button', { name: 'Save as new team' })).toBeVisible();
		await modal.screenshot({ path: '/opt/cursor/artifacts/screenshots/quick-save-overwrite-warning.png' });
		await modal.getByTestId('cancel-photo-save').click();
		await expect(modal).toBeHidden();
		expect(messages.filter((message) => message.includes('Team saved successfully')).length).toBe(2);
	});
});
