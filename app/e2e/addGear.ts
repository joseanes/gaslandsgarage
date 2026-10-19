import { expect, type Page } from '@playwright/test';

/** Type into a vehicle adder and pick the matching row. */
export async function addGear(page: Page, label: string, query: string, optionName: RegExp) {
	const input = page.getByRole('combobox', { name: label });
	await input.click();
	await input.fill(query);
	const option = page.getByRole('listbox', { name: label }).getByRole('option', { name: optionName });
	await expect(option).toBeVisible();
	await option.click();
	await expect(input).toBeFocused();
	await expect(input).toHaveValue('');
}
