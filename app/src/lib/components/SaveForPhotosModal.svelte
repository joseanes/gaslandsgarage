<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { displacedVehicleLabel, type DisplacedVehicle } from '$lib/photos/saveBeforePhoto';

	export let open = false;
	export let mode: 'new-team' | 'unsaved' | 'overwrite' | 'name-new' = 'unsaved';
	export let displaced: DisplacedVehicle[] = [];
	export let unverified = false;
	export let busy = false;
	export let teamNameDraft = '';

	const dispatch = createEventDispatcher();

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && !busy) cancel();
	}

	function cancel() {
		if (mode === 'name-new') {
			dispatch('back');
			return;
		}
		dispatch('cancel');
	}

	$: title =
		mode === 'new-team'
			? 'Save the team first'
			: mode === 'overwrite'
				? 'Saving will remove or replace vehicles'
				: mode === 'name-new'
					? 'Save as a new team'
					: 'Save your team to add photos';

	$: titleId = 'save-for-photos-title';
</script>

<svelte:window on:keydown={onKey} />

{#if open}
	<div class="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4">
		<div
			class="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border-2 border-amber-500 bg-white p-5 shadow-xl dark:bg-gray-800"
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			data-testid="save-for-photos-modal"
			tabindex="-1"
		>
			<h2 id={titleId} class="text-lg font-bold text-stone-800 dark:text-white">{title}</h2>

			{#if mode === 'new-team'}
				<p class="mt-2 text-base text-stone-700 dark:text-gray-200">
					Photos are stored on a saved team. Name this team, then save it. The photo step continues after that.
				</p>
				<label class="mt-4 block text-sm font-medium text-stone-800 dark:text-gray-100" for="save-for-photos-name">
					Team name
				</label>
				<input
					id="save-for-photos-name"
					bind:value={teamNameDraft}
					class="mt-1 w-full min-h-11 rounded-md border border-stone-300 bg-white px-3 text-base text-stone-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
					autocomplete="off"
					disabled={busy}
				/>
			{:else if mode === 'name-new'}
				<p class="mt-2 text-base text-stone-700 dark:text-gray-200">
					The team already saved stays as it is. This builder switches to the new copy.
				</p>
				<label class="mt-4 block text-sm font-medium text-stone-800 dark:text-gray-100" for="save-for-photos-new-name">
					New team name
				</label>
				<input
					id="save-for-photos-new-name"
					bind:value={teamNameDraft}
					class="mt-1 w-full min-h-11 rounded-md border border-stone-300 bg-white px-3 text-base text-stone-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
					autocomplete="off"
					disabled={busy}
				/>
			{:else if mode === 'overwrite'}
				<p class="mt-2 text-base text-stone-700 dark:text-gray-200">
					Quick Save updates the team that is already saved.
					{#if unverified}
						The saved team could not be read. Saving may remove or replace vehicles that are already stored, including cars with photos.
					{:else}
						These vehicles would be removed or replaced:
					{/if}
				</p>
				{#if !unverified}
					<ul class="mt-3 list-disc space-y-1 pl-5 text-base text-stone-800 dark:text-gray-100" data-testid="displaced-vehicles">
						{#each displaced as vehicle (vehicle.id)}
							<li>{displacedVehicleLabel(vehicle)}</li>
						{/each}
					</ul>
					{#if displaced.some((vehicle) => vehicle.hasPhotos)}
						<p class="mt-3 text-sm text-stone-700 dark:text-gray-200">
							Photos stay in My Photos. They will no longer be attached to the saved team.
						</p>
					{/if}
				{/if}
			{:else}
				<p class="mt-2 text-base text-stone-700 dark:text-gray-200">
					This car is only in the builder until you save. Save the team, and the photo step continues on its own.
				</p>
			{/if}

			<div class="mt-5 flex flex-col gap-2">
				{#if mode === 'new-team' || mode === 'name-new'}
					<button
						type="button"
						class="min-h-11 w-full rounded-md px-4 text-base font-medium amber-button disabled:opacity-60"
						data-testid="confirm-save-for-photos"
						disabled={busy || !teamNameDraft.trim()}
						on:click={() => dispatch('save')}
					>
						{busy ? 'Saving...' : 'Save'}
					</button>
				{:else if mode === 'overwrite'}
					<button
						type="button"
						class="min-h-11 w-full rounded-md px-4 text-base font-medium red-button disabled:opacity-60"
						data-testid="save-anyway-for-photos"
						disabled={busy}
						on:click={() => dispatch('saveanyway')}
					>
						{busy ? 'Saving...' : 'Save anyway'}
					</button>
				{:else}
					<button
						type="button"
						class="min-h-11 w-full rounded-md px-4 text-base font-medium amber-button disabled:opacity-60"
						data-testid="quick-save-for-photos"
						disabled={busy}
						on:click={() => dispatch('quicksave')}
					>
						{busy ? 'Saving...' : 'Quick Save'}
					</button>
				{/if}

				{#if mode === 'unsaved' || mode === 'overwrite'}
					<button
						type="button"
						class="min-h-11 w-full rounded-md border border-stone-300 px-4 text-base font-medium text-stone-800 dark:border-gray-500 dark:text-gray-100"
						data-testid="save-as-new-team"
						disabled={busy}
						on:click={() => dispatch('savenew')}
					>
						Save as new team
					</button>
				{/if}

				<button
					type="button"
					class="min-h-11 w-full rounded-md border border-stone-300 px-4 text-base text-stone-700 dark:border-gray-500 dark:text-gray-200"
					data-testid="cancel-photo-save"
					disabled={busy}
					on:click={cancel}
				>
					{mode === 'name-new' ? 'Back' : 'Cancel'}
				</button>
			</div>
		</div>
	</div>
{/if}
