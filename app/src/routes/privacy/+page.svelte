<script lang="ts">
	import { PHOTO_PRIVACY_SHORT } from '$lib/photos/model';
	import { GALLERY_SHARE_COPY, SHARE_BUDDIES_LABEL, SHARE_GALLERY_LABEL, SHARE_LINK_LABEL, SHARE_STATS_LABEL, STATS_SHARE_COPY } from '$lib/photos/share';
	const linkClass = 'text-amber-600 dark:text-amber-400 hover:underline';
</script>

<svelte:head>
	<title>Privacy Policy - Gaslands Garage</title>
	<meta
		name="description"
		content="Privacy Policy for Gaslands Garage: Google sign-in, saved teams, car photos, the players map, game requests, and what is public."
	/>
	<link rel="canonical" href="https://gaslandsgarage.com/privacy" />
</svelte:head>

<article class="max-w-3xl mx-auto py-8 px-2 text-stone-800 dark:text-gray-100">
	<h1 class="text-3xl font-bold mb-2">Privacy Policy</h1>
	<p class="text-stone-600 dark:text-gray-300 mb-6">Last updated: October 19, 2026</p>

	<div class="space-y-4">
		<p>
			Gaslands Garage at gaslandsgarage.com is a free fan-made team builder operated by Anes & Rincon LLC. This
			page describes information the site actually collects and stores. You can also read the
			<a class={linkClass} href="/terms">Terms and Conditions</a>.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Signing in</h2>
		<p>
			You can build a team without an account. Saving a team, saving a player profile, adding a photo of
			a car, sending a game request, adding a gaming buddy, and using Contact Us require a sign-in.
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
			Your settings are stored separately. They include builder and print preferences. You can read and
			change them. An administrator can view that document and cannot change it. Email choices stay off
			until you turn them on:
		</p>
		<ul class="list-disc pl-6 space-y-2">
			<li>
				“Allow other players to contact me to setup a game” is a separate choice. It is the only
				setting that allows a game-request email. Being open to games does not turn it on.
			</li>
			<li>
				The monthly Gaslands Garage email stays off until you opt in. It is about once a month and
				covers game tips, car suggestions, and new site features. Unsubscribe from the link in that
				email, turn it off in settings, or subscribe and unsubscribe on your player profile.
			</li>
		</ul>

		<h2 class="text-xl font-bold mt-8 mb-3">Teams and vehicles</h2>
		<p>
			A saved team is stored under your user id. It includes the team name and the build: vehicles,
			weapons, upgrades, perks, sponsor, and the other choices you made in the builder. You can open and
			delete your own teams. Other players cannot read them unless you have both accepted a gaming buddy
			link and you have not hidden the team. An administrator can view them.
		</p>
		<p>
			A share link or QR code puts the build in the link itself. Anyone you give that link to can open
			that build. The link is not an account, and it does not include your email. A photo appears on
			that link only when you turn on "Show on my team share link" for that photo.
		</p>

		<h2 id="photos" class="text-xl font-bold mt-8 mb-3">Photos of your cars</h2>
		<p>{PHOTO_PRIVACY_SHORT}</p>
		<p>We never use them for advertising, and we never use them to train models.</p>
		<p>
			A photo is optional. It belongs to your account. My Photos, under Settings, opens the Gallery
			with your photos selected and lists every photo you have added. You can attach one photo to cars
			on teams you saved. The file is stored in
			Firebase Storage, in this site's project, under your user id. A small note (the time, the size,
			and a caption if you add one) is stored in the database, also under your user id. The picture is
			resized in your browser before it is uploaded, which removes camera location data from the file
			we store.
		</p>
		<p>
			Sharing is off until you turn it on for that photo. Adding a photo asks the same four choices:
			"{SHARE_BUDDIES_LABEL}", "{SHARE_LINK_LABEL}", "{SHARE_GALLERY_LABEL}", and "{SHARE_STATS_LABEL}".
			All four start off, and you can change them later. "Show to my Gaming Buddies"
			lets a buddy who can already see that team see the photo. "Show on my team share link" shows it to
			anyone who opens that link. "{SHARE_GALLERY_LABEL}" puts it on the Gallery page, which is under
			Players and Events. Other players who open the Gallery only see photos published there that are
			not hidden. A private photo is visible only to the player who added it. {GALLERY_SHARE_COPY}
			"{SHARE_STATS_LABEL}" {STATS_SHARE_COPY} The snapshot is
			copied from the saved team, updated when that vehicle changes, and removed from the Gallery when
			you turn stats sharing off. The Gallery shows the display name you chose in Gaslands Garage, the
			vehicle type, the caption, and those stats only when you shared them. It does not show your Google
			name, your email, or your account id.
		</p>
		<p>
			A shared photo is a separate copy. Unsharing, deleting the photo, or deleting your account
			removes that copy. Removing a car or a team takes the photo off that car and out of that car's
			share. The photo stays in My Photos until you delete the photo or your account. Photos are still
			never used outside Gaslands Garage. Print with photos puts your own photos on a sheet in your
			browser.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Gaming buddies</h2>
		<p>
			Gaming buddies are optional and mutual. You send a request with an invite link or by searching a
			display name. The other person accepts or declines. Either of you can remove the buddy, which ends
			access immediately. You can block a request. A buddy can read teams you have not hidden and open
			them as a copy. If they save, the copy is stored on their account under their user id. It does not
			change your team.
		</p>
		<p>
			A buddy request stores the two account ids, the display names, the status, and the time. It does
			not store an email address. The invite code is random. Search only includes players who opted in,
			and it returns a display name, not an email. You can turn search off. Disabled accounts cannot use
			buddy access.
		</p>
		<p>
			If you type someone's email address to invite them, we send one plain message through Twilio Email.
			We use that address only to send the invite and to honor a request not to be emailed again. We do
			not keep the address. We keep a salted hash of it so the same address is not invited again for 7
			days, and so an opt-out stays in effect. The message has no marketing. The accept link expires
			after 14 days and works once, and it works only after the recipient signs in with that verified
			address. The link that says not to email invites again works without an account. Opening that
			link does not change anything until the person confirms. Deleting an account does not remove
			that opt-out.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Location, Nominatim, and the approximate point</h2>
		<p>
			A player profile is optional. The private profile can store a player name, a short bio, a place
			label, where you like to play, an optional website (a YouTube channel or a blog, for example),
			whether you appear on the map, whether that pin is anonymous,
			whether you are open to a game, an approximate coordinate, and a random pin id. The website is
			not shown on the map. The pin id is not
			your account id. The profile does not store an email address.
		</p>
		<p>
			The place you enter has to be a city and region, or a 5-digit US ZIP. Street addresses and ZIP+4
			codes are rejected. Text that contains an @ sign is rejected, so an email address cannot be saved
			in the name, bio, place, or play-spot fields. A website has to be a full http or https link. It
			may contain an @ sign, which is how a YouTube channel address is written. A photo can store its
			own link. If that link is blank, the photo has no link.
		</p>
		<p>
			A city or region is geocoded once, when you save a new place, by OpenStreetMap Nominatim
			(<span class="break-all">nominatim.openstreetmap.org</span>). The browser sends that place name to
			Nominatim and does not send your email or account id. A 5-digit US ZIP is looked up in a list
			shipped with the site and is not sent to Nominatim.
		</p>
		<p>
			On the player profile page, the location field can also suggest cities from Google Places. The Maps
			JavaScript API script loads only on that page, after the profile form is shown, and it is not used
			for the players map. Characters typed in that field are sent to Google so it can suggest a city.
			The request does not include your email or account id, and the page does not ask the browser for
			GPS. A suggestion is kept only when it is a city, region, or 5-digit US ZIP. Street addresses are
			still rejected. Google’s precise place point is not stored. The coordinate saved with the profile
			is the approximate point the site issues after Nominatim or the local ZIP list.
		</p>
		<p>
			When you save a new place, a server function moves the coordinate 2 to 8 kilometers in a random
			direction and rounds it to about 1 kilometer (0.01 degrees). The database accepts a new or moved
			pin only when it matches that server-issued point. Street addresses are rejected before the point
			is stored. An existing pin keeps its point until you save a new place. The original point is not
			kept. Only that approximate point can appear on the map.
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
			disabled can read it. Each card shows a player name, bio, and where that person likes to play. The
			list is keyed by account id, so a signed-in player can see that id. It does not include an email
			address or a coordinate.
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
			Email is sent only if you turned on “Allow other players to contact me to setup a game.” When
			someone creates a new request to you, the site reads the email on your Firebase Authentication
			account and sends one message to that address through Twilio Email. The address is not copied onto
			the request, your profile, or your settings, and the message body does not include it. The other
			player cannot see it. We do not send that message through SendGrid.
		</p>
		<p>
			No email is sent if you have not allowed contact, if the account is disabled, if the account has
			no email, or if the request is only being edited or replied to. A later reply does not send
			another email.
		</p>
		<p>
			The queued copy of that message, which is the copy that holds the email address, is kept for 30
			days and then deleted. The website cannot read that queue.
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
			Google Analytics 4, measurement id G-EKPMXMY097, uses Consent Mode. For visitors in the EEA, the
			UK, and Switzerland, analytics cookies stay off until you click Accept on a banner. You can change
			that choice later with the Privacy settings link in the footer. Outside those places, analytics
			cookies may be set without the banner. The same footer link still lets you change the choice.
		</p>
		<p>
			When analytics cookies are allowed, Google Analytics sets first-party cookies whose names start
			with <span class="font-mono">_ga</span>, including <span class="font-mono">_ga</span> and
			<span class="font-mono">_ga_EKPMXMY097</span>. Those cookies recognize a browser and measure
			visits, such as pages viewed and general browser details. We keep Google Analytics data for 2
			months. We do not sell personal information.
		</p>
		<p>
			The site does not display advertisements, and it does not load an ad unit. Ad-related signals stay
			denied. Google signals and ad personalization are off. A file named ads.txt is published and names
			a Google AdSense publisher id. That file does not place an ad on the page.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Do Not Track and Global Privacy Control</h2>
		<p>
			The site does not respond to a Do Not Track signal. Do Not Track does not turn analytics cookies
			off and does not stop the site from storing the information described on this page.
		</p>
		<p>
			The site honors Global Privacy Control by keeping ad-related signals denied. There are no ads.
			Google signals and ad personalization stay off. We still do not sell personal information.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Map tiles</h2>
		<p>
			The players map uses Leaflet. It does not load Google Maps. The map pictures are OpenStreetMap
			tiles from tile.openstreetmap.org, or CARTO’s Voyager tiles from basemaps.cartocdn.com when we
			have a CARTO key set up. Your browser requests those tiles directly from that provider, so it
			receives the request, including an IP address. We do not send your email or account id with that
			request. Tile copyright stays with OpenStreetMap contributors, and with CARTO for CARTO tiles.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Data stored in this browser</h2>
		<p>
			Besides the Google Analytics <span class="font-mono">_ga</span> cookies above, the site stores
			preferences on your device. These are not cookies.
		</p>
		<p>localStorage can hold:</p>
		<ul class="list-disc pl-6 space-y-2">
			<li>dark mode</li>
			<li>print options, including which descriptions to include</li>
			<li>whether you have said you own the rules</li>
			<li>sponsorship and advanced-rules switches</li>
			<li>your analytics cookie choice</li>
			<li>a temporary copy of a team while you move between pages</li>
		</ul>
		<p>sessionStorage, which lasts for this tab, can hold:</p>
		<ul class="list-disc pl-6 space-y-2">
			<li>the team you are editing</li>
			<li>which team-menu action to run after a page change</li>
			<li>
				a directory cache of the players map and the open-to-games list. A repeat visit within five
				minutes reuses that cache instead of reading it again. Saving your profile in the same tab
				clears it.
			</li>
		</ul>
		<p>Signing out does not clear those keys. Clearing site data in the browser does.</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Administrators</h2>
		<p>
			An administrator can list accounts, search by email or display name, view saved teams, and assign
			a role. An administrator can open a read-only view of another player's major settings: the monthly
			email choice and when it was given, game-request email, profile city and map visibility, account
			status, and created and last sign-in times. That view cannot change consent.
			Analytics and advertising choices stay in the browser. The site does not collect an SMS or text
			opt-in. An administrator can disable another account. Disabling signs that person out, marks the
			Firebase Authentication user disabled, and blocks access to their teams and profile. It does not
			delete the account, the teams, or the profile. An administrator cannot disable their own account
			from the page. An administrator cannot delete an account. You can delete your own account from
			settings, as described below.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">How long we keep information</h2>
		<p>
			Saved teams stay until you delete them or you ask us to delete them. You can delete a saved team
			from My Teams. Photos stay in My Photos until you delete the photo or your account. Removing a
			car or a team only takes the photo off that car.
			Settings and the private player profile stay until you change them or you ask us to
			delete them. Turning the map off removes the public pin. Turning open to games off removes that
			card.
		</p>
		<p>
			The account record is not deleted when you sign out, and it is not deleted when an account is
			disabled. While you are signed in, you can delete your account from settings. You can also ask by
			email. Buddy links, requests, blocks, your invite code, and buddy-invite records stay until you
			remove them or delete your account. Deleting your account removes those links for both people
			and removes the invites you sent. The salted hash for “don't email me invites again” stays,
			including the hash of your own address, so that request still blocks a later invite.
		</p>
		<p>
			Game requests stay until an account deletion anonymizes them, or until we remove them on request. The profile page does not include a delete
			button for a request. Contact Us messages have no automatic expiry.
		</p>
		<p>
			Game-request mail is kept for 30 days and then deleted. Google Analytics data is kept for 2
			months. Public usage totals are replaced when the daily job runs. They are counts, not a copy of
			your teams.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Why we use this information</h2>
		<p>If the GDPR or UK GDPR applies, we rely on these bases:</p>
		<ul class="list-disc pl-6 space-y-2">
			<li>
				Contract: your account, saved teams, photos of your cars, settings, in-app game requests, gaming buddy links, and the
				address you type for a buddy invite, so we can provide the features you use.
			</li>
			<li>
				Consent: a public or anonymous map pin, the open-to-games listing, being findable by display
				name for gaming buddies, a buddy invite email when you enter an address, game-request email,
				and the monthly Gaslands Garage email. Each one stays off until you turn it on. In the EEA, the
				UK, and Switzerland, analytics cookies are also consent: they stay off until you click Accept.
				You can withdraw consent by turning the control off, by using the Privacy settings link in the
				footer, or by emailing us. Withdrawal does not undo a message already sent.
			</li>
			<li>
				Legitimate interests: securing the site, limiting abuse, publishing aggregate usage totals, and,
				outside the EEA, the UK, and Switzerland, measuring visits with Google Analytics. You can object
				by emailing us, and you can turn analytics cookies off from Privacy settings.
			</li>
			<li>Legal obligation: when the law requires us to keep or disclose information.</li>
		</ul>
		<p>
			The operator is in Florida, USA. Google (sign-in, the database, photo storage, Analytics, and Places city
			suggestions on the profile page), Twilio (email), CARTO (map tiles), and OpenStreetMap Nominatim
			(city lookup) process information for the site, including in the United States.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Your rights</h2>
		<p>
			If you are signed in, you can download your data and delete your account from settings. You can
			also email the contact address,
			<a class={linkClass} href="mailto:jose.anes@gmail.com">jose.anes@gmail.com</a>. We
			answer email requests within 1 month. We may need to confirm that you control the Google account.
		</p>
		<p>If the GDPR or UK GDPR applies, you can ask us to:</p>
		<ul class="list-disc pl-6 space-y-2">
			<li>access the personal information we hold about you</li>
			<li>correct it</li>
			<li>delete it</li>
			<li>restrict how we use it</li>
			<li>provide a copy in a portable form</li>
			<li>object to processing based on legitimate interests, including analytics</li>
			<li>
				object to marketing, which you can also stop by turning the monthly email off, or by opening the
				unsubscribe link in that email and confirming
			</li>
			<li>withdraw consent, where the processing was based on consent</li>
		</ul>
		<p>
			You can complain to a regulator. In the UK, that is the Information Commissioner’s Office. In the
			EU, it is the data protection authority in your country. You can do that whether or not you email
			us first.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">California residents</h2>
		<p>
			We do not sell personal information, and we do not share it for cross-context behavioral
			advertising. There is no “Do Not Sell or Share” switch because we do not sell or share it that
			way. We do not offer a financial incentive for personal information.
		</p>
		<p>
			You can ask us to tell you the categories and specific pieces of personal information we hold, to
			correct it, or to delete it. We will not discriminate against you for asking. If you are signed
			in, you can download your data and delete your account from settings. You can also email the
			contact address,
			<a class={linkClass} href="mailto:jose.anes@gmail.com">jose.anes@gmail.com</a>. We answer email
			requests within 1 month.
		</p>
		<p>
			The information we hold can include identifiers (such as email, display name, and account id),
			the teams and profile text you save, photos of your cars if you add them, an approximate location if you add one, messages you send,
			and internet activity collected by Google Analytics.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Children</h2>
		<p>
			The site is for people 13 and older, or 16 and older where the law requires that age before
			someone can consent on their own. We do not knowingly collect personal information from anyone
			younger. The site does not ask for a date of birth. If you believe we have information about
			someone under that age, email us and we will delete the Gaslands Garage data we hold for them.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Asking us to delete information</h2>
		<p>
			If you are signed in, you can download your data and delete your account from settings. You can
			also email the contact address,
			<a class={linkClass} href="mailto:jose.anes@gmail.com">jose.anes@gmail.com</a>, or use
			Contact Us while signed in, and say what you want removed. We answer email requests within 1
			month. We can delete the Gaslands Garage records we hold for that account, including the account
			record, teams, photos of your cars, profile, settings, game requests, gaming buddy links, and the buddy invites you sent. A game request is anonymized:
			your name and note are cleared, and the request is removed only when the other player's account
			is gone too. A request not to receive buddy-invite email stays in place. Disabling an account is not
			the same as deleting it. We cannot delete the Google account itself.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Security</h2>
		<p>
			The site is served over HTTPS. Database access starts from a deny-all rule. Teams, settings, and
			the private profile are limited to the signed-in owner, with the administrator access described
			above. Photos are limited to the signed-in owner. A buddy can read a team only when the link is accepted both ways and the team is not
			hidden. Buddies cannot change your teams, and they cannot see your photos. The public map and the public usage totals are readable
			without an account. The mail queue is not readable from the website. No storage method is perfect.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Changes</h2>
		<p>
			If this policy changes, the date at the top of this page will change. We do not email a notice of
			that change.
		</p>

		<h2 class="text-xl font-bold mt-8 mb-3">Contact</h2>
		<p>
			Anes & Rincon LLC<br />
			Contact address:
			<a class={linkClass} href="mailto:jose.anes@gmail.com">jose.anes@gmail.com</a>
		</p>
		<p>
			You can also open Contact Us from the Help menu. That form requires a sign-in.
			<a class={linkClass} href="/terms">Terms and Conditions</a>.
		</p>
	</div>
</article>
