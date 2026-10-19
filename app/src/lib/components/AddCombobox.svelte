<script lang="ts">
	import { createEventDispatcher, tick } from 'svelte';
	import {
		filterOptions,
		firstEnabled,
		groupOptions,
		highlightParts,
		lastEnabled,
		matchHint,
		moveActive,
		placeAddList,
		type AddOption,
		type ListPlacement
	} from './addCombobox';

	export let id: string;
	export let label: string;
	export let placeholder: string;
	export let options: AddOption[] = [];
	export let disabled = false;
	/** Optional callback so tests can listen without the component event. */
	export let onSelect: (id: string) => void = () => {};

	const dispatch = createEventDispatcher<{ select: { id: string } }>();

	let query = '';
	let open = false;
	let activeIndex = -1;
	let choosing = false;
	let inDark = false;
	let inputEl: HTMLInputElement;
	let rootEl: HTMLDivElement;
	let listEl: HTMLDivElement | null = null;
	let blurTimer: ReturnType<typeof setTimeout> | null = null;
	let placement: ListPlacement = { top: 0, left: 0, width: 0, maxHeight: 240, mode: 'below' };

	$: shown = filterOptions(options, query);
	$: groups = groupOptions(shown);
	$: activeId = activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined;
	$: if (open && (activeIndex >= shown.length || (shown[activeIndex]?.disabled ?? false))) {
		activeIndex = firstEnabled(shown);
	}

	function positionList() {
		if (!inputEl || typeof window === 'undefined') return;
		const rect = inputEl.getBoundingClientRect();
		const view = window.visualViewport;
		const viewTop = view?.offsetTop ?? 0;
		const viewLeft = view?.offsetLeft ?? 0;
		const viewWidth = view?.width ?? window.innerWidth;
		const viewHeight = view?.height ?? window.innerHeight;
		inDark = !!inputEl.closest('.dark');
		placement = placeAddList(
			{ top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
			{
				top: viewTop,
				left: viewLeft,
				width: viewWidth,
				height: viewHeight,
				keyboard: !!view && window.innerHeight - view.height > 140
			}
		);
	}

	function mountList(node: HTMLDivElement) {
		listEl = node;
		document.body.appendChild(node);
		positionList();
		const onReflow = () => positionList();
		window.addEventListener('scroll', onReflow, true);
		window.addEventListener('resize', onReflow);
		window.visualViewport?.addEventListener('resize', onReflow);
		window.visualViewport?.addEventListener('scroll', onReflow);
		return {
			destroy() {
				window.removeEventListener('scroll', onReflow, true);
				window.removeEventListener('resize', onReflow);
				window.visualViewport?.removeEventListener('resize', onReflow);
				window.visualViewport?.removeEventListener('scroll', onReflow);
				if (listEl === node) listEl = null;
				node.remove();
			}
		};
	}

	function cancelBlur() {
		if (blurTimer) {
			clearTimeout(blurTimer);
			blurTimer = null;
		}
	}

	function openList() {
		if (disabled) return;
		open = true;
		if (activeIndex < 0 || activeIndex >= shown.length || shown[activeIndex]?.disabled) {
			activeIndex = firstEnabled(shown);
		}
		requestAnimationFrame(positionList);
	}

	function onFocus() {
		cancelBlur();
		openList();
		if (typeof window !== 'undefined' && window.innerWidth < 640) {
			try {
				inputEl?.scrollIntoView({ block: 'center', inline: 'nearest' });
			} catch {
				/* jsdom */
			}
		}
	}

	function onBlur() {
		cancelBlur();
		blurTimer = setTimeout(() => {
			open = false;
		}, 180);
	}

	function onInput(event: Event) {
		if (disabled) return;
		const value = (event.currentTarget as HTMLInputElement).value;
		open = true;
		// Filter from the field value. The derived list has not flushed yet.
		activeIndex = firstEnabled(filterOptions(options, value));
		requestAnimationFrame(() => {
			positionList();
			scrollActiveIntoView();
		});
	}

	function onWindowPointerDown(event: PointerEvent) {
		const target = event.target as Node | null;
		if (!target) return;
		if (rootEl?.contains(target) || listEl?.contains(target)) return;
		open = false;
	}

	function onKeydown(event: KeyboardEvent) {
		if (disabled) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			const wasOpen = open;
			open = true;
			activeIndex = wasOpen ? moveActive(shown, activeIndex, 1) : firstEnabled(shown);
			if (activeIndex < 0) activeIndex = firstEnabled(shown);
			scrollActiveIntoView();
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			const wasOpen = open;
			open = true;
			activeIndex = wasOpen ? moveActive(shown, activeIndex, -1) : lastEnabled(shown);
			scrollActiveIntoView();
		} else if (event.key === 'Home') {
			if (!open) return;
			event.preventDefault();
			activeIndex = firstEnabled(shown);
			scrollActiveIntoView();
		} else if (event.key === 'End') {
			if (!open) return;
			event.preventDefault();
			activeIndex = lastEnabled(shown);
			scrollActiveIntoView();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (!open) {
				open = true;
				activeIndex = firstEnabled(shown);
				return;
			}
			const option = shown[activeIndex];
			if (option && !option.disabled) void choose(option);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			if (open) open = false;
			else query = '';
		} else if (event.key === 'Tab') {
			open = false;
		}
	}

	function scrollActiveIntoView() {
		requestAnimationFrame(() => {
			const node = listEl?.querySelector(`[data-index="${activeIndex}"]`);
			if (node && 'scrollIntoView' in node) {
				try {
					node.scrollIntoView({ block: 'nearest' });
				} catch {
					/* jsdom */
				}
			}
		});
	}

	async function choose(option: AddOption) {
		if (option.disabled || choosing) return;
		choosing = true;
		cancelBlur();
		onSelect(option.id);
		dispatch('select', { id: option.id });
		query = '';
		open = true;
		await tick();
		activeIndex = firstEnabled(shown);
		inputEl?.focus();
		positionList();
		choosing = false;
	}

	function factClass(tone: AddOptionFactTone) {
		if (tone === 'dice') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
		if (tone === 'electric') return 'bg-blue-100 text-blue-800';
		if (tone === 'trailer') return 'bg-amber-100 text-amber-800';
		if (tone === 'muted') return 'bg-stone-100 text-stone-500 dark:bg-gray-600 dark:text-gray-300';
		return 'bg-stone-100 text-stone-700 dark:bg-gray-600 dark:text-gray-200';
	}

	type AddOptionFactTone = NonNullable<AddOption['facts'][number]['tone']>;
</script>

<svelte:window on:pointerdown={onWindowPointerDown} />

<div class="relative" bind:this={rootEl}>
	<label for={id} class="sr-only">{label}</label>
	<input
		{id}
		bind:this={inputEl}
		bind:value={query}
		type="text"
		role="combobox"
		class="w-full min-h-11 md:min-h-0 py-2 md:py-1 pl-2 pr-8 border border-stone-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-stone-800 dark:text-gray-100 text-base md:text-sm placeholder:text-stone-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 focus:outline-none disabled:bg-stone-100 disabled:text-stone-400"
		{placeholder}
		{disabled}
		autocomplete="off"
		autocapitalize="off"
		autocorrect="off"
		spellcheck="false"
		aria-autocomplete="list"
		aria-expanded={open}
		aria-controls="{id}-listbox"
		aria-activedescendant={open ? activeId : undefined}
		aria-haspopup="listbox"
		on:focus={onFocus}
		on:click={openList}
		on:blur={onBlur}
		on:input={onInput}
		on:keydown={onKeydown}
	/>
	<div class="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none" aria-hidden="true">
		<svg class="w-4 h-4 text-stone-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
		</svg>
	</div>
</div>

{#if open}
	<div
		bind:this={listEl}
		use:mountList
		class="fixed z-30 {inDark ? 'dark' : ''}"
		data-placement={placement.mode}
		style="top: {placement.top}px; left: {placement.left}px; width: {placement.width}px;"
	>
		<div class="overflow-hidden rounded border border-stone-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<ul
				id="{id}-listbox"
				role="listbox"
				aria-label={label}
				class="overflow-y-auto overscroll-contain py-1"
				style="max-height: {placement.maxHeight}px; -webkit-overflow-scrolling: touch;"
				on:pointerdown={cancelBlur}
				on:mousedown|preventDefault={cancelBlur}
			>
				{#if shown.length === 0}
					<li class="px-3 py-2 text-sm text-stone-500 dark:text-gray-400" role="presentation">No matches</li>
				{/if}
				{#each groups as group}
					{#if group.label}
						<li class="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-gray-400" role="presentation">
							{group.label}
						</li>
					{/if}
					{#each group.options as entry (entry.option.id)}
						{@const hint = matchHint(entry.option, query)}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<li
							id="{id}-option-{entry.index}"
							role="option"
							data-index={entry.index}
							aria-disabled={entry.option.disabled}
							aria-selected={entry.index === activeIndex}
							class="mx-1 flex min-h-11 flex-col justify-center rounded px-2 py-1.5 text-sm {entry.option.disabled
								? 'cursor-not-allowed text-stone-400 dark:text-gray-500'
								: 'cursor-pointer text-stone-800 dark:text-gray-100'} {entry.index === activeIndex && !entry.option.disabled
								? 'bg-amber-100 dark:bg-amber-900/40'
								: ''}"
							on:mouseenter={() => {
								if (!entry.option.disabled) activeIndex = entry.index;
							}}
							on:click={() => choose(entry.option)}
						>
							<span class="flex flex-wrap items-center gap-1">
								<span class="font-semibold">
									{#each highlightParts(entry.option.name, query) as part}
										{#if part.match}<mark class="rounded-sm bg-amber-200 px-0.5 text-stone-900">{part.text}</mark>{:else}{part.text}{/if}
									{/each}
								</span>
								{#if hint}
									<span class="text-xs text-stone-500 dark:text-gray-400">
										{#each highlightParts(hint, query) as part}
											{#if part.match}<mark class="rounded-sm bg-amber-200 px-0.5 text-stone-900">{part.text}</mark>{:else}{part.text}{/if}
										{/each}
									</span>
								{/if}
								{#each entry.option.facts as fact}
									<span class="rounded px-1.5 py-0.5 text-xs {factClass(fact.tone || 'neutral')}">
										{#each highlightParts(fact.text, query) as part}
											{#if part.match}<mark class="rounded-sm bg-amber-200 px-0.5 text-stone-900">{part.text}</mark>{:else}{part.text}{/if}
										{/each}
									</span>
								{/each}
							</span>
							{#if entry.option.disabled && entry.option.reason}
								<span class="text-xs text-stone-500 dark:text-gray-400">{entry.option.reason}</span>
							{/if}
						</li>
					{/each}
				{/each}
			</ul>
		</div>
	</div>
{/if}
