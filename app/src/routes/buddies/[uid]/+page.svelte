<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { accountSessionReady } from '$lib/admin/session';
	import { signInWithGoogle, user } from '$lib/firebase';
	import ReadonlyTeam from '$lib/components/ReadonlyTeam.svelte';
	import type { ViewVehicle } from '$lib/admin/teamView';
	import {
		buddyErrorMessage,
		loadAcceptedBuddy,
		loadBuddyTeams,
		stageBuddyTeamCopy,
		type BuddyTeam
	} from '$lib/services/buddies';

	let status: 'loading' | 'signed-out' | 'ready' | 'denied' | 'error' = 'loading';
	let buddyName = 'Gaming buddy';
	let teams: BuddyTeam[] = [];
	let notice = '';
	let loadedKey = '';

	const primaryClass =
		'amber-button inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 disabled:opacity-60';

	function denied(error: unknown): boolean {
		const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
		return code.includes('permission-denied');
	}

	function vehiclesOf(team: BuddyTeam): ViewVehicle[] {
		const raw = team.teamData.vehicles;
		if (!Array.isArray(raw)) return [];
		return raw.flatMap((item) => {
			if (!item || typeof item !== 'object') return [];
			const vehicle = item as Record<string, unknown>;
			const list = (value: unknown) => (Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []);
			return [
				{
					id: typeof vehicle.id === 'string' ? vehicle.id : 'vehicle',
					type: typeof vehicle.type === 'string' ? vehicle.type : 'car',
					name: typeof vehicle.name === 'string' ? vehicle.name : 'Vehicle',
					weapons: list(vehicle.weapons),
					upgrades: list(vehicle.upgrades),
					perks: list(vehicle.perks),
					driverName: typeof vehicle.driverName === 'string' ? vehicle.driverName : undefined
				}
			];
		});
	}

	function sponsorOf(team: BuddyTeam): string {
		const sponsor = team.teamData.sponsor ?? team.teamData.sponsorId;
		return typeof sponsor === 'string' ? sponsor : '';
	}

	function versionOf(team: BuddyTeam): 2 | 3 | null {
		return team.teamData.rulesVersion === 3 ? 3 : team.teamData.rulesVersion === 2 ? 2 : null;
	}

	function cansOf(team: BuddyTeam): number | null {
		return typeof team.teamData.maxCans === 'number' ? team.teamData.maxCans : null;
	}

	async function load(otherUid: string) {
		notice = '';
		try {
			const buddy = await loadAcceptedBuddy(otherUid);
			if (!buddy) {
				status = 'denied';
				teams = [];
				return;
			}
			buddyName = buddy.displayName;
			teams = await loadBuddyTeams(otherUid);
			status = 'ready';
		} catch (error) {
			if (denied(error)) {
				status = 'denied';
				teams = [];
				return;
			}
			console.error('Could not load buddy teams', error);
			status = 'error';
			notice = buddyErrorMessage(error);
		}
	}

	async function loadCopy(team: BuddyTeam) {
		notice = '';
		try {
			await stageBuddyTeamCopy(team, buddyName);
			await goto('/builder');
		} catch (error) {
			notice = error instanceof Error ? error.message : 'Could not open that copy.';
		}
	}

	$: otherUid = $page.params.uid ?? '';
	$: if (!$accountSessionReady) {
		status = 'loading';
	} else if (!$user) {
		status = 'signed-out';
		loadedKey = '';
	} else if (loadedKey !== `${$user.uid}:${otherUid}`) {
		loadedKey = `${$user.uid}:${otherUid}`;
		status = 'loading';
		void load(otherUid);
	}
</script>

<svelte:head>
	<title>{buddyName} teams - Gaslands Garage</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<section class="mx-auto max-w-3xl px-2 py-8 text-stone-800 dark:text-gray-100" data-testid="buddy-teams-page">
	<p class="mb-3"><a class="text-amber-800 underline dark:text-amber-300" href="/buddies">Back to Gaming Buddies</a></p>
	<h1 class="mb-2 text-3xl font-bold">{buddyName}</h1>
	<p class="mb-6 text-stone-600 dark:text-gray-300">
		These teams are read-only. Load a copy in the builder, then save it to your own account. Saving does not
		change {buddyName}'s team.
	</p>

	{#if notice}
		<p role="alert" class="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100">{notice}</p>
	{/if}

	{#if status === 'loading'}
		<p>Loading…</p>
	{:else if status === 'signed-out'}
		<div class="rounded-lg border border-stone-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
			<p class="font-medium">Sign in to view a buddy's teams.</p>
			<button type="button" class="{primaryClass} mt-4" on:click={() => signInWithGoogle()}>Sign in with Google</button>
		</div>
	{:else if status === 'denied'}
		<p data-testid="buddy-access-ended">You can no longer view this player's teams.</p>
	{:else if status === 'error'}
		<p role="alert">Could not load these teams.</p>
	{:else if teams.length === 0}
		<p data-testid="buddy-no-teams">No teams are visible to buddies.</p>
	{:else}
		<ul class="space-y-4" data-testid="buddy-team-list">
			{#each teams as team (team.id)}
				<li class="space-y-3" data-testid="buddy-team">
					<ReadonlyTeam
						teamName={team.teamName}
						sponsorId={sponsorOf(team)}
						rulesVersion={versionOf(team)}
						maxCans={cansOf(team)}
						vehicles={vehiclesOf(team)}
					/>
					<button type="button" class={primaryClass} data-testid="buddy-load-copy" on:click={() => loadCopy(team)}>
						Load a copy in the builder
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
