import fs from 'node:fs';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { SHOW_BUDDY_HIDE_TOGGLE } from '../src/lib/features/buddyHide';

const shots = '/opt/cursor/artifacts/screenshots';

type SignedIn = { page: Page; notices: string[]; email: string };

async function signIn(browser: Browser, email: string): Promise<SignedIn> {
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const page = await context.newPage();
	const notices: string[] = [];
	page.on('dialog', async (dialog) => {
		notices.push(dialog.message());
		await dialog.accept();
	});
	await page.addInitScript(() => localStorage.setItem('gaslands-firebase-emulators', '1'));
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();
	return { page, notices, email };
}

async function openTeams(page: Page) {
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Save/Load Team' }).click();
	const dialog = page.getByRole('dialog', { name: 'My Teams' });
	await expect(dialog).toBeVisible();
	return dialog;
}

async function saveNamedTeam(dialog: Locator, name: string, notices: string[]) {
	await expect(dialog.getByPlaceholder('Enter team name')).toHaveValue(name);
	const before = notices.length;
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect.poll(() => notices.slice(before).some((message) => message.includes('Team saved successfully'))).toBeTruthy();
	await expect(dialog.getByText(name, { exact: true })).toBeVisible();
}

async function saveRacers(page: Page, notices: string[]) {
	await page.getByLabel('Team Name').fill('Racers');
	await page.locator('#sponsor-select').selectOption('rutherford');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	await page.getByLabel('Vehicle Name').fill('Hauler');
	const dialog = await openTeams(page);
	await saveNamedTeam(dialog, 'Racers', notices);
	await dialog.getByRole('button', { name: 'Close teams modal' }).click();
}

async function dismissNewsletter(page: Page) {
	const dismiss = page.getByTestId('newsletter-dismiss');
	try {
		await dismiss.waitFor({ state: 'visible', timeout: 3_000 });
		await dismiss.click();
		await expect(dismiss).toBeHidden();
	} catch {
		// The prompt is already answered for this account.
	}
}

async function openBuddies(page: Page) {
	await page.goto('/buddies', { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('buddy-invite-code')).toBeVisible({ timeout: 60_000 });
	await dismissNewsletter(page);
}

async function saveBuddyName(page: Page, name: string) {
	await page.getByTestId('buddy-display-name').fill(name);
	await page.getByTestId('buddy-save-profile').click();
	await expect(page.getByTestId('buddies-notice')).toContainText(/saved|find this name/i);
}

async function shoot(page: Page, name: string) {
	fs.mkdirSync(shots, { recursive: true });
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.screenshot({ path: `${shots}/${name}-1280.png`, fullPage: true });
	await page.evaluate(() => {
		document.documentElement.classList.add('dark', 'dark-mode');
	});
	await page.screenshot({ path: `${shots}/${name}-1280-dark.png`, fullPage: true });
	await page.evaluate(() => {
		document.documentElement.classList.remove('dark', 'dark-mode');
	});
	await page.setViewportSize({ width: 375, height: 812 });
	await page.screenshot({ path: `${shots}/${name}-375.png`, fullPage: true });
	await page.setViewportSize({ width: 1280, height: 800 });
}

test('a buddy request, accepted copy, and removal stay on the right accounts', async ({ browser }) => {
	test.setTimeout(240_000);
	const stamp = Date.now();
	const ada = await signIn(browser, `ada-${stamp}@example.com`);
	const grace = await signIn(browser, `grace-${stamp}@example.com`);

	await saveRacers(ada.page, ada.notices);
	await ada.page.getByRole('button', { name: ada.email.split('@')[0] }).click();
	await expect(ada.page.getByRole('link', { name: 'Gaming Buddies' })).toBeVisible();
	await ada.page.goto('/profile', { waitUntil: 'domcontentloaded' });
	await expect(ada.page.getByRole('link', { name: 'Gaming Buddies' })).toBeVisible();
	await ada.page.getByRole('button', { name: 'Players', exact: true }).click();
	await expect(ada.page.locator('.players-menu-dropdown').getByRole('link', { name: 'Gaming Buddies' })).toBeVisible();

	await openBuddies(ada.page);
	await saveBuddyName(ada.page, 'Ada');
	const invite = await ada.page.getByTestId('buddy-invite-link').inputValue();
	expect(invite).toContain('/buddies?invite=');
	expect(invite).not.toContain('@');

	await saveRacers(grace.page, grace.notices);
	await openBuddies(grace.page);
	await saveBuddyName(grace.page, 'Grace');
	await grace.page.goto(invite, { waitUntil: 'domcontentloaded' });
	await expect(grace.page.getByTestId('buddy-invite-prompt')).toBeVisible({ timeout: 60_000 });
	await grace.page.getByTestId('buddy-send-invite').click();
	await expect(grace.page.getByTestId('buddies-notice')).toContainText('Request sent');
	await expect(grace.page.getByTestId('buddy-outgoing')).toContainText('Ada');

	await ada.page.reload({ waitUntil: 'domcontentloaded' });
	await expect(ada.page.getByTestId('buddy-incoming')).toContainText('Grace', { timeout: 60_000 });
	await ada.page.getByTestId('buddy-accept').click();
	await expect(ada.page.getByTestId('buddies-notice')).toContainText('gaming buddies');
	await expect(ada.page.getByTestId('buddy-list')).toContainText('Grace');
	if (SHOW_BUDDY_HIDE_TOGGLE) {
		await expect(ada.page.getByTestId('team-hide-from-buddies')).toBeVisible();
	} else {
		await expect(ada.page.getByTestId('team-hide-from-buddies')).toHaveCount(0);
		await expect(ada.page.getByRole('button', { name: /from buddies/i })).toHaveCount(0);
	}
	await expect(ada.page.getByTestId('buddy-email-form')).toBeVisible();
	await ada.page.getByTestId('buddy-email').fill('friend@example.com');
	await ada.page.getByTestId('buddy-email-message').fill('See you at the table');
	await shoot(ada.page, 'buddies');

	await grace.page.reload({ waitUntil: 'domcontentloaded' });
	await expect(grace.page.getByTestId('buddy-list')).toContainText('Ada', { timeout: 60_000 });
	const buddyHref = await grace.page.getByTestId('buddy-view').getAttribute('href');
	expect(buddyHref).toMatch(/^\/buddies\//);
	await grace.page.goto(buddyHref!, { waitUntil: 'domcontentloaded' });
	await expect(grace.page.getByTestId('buddy-team-list')).toContainText('Racers', { timeout: 30_000 });
	await expect(grace.page.getByTestId('vehicle-readonly')).toContainText('Hauler');
	await shoot(grace.page, 'buddy-teams');

	await grace.page.getByTestId('buddy-load-copy').click();
	await expect(grace.page.getByLabel('Team Name')).toHaveValue('Racers (from Ada)', { timeout: 30_000 });
	await expect(grace.page.getByTestId('buddy-copy-banner')).toBeVisible();
	await expect(grace.page.locator('#sponsor-select')).toHaveValue('rutherford');
	await grace.page.getByRole('button', { name: 'Expand vehicle' }).click();
	await expect(grace.page.getByLabel('Vehicle Name')).toHaveValue('Hauler');
	await shoot(grace.page, 'builder-copy');

	const beforeSave = grace.notices.length;
	await grace.page.getByRole('button', { name: 'Quick Save' }).click();
	await expect.poll(() => grace.notices.slice(beforeSave).some((message) => message.includes('Team saved successfully'))).toBeTruthy();

	const graceTeams = await openTeams(grace.page);
	await expect(graceTeams.getByText('Racers', { exact: true })).toBeVisible();
	await expect(graceTeams.getByText('Racers (from Ada)', { exact: true })).toBeVisible();
	if (SHOW_BUDDY_HIDE_TOGGLE) {
		await expect(graceTeams.getByTestId('team-hide-from-buddies').first()).toBeVisible();
	} else {
		await expect(graceTeams.getByTestId('team-hide-from-buddies')).toHaveCount(0);
		await expect(graceTeams.getByRole('button', { name: /from buddies/i })).toHaveCount(0);
	}
	await graceTeams.getByRole('button', { name: 'Close teams modal' }).click();

	await ada.page.reload({ waitUntil: 'domcontentloaded' });
	await expect(ada.page.getByTestId('buddy-list')).toContainText('Grace', { timeout: 30_000 });
	await expect(ada.page.getByRole('region', { name: 'Your teams' })).toContainText('Racers');
	await expect(ada.page.getByText('Racers (from Ada)', { exact: true })).toHaveCount(0);

	await ada.page.getByTestId('buddy-remove').click();
	await expect(ada.page.getByTestId('buddies-notice')).toContainText('Buddy removed');
	await expect(ada.page.getByText('No buddies yet.')).toBeVisible();

	await grace.page.goto(buddyHref!, { waitUntil: 'domcontentloaded' });
	await expect(grace.page.getByTestId('buddy-access-ended')).toBeVisible({ timeout: 30_000 });
	const stillThere = await openTeams(grace.page);
	await expect(stillThere.getByText('Racers (from Ada)', { exact: true })).toBeVisible();
	await expect(stillThere.getByText('Racers', { exact: true })).toBeVisible();
});
