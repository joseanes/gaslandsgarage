<script lang="ts">
	const linkClass = 'text-amber-600 dark:text-amber-400 hover:underline';
</script>

<svelte:head>
	<title>Privacy Policy - Gaslands Garage</title>
	<meta
		name="description"
		content="Privacy Policy for Gaslands Garage: Google sign-in, saved teams, the players map, game requests, and what is public."
	/>
	<link rel="canonical" href="https://gaslandsgarage.com/privacy" />
</svelte:head>

<article class="max-w-3xl mx-auto py-8 px-2 text-stone-800 dark:text-gray-100">
	<h1 class="text-3xl font-bold mb-2">Privacy Policy</h1>
	<p class="text-stone-600 dark:text-gray-300 mb-6">Last updated: October 18, 2026</p>

	<div class="space-y-4">
		<p>
			Gaslands Garage at gaslandsgarage.com is a free fan-made team builder operated by José Anés. This
			page describes information the site actually collects and stores. You can also read the
			<a class={linkClass} href="/terms">Terms and Conditions</a>.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Signing in</h2>
		<p>
			You can build a team without an account. Saving a team, saving a player profile, sending a game
			request, and using Contact Us require a sign-in.
		</p>
		<p>
			The sign-in button uses Google, through Firebase Authentication. We receive that Google account’s
			user id, email address, and display name. We do not receive your Google password. The public site
			does not offer a separate email-and-password account.
		</p>
		<p>
			Firebase keeps the sign-in session in this browser until you sign out. Signing out of Gaslands
			Garage does not delete your Google account.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Account record</h2>
		<p>
			When you sign in, the site writes an account record with your user id, email, display name, the
			time the record was created, the time you were last seen, and the time you last signed in. A daily
			job refreshes the email, display name, and last sign-in time for accounts in Firebase
			Authentication, including accounts that have not opened the site lately. That job is how an
			administrator can see those accounts. It does not publish email addresses. The public usage page
			receives totals only.
		</p>
		<p>
			Your settings are stored separately and are readable only by you. They include builder and print
			preferences, whether you asked to be kept up to date, and whether you allow other players to
			contact you about a game. Both of those choices are off until you turn them on. The “Keep me up to
			date” choice is saved. The site does not send marketing or feature-update email from it.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Teams and vehicles</h2>
		<p>
			A saved team is stored under your user id. It includes the team name and the build: vehicles,
			weapons, upgrades, perks, sponsor, and the other choices you made in the builder. You can open and
			delete your own teams. Other players cannot read them. An administrator can view them.
		</p>
		<p>
			A share link or QR code puts the build in the link itself. Anyone you give that link to can open
			that build. The link is not an account, and it does not include your email.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Player profile and approximate location</h2>
		<p>
			A player profile is optional. The private profile can store a player name, a short bio, a place
			label, where you like to play, whether you appear on the map, whether that pin is anonymous,
			whether you are open to a game, an approximate coordinate, and a random pin id. The pin id is not
			your account id. The profile does not store an email address.
		</p>
		<p>
			The place label has to be a city and region, or a 5-digit US ZIP. Street addresses and ZIP+4 codes
			are rejected. Text that contains an @ sign is rejected, so an email address cannot be saved in the
			name, bio, place, or play-spot fields.
		</p>
		<p>
			If you enter a city or region, the browser asks OpenStreetMap Nominatim for a coordinate once,
			when you save a new place. A 5-digit US ZIP is looked up in a list shipped with the site and is
			not sent to Nominatim. The coordinate that is stored is moved 2 to 8 kilometers in a random
			direction and rounded to about one kilometer. The original point is not kept. Only that
			approximate point can appear on the map.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">What is public, and what needs a sign-in</h2>
		<p>The players map can be opened without an account. It shows pins people chose to publish.</p>
		<ul class="list-disc pl-6 space-y-2">
			<li>An anonymous pin is an approximate point and nothing else. No name is shown.</li>
			<li>
				A named pin can show the player name, bio, play spots, the place label, whether that player is
				open to a game, and the approximate point. It does not include an email address or an account
				id.
			</li>
		</ul>
		<p>
			The open-to-games list is not on the public map. Only a signed-in player whose account is not
			disabled can read it. Each card shows a player name, bio, and where that person likes to play. It
			does not include an email address or a coordinate.
		</p>
		<p>
			Your private profile, your settings, and your saved teams stay limited to you, plus an
			administrator as described below. Turning the map off removes your public pin. Turning open to
			games off removes that card.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Game requests and email</h2>
		<p>
			A game request is a note between two signed-in players. It stores the two account ids, the two
			player names, the note, when it was sent, whether it has been read, and any reply. It does not
			store an email address. Only the two players, and an administrator, can read it. The other player
			sees the name on your profile, not your email.
		</p>
		<p>
			Being listed as open to games lets another signed-in player send that in-app note. It does not
			allow email.
		</p>
		<p>
			Email is a separate setting, “Allow other players to contact me to setup a game.” It is off unless
			you turn it on. If it is on, and someone creates a new game request to you, a server function
			reads the email on your Firebase Authentication account and queues one message to that address.
			The address is written only on that queued mail document. It is not copied onto the request, your
			profile, or your settings. The message text does not include your email. The other player still
			cannot see it.
		</p>
		<p>
			No mail is queued if you have not allowed contact, if the account is disabled, if the account has
			no email, or if the request is only being edited or replied to. A second queue for the same
			request is ignored.
		</p>
		<p>
			The queued document includes an expiry time 30 days after it is written. A Firestore time-to-live
			policy on that field is what deletes it. When the policy is on, deletion usually finishes within
			about a day after the expiry time, not at the exact minute. The website cannot read the mail
			queue. The queue is the document the Firebase Trigger Email extension uses. Installing that
			extension is separate from publishing the website. Until the extension is in place, the queue
			document is stored and the message is not sent.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Messages to us</h2>
		<p>
			Contact Us, in the Help menu, requires a sign-in. It saves your user id, the email on your sign-in
			account, the subject, and the message, so we can reply. An administrator can read those messages.
			The form does not let you edit or delete one later, and that collection has no automatic deletion
			date. Email us if you want a message removed.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Usage stats</h2>
		<p>
			The public usage page shows aggregate counts only: accounts, saved teams, vehicles, teams by rules
			version, teams by sponsor, and teams created in the last 30 days. That document does not include
			user ids, email addresses, team names, or vehicle lists. Anyone can read it.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Analytics, ads, and cookies</h2>
		<p>
			Each page loads Google Analytics, measurement id G-EKPMXMY097. Google Analytics uses cookies and
			collects usage data such as pages visited, a client id, and browser details. The site does not
			show a cookie banner. We do not sell personal information.
		</p>
		<p>
			The site does not display advertisements, and it does not load an ad unit. A file named ads.txt is
			published and names a Google AdSense publisher id. That file does not place an ad on the page.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Map tiles</h2>
		<p>
			The players map uses Leaflet. The map pictures are CARTO’s Voyager tiles from
			basemaps.cartocdn.com, based on OpenStreetMap data. Your browser requests those tiles directly
			from CARTO, so CARTO receives the request, including an IP address. We do not send your email or
			account id with that request. Tile copyright stays with OpenStreetMap contributors and CARTO.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Data stored in this browser</h2>
		<p>
			Besides the Google Analytics cookies above, the site stores preferences on your device. These are
			not cookies.
		</p>
		<p>localStorage can hold:</p>
		<ul class="list-disc pl-6 space-y-2">
			<li>dark mode</li>
			<li>print options, including which descriptions to include</li>
			<li>whether you have said you own the rules</li>
			<li>sponsorship and advanced-rules switches</li>
			<li>a temporary copy of a team while you move between pages</li>
		</ul>
		<p>sessionStorage, which lasts for the tab, can hold:</p>
		<ul class="list-disc pl-6 space-y-2">
			<li>the team you are editing</li>
			<li>which team-menu action to run after a page change</li>
			<li>
				a copy of the players map and the open-to-games list, reused for five minutes and cleared when
				you save your profile in the same tab
			</li>
		</ul>
		<p>Signing out does not clear those keys. Clearing site data in the browser does.</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Administrators</h2>
		<p>
			An administrator can list accounts, search by email or display name, view saved teams, and assign
			a role. An administrator can disable another account. Disabling signs that person out, marks the
			Firebase Authentication user disabled, and blocks access to their teams and profile. It does not
			delete the account, the teams, or the profile. An administrator cannot disable their own account
			from the page. The app does not delete accounts.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">How long we keep information</h2>
		<p>
			Saved teams stay until you delete them or you ask us to delete them. You can delete a saved team
			from My Teams. Settings and the private player profile stay until you change them or you ask us to
			delete them. Turning the map off removes the public pin. Turning open to games off removes that
			card.
		</p>
		<p>
			The account record is not deleted when you sign out, and it is not deleted when an account is
			disabled. There is no delete-account button.
		</p>
		<p>
			Game requests stay until we delete them on request. The profile page does not include a delete
			button for a request. Contact Us messages have no automatic expiry.
		</p>
		<p>
			Queued game-request mail is marked to expire 30 days after it is written. Public usage totals are
			replaced when the daily job runs. They are counts, not a copy of your teams.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Asking us to delete information</h2>
		<p>
			Email <a class={linkClass} href="mailto:jose.anes@gmail.com">jose.anes@gmail.com</a>, or use Contact
			Us while signed in, and say what you want removed. We can delete the Gaslands Garage records we
			hold for that account, including the account record, teams, profile, settings, game requests, and
			messages to us. Disabling an account is not the same as deleting it. We cannot delete the Google
			account itself.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Children</h2>
		<p>
			The site is not directed at children under 13, and we do not knowingly collect personal
			information from a child under 13. The site does not ask for a date of birth. If you believe a
			child under 13 has an account, email us and we will delete the Gaslands Garage data we hold for
			it.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">California residents</h2>
		<p>
			We do not sell personal information, and we do not share it for cross-context behavioral
			advertising. There is no “Do Not Sell” switch because we do not sell it.
		</p>
		<p>
			You can ask what account data we hold, ask us to correct it, or ask us to delete it. Email
			<a class={linkClass} href="mailto:jose.anes@gmail.com">jose.anes@gmail.com</a>. We may need to
			confirm that you control the Google account. The app does not have a separate download button.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Security</h2>
		<p>
			The site is served over HTTPS. Database access starts from a deny-all rule. Teams, settings, and
			the private profile are limited to the signed-in owner, with the administrator access described
			above. The public map and the public usage totals are readable without an account. The mail queue
			is not readable from the website. No storage method is perfect.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Changes</h2>
		<p>
			If this policy changes, the date at the top of this page will change. We do not email a notice of
			that change. The site does not run a mailing list.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Contact</h2>
		<p>
			José Anés<br />
			<a class={linkClass} href="mailto:jose.anes@gmail.com">jose.anes@gmail.com</a>
		</p>
		<p>
			You can also open Contact Us from the Help menu. That form requires a sign-in.
			<a class={linkClass} href="/terms">Terms and Conditions</a>.
		</p>
	</div>
</article>
