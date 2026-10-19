<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { accountSessionReady } from '$lib/admin/session';
	import { signInWithGoogle, user } from '$lib/firebase';
	import { SHOW_BUDDY_HIDE_TOGGLE } from '$lib/features/buddyHide';
	import { getUserTeams, setTeamHiddenFromBuddies } from '$lib/services/team';
	import {
		buddyErrorMessage,
		cancelBuddyRequest,
		loadBuddyBlocks,
		loadBuddyLinks,
		acceptBuddyEmailInvite,
		loadBuddyProfile,
		loadBuddyRequests,
		removeBuddy,
		respondBuddyRequest,
		saveBuddyProfile,
		searchBuddyPlayers,
		sendBuddyEmailInvite,
		sendBuddyRequest,
		unblockBuddy,
		type BuddyBlock,
		type BuddyLink,
		type BuddyRequest,
		type SearchResult
	} from '$lib/services/buddies';

	type OwnTeam = { id: string; teamName: string; hiddenFromBuddies: boolean };

	let status: 'loading' | 'signed-out' | 'ready' | 'error' = 'loading';
	let notice = '';
	let noticeError = false;
	let busy = false;
	let loadedFor = '';
	let code = '';
	let displayName = '';
	let discoverable = false;
	let emailInvites = false;
	let inviteEmail = '';
	let inviteMessage = '';
	let searchText = '';
	let results: SearchResult[] = [];
	let buddies: BuddyLink[] = [];
	let incoming: BuddyRequest[] = [];
	let outgoing: BuddyRequest[] = [];
	let blocks: BuddyBlock[] = [];
	let teams: OwnTeam[] = [];

	const fieldClass =
		'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';
	const primaryClass =
		'amber-button inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 disabled:opacity-60';
	const quietClass =
		'inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700';

	$: inviteFromLink = ($page.url.searchParams.get('invite') ?? '').trim();
	$: emailInviteToken = ($page.url.searchParams.get('emailInvite') ?? '').trim();
	$: inviteLink = code && typeof window !== 'undefined' ? `${window.location.origin}/buddies?invite=${code}` : '';

	function say(message: string, isError = false) {
		notice = message;
		noticeError = isError;
	}

	function transient(error: unknown): boolean {
		const text = buddyErrorMessage(error).toLowerCase();
		return text.includes('not available') || text.includes('failed to fetch') || text.includes('internal');
	}

	async function load() {
		const profile = await loadBuddyProfile();
		code = profile.code;
		displayName = profile.displayName;
		discoverable = profile.discoverable;
		emailInvites = profile.emailInvites === true;
		const [links, requests, blocked, own] = await Promise.all([
			loadBuddyLinks(),
			loadBuddyRequests(),
			loadBuddyBlocks(),
			getUserTeams()
		]);
		buddies = links;
		incoming = requests.incoming;
		outgoing = requests.outgoing;
		blocks = blocked;
		teams =
			own.success && own.teams
				? own.teams.map((team) => ({
						id: String(team.id),
						teamName: String(team.teamName ?? 'Untitled team'),
						hiddenFromBuddies: team.hiddenFromBuddies === true
					}))
				: [];
		status = 'ready';
	}

	async function loadWithRetry() {
		let last: unknown;
		for (let attempt = 0; attempt < 4; attempt += 1) {
			try {
				await load();
				return;
			} catch (error) {
				last = error;
				if (!transient(error) || attempt === 3) break;
				await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
			}
		}
		console.error('Could not load gaming buddies', last);
		status = 'error';
		say(buddyErrorMessage(last), true);
	}

	$: if (!$accountSessionReady) {
		status = 'loading';
	} else if (!$user) {
		status = 'signed-out';
		loadedFor = '';
	} else if (loadedFor !== $user.uid) {
		loadedFor = $user.uid;
		status = 'loading';
		void loadWithRetry();
	}

	async function run(action: () => Promise<void>, success: string) {
		busy = true;
		notice = '';
		try {
			await action();
			await load();
			say(success);
		} catch (error) {
			say(buddyErrorMessage(error), true);
		} finally {
			busy = false;
		}
	}

	function saveProfile() {
		void run(
			() => saveBuddyProfile({ displayName, discoverable }).then((saved) => {
				displayName = saved.displayName;
				discoverable = saved.discoverable;
			}),
			discoverable ? 'Other players can find this name.' : 'Your buddy name was saved.'
		);
	}

	async function search() {
		busy = true;
		notice = '';
		noticeError = false;
		try {
			results = await searchBuddyPlayers(searchText);
			if (results.length === 0) say('No findable player matched that name.');
		} catch (error) {
			say(buddyErrorMessage(error), true);
		} finally {
			busy = false;
		}
	}

	async function copyLink() {
		if (!inviteLink) return;
		try {
			await navigator.clipboard.writeText(inviteLink);
			say('Invite link copied.');
		} catch {
			say('Select the invite link and copy it.');
		}
	}

	function sendEmailInvite() {
		void run(async () => {
			await sendBuddyEmailInvite(inviteEmail, inviteMessage);
			inviteEmail = '';
			inviteMessage = '';
		}, 'If that address can receive an invite, we sent one.');
	}

	function acceptEmailInvite() {
		if (!emailInviteToken) return;
		void run(async () => {
			await acceptBuddyEmailInvite(emailInviteToken);
			await goto('/buddies', { replaceState: true, keepFocus: true });
		}, 'You are gaming buddies.');
	}

	function sendInvite() {
		if (!inviteFromLink) return;
		void run(async () => {
			await sendBuddyRequest({ code: inviteFromLink });
			await goto('/buddies', { replaceState: true, keepFocus: true });
		}, 'Request sent. They can accept it from Gaming Buddies.');
	}

	function relationshipLabel(value: string): string {
		if (value === 'buddy') return 'Already buddies';
		if (value === 'outgoing') return 'Request sent';
		if (value === 'incoming') return 'They sent you a request';
		if (value === 'blocked') return 'Blocked';
		return '';
	}
</script>

<svelte:head>
	<title>Gaming Buddies - Gaslands Garage</title>
	<meta name="description" content="Add a gaming buddy, view their teams, and save a copy to your own account." />
	<meta name="robots" content="noindex" />
	<link rel="canonical" href="https://gaslandsgarage.com/buddies" />
</svelte:head>

<section class="mx-auto max-w-3xl px-2 py-8 text-stone-800 dark:text-gray-100" data-testid="buddies-page">
	<h1 class="mb-2 text-3xl font-bold">Gaming Buddies</h1>
	<p class="mb-6 text-stone-600 dark:text-gray-300">
		A buddy can open a read-only copy of the teams you have not hidden. If they save it, that copy lives on
		their account and does not change yours. Both of you have to agree, and either of you can remove the
		buddy. Email addresses are not shown.
	</p>

	{#if status === 'loading'}
		<p data-testid="buddies-loading">Loading…</p>
	{:else if status === 'signed-out'}
		<div class="rounded-lg border border-stone-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800" data-testid="buddies-signed-out">
			<p class="font-medium">Sign in to add gaming buddies.</p>
			<p class="mt-2 text-stone-600 dark:text-gray-300">Buddy requests use your display name, not your email.</p>
			{#if emailInviteToken}
				<p class="mt-3 text-sm" data-testid="buddy-email-accept">
					Sign in with the email address that received this invite. Nothing is accepted until you confirm.
				</p>
			{/if}
			<button type="button" class="{primaryClass} mt-4" on:click={() => signInWithGoogle()}>Sign in with Google</button>
		</div>
	{:else if status === 'error'}
		<p role="alert" data-testid="buddies-error">{notice || 'Could not load Gaming Buddies.'}</p>
		<button type="button" class="{quietClass} mt-4" on:click={() => loadWithRetry()}>Try again</button>
	{:else}
		{#if notice}
			<p class="mb-4 rounded-lg border px-3 py-2 {noticeError ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100' : 'border-amber-300 bg-amber-50 text-stone-800 dark:border-amber-700 dark:bg-gray-800 dark:text-gray-100'}" role={noticeError ? 'alert' : 'status'} data-testid="buddies-notice">
				{notice}
			</p>
		{/if}

		{#if inviteFromLink}
			<div class="mb-6 rounded-lg border border-amber-400 bg-amber-50 p-4 dark:border-amber-700 dark:bg-gray-800" data-testid="buddy-invite-prompt">
				<h2 class="text-lg font-bold">Invite</h2>
				<p class="mt-1 text-sm text-stone-700 dark:text-gray-200">Send a buddy request with this invite. Nothing is sent until you confirm.</p>
				<button type="button" class="{primaryClass} mt-3" disabled={busy} on:click={sendInvite} data-testid="buddy-send-invite">Send buddy request</button>
			</div>
		{/if}

		{#if emailInviteToken}
			<div class="mb-6 rounded-lg border border-amber-400 bg-amber-50 p-4 dark:border-amber-700 dark:bg-gray-800" data-testid="buddy-email-accept">
				<h2 class="text-lg font-bold">Email invite</h2>
				<p class="mt-1 text-sm text-stone-700 dark:text-gray-200">
					Accepting makes you gaming buddies with the person who sent this. Nothing changes until you confirm. Use the
					email address that received the invite.
				</p>
				<button type="button" class="{primaryClass} mt-3" disabled={busy} on:click={acceptEmailInvite}>Accept buddy invite</button>
			</div>
		{/if}

		<div class="space-y-8">
			<section class="rounded-lg border border-stone-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800" aria-labelledby="buddy-invite-heading">
				<h2 id="buddy-invite-heading" class="text-xl font-bold">Your invite link</h2>
				<p class="mt-1 text-sm text-stone-600 dark:text-gray-300">Anyone with this link can ask to be your buddy. It does not include your email.</p>
				<label class="mt-3 block text-sm font-medium" for="buddy-invite-link">Invite link</label>
				<input id="buddy-invite-link" class="{fieldClass} mt-1" readonly value={inviteLink} data-testid="buddy-invite-link" />
				<p class="mt-2 text-sm text-stone-600 dark:text-gray-300">Code <span class="font-mono" data-testid="buddy-invite-code">{code}</span></p>
				<button type="button" class="{quietClass} mt-3" on:click={copyLink}>Copy invite link</button>
				{#if emailInvites}
					<form class="mt-6 space-y-3 border-t border-stone-200 pt-4 dark:border-gray-600" data-testid="buddy-email-form" on:submit|preventDefault={sendEmailInvite}>
						<h3 class="text-lg font-bold">Invite by email</h3>
						<p class="text-sm text-stone-600 dark:text-gray-300">
							We send one plain message. We do not keep the address, and we do not say whether an account exists.
						</p>
						<div>
							<label for="buddy-email" class="mb-1 block text-sm font-medium">Email address</label>
							<input
								id="buddy-email"
								class={fieldClass}
								type="email"
								maxlength="320"
								autocomplete="off"
								required
								bind:value={inviteEmail}
								data-testid="buddy-email"
							/>
						</div>
						<div>
							<label for="buddy-email-message" class="mb-1 block text-sm font-medium">Message, optional</label>
							<textarea
								id="buddy-email-message"
								class={fieldClass}
								maxlength="280"
								rows="3"
								bind:value={inviteMessage}
								data-testid="buddy-email-message"
							></textarea>
						</div>
						<button type="submit" class={primaryClass} disabled={busy} data-testid="buddy-email-send">Send email invite</button>
					</form>
				{:else}
					<p class="mt-4 text-sm text-stone-600 dark:text-gray-300" data-testid="buddy-email-soon">
						Email invites are coming soon. Share the link above until then.
					</p>
				{/if}
			</section>

			<section class="rounded-lg border border-stone-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800" aria-labelledby="buddy-name-heading">
				<h2 id="buddy-name-heading" class="text-xl font-bold">Name buddies see</h2>
				<form class="mt-3 space-y-3" on:submit|preventDefault={saveProfile}>
					<div>
						<label for="buddy-display-name" class="mb-1 block text-sm font-medium">Display name</label>
						<input id="buddy-display-name" class={fieldClass} maxlength="60" bind:value={displayName} autocomplete="nickname" data-testid="buddy-display-name" />
					</div>
					<label class="flex items-start gap-2 text-sm">
						<input type="checkbox" class="mt-1" bind:checked={discoverable} data-testid="buddy-discoverable" />
						<span>Let other players find me by this name. Your email stays hidden.</span>
					</label>
					<button type="submit" class={primaryClass} disabled={busy} data-testid="buddy-save-profile">Save</button>
				</form>
			</section>

			<section class="rounded-lg border border-stone-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800" aria-labelledby="buddy-search-heading">
				<h2 id="buddy-search-heading" class="text-xl font-bold">Find a player</h2>
				<form class="mt-3 flex flex-col gap-2 sm:flex-row" on:submit|preventDefault={search}>
					<div class="min-w-0 flex-1">
						<label for="buddy-search" class="mb-1 block text-sm font-medium">Search by display name</label>
						<input id="buddy-search" class={fieldClass} maxlength="40" bind:value={searchText} data-testid="buddy-search" />
					</div>
					<button type="submit" class="{primaryClass} sm:self-end" disabled={busy}>Search</button>
				</form>
				{#if results.length > 0}
					<ul class="mt-4 space-y-2" data-testid="buddy-search-results">
						{#each results as result (result.uid)}
							<li class="flex flex-col gap-2 rounded-lg border border-stone-200 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-600">
								<span class="font-medium">{result.displayName}</span>
								{#if relationshipLabel(result.relationship)}
									<span class="text-sm text-stone-600 dark:text-gray-300">{relationshipLabel(result.relationship)}</span>
								{:else}
									<button type="button" class={primaryClass} disabled={busy} on:click={() => run(() => sendBuddyRequest({ targetUid: result.uid }), 'Request sent.')}>
										Send request
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section aria-labelledby="buddy-incoming-heading">
				<h2 id="buddy-incoming-heading" class="text-xl font-bold">Incoming requests</h2>
				{#if incoming.length === 0}
					<p class="mt-2 text-sm text-stone-600 dark:text-gray-300">No pending requests.</p>
				{:else}
					<ul class="mt-3 space-y-2" data-testid="buddy-incoming">
						{#each incoming as request (request.id)}
							<li class="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700 dark:bg-gray-800">
								<span><span class="font-medium">{request.fromName}</span> wants to be buddies</span>
								<div class="flex flex-wrap gap-2">
									<button type="button" class={primaryClass} disabled={busy} data-testid="buddy-accept" on:click={() => run(() => respondBuddyRequest(request.id, 'accept'), 'You are now gaming buddies.')}>Accept</button>
									<button type="button" class={quietClass} disabled={busy} data-testid="buddy-decline" on:click={() => run(() => respondBuddyRequest(request.id, 'decline'), 'Request declined.')}>Decline</button>
									<button type="button" class={quietClass} disabled={busy} data-testid="buddy-block" on:click={() => run(() => respondBuddyRequest(request.id, 'block'), 'Request blocked.')}>Block</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section aria-labelledby="buddy-outgoing-heading">
				<h2 id="buddy-outgoing-heading" class="text-xl font-bold">Sent requests</h2>
				{#if outgoing.length === 0}
					<p class="mt-2 text-sm text-stone-600 dark:text-gray-300">No requests waiting on someone else.</p>
				{:else}
					<ul class="mt-3 space-y-2" data-testid="buddy-outgoing">
						{#each outgoing as request (request.id)}
							<li class="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700 dark:bg-gray-800">
								<span>Waiting on <span class="font-medium">{request.toName}</span></span>
								<button type="button" class={quietClass} disabled={busy} on:click={() => run(() => cancelBuddyRequest(request.id), 'Request cancelled.')}>Cancel</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section aria-labelledby="buddy-list-heading">
				<h2 id="buddy-list-heading" class="text-xl font-bold">Buddies</h2>
				{#if buddies.length === 0}
					<p class="mt-2 text-sm text-stone-600 dark:text-gray-300">No buddies yet.</p>
				{:else}
					<ul class="mt-3 space-y-2" data-testid="buddy-list">
						{#each buddies as buddy (buddy.uid)}
							<li class="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700 dark:bg-gray-800">
								<span class="font-medium">{buddy.displayName}</span>
								<div class="flex flex-wrap gap-2">
									<a class={primaryClass} href="/buddies/{buddy.uid}" data-testid="buddy-view">View teams</a>
									<button
										type="button"
										class={quietClass}
										disabled={busy}
										data-testid="buddy-remove"
										on:click={() => {
											if (!confirm(`Remove ${buddy.displayName}? They will lose access to your teams.`)) return;
											void run(() => removeBuddy(buddy.uid), 'Buddy removed.');
										}}
									>
										Remove
									</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if blocks.length > 0}
				<section aria-labelledby="buddy-blocked-heading">
					<h2 id="buddy-blocked-heading" class="text-xl font-bold">Blocked</h2>
					<ul class="mt-3 space-y-2">
						{#each blocks as block (block.id)}
							<li class="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700 dark:bg-gray-800">
								<span>Blocked player</span>
								<button type="button" class={quietClass} disabled={busy} on:click={() => run(() => unblockBuddy(block.blockedUid), 'Player unblocked.')}>Unblock</button>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<section aria-labelledby="buddy-teams-heading">
				<h2 id="buddy-teams-heading" class="text-xl font-bold">Your teams</h2>
				{#if SHOW_BUDDY_HIDE_TOGGLE}
					<p class="mt-1 text-sm text-stone-600 dark:text-gray-300">Hidden teams stay on your account. Buddies cannot open them.</p>
				{/if}
				{#if teams.length === 0}
					<p class="mt-2 text-sm text-stone-600 dark:text-gray-300">You have not saved a team yet.</p>
				{:else}
					<ul class="mt-3 space-y-2">
						{#each teams as team (team.id)}
							<li class="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700 dark:bg-gray-800">
								<span class="font-medium">{team.teamName}</span>
								{#if SHOW_BUDDY_HIDE_TOGGLE}
									<button
										type="button"
										class={quietClass}
										aria-pressed={team.hiddenFromBuddies}
										aria-label="{team.hiddenFromBuddies ? 'Show' : 'Hide'} {team.teamName} from buddies"
										data-testid="team-hide-from-buddies"
										disabled={busy}
										on:click={() =>
											run(async () => {
												const result = await setTeamHiddenFromBuddies(team.id, !team.hiddenFromBuddies);
												if (!result.success) throw new Error('Could not update that team.');
											}, team.hiddenFromBuddies ? 'Team is visible to buddies.' : 'Team hidden from buddies.')}
									>
										{team.hiddenFromBuddies ? 'Hidden from buddies' : 'Hide from buddies'}
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>
	{/if}
</section>
