<script lang="ts">
	import { tick } from 'svelte';
	import { user } from '$lib/firebase';
	import { accountSessionReady, isAdministrator } from '$lib/admin/session';
	import {
		changeUserRole,
		loadDirectory,
		loadUserAccount,
		loadUserTeams,
		setUserDisabled,
		type DirectoryTeam,
		type DirectoryUser
	} from '$lib/admin/api';
	import { REGULAR_USER_LABEL, roleChoices, userMatchesSearch } from '$lib/admin/accountActions';
	import AdminAccountSettings from '$lib/components/AdminAccountSettings.svelte';
	import ReadonlyTeam from '$lib/components/ReadonlyTeam.svelte';
	import { type AdminAccountSettings as AccountSettings, type AdminProfileView } from '$lib/admin/accountSettings';
	import {
		DEFAULT_USER_SORT,
		nextUserSort,
		sortDirectoryUsers,
		type SortDirection,
		type UserSortKey
	} from '$lib/admin/userSort';

	let status: 'loading' | 'signed-out' | 'forbidden' | 'ready' | 'error' = 'loading';
	let loadError = '';
	let actionError = '';
	let query = '';
	let sortKey: UserSortKey = DEFAULT_USER_SORT.key;
	let sortDirection: SortDirection = DEFAULT_USER_SORT.direction;
	let rows: DirectoryUser[] = [];
	let selectedUid = '';
	let settingsUid = '';
	let settingsPanelEl: HTMLElement | null = null;
	let teamsPanelEl: HTMLElement | null = null;
	let settingsDetailStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
	let settingsDetailError = '';
	let settingsDetail: AccountSettings | null = null;
	let settingsProfile: AdminProfileView | null = null;
	let settingsProfileLoaded = false;
	let settingsRequest = 0;
	let teamsDetailStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
	let teamsDetailError = '';
	let teamsDetail: DirectoryTeam[] = [];
	let teamsRequest = 0;
	let busy = false;
	let loadedFor = '';

	let roleTarget: DirectoryUser | null = null;
	let roleChoice = REGULAR_USER_LABEL;
	let disableTarget: DirectoryUser | null = null;
	let disableConfirm = '';
	let enableTarget: DirectoryUser | null = null;

	function formatWhen(value: string): string {
		if (!value) return '—';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	function roleLabel(role: string | null): string {
		return role || REGULAR_USER_LABEL;
	}

	function sameAccount(target: DirectoryUser | null, users: DirectoryUser[]): DirectoryUser | null {
		if (!target) return null;
		return users.find((row) => row.uid === target.uid) ?? target;
	}

	async function refresh(uid: string) {
		loadError = '';
		try {
			const directory = await loadDirectory();
			if ($user?.uid !== uid) return;
			const previousRole = roleTarget ? roleLabel(roleTarget.role) : '';
			rows = directory.users;
			roleTarget = sameAccount(roleTarget, rows);
			if (roleTarget && roleChoice === previousRole) roleChoice = roleLabel(roleTarget.role);
			disableTarget = sameAccount(disableTarget, rows);
			enableTarget = sameAccount(enableTarget, rows);
			status = 'ready';
		} catch (error) {
			console.error('Could not load users', error);
			if ($user?.uid !== uid) return;
			loadError = error instanceof Error ? error.message : 'Could not load users';
			status = 'error';
		}
	}

	$: if (!$accountSessionReady) {
		status = 'loading';
	} else if (!$user) {
		status = 'signed-out';
		loadedFor = '';
	} else if (!$isAdministrator) {
		status = 'forbidden';
		loadedFor = '';
	} else if (loadedFor !== $user.uid) {
		loadedFor = $user.uid;
		void refresh($user.uid);
	}

	$: visible = sortDirectoryUsers(
		rows.filter((row) => userMatchesSearch(row, query)),
		{ key: sortKey, direction: sortDirection }
	);

	function toggleSort(key: UserSortKey) {
		const next = nextUserSort({ key: sortKey, direction: sortDirection }, key);
		sortKey = next.key;
		sortDirection = next.direction;
	}

	function ariaSort(key: UserSortKey): 'ascending' | 'descending' | 'none' {
		if (sortKey !== key) return 'none';
		return sortDirection === 'asc' ? 'ascending' : 'descending';
	}

	function detailMessage(error: unknown, fallback: string): string {
		return error instanceof Error && error.message ? error.message : fallback;
	}

	function revealDetail(rowEl: HTMLElement | null, panelEl: HTMLElement | null) {
		if (!panelEl) return;
		panelEl.focus({ preventScroll: true });
		const scroller = rowEl?.closest('[data-testid="admin-users-scroll"]');
		if (scroller instanceof HTMLElement) scroller.scrollLeft = 0;
		if (!rowEl) return;
		const panel = panelEl.getBoundingClientRect();
		const row = rowEl.getBoundingClientRect();
		const panelTopVisible = panel.top >= 0 && panel.top < window.innerHeight - 40 && panel.left >= 0 && panel.left < window.innerWidth;
		const rowVisible = row.top >= 0 && row.bottom <= window.innerHeight;
		if (!panelTopVisible || !rowVisible) {
			rowEl.scrollIntoView({ block: 'start', inline: 'nearest' });
		}
	}

	async function toggleSettings(row: DirectoryUser, event: MouseEvent) {
		const trigger = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
		if (settingsUid === row.uid) {
			settingsUid = '';
			settingsDetailStatus = 'idle';
			await tick();
			trigger?.focus();
			return;
		}
		const request = ++settingsRequest;
		settingsUid = row.uid;
		settingsDetail = null;
		settingsProfile = null;
		settingsProfileLoaded = false;
		settingsDetailError = '';
		settingsDetailStatus = 'loading';
		const rowEl = trigger?.closest('tr') ?? null;
		await tick();
		revealDetail(rowEl, settingsPanelEl);
		try {
			const view = await loadUserAccount(row.uid);
			if (request !== settingsRequest || settingsUid !== row.uid) return;
			settingsDetail = view.settings;
			settingsProfile = view.profile;
			settingsProfileLoaded = view.profileLoaded;
			settingsDetailStatus = 'ready';
		} catch (error) {
			if (request !== settingsRequest || settingsUid !== row.uid) return;
			settingsDetail = null;
			settingsDetailStatus = 'error';
			settingsDetailError = detailMessage(error, 'Account settings could not be loaded.');
		}
		await tick();
		revealDetail(rowEl, settingsPanelEl);
	}

	async function toggleTeams(row: DirectoryUser, event: MouseEvent) {
		const trigger = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
		if (selectedUid === row.uid) {
			selectedUid = '';
			teamsDetailStatus = 'idle';
			await tick();
			trigger?.focus();
			return;
		}
		const request = ++teamsRequest;
		selectedUid = row.uid;
		teamsDetail = [];
		teamsDetailError = '';
		teamsDetailStatus = 'loading';
		const rowEl = trigger?.closest('tr') ?? null;
		await tick();
		revealDetail(rowEl, teamsPanelEl);
		try {
			const teams = await loadUserTeams(row.uid);
			if (request !== teamsRequest || selectedUid !== row.uid) return;
			teamsDetail = teams;
			teamsDetailStatus = 'ready';
		} catch (error) {
			if (request !== teamsRequest || selectedUid !== row.uid) return;
			teamsDetail = [];
			teamsDetailStatus = 'error';
			teamsDetailError = detailMessage(error, 'Teams could not be loaded.');
		}
		await tick();
		revealDetail(rowEl, teamsPanelEl);
	}

	function openRole(row: DirectoryUser) {
		actionError = '';
		roleTarget = row;
		roleChoice = roleLabel(row.role);
	}

	function openDisable(row: DirectoryUser) {
		actionError = '';
		disableTarget = row;
		disableConfirm = '';
	}

	async function confirmRole() {
		if (!roleTarget || !$user) return;
		busy = true;
		actionError = '';
		const next = roleChoice === REGULAR_USER_LABEL ? null : roleChoice;
		const result = await changeUserRole($user.uid, roleTarget.uid, next);
		busy = false;
		if (!result.success) {
			actionError = result.error;
			return;
		}
		roleTarget = null;
		await refresh($user.uid);
	}

	async function confirmDisable() {
		if (!disableTarget || !$user) return;
		busy = true;
		actionError = '';
		const result = await setUserDisabled($user.uid, disableTarget.uid, true);
		busy = false;
		if (!result.success) {
			actionError = result.error;
			return;
		}
		disableTarget = null;
		await refresh($user.uid);
	}

	async function confirmEnable() {
		if (!enableTarget || !$user) return;
		busy = true;
		actionError = '';
		const result = await setUserDisabled($user.uid, enableTarget.uid, false);
		busy = false;
		if (!result.success) {
			actionError = result.error;
			return;
		}
		enableTarget = null;
		await refresh($user.uid);
	}

	function confirmationText(row: DirectoryUser): string {
		return row.email || row.uid;
	}

	const sortColumns: { key: UserSortKey; label: string }[] = [
		{ key: 'email', label: 'Email' },
		{ key: 'displayName', label: 'Display name' },
		{ key: 'created', label: 'Created' },
		{ key: 'lastSignIn', label: 'Last sign-in' },
		{ key: 'teams', label: 'Teams' },
		{ key: 'role', label: 'Role' },
		{ key: 'status', label: 'Status' }
	];
</script>

<svelte:head>
	<title>Users - Gaslands Garage</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<section class="max-w-6xl mx-auto py-8 px-2 text-stone-800 dark:text-gray-100">
	<h1 class="text-3xl font-bold mb-2">Users</h1>
	<p class="text-stone-600 dark:text-gray-300 mb-2">
		Administrators can review accounts, change roles, and disable sign-in. Disabled players are signed out and cannot open their saved teams. The teams stay in the garage.
	</p>
	<p class="mb-6"><a class="text-amber-800 underline dark:text-amber-300" href="/admin/gallery" data-testid="photo-reports-link">Photo reports</a></p>

	{#if status === 'loading'}
		<p data-testid="admin-loading">Loading…</p>
	{:else if status === 'signed-out'}
		<p data-testid="admin-signed-out">Sign in to manage users.</p>
	{:else if status === 'forbidden'}
		<p data-testid="admin-forbidden">You need the Administrator role to manage users.</p>
	{:else if status === 'error'}
		<p role="alert" data-testid="admin-error">{loadError || 'Could not load users.'}</p>
	{:else}
		<label for="user-search" class="block text-sm font-medium mb-1">Search users</label>
		<input
			id="user-search"
			class="mb-4 w-full max-w-md rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
			placeholder="Email or display name"
			bind:value={query}
			data-testid="user-search"
		/>

		{#if actionError && !roleTarget && !disableTarget && !enableTarget}
			<p role="alert" class="mb-4 text-red-700 dark:text-red-300">{actionError}</p>
		{/if}

		<div class="user-table-scroll overflow-x-auto rounded-lg border border-stone-200 dark:border-gray-700" data-testid="admin-users-scroll">
			<table class="min-w-full text-sm" data-testid="admin-users">
				<thead class="bg-stone-100 text-left dark:bg-gray-800">
					<tr>
						{#each sortColumns as column (column.key)}
							<th class="px-3 py-2 font-medium" aria-sort={ariaSort(column.key)}>
								<button
									type="button"
									class="inline-flex items-center gap-1 text-left font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
									data-testid={`sort-${column.key}`}
									on:click={() => toggleSort(column.key)}
								>
									{column.label}
									{#if sortKey === column.key}
										<span aria-hidden="true">{sortDirection === 'asc' ? '▲' : '▼'}</span>
									{/if}
								</button>
							</th>
						{/each}
						<th class="px-3 py-2 font-medium">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#if visible.length === 0}
						<tr>
							<td colspan="8" class="px-3 py-4 text-stone-600 dark:text-gray-300">No users match that search.</td>
						</tr>
					{/if}
					{#each visible as row (row.uid)}
						<tr class="border-t border-stone-200 align-top dark:border-gray-700" data-testid="admin-user-row">
							<td class="px-3 py-3">
								<div>{row.email || 'No email'}</div>
								<div class="text-xs text-stone-500">{row.uid}</div>
							</td>
							<td class="px-3 py-3">{row.displayName || '—'}</td>
							<td class="px-3 py-3">{formatWhen(row.createdAt)}</td>
							<td class="px-3 py-3">{formatWhen(row.lastSignInAt)}</td>
							<td class="px-3 py-3">{row.teamCount}</td>
							<td class="px-3 py-3">{roleLabel(row.role)}</td>
							<td class="px-3 py-3">
								{#if row.disabled}
									<span class="font-medium">Disabled</span>
									{#if row.disabledAt}<div class="text-xs text-stone-500">{formatWhen(row.disabledAt)}</div>{/if}
								{:else}
									Active
								{/if}
							</td>
							<td class="px-3 py-3">
								<div class="flex flex-col items-start gap-2">
									<button
										type="button"
										class="text-amber-700 underline dark:text-amber-300"
										aria-expanded={settingsUid === row.uid}
										aria-controls={`user-settings-${row.uid}`}
										aria-label={`${settingsUid === row.uid ? 'Hide' : 'View'} settings for ${row.email || row.uid}`}
										on:click={(event) => toggleSettings(row, event)}
									>
										{settingsUid === row.uid ? 'Hide settings' : 'View settings'}
									</button>
									<button
										type="button"
										class="text-amber-700 underline dark:text-amber-300"
										aria-expanded={selectedUid === row.uid}
										aria-controls={`user-teams-${row.uid}`}
										aria-label={`${selectedUid === row.uid ? 'Hide' : 'View'} teams for ${row.email || row.uid}`}
										on:click={(event) => toggleTeams(row, event)}
									>
										{selectedUid === row.uid ? 'Hide teams' : 'View teams'}
									</button>
									{#if row.uid === $user?.uid}
										<p class="text-xs text-stone-500">Your {roleLabel(row.role)} role stays on this account.</p>
										<p class="text-xs text-stone-500">This account stays active.</p>
									{:else}
										<button
											type="button"
											class="text-amber-700 underline dark:text-amber-300"
											aria-label={`Change role for ${row.email || row.uid}`}
											on:click={() => openRole(row)}
										>
											Change role
										</button>
										{#if row.disabled}
											<button
												type="button"
												class="text-amber-700 underline dark:text-amber-300"
												aria-label={`Re-enable ${row.email || row.uid}`}
												on:click={() => (enableTarget = row)}
											>
												Re-enable
											</button>
										{:else}
											<button
												type="button"
												class="text-amber-700 underline dark:text-amber-300"
												aria-label={`Disable ${row.email || row.uid}`}
												on:click={() => openDisable(row)}
											>
												Disable
											</button>
										{/if}
									{/if}
								</div>
							</td>
						</tr>
						{#if settingsUid === row.uid}
							<tr class="border-t border-stone-200 bg-stone-50 dark:border-gray-700 dark:bg-gray-900" data-testid="admin-settings-row">
								<td colspan="8" class="p-0">
									<div
										id={`user-settings-${row.uid}`}
										class="user-detail p-3 outline-none"
										tabindex="-1"
										bind:this={settingsPanelEl}
										data-testid="admin-settings-panel"
									>
										<AdminAccountSettings
											person={row}
											settings={settingsDetail}
											profile={settingsProfile}
											profileLoaded={settingsProfileLoaded}
											loading={settingsDetailStatus === 'loading'}
											loadError={settingsDetailStatus === 'error' ? settingsDetailError : ''}
										/>
									</div>
								</td>
							</tr>
						{/if}
						{#if selectedUid === row.uid}
							<tr class="border-t border-stone-200 bg-stone-50 dark:border-gray-700 dark:bg-gray-900" data-testid="admin-teams-row">
								<td colspan="8" class="p-0">
									<div
										id={`user-teams-${row.uid}`}
										class="user-detail space-y-3 p-3 outline-none"
										tabindex="-1"
										bind:this={teamsPanelEl}
										data-testid="admin-teams-panel"
										aria-label={`Teams for ${row.email || row.uid}`}
									>
										<h2 class="text-xl font-bold">Teams for {row.email || row.displayName || row.uid}</h2>
										{#if teamsDetailStatus === 'loading'}
											<p data-testid="teams-loading">Loading teams</p>
										{:else if teamsDetailStatus === 'error'}
											<p role="alert" data-testid="teams-error">{teamsDetailError || 'Teams could not be loaded.'}</p>
										{:else if teamsDetail.length === 0}
											<p data-testid="teams-empty">No saved teams</p>
										{:else}
											{#each teamsDetail as team (team.id)}
												<ReadonlyTeam
													teamName={team.teamName}
													sponsorId={team.sponsorId}
													rulesVersion={team.rulesVersion}
													maxCans={team.maxCans}
													vehicles={team.vehicles}
												/>
											{/each}
										{/if}
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<style>
	.user-table-scroll {
		container-type: inline-size;
	}

	.user-detail {
		position: sticky;
		left: 0;
		box-sizing: border-box;
		width: 100cqw;
		max-width: 100%;
	}
</style>

{#if roleTarget}
	<div class="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 sm:items-center">
		<div role="dialog" aria-modal="true" aria-label="Change role" class="w-full max-w-md rounded-xl border-2 border-amber-500 bg-white p-6 text-stone-800 shadow-xl">
			<h2 class="mb-2 text-lg font-bold">Change role</h2>
			<p class="mb-4">
				Change {roleTarget.email || roleTarget.uid} from {roleLabel(roleTarget.role)} to {roleChoice === REGULAR_USER_LABEL ? REGULAR_USER_LABEL : roleChoice}?
			</p>
			<label for="role-choice" class="mb-1 block text-sm font-medium">Role</label>
			<select id="role-choice" class="mb-4 w-full rounded-lg border border-stone-300 px-3 py-2" bind:value={roleChoice}>
				{#each roleChoices(roleTarget.role) as choice}
					<option value={choice}>{choice}</option>
				{/each}
			</select>
			{#if actionError}<p role="alert" class="mb-3 text-red-700">{actionError}</p>{/if}
			<div class="flex justify-end gap-2">
				<button type="button" class="rounded-lg border border-stone-300 px-4 py-2" on:click={() => (roleTarget = null)} disabled={busy}>Cancel</button>
				<button
					type="button"
					class="rounded-lg bg-amber-500 px-4 py-2 font-medium text-white disabled:opacity-50"
					on:click={confirmRole}
					disabled={busy || roleChoice === roleLabel(roleTarget.role)}
				>
					Change role
				</button>
			</div>
		</div>
	</div>
{/if}

{#if disableTarget}
	<div class="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 sm:items-center">
		<div role="dialog" aria-modal="true" aria-label="Disable account" class="w-full max-w-md rounded-xl border-2 border-amber-500 bg-white p-6 text-stone-800 shadow-xl">
			<h2 class="mb-2 text-lg font-bold">Disable account</h2>
			<p class="mb-4">
				Disable <strong>{confirmationText(disableTarget)}</strong>? They are signed out of Gaslands Garage and cannot open their teams until an administrator re-enables the account.
			</p>
			<label for="disable-confirm" class="mb-1 block text-sm font-medium">Type {confirmationText(disableTarget)} to confirm</label>
			<input
				id="disable-confirm"
				class="mb-4 w-full rounded-lg border border-stone-300 px-3 py-2"
				bind:value={disableConfirm}
				autocomplete="off"
			/>
			{#if actionError}<p role="alert" class="mb-3 text-red-700">{actionError}</p>{/if}
			<div class="flex justify-end gap-2">
				<button type="button" class="rounded-lg border border-stone-300 px-4 py-2" on:click={() => (disableTarget = null)} disabled={busy}>Cancel</button>
				<button
					type="button"
					class="rounded-lg bg-amber-500 px-4 py-2 font-medium text-white disabled:opacity-50"
					on:click={confirmDisable}
					disabled={busy || disableConfirm !== confirmationText(disableTarget)}
				>
					Disable account
				</button>
			</div>
		</div>
	</div>
{/if}

{#if enableTarget}
	<div class="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 sm:items-center">
		<div role="dialog" aria-modal="true" aria-label="Re-enable account" class="w-full max-w-md rounded-xl border-2 border-amber-500 bg-white p-6 text-stone-800 shadow-xl">
			<h2 class="mb-2 text-lg font-bold">Re-enable account</h2>
			<p class="mb-4">Re-enable <strong>{confirmationText(enableTarget)}</strong>? They can sign in and open their teams again.</p>
			{#if actionError}<p role="alert" class="mb-3 text-red-700">{actionError}</p>{/if}
			<div class="flex justify-end gap-2">
				<button type="button" class="rounded-lg border border-stone-300 px-4 py-2" on:click={() => (enableTarget = null)} disabled={busy}>Cancel</button>
				<button type="button" class="rounded-lg bg-amber-500 px-4 py-2 font-medium text-white disabled:opacity-50" on:click={confirmEnable} disabled={busy}>
					Re-enable account
				</button>
			</div>
		</div>
	</div>
{/if}
