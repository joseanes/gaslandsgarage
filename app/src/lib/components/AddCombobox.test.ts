import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import AddCombobox from './AddCombobox.svelte';
import type { AddOption } from './addCombobox';

afterEach(cleanup);

const options: AddOption[] = [
	{
		id: 'hmg',
		name: 'Heavy Machine Gun',
		aliases: ['hmg'],
		keywords: ['double'],
		disabled: false,
		facts: [
			{ text: 'Double', tone: 'neutral' },
			{ text: '🎲 3', tone: 'dice' },
			{ text: '1 slot', tone: 'neutral' },
			{ text: '3 cans', tone: 'neutral' }
		]
	},
	{
		id: 'mg',
		name: 'Machine Gun',
		aliases: ['mg'],
		keywords: ['double'],
		disabled: false,
		facts: [{ text: '2 cans', tone: 'neutral' }]
	},
	{
		id: 'tank_cannon',
		name: 'Tank Cannon',
		aliases: ['tank_cannon'],
		keywords: ['splash'],
		disabled: true,
		reason: 'Insufficient slots',
		facts: [{ text: '5 slots', tone: 'neutral' }]
	}
];

async function openAdder() {
	const picked: string[] = [];
	render(AddCombobox, {
		id: 'add-weapon-1',
		label: 'Add a weapon',
		placeholder: '+ Add weapon… (type to search)',
		options,
		onSelect: (id: string) => picked.push(id)
	});
	const input = screen.getByRole('combobox', { name: 'Add a weapon' }) as HTMLInputElement;
	await fireEvent.focus(input);
	await tick();
	return { input, picked };
}

describe('AddCombobox', () => {
	it('types machine, highlights the match, and adds Heavy Machine Gun', async () => {
		const { input, picked } = await openAdder();
		await fireEvent.input(input, { target: { value: 'machine' } });
		await tick();

		const heavy = screen.getByRole('option', { name: /Heavy Machine Gun/ });
		expect(heavy.querySelector('mark')?.textContent).toBe('Machine');
		expect(heavy.getAttribute('aria-selected')).toBe('true');
		await fireEvent.click(heavy);
		await tick();

		expect(picked).toEqual(['hmg']);
		expect(input.value).toBe('');
		expect(document.activeElement).toBe(input);
		expect(input.getAttribute('aria-expanded')).toBe('true');
	});

	it('does not pick a disabled option from a click or Enter', async () => {
		const { input, picked } = await openAdder();
		await fireEvent.input(input, { target: { value: 'tank' } });
		await tick();

		const tank = screen.getByRole('option', { name: /Tank Cannon/ });
		expect(tank.getAttribute('aria-disabled')).toBe('true');
		expect(tank.textContent).toContain('Insufficient slots');
		await fireEvent.click(tank);
		await fireEvent.keyDown(input, { key: 'Enter' });
		await tick();

		expect(picked).toEqual([]);
		expect(screen.getByRole('listbox', { name: 'Add a weapon' })).toBeTruthy();
	});

	it('moves with the arrow keys, adds on Enter, and closes on Escape or Tab', async () => {
		const { input, picked } = await openAdder();
		await fireEvent.input(input, { target: { value: 'machine' } });
		await tick();

		expect(screen.getByRole('option', { name: /Heavy Machine Gun/ }).getAttribute('aria-selected')).toBe('true');
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		await tick();
		expect(screen.getByRole('option', { name: /^Machine Gun/ }).getAttribute('aria-selected')).toBe('true');

		await fireEvent.keyDown(input, { key: 'ArrowUp' });
		await fireEvent.keyDown(input, { key: 'Enter' });
		await tick();
		expect(picked).toEqual(['hmg']);

		await fireEvent.keyDown(input, { key: 'Tab' });
		await tick();
		expect(screen.queryByRole('listbox')).toBeNull();

		await fireEvent.focus(input);
		await fireEvent.input(input, { target: { value: 'gun' } });
		await tick();
		expect(screen.queryByRole('listbox')).toBeTruthy();
		await fireEvent.keyDown(input, { key: 'Escape' });
		await tick();
		expect(screen.queryByRole('listbox')).toBeNull();
		expect(input.value).toBe('gun');
	});
});
