import { expect, test, type Locator, type Page } from '@playwright/test';
import { emulatorFirestore } from './emulatorAdmin';

const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

const SITE = 'https://www.youtube.com/@rustpainter';
const LABEL = 'Painting guide on youtube.com';

async function signIn(page: Page, email: string) {
	await page.addInitScript(() => {
		localStorage.setItem('gaslands-firebase-emulators', '1');
		localStorage.setItem('hasRules', 'true');
		localStorage.setItem('printRulesPromptSeen', 'true');
	});
	await page.goto('/profile', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	const uid = await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
		return window.emulatorAuthState?.()?.uid ?? '';
	}, email);
	await expect(page.getByTestId('profile-form')).toBeVisible();
	return uid;
}

async function photoDoc(uid: string, caption: string) {
	const snap = await emulatorFirestore().collection(`users/${uid}/photos`).where('caption', '==', caption).get();
	expect(snap.size).toBe(1);
	return snap.docs[0];
}

async function expectGuide(scope: Locator, present: boolean) {
	const guide = scope.getByTestId('painting-guide');
	if (!present) {
		await expect(guide).toHaveCount(0);
		await expect(scope).not.toContainText(LABEL);
		await expect(scope).not.toContainText(SITE);
		return;
	}
	await expect(guide).toBeVisible();
	await expect(guide).toHaveText(LABEL);
	await expect(guide).toHaveAttribute('href', SITE);
	await expect(guide).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
	await expect(guide).toHaveAttribute('target', '_blank');
	await expect(guide.locator('svg')).toBeVisible();
}

test('a painting guide starts from the profile and stays blank when the photo link is cleared', async ({ page }) => {
	test.setTimeout(180_000);
	const stamp = Date.now().toString(36);
	const email = `paint-guide-${stamp}@example.com`;
	const caption = `guide${stamp}`;
	const uid = await signIn(page, email);

	await page.getByTestId('profile-player-name').fill('Rust Painter');
	await page.getByTestId('profile-website').fill(SITE);
	await page.getByTestId('profile-save').click();
	await expect(page.getByTestId('profile-notice')).toHaveText('Profile saved.');
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('profile-website')).toHaveValue(SITE);

	const profile = (await emulatorFirestore().doc(`playerProfiles/${uid}`).get()).data() ?? {};
	expect(profile.website).toBe(SITE);
	expect(profile).not.toHaveProperty('email');
	expect(JSON.stringify(profile)).not.toContain(email);

	await page.goto('/gallery', { waitUntil: 'domcontentloaded' });
	await page.getByTestId('add-photo').click();
	const dialog = page.getByTestId('add-photo-dialog');
	const link = dialog.getByTestId('add-painting-link');
	await expect(link).toHaveValue(SITE, { timeout: 20_000 });
	await expect(dialog.getByTestId('add-use-profile-website')).toBeEnabled();
	await link.fill('');
	await expect(link).toHaveValue('');
	await link.fill('javascript:alert(1)');
	await link.blur();
	await expect(dialog.getByRole('alert')).toContainText('Use a full http or https link');
	await dialog.getByTestId('add-use-profile-website').click();
	await expect(link).toHaveValue(SITE);
	await link.fill('');
	await link.blur();
	await dialog.getByTestId('add-photo-file').setInputFiles({
		name: 'rust-car.png',
		mimeType: 'image/png',
		buffer: TINY_PNG
	});
	await dialog.getByTestId('add-photo-caption').fill(caption);
	await dialog.getByTestId('add-photo-type').selectOption('Performance Car');
	await dialog.getByTestId('add-photo-submit').click();
	await expect(page.getByText('Your photo is in the Gallery.')).toBeVisible({ timeout: 30_000 });

	const created = await photoDoc(uid, caption);
	expect(created.get('paintingUrl') ?? '').toBe('');
	const sharedBlank = (await emulatorFirestore().doc(`sharedPhotos/${created.id}`).get()).data() ?? {};
	expect(sharedBlank.paintingUrl ?? '').toBe('');
	expect(JSON.stringify(sharedBlank)).not.toContain(SITE);
	expect(JSON.stringify(sharedBlank)).not.toContain(email);
	expect(sharedBlank).not.toHaveProperty('ownerUid');

	await page.getByTestId('gallery-search').fill(caption);
	await page.getByTestId('gallery-search').press('Enter');
	await expect(page.getByTestId('gallery-card')).toHaveCount(1);
	await page.getByTestId('gallery-card').click();
	const lightbox = page.getByTestId('gallery-lightbox');
	await expectGuide(lightbox, false);
	await lightbox.getByRole('button', { name: 'Close' }).click();

	await page.goto('/gallery?view=mine', { waitUntil: 'domcontentloaded' });
	const editor = page.getByTestId('library-photo');
	await expect(editor.getByTestId('library-painting-link')).toHaveValue('');
	await expect(editor.getByTestId('library-use-profile-website')).toBeEnabled();
	await editor.getByTestId('library-use-profile-website').click();
	await expect(editor.getByTestId('library-painting-link')).toHaveValue(SITE);
	await expect.poll(async () => (await emulatorFirestore().doc(`sharedPhotos/${created.id}`).get()).get('paintingUrl')).toBe(SITE);

	await page.goto('/gallery', { waitUntil: 'domcontentloaded' });
	await page.getByTestId('gallery-search').fill(caption);
	await page.getByTestId('gallery-search').press('Enter');
	await page.getByTestId('gallery-card').click();
	await expectGuide(page.getByTestId('gallery-lightbox'), true);
	await page.getByTestId('gallery-lightbox').getByTestId('car-page-link').click();
	await expect(page.getByTestId('car-page')).toBeVisible();
	await expectGuide(page.getByTestId('car-page'), true);
	await expect(page.getByTestId('car-page')).not.toContainText(email);

	await page.goto(`/embed/car/${created.id}`, { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('car-embed')).toBeVisible();
	await expectGuide(page.getByTestId('car-embed'), true);
	const titleLink = page.getByTestId('car-embed').locator('h1 a');
	await expect(titleLink).toHaveAttribute('target', '_top');
	await expect(page.getByTestId('car-embed')).not.toContainText(email);

	await page.goto('/gallery?view=mine', { waitUntil: 'domcontentloaded' });
	const again = page.getByTestId('library-photo');
	await again.getByTestId('library-painting-link').fill('');
	await again.getByTestId('library-painting-link').blur();
	await expect.poll(async () => (await emulatorFirestore().doc(`sharedPhotos/${created.id}`).get()).get('paintingUrl')).toBe('');
	expect((await emulatorFirestore().doc(`playerProfiles/${uid}`).get()).get('website')).toBe(SITE);

	await page.goto(`/car/${created.id}`, { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('car-page')).toBeVisible();
	await expectGuide(page.getByTestId('car-page'), false);
	await page.goto(`/embed/car/${created.id}`, { waitUntil: 'domcontentloaded' });
	await expectGuide(page.getByTestId('car-embed'), false);
	await page.goto('/gallery', { waitUntil: 'domcontentloaded' });
	await page.getByTestId('gallery-search').fill(caption);
	await page.getByTestId('gallery-search').press('Enter');
	await page.getByTestId('gallery-card').click();
	await expectGuide(page.getByTestId('gallery-lightbox'), false);
});
