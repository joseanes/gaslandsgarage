<script lang="ts">
	import { accountSessionReady } from '$lib/admin/session';
	import PlayersMap from '$lib/components/PlayersMap.svelte';
	import { signInWithGoogle, user } from '$lib/firebase';
	import type { MapMarker } from '$lib/players/profile';
	import {
		loadMapMarkers,
		loadOpenPlayers,
		loadOwnProfile,
		sendGameContact,
		type OpenPlayer
	} from '$lib/services/playerProfile';

	let status: 'loading' | 'ready' | 'error' = 'loading';
	let markers: MapMarker[] = [];
	let openPlayers: OpenPlayer[] = [];
	let senderName = '';
	let seen: string | null = null;
	let asking = '';
	let draft = '';
	let notice = '';
	let noticeError = false;
	let busy = false;

	const fieldClass =
		'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

	async function load(uid: string) {
		try {
			const nextMarkers = await loadMapMarkers();
			let nextOpen: OpenPlayer[] = [];
			let nextName = '';
			if (uid) {
				const [players, profile] = await Promise.all([loadOpenPlayers(), loadOwnProfile(uid)]);
				nextOpen = players.filter((player) => player.uid !== uid);
				nextName = profile?.playerName ?? '';
			}
			if (($user?.uid ?? '') !== uid) return;
			markers = nextMarkers;
			openPlayers = nextOpen;
			senderName = nextName;
			status = 'ready';
		} catch (error) {
			console.error('Could not load the players map', error);
			if (($user?.uid ?? '') !== uid) return;
			status = 'error';
		}
	}

	$: if ($accountSessionReady) {
		const uid = $user?.uid ?? '';
		if (seen !== uid) {
			seen = uid;
			status = 'loading';
			void load(uid);
		}
	}

	async function send(player: OpenPlayer) {
		if (!$user) return;
		busy = true;
		notice = '';
		noticeError = false;
		const result = await sendGameContact({
			fromUid: $user.uid,
			fromName: senderName,
			toUid: player.uid,
			toName: player.playerName,
			message: draft
		});
		busy = false;
		if (!result.success) {
			notice = result.error;
			noticeError = true;
			return;
		}
		draft = '';
		asking = '';
		notice = `Request sent to ${player.playerName}. They will see it in the app. Your email was not included.`;
	}

	$: named = markers.filter((marker) => !marker.anonymous);
	$: anonymousCount = markers.filter((marker) => marker.anonymous).length;
</script>

<svelte:head>
	<title>Players map - Gaslands Garage</title>
	<meta name="description" content="Approximate map of Gaslands Garage players who chose to appear. Anonymous pins have no name." />
	<meta name="robots" content="noindex" />
	<link rel="canonical" href="https://gaslandsgarage.com/players" />
</svelte:head>

<section class="players-page max-w-6xl mx-auto py-8 px-2 text-stone-800 dark:text-gray-100">
	<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-3xl font-bold mb-2">Players map</h1>
			<p class="max-w-3xl text-stone-600 dark:text-gray-300">
				Only players who opt in are shown. Pins are approximate. Amber pins include a name. Gray pins are anonymous and carry no name.
			</p>
		</div>
		<a href="/profile" class="text-amber-700 underline dark:text-amber-300">Edit your profile</a>
	</div>

	{#if status === 'loading'}
		<p data-testid="players-loading">Loading the map…</p>
	{:else if status === 'error'}
		<p role="alert" data-testid="players-error">The players map is not available yet.</p>
	{:else}
		<PlayersMap {markers} />
		<p class="mt-2 text-sm text-stone-500 dark:text-gray-400">
			Map data &copy; OpenStreetMap contributors, tiles &copy; CARTO. City lookup also uses OpenStreetMap. No API key is shipped with the app.
		</p>

		<div class="mt-6 grid gap-6 lg:grid-cols-2">
			<div>
				<h2 class="text-xl font-bold mb-3">Named players</h2>
				{#if named.length === 0}
					<p class="text-stone-600 dark:text-gray-300" data-testid="named-empty">No named players on the map yet.</p>
				{:else}
					<ul class="space-y-3" data-testid="named-players">
						{#each named as marker (marker.id)}
							<li class="rounded-lg border border-stone-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
								<p class="font-medium">{marker.playerName || 'Player'}</p>
								{#if marker.locationLabel}<p class="text-sm text-stone-600 dark:text-gray-300">{marker.locationLabel}</p>{/if}
								{#if marker.playSpots}<p class="mt-2 whitespace-pre-wrap">{marker.playSpots}</p>{/if}
								{#if marker.bio}<p class="mt-2 whitespace-pre-wrap text-stone-700 dark:text-gray-200">{marker.bio}</p>{/if}
								{#if marker.openToGames}<p class="mt-2 text-sm font-medium text-amber-700 dark:text-amber-300">Open to a game</p>{/if}
							</li>
						{/each}
					</ul>
				{/if}
				<p class="mt-3 text-sm text-stone-600 dark:text-gray-300" data-testid="anonymous-count">
					{anonymousCount === 1
						? '1 anonymous player is on the map with no name.'
						: `${anonymousCount} anonymous players are on the map with no name.`}
				</p>
			</div>

			<div>
				<h2 class="text-xl font-bold mb-3">Open to games</h2>
				{#if !$user}
					<div class="rounded-lg border border-stone-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800" data-testid="open-signed-out">
						<p>Sign in to see players who want a game and to contact them. Email addresses are not shown.</p>
						<button type="button" class="amber-button mt-4 rounded-lg px-4" on:click={() => signInWithGoogle()}>
							Sign in with Google
						</button>
					</div>
				{:else if openPlayers.length === 0}
					<p class="text-stone-600 dark:text-gray-300" data-testid="open-empty">No other players are open to games right now.</p>
				{:else}
					<ul class="space-y-3" data-testid="open-players">
						{#each openPlayers as player (player.uid)}
							<li class="rounded-lg border border-stone-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
								<p class="font-medium">{player.playerName}</p>
								{#if player.playSpots}<p class="mt-2 whitespace-pre-wrap">{player.playSpots}</p>{/if}
								{#if player.bio}<p class="mt-2 whitespace-pre-wrap text-stone-700 dark:text-gray-200">{player.bio}</p>{/if}
								{#if asking === player.uid}
									<label class="mt-3 block text-sm font-medium" for={"ask-" + player.uid}>Note</label>
									<textarea
										id={"ask-" + player.uid}
										class="{fieldClass} mt-1 min-h-20"
										maxlength="500"
										placeholder="When and where you want to play"
										bind:value={draft}
									></textarea>
									<div class="mt-2 flex gap-3">
										<button type="button" class="amber-button rounded-lg px-3" disabled={busy} on:click={() => send(player)}>
											Send request
										</button>
										<button type="button" class="text-stone-600 underline dark:text-gray-300" on:click={() => (asking = '')}>Cancel</button>
									</div>
								{:else}
									<button
										type="button"
										class="mt-3 text-amber-700 underline dark:text-amber-300"
										on:click={() => {
											asking = player.uid;
											draft = '';
											notice = '';
										}}
									>
										Ask about a game
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
				{#if notice}
					<p role="status" class="mt-3 {noticeError ? 'text-red-700 dark:text-red-300' : 'text-stone-700 dark:text-gray-200'}" data-testid="contact-notice">
						{notice}
					</p>
				{/if}
				{#if $user && !senderName}
					<p class="mt-3 text-sm text-stone-600 dark:text-gray-300">
						<a href="/profile" class="text-amber-700 underline dark:text-amber-300">Add a player name</a>
						before you send a request. The other player sees that name, not your email.
					</p>
				{/if}
			</div>
		</div>
	{/if}
</section>
