<script lang="ts">
	import { accountSessionReady } from '$lib/admin/session';
	import { signInWithGoogle, user } from '$lib/firebase';
	import LocationField from '$lib/components/LocationField.svelte';
	import MonthlyEmailChoice from '$lib/components/MonthlyEmailChoice.svelte';
	import { hundredthsToDegrees } from '$lib/players/location';
	import { ANONYMOUS_ON_MAP_LABEL, LOCATION_HELP, SHOW_ON_MAP_LABEL } from '$lib/players/mapCopy';
	import { emptyForm, type PlayerForm, type StoredProfile } from '$lib/players/profile';
	import {
		loadContacts,
		loadOwnProfile,
		markContactRead,
		replyToContact,
		saveOwnProfile,
		type GameContact
	} from '$lib/services/playerProfile';

	let status: 'loading' | 'signed-out' | 'ready' | 'error' = 'loading';
	let form: PlayerForm = emptyForm();
	let stored: StoredProfile | null = null;
	let contacts: GameContact[] = [];
	let replies: Record<string, string> = {};
	let notice = '';
	let noticeError = false;
	let busy = false;
	let loadedFor = '';

	const fieldClass =
		'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

	function formFrom(profile: StoredProfile | null): PlayerForm {
		if (!profile) return emptyForm();
		return {
			playerName: profile.playerName,
			bio: profile.bio,
			locationLabel: profile.locationLabel,
			playSpots: profile.playSpots,
			showOnMap: profile.showOnMap,
			anonymousOnMap: profile.anonymousOnMap,
			openToGames: profile.openToGames
		};
	}

	function formatWhen(value: string): string {
		if (!value) return '';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	async function load(uid: string) {
		notice = '';
		try {
			stored = await loadOwnProfile(uid);
			form = formFrom(stored);
			contacts = await loadContacts(uid);
			status = 'ready';
		} catch (error) {
			console.error('Could not load player profile', error);
			status = 'error';
		}
	}

	$: if (!$accountSessionReady) {
		status = 'loading';
	} else if (!$user) {
		status = 'signed-out';
		loadedFor = '';
		stored = null;
		form = emptyForm();
		contacts = [];
	} else if (loadedFor !== $user.uid) {
		loadedFor = $user.uid;
		void load($user.uid);
	}

	function onMapToggle() {
		if (!form.showOnMap) form.anonymousOnMap = false;
	}

	async function save() {
		if (!$user) return;
		busy = true;
		notice = '';
		noticeError = false;
		const result = await saveOwnProfile($user.uid, form, stored);
		busy = false;
		if (!result.success) {
			notice = result.error;
			noticeError = true;
			return;
		}
		stored = result.profile;
		form = formFrom(result.profile);
		notice = 'Profile saved.';
	}

	async function sendReply(contact: GameContact) {
		const text = (replies[contact.id] ?? '').trim();
		busy = true;
		notice = '';
		const result = await replyToContact(contact.id, text);
		busy = false;
		if (!result.success) {
			notice = result.error;
			noticeError = true;
			return;
		}
		replies = { ...replies, [contact.id]: '' };
		if ($user) await load($user.uid);
		notice = 'Reply sent.';
		noticeError = false;
	}

	async function markRead(contact: GameContact) {
		const result = await markContactRead(contact.id);
		if (!result.success) {
			notice = result.error;
			noticeError = true;
			return;
		}
		if ($user) await load($user.uid);
	}

	$: pin =
		stored && stored.latE2 != null && stored.lngE2 != null
			? hundredthsToDegrees(stored.latE2, stored.lngE2)
			: null;
	$: inbox = contacts.filter((contact) => contact.incoming);
	$: sent = contacts.filter((contact) => !contact.incoming);
</script>

<svelte:head>
	<title>Player profile - Gaslands Garage</title>
	<meta name="description" content="Optional player profile for Gaslands Garage. Location is approximate, and contact never shares your email." />
	<meta name="robots" content="noindex" />
	<link rel="canonical" href="https://gaslandsgarage.com/profile" />
</svelte:head>

<section class="player-profile max-w-3xl mx-auto py-8 px-2 text-stone-800 dark:text-gray-100">
	<h1 class="text-3xl font-bold mb-2">Player profile</h1>
	<p class="text-stone-600 dark:text-gray-300 mb-6">
		Everything here is optional. It stays private until you opt in to the map or to game requests.
		<a href="/players" class="text-amber-700 underline dark:text-amber-300">View the players map</a>.
		<a href="/buddies" class="text-amber-700 underline dark:text-amber-300">Gaming Buddies</a>
		can open a copy of teams you have not hidden.
	</p>

	{#if $user}
		<MonthlyEmailChoice />
	{/if}

	{#if status === 'loading'}
		<p data-testid="profile-loading">Loading…</p>
	{:else if status === 'signed-out'}
		<div class="rounded-lg border border-stone-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800" data-testid="profile-signed-out">
			<p class="font-medium">Sign in to add a player profile.</p>
			<p class="mt-2 text-stone-600 dark:text-gray-300">Your email stays on your account. It is not shown on the map or in game requests.</p>
			<button type="button" class="amber-button mt-4 rounded-lg px-4" on:click={() => signInWithGoogle()}>
				Sign in with Google
			</button>
		</div>
	{:else if status === 'error'}
		<p role="alert" data-testid="profile-error">Could not load your profile.</p>
	{:else}
		<form class="space-y-5" data-testid="profile-form" on:submit|preventDefault={save}>
			<div>
				<label for="player-name" class="mb-1 block text-sm font-medium">Player name</label>
				<input id="player-name" class={fieldClass} maxlength="60" bind:value={form.playerName} data-testid="profile-player-name" autocomplete="nickname" />
			</div>

			<div>
				<label for="player-bio" class="mb-1 block text-sm font-medium">Bio</label>
				<textarea id="player-bio" class="{fieldClass} min-h-24" maxlength="280" bind:value={form.bio} data-testid="profile-bio"></textarea>
			</div>

			<div>
				<LocationField bind:value={form.locationLabel} inputClass={fieldClass} />
				<p class="mt-1 text-sm text-stone-600 dark:text-gray-300">{LOCATION_HELP}</p>
				{#if pin}
					<p class="mt-1 text-sm text-stone-500" data-testid="profile-pin">
						Approximate pin on file: {pin.lat.toFixed(2)}, {pin.lng.toFixed(2)}
					</p>
				{/if}
			</div>

			<div>
				<label for="player-spots" class="mb-1 block text-sm font-medium">Where you like to play</label>
				<textarea
					id="player-spots"
					class="{fieldClass} min-h-20"
					maxlength="280"
					placeholder="Stores, clubs, conventions, or at home"
					bind:value={form.playSpots}
					data-testid="profile-spots"
				></textarea>
			</div>

			<fieldset class="rounded-lg border border-stone-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
				<legend class="px-1 font-medium">Players map</legend>
				<label class="mt-2 flex items-start gap-2">
					<input type="checkbox" bind:checked={form.showOnMap} on:change={onMapToggle} data-testid="profile-show-on-map" />
					<span>{SHOW_ON_MAP_LABEL}</span>
				</label>
				<label class="mt-3 flex items-start gap-2">
					<input type="checkbox" bind:checked={form.anonymousOnMap} disabled={!form.showOnMap} data-testid="profile-anonymous" />
					<span>{ANONYMOUS_ON_MAP_LABEL}</span>
				</label>
			</fieldset>

			<fieldset class="rounded-lg border border-stone-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
				<legend class="px-1 font-medium">Open to games</legend>
				<label class="mt-2 flex items-start gap-2">
					<input type="checkbox" bind:checked={form.openToGames} data-testid="profile-open-to-games" />
					<span>Let other signed-in players send me a game request in the app. This is separate from the map, and your email is never shared.</span>
				</label>
			</fieldset>

			<div class="flex flex-wrap items-center gap-3">
				<button type="submit" class="amber-button rounded-lg px-4" disabled={busy} data-testid="profile-save">
					{busy ? 'Saving…' : 'Save profile'}
				</button>
				{#if notice}
					<p role="status" class={noticeError ? 'text-red-700 dark:text-red-300' : 'text-stone-700 dark:text-gray-200'} data-testid="profile-notice">
						{notice}
					</p>
				{/if}
			</div>
		</form>

		<h2 class="mt-10 text-xl font-bold">Game requests</h2>
		<p class="mt-1 text-sm text-stone-600 dark:text-gray-300">Requests other players sent you. Their email is not included.</p>
		{#if inbox.length === 0}
			<p class="mt-3 text-stone-600 dark:text-gray-300" data-testid="profile-inbox-empty">No game requests yet.</p>
		{:else}
			<ul class="mt-3 space-y-3" data-testid="profile-inbox">
				{#each inbox as contact (contact.id)}
					<li class="rounded-lg border border-stone-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
						<p class="font-medium">{contact.fromName}</p>
						<p class="text-sm text-stone-500">{formatWhen(contact.createdAt)}{contact.read ? '' : ' · New'}</p>
						<p class="mt-2 whitespace-pre-wrap">{contact.message}</p>
						{#if contact.reply}
							<p class="mt-2 whitespace-pre-wrap text-stone-700 dark:text-gray-200">Your reply: {contact.reply}</p>
						{:else}
							<label class="mt-3 block text-sm font-medium" for={"reply-" + contact.id}>Reply</label>
							<textarea id={"reply-" + contact.id} class="{fieldClass} mt-1 min-h-20" maxlength="500" bind:value={replies[contact.id]}></textarea>
							<div class="mt-2 flex gap-3">
								<button type="button" class="amber-button rounded-lg px-3" disabled={busy} on:click={() => sendReply(contact)}>Send reply</button>
								{#if !contact.read}
									<button type="button" class="text-amber-700 underline dark:text-amber-300" on:click={() => markRead(contact)}>Mark read</button>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if sent.length > 0}
			<h2 class="mt-8 text-xl font-bold">Sent</h2>
			<ul class="mt-3 space-y-3" data-testid="profile-sent">
				{#each sent as contact (contact.id)}
					<li class="rounded-lg border border-stone-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
						<p class="font-medium">To {contact.toName}</p>
						<p class="mt-2 whitespace-pre-wrap">{contact.message}</p>
						{#if contact.reply}
							<p class="mt-2 whitespace-pre-wrap">Reply: {contact.reply}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>
