/** One row in the weapon, upgrade, or perk adder. */
export interface AddOptionFact {
	text: string;
	tone?: 'neutral' | 'dice' | 'electric' | 'trailer' | 'muted';
}

export interface AddOption {
	id: string;
	name: string;
	aliases: string[];
	keywords: string[];
	disabled: boolean;
	reason?: string;
	facts: AddOptionFact[];
	/** Set only when the current menu already groups its choices. */
	group?: string;
}

export interface TextPart {
	text: string;
	match: boolean;
}

export interface ListAnchor {
	top: number;
	bottom: number;
	left: number;
	width: number;
}

export interface ListViewport {
	top: number;
	left: number;
	width: number;
	height: number;
	/** True when the on-screen keyboard has shrunk the visual viewport. */
	keyboard: boolean;
}

export interface ListPlacement {
	top: number;
	left: number;
	width: number;
	maxHeight: number;
	mode: 'below' | 'above' | 'sheet';
}

const GAP = 4;
const MIN_LIST = 120;
const PREFER_LIST = 320;

export function filterOptions(options: AddOption[], query: string): AddOption[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return options;
	return options.filter((option) => matchesOption(option, needle));
}

export function matchesOption(option: AddOption, needle: string): boolean {
	return [option.name, ...option.aliases, ...option.keywords].some((field) =>
		field.toLowerCase().includes(needle)
	);
}

export function highlightParts(text: string, query: string): TextPart[] {
	const needle = query.trim();
	if (!needle) return [{ text, match: false }];
	const lower = text.toLowerCase();
	const target = needle.toLowerCase();
	const parts: TextPart[] = [];
	let cursor = 0;
	while (cursor < text.length) {
		const found = lower.indexOf(target, cursor);
		if (found < 0) {
			parts.push({ text: text.slice(cursor), match: false });
			break;
		}
		if (found > cursor) parts.push({ text: text.slice(cursor, found), match: false });
		parts.push({ text: text.slice(found, found + target.length), match: true });
		cursor = found + target.length;
	}
	return parts.filter((part) => part.text.length > 0);
}

/** Alias or keyword that explains a hit when the name itself does not contain the query. */
export function matchHint(option: AddOption, query: string): string | null {
	const needle = query.trim().toLowerCase();
	if (!needle || option.name.toLowerCase().includes(needle)) return null;
	return (
		[...option.aliases, ...option.keywords].find((field) => field.toLowerCase().includes(needle)) ??
		null
	);
}

export function firstEnabled(options: AddOption[]): number {
	return options.findIndex((option) => !option.disabled);
}

export function lastEnabled(options: AddOption[]): number {
	for (let index = options.length - 1; index >= 0; index -= 1) {
		if (!options[index].disabled) return index;
	}
	return -1;
}

/** Move to the next enabled row. Disabled rows are skipped. Stops at the ends. */
export function moveActive(options: AddOption[], current: number, direction: 1 | -1): number {
	const start = current < 0 ? (direction === 1 ? -1 : options.length) : current;
	for (let index = start + direction; index >= 0 && index < options.length; index += direction) {
		if (!options[index].disabled) return index;
	}
	return current >= 0 && current < options.length && !options[current].disabled ? current : -1;
}

export interface OptionGroup {
	label: string | null;
	options: { option: AddOption; index: number }[];
}

/** Keeps the incoming order. Headers appear only when a row already has a group. */
export function groupOptions(options: AddOption[]): OptionGroup[] {
	const grouped = options.some((option) => option.group);
	if (!grouped) {
		return [{ label: null, options: options.map((option, index) => ({ option, index })) }];
	}
	const groups: OptionGroup[] = [];
	for (let index = 0; index < options.length; index += 1) {
		const option = options[index];
		const label = option.group || 'Other';
		const last = groups[groups.length - 1];
		if (!last || last.label !== label) groups.push({ label, options: [] });
		groups[groups.length - 1].options.push({ option, index });
	}
	return groups;
}

/**
 * Put the list where it can be seen. Prefer below the input, then above it.
 * On a phone with the keyboard up, or when neither side has room, use a sheet
 * pinned to the visible viewport so the card's overflow cannot clip it.
 */
export function placeAddList(anchor: ListAnchor, view: ListViewport): ListPlacement {
	const viewBottom = view.top + view.height;
	const spaceBelow = viewBottom - anchor.bottom - GAP;
	const spaceAbove = anchor.top - view.top - GAP;
	const narrow = view.width < 640;
	const width = Math.max(0, anchor.width);
	const left = clamp(anchor.left, view.left + GAP, view.left + view.width - width - GAP);

	if (narrow && view.keyboard) {
		if (spaceBelow >= 96) {
			return {
				mode: 'sheet',
				top: anchor.bottom + GAP,
				left: view.left + 8,
				width: Math.max(0, view.width - 16),
				maxHeight: Math.min(PREFER_LIST, spaceBelow)
			};
		}
		if (spaceAbove >= 96) {
			const maxHeight = Math.min(PREFER_LIST, spaceAbove);
			return {
				mode: 'above',
				top: anchor.top - GAP - maxHeight,
				left: view.left + 8,
				width: Math.max(0, view.width - 16),
				maxHeight
			};
		}
	}

	if (spaceBelow >= MIN_LIST) {
		return {
			mode: 'below',
			top: anchor.bottom + GAP,
			left,
			width,
			maxHeight: Math.min(PREFER_LIST, spaceBelow)
		};
	}
	if (spaceAbove >= MIN_LIST && spaceAbove > spaceBelow) {
		const maxHeight = Math.min(PREFER_LIST, spaceAbove);
		return {
			mode: 'above',
			top: Math.max(view.top + GAP, anchor.top - GAP - maxHeight),
			left,
			width,
			maxHeight
		};
	}

	const maxHeight = Math.max(96, Math.min(Math.round(view.height * 0.55), view.height - GAP * 2));
	return {
		mode: 'sheet',
		top: view.top + view.height - maxHeight,
		left: view.left + 8,
		width: Math.max(0, view.width - 16),
		maxHeight
	};
}

function clamp(value: number, min: number, max: number) {
	if (max < min) return min;
	return Math.min(Math.max(value, min), max);
}
