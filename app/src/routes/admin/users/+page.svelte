<script lang="ts">
	import { user } from '$lib/firebase';
	import { accountSessionReady, isAdministrator } from '$lib/admin/session';
	import {
		changeUserRole,
		loadDirectory,
		setUserDisabled,
		type DirectoryTeam,
		type DirectoryUser
	} from '$lib/admin/api';
	import { REGULAR_USER_LABEL, roleChoices, userMatchesSearch } from '$lib/admin/accountActions';
	import AdminAccountSettings from '$lib/components/AdminAccountSettings.svelte';
	import ReadonlyTeam from '$lib/components/ReadonlyTeam.svelte';
	import { projectUserSettings, type AdminAccountSettings as AccountSettings, type AdminProfileView } from '$lib/admin/accountSettings';

	let status: 'loading' | 'signed-out' | 'forbidden' | 'ready' | 'error' = 'loading';
	let loadError = '';
	let actionError = '';
	let query = '';
	let rows: DirectoryUser[] = [];
	let teamsByUser = new Map<string, DirectoryTeam[]>();
	let settingsByUser: Map<string, AccountSettings> | null = null;
	let profilesByUser: Map<string, AdminProfileView> | null = null;
	let selectedUid = '';
	let settingsUid = '';
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
			teamsByUser = directory.teamsByUser;
			settingsByUser = directory.settingsByUser;
			profilesByUser = directory.profilesByUser;
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

	$: visible = rows.filter((row) => userMatchesSearch(row, query));
	$: selected = rows.find((row) => row.uid === selectedUid) ?? null;
	$: selectedTeams = selected ? teamsByUser.get(selected.uid) ?? [] : [];
	$: settingsPerson = rows.find((row) => row.uid === settingsUid) ?? null;
	$: settingsRecord = settingsPerson
		? settingsByUser
			? (settingsByUser.get(settingsPerson.uid) ?? projectUserSettings(undefined))
			: null
		: null;
	$: profileRecord = settingsPerson && profilesByUser ? (profilesByUser.get(settingsPerson.uid) ?? null) : null;

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
</script>

<svelte:head>
	<title>Users - Gaslands Garage</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<section class="max-w-6xl mx-auto py-8 px-2 text-stone-800 dark:text-gray-100">
	<h1 class="text-3xl font-bold mb-2">Users</h1>
	<p class="text-stone-600 dark:text-gray-300 mb-6">
		Administrators can review accounts, change roles, and disable sign-in. Disabled players are signed out and cannot open their saved teams. The teams stay in the garage.
	</p>

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

		<div class="overflow-x-auto rounded-lg border border-stone-200 dark:border-gray-700">
			<table class="min-w-full text-sm" data-testid="admin-users">
				<thead class="bg-stone-100 text-left dark:bg-gray-800">
					<tr>
						<th class="px-3 py-2 font-medium">Email</th>
						<th class="px-3 py-2 font-medium">Display name</th>
						<th class="px-3 py-2 font-medium">Created</th>
						<th class="px-3 py-2 font-medium">Last sign-in</th>
						<th class="px-3 py-2 font-medium">Teams</th>
						<th class="px-3 py-2 font-medium">Role</th>
						<th class="px-3 py-2 font-medium">Status</th>
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
						<tr class="border-t border-stone-200 align-top dark:border-gray-700">
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
										aria-label={`${settingsUid === row.uid ? 'Hide' : 'View'} settings for ${row.email || row.uid}`}
										on:click={() => (settingsUid = settingsUid === row.uid ? '' : row.uid)}
									>
										{settingsUid === row.uid ? 'Hide settings' : 'View settings'}
									</button>
									<button
										type="button"
										class="text-amber-700 underline dark:text-amber-300"
										aria-label={`${selectedUid === row.uid ? 'Hide' : 'View'} teams for ${row.email || row.uid}`}
										on:click={() => (selectedUid = selectedUid === row.uid ? '' : row.uid)}
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
					{/each}
				</tbody>
			</table>
		</div>

		{#if settingsPerson}
			<AdminAccountSettings
				person={settingsPerson}
				settings={settingsRecord}
				profile={profileRecord}
				profileLoaded={profilesByUser !== null}
			/>
		{/if}

		{#if selected}
			<div class="mt-6 space-y-3" aria-label={`Teams for ${selected.email || selected.uid}`}>
				<h2 class="text-xl font-bold">Teams for {selected.email || selected.displayName || selected.uid}</h2>
				{#if selectedTeams.length === 0}
					<p>No saved teams.</p>
				{:else}
					{#each selectedTeams as team (team.id)}
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
		{/if}
	{/if}
</section>

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
