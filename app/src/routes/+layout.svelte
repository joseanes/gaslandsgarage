<!-- app/src/routes/+layout.svelte -->
<script lang="ts">
  /*  Import the global Tailwind stylesheet once  */
  import "../app.css";
  import "../dark-mode.css";
  import "../form-styles.css";
  import "../print.css";
  import "../dark-override.css"; /* This must be imported last to override other styles */
  import "../inline-fixes.js"; /* JavaScript fixes for element heights */
  import "../print-new.js"; /* Print handler */
  import { onMount, tick } from 'svelte';
  import { clampToViewport } from '$lib/clampToViewport';
  import { fade } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import AdUnit from '$lib/components/AdUnit.svelte';
  import Auth from '$lib/components/Auth.svelte';
  import ConsentBanner from '$lib/components/ConsentBanner.svelte';
  import LayoutSettingsHost from '$lib/components/LayoutSettingsHost.svelte';
  import NewsletterPrompt from '$lib/components/NewsletterPrompt.svelte';
  import TeamsModal from '$lib/components/TeamsModal.svelte';
  import { openPrivacySettings } from '$lib/privacy/consent';
  import { signInWithGoogle, user } from '$lib/firebase';
  import { disabledNotice, isAdministrator, startAccountSession } from '$lib/admin/session';

  startAccountSession();
  import { sendContactMessage } from '$lib/services/messages';
  import { builderPathForTeamAction, rememberTeamMenuAction, type TeamMenuAction } from '$lib/teamMenu';
  import { openLayoutSettings, type SettingsTab } from '$lib/settings/layoutSettingsControl';
  import { wargamingEventsUrl } from '$lib/players/wargamingEvents';
  import { SHOW_CHANGE_LOG, SHOW_UPCOMING_FEATURES } from '$lib/features/helpMenu';
  
  // Ad configuration variables
  let showAds = false; // Removed ads for now
  
  const headerMenus = ['.share-menu-dropdown', '.settings-menu-dropdown', '.players-menu-dropdown', '.help-menu-dropdown'];

  async function clampHeaderMenus() {
    await tick();
    if (typeof document === 'undefined') return;
    for (const selector of headerMenus) clampToViewport(document.querySelector(selector));
  }

  // Menu state
  let showShareMenu = false;
  // "Share Team" submenu inside the Teams menu. A flyout on wide screens,
  // an expandable group on narrow ones.
  let showShareSubmenu = false;
  let shareSubmenuByHover = false;
  let shareTeamButton: HTMLButtonElement | undefined;
  let shareSubmenuEl: HTMLDivElement | undefined;
  $: if (!showShareMenu) {
    showShareSubmenu = false;
    shareSubmenuByHover = false;
  }

  function shareFlyout(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(min-width: 641px)').matches;
  }

  async function openShareSubmenu(focusFirst = false) {
    showShareSubmenu = true;
    await tick();
    if (shareFlyout()) clampToViewport(shareSubmenuEl ?? null);
    if (focusFirst) shareSubmenuEl?.querySelector<HTMLElement>('button')?.focus();
  }

  function closeShareSubmenu(returnFocus = false) {
    showShareSubmenu = false;
    shareSubmenuByHover = false;
    if (returnFocus) shareTeamButton?.focus();
  }

  function toggleShareSubmenu() {
    if (showShareSubmenu && !shareSubmenuByHover) closeShareSubmenu();
    else {
      shareSubmenuByHover = false;
      void openShareSubmenu();
    }
  }

  function onShareGroupEnter() {
    if (!shareFlyout() || !window.matchMedia('(hover: hover)').matches || showShareSubmenu) return;
    shareSubmenuByHover = true;
    void openShareSubmenu();
  }

  function onShareGroupLeave() {
    if (shareSubmenuByHover) closeShareSubmenu();
  }

  function onShareTriggerKey(event: KeyboardEvent) {
    if (event.key === 'ArrowRight' || (event.key === 'ArrowDown' && showShareSubmenu)) {
      event.preventDefault();
      shareSubmenuByHover = false;
      void openShareSubmenu(true);
    } else if (event.key === 'ArrowLeft' || event.key === 'Escape') {
      if (!showShareSubmenu) return;
      event.preventDefault();
      event.stopPropagation();
      closeShareSubmenu(true);
    }
  }

  function onShareSubmenuKey(event: KeyboardEvent) {
    const items = [...(shareSubmenuEl?.querySelectorAll<HTMLElement>('button') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      closeShareSubmenu(true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    }
  }

  function runShareAction(action: () => void) {
    action();
    showShareMenu = false;
  }

  // Wargaming Events link. Uses the player's saved, already coarse map location when there is one.
  let eventsProfileUid = '';
  let wgeHref = wargamingEventsUrl(null);
  $: if (!$user) {
    eventsProfileUid = '';
    wgeHref = wargamingEventsUrl(null);
  }

  async function refreshEventsLink() {
    const uid = $user?.uid ?? '';
    if (!uid || uid === eventsProfileUid) return;
    eventsProfileUid = uid;
    try {
      const { loadOwnProfile } = await import('$lib/services/playerProfile');
      const profile = await loadOwnProfile(uid);
      if (($user?.uid ?? '') === uid) wgeHref = wargamingEventsUrl(profile);
    } catch {
      // Keep the Gaslands-only link.
    }
  }

  function togglePlayersMenu() {
    showPlayersMenu = !showPlayersMenu;
    if (showPlayersMenu) void refreshEventsLink();
    void clampHeaderMenus();
  }
  let showHelpMenu = false;
  let showSettingsMenu = false;
  let showPlayersMenu = false;
  let showSignInPrompt = false;
  let showTeamsModal = false;
  let showAboutModal = false;
  let showAboutGaslandsModal = false;
  let showChangeLogModal = false;
  let showUpcomingFeaturesModal = false;
  let showContributorsModal = false;
  let showContactUsModal = false;

  // Contact form state
  let contactSubject = '';
  let contactMessage = '';
  let contactSubmitting = false;
  let contactSuccess = false;
  let contactError = '';
  
  // Hook for My Teams functionality
  function openTeamsModal() {
    if (typeof window !== 'undefined' && window.location.pathname.includes('/builder')) {
      // Force re-creation of functions if they don't exist - will be defined in the Builder page
      if (typeof window.currentDraftFn !== 'function' || typeof window.importDraftFn !== 'function') {
        console.log("Functions not available, will proceed anyway");
      }
      
      // Get the team name from the builder page if possible
      try {
        // Try to find the team name input directly
        const teamNameInput = document.querySelector('input[placeholder="Team Name"]');
        if (teamNameInput instanceof HTMLInputElement && teamNameInput.value) {
          window.teamName = teamNameInput.value;
          console.log("Got team name from input field:", window.teamName);
        }
      } catch (e) {
        console.error("Error getting team name directly:", e);
      }
      
      // The builder hook copies the current team name onto window. Its own
      // showTeamsModal flag is not the dialog rendered here, so the menu
      // still has to open this layout dialog after the name is synced.
      if (typeof window.openTeamsModalFn === 'function') {
        console.log("Using window.openTeamsModalFn to ensure team name is updated");
        window.openTeamsModalFn();
      }
      showTeamsModal = true;
    } else {
      openOnBuilder('myteams');
    }
  }
  
  // Add click outside handler for the share menu
  onMount(() => {
    // Check for dark mode preference in localStorage
    const darkMode = localStorage.getItem('darkMode') === 'true';
    if (darkMode) {
      document.documentElement.classList.add('dark-mode');
      document.documentElement.classList.add('dark');
    }

    // You could potentially load ad preferences here too
    // const adsDisabled = localStorage.getItem('adsDisabled') === 'true';
    // showAds = !adsDisabled;

    const handleClickOutside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // Handle Share menu clicks outside
      const shareMenuButton = document.querySelector('.share-menu-trigger');
      const shareMenu = document.querySelector('.share-menu-dropdown');

      if (showShareMenu &&
        shareMenuButton &&
        shareMenu &&
        !shareMenuButton.contains(target) &&
        !shareMenu.contains(target)) {
        showShareMenu = false;
      }

      // Handle Help menu clicks outside
      const helpMenuButton = document.querySelector('.help-menu-trigger');
      const helpMenu = document.querySelector('.help-menu-dropdown');

      if (showHelpMenu &&
        helpMenuButton &&
        helpMenu &&
        !helpMenuButton.contains(target) &&
        !helpMenu.contains(target)) {
        showHelpMenu = false;
      }

      // Handle Settings menu clicks outside
      const settingsMenuButton = document.querySelector('.settings-menu-trigger');
      const settingsMenu = document.querySelector('.settings-menu-dropdown');

      if (showSettingsMenu &&
        settingsMenuButton &&
        settingsMenu &&
        !settingsMenuButton.contains(target) &&
        !settingsMenu.contains(target)) {
        showSettingsMenu = false;
      }

      const playersMenuButton = document.querySelector('.players-menu-trigger');
      const playersMenu = document.querySelector('.players-menu-dropdown');

      if (showPlayersMenu &&
        playersMenuButton &&
        playersMenu &&
        !playersMenuButton.contains(target) &&
        !playersMenu.contains(target)) {
        showPlayersMenu = false;
      }
    };

    const onRequestSignIn = () => {
      showSignInPrompt = true;
    };

    const openMyTeamsFromBuilder = () => {
      openTeamsModal();
    };

    document.addEventListener('click', handleClickOutside);
    window.addEventListener('gaslands-request-sign-in', onRequestSignIn);
    window.addEventListener('gaslands-open-my-teams', openMyTeamsFromBuilder);

    return () => {
      document.removeEventListener('click', handleClickOutside);
      window.removeEventListener('gaslands-request-sign-in', onRequestSignIn);
      window.removeEventListener('gaslands-open-my-teams', openMyTeamsFromBuilder);
    };
  });

  function onBuilderPage() {
    return typeof window !== 'undefined' && window.location.pathname.includes('/builder');
  }

  // The builder is already home. A normal click would remount it and drop the
  // team on screen. Other links do not ask before leaving; staying put is what
  // keeps the in-progress list. Modified clicks still open a new tab.
  function stayOnBuilder(event: MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (!onBuilderPage()) return;
    event.preventDefault();
  }

  function openOnBuilder(action: TeamMenuAction) {
    rememberTeamMenuAction(action);
    void goto(builderPathForTeamAction(action));
  }

  async function startGoogleSignIn() {
    showSignInPrompt = false;
    await signInWithGoogle();
  }
  
  // Menu actions
  // Menu actions for non-builder routes
  // These functions check if we're on the builder page before performing actions
  function copyDraft() {
    if (typeof window !== 'undefined' && window.location.pathname.includes('/builder')) {
      // Forward to builder's copyDraft function
      if (typeof window.copyDraftFn === 'function') {
        window.copyDraftFn();
      }
    } else {
      openOnBuilder('copy');
    }
  }
  
  function shareLink() {
    if (typeof window !== 'undefined' && window.location.pathname.includes('/builder')) {
      // Forward to builder's shareLink function
      if (typeof window.shareLinkFn === 'function') {
        window.shareLinkFn();
      }
    } else {
      openOnBuilder('share');
    }
  }
  
  function generateQRCode() {
    console.log('[Layout] Generating QR Code');
    if (typeof window !== 'undefined' && window.location.pathname.includes('/builder')) {
      // Try all available methods to trigger QR code generation
      // 1. First try using the custom event approach
      try {
        console.log('[Layout] Dispatching gaslands-menu-action event for generateQRCode');
        window.dispatchEvent(new CustomEvent('gaslands-menu-action', {
          detail: { action: 'generateQRCode' }
        }));
        return;
      } catch (err) {
        console.error('[Layout] Error dispatching custom event:', err);
      }
      
      // 2. Try the function approach as fallback
      if (typeof window.generateQRCodeFn === 'function') {
        console.log('[Layout] Calling window.generateQRCodeFn');
        window.generateQRCodeFn();
        return;
      } else {
        console.error('[Layout] window.generateQRCodeFn is not a function!', typeof window.generateQRCodeFn);
      }
      
      // 3. Try direct function call as fallback
      if (typeof window.generateQRCode === 'function') {
        console.log('[Layout] Calling window.generateQRCode directly');
        window.generateQRCode();
        return;
      }
      
      console.error('[Layout] All methods to generate QR code failed');
    } else {
      openOnBuilder('qr');
    }
  }
  
  function importBuild() {
    console.log('[Layout] Importing build');
    if (typeof window !== 'undefined' && window.location.pathname.includes('/builder')) {
      // Try all available methods to trigger the import modal
      // 1. First try using the custom event approach
      try {
        console.log('[Layout] Dispatching gaslands-menu-action event for importBuild');
        window.dispatchEvent(new CustomEvent('gaslands-menu-action', {
          detail: { action: 'importBuild' }
        }));
        return;
      } catch (err) {
        console.error('[Layout] Error dispatching custom event:', err);
      }
      
      // 2. Try the function approach as fallback
      if (typeof window.importBuildFn === 'function') {
        console.log('[Layout] Calling window.importBuildFn');
        window.importBuildFn();
        return;
      } else {
        console.error('[Layout] window.importBuildFn is not a function!', typeof window.importBuildFn);
      }
      
      // 3. Try direct function call as fallback
      if (typeof window.importBuild === 'function') {
        console.log('[Layout] Calling window.importBuild directly');
        window.importBuild();
        return;
      }
      
      console.error('[Layout] All methods to trigger import modal failed');
    } else {
      openOnBuilder('import');
    }
  }
  
  function startNewTeam() {
    if (onBuilderPage() && typeof window.startNewTeamFn === 'function') {
      window.startNewTeamFn();
      return;
    }
    openOnBuilder('new');
  }

  function printTeam() {
    console.log('[Layout] Printing team');
    if (typeof window !== 'undefined' && window.location.pathname.includes('/builder')) {
      // Try all available methods to trigger print
      // 1. First try using the custom event approach
      try {
        console.log('[Layout] Dispatching gaslands-menu-action event for printTeam');
        window.dispatchEvent(new CustomEvent('gaslands-menu-action', {
          detail: { action: 'printTeam' }
        }));
        return;
      } catch (err) {
        console.error('[Layout] Error dispatching custom event:', err);
      }
      
      // 2. Try the function approach as fallback
      if (typeof window.printTeamFn === 'function') {
        console.log('[Layout] Calling window.printTeamFn');
        window.printTeamFn();
        return;
      } else {
        console.error('[Layout] window.printTeamFn is not a function!', typeof window.printTeamFn);
      }
      
      // 3. Try direct function calls as fallback
      if (typeof window.printWithRulesCheck === 'function') {
        console.log('[Layout] Calling window.printWithRulesCheck directly');
        window.printWithRulesCheck();
        return;
      } else if (typeof window.printTeam === 'function') {
        console.log('[Layout] Calling window.printTeam directly');
        window.printTeam();
        return;
      }
      
      console.error('[Layout] All methods to print team failed');
    } else {
      openOnBuilder('print');
    }
  }

  function printTeamWithPhotos() {
    if (typeof window !== 'undefined' && window.location.pathname.includes('/builder')) {
      try {
        window.dispatchEvent(new CustomEvent('gaslands-menu-action', {
          detail: { action: 'printTeamWithPhotos' }
        }));
        return;
      } catch (err) {
        console.error('[Layout] Error dispatching photo print:', err);
      }
      if (typeof window.printTeamWithPhotosFn === 'function') {
        window.printTeamWithPhotosFn();
        return;
      }
    } else {
      openOnBuilder('printphotos');
    }
  }
  
  function openBuilderSettings(tab: SettingsTab) {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent('gaslands-menu-action', {
        detail: { action: 'openSettings', tab }
      }));
      return;
    } catch {
      // Fall through when the event cannot be dispatched.
    }
    if (typeof window.openSettingsFn === 'function') {
      window.openSettingsFn(tab);
      return;
    }
    if (typeof window.openSettings === 'function') {
      window.openSettings(tab);
    }
  }

  // General settings are account preferences, so they open on every page.
  // Print settings are account preferences too: style and descriptions, not the team.
  function openGeneralSettings() {
    if (onBuilderPage()) {
      openBuilderSettings('general');
      return;
    }
    openLayoutSettings('general');
  }

  function openPrintSettings() {
    if (onBuilderPage()) {
      openBuilderSettings('print');
      return;
    }
    openLayoutSettings('print');
  }
  
  // Help menu functions
  function openAbout() {
    showAboutModal = true;
  }

  function openAboutGaslands() {
    showAboutGaslandsModal = true;
  }

  function openChangeLog() {
    showChangeLogModal = true;
  }

  function openUpcomingFeatures() {
    showUpcomingFeaturesModal = true;
  }

  function openContributors() {
    showContributorsModal = true;
  }

  function openContactUs() {
    showContactUsModal = true;
  }

  // Handle contact form submission
  async function handleContactFormSubmit() {
    if (!$user) {
      contactError = 'You must be logged in to send a message.';
      return;
    }

    if (!contactSubject.trim() || !contactMessage.trim()) {
      contactError = 'Please fill out all required fields.';
      return;
    }

    contactSubmitting = true;
    contactError = '';
    contactSuccess = false;

    try {
      // Add debug logging to understand user information
      console.log("User information:", $user);

      // Make sure we have valid user information before proceeding
      if (!$user || !$user.uid) {
        contactError = 'User information not available. Please sign out and sign in again.';
        contactSubmitting = false;
        return;
      }

      const result = await sendContactMessage(
        $user.uid,
        $user.email || '',
        contactSubject.trim(),
        contactMessage.trim()
      );

      if (result.success) {
        contactSuccess = true;
        contactSubject = '';
        contactMessage = '';

        // Automatically close the modal after 3 seconds
        setTimeout(() => {
          if (contactSuccess) {
            showContactUsModal = false;
          }
        }, 3000);
      } else {
        // Display a more specific error message if available
        if (result.error) {
          contactError = `Error: ${result.error}`;
        } else {
          contactError = 'There was an error sending your message. Please try again.';
        }

        console.error('Message sending error:', result.error);
      }
    } catch (error) {
      console.error('Error sending contact message:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      contactError = `An unexpected error occurred: ${errorMessage}. Please try again later.`;
    } finally {
      contactSubmitting = false;
    }
  }
</script>

<!-- Main layout with ad space -->
<div class="app-container min-h-screen flex flex-col">
  <!-- Top Navigation Bar -->
  <!-- Sticky on the header, not only the bar: the bar fills the header, so a
       sticky bar has no room to stick and the open menu scrolls away with the page. -->
  <header class="sticky top-0 z-10 w-full print:hidden">
    <nav class="menu-bar print:hidden">
      <div class="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 w-full flex justify-between items-center">
        <div class="flex flex-col justify-start">
          <a href="/builder" class="logo text-left" aria-label="Gaslands Garage home" on:click={stayOnBuilder}>
            <span class="logo-highlight">Gaslands</span> Garage
          </a>
          <span class="logo-sponsor">
            by <a href="https://funboardgames.etsy.com/" target="_blank" rel="noopener noreferrer" class="etsy-link">Fun Board Games</a>
          </span>
        </div>

        <div class="flex flex-wrap items-center justify-end" style="gap: 5px;">
          <div class="relative">
            <button
              type="button"
              class="menu-item flex items-center share-menu-trigger"
              on:click={() => { showShareMenu = !showShareMenu; void clampHeaderMenus(); }}
              aria-haspopup="true"
              aria-expanded={showShareMenu}
              style="height: auto !important; min-height: auto !important;"
            >
            Teams
            <svg class="ml-1 w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"></path>
            </svg>
          </button>

            {#if showShareMenu}
          <div
            class="absolute w-52 bg-black border-2 border-amber-500 shadow-xl rounded-lg overflow-visible z-30 py-2 share-menu-dropdown"
            style="box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5); background-color: #000000 !important; top: 40px; left: 0;"
            transition:fade={{ duration: 150 }}
          >
            <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" on:click={() => { startNewTeam(); showShareMenu = false; }}>
              New
            </button>
            <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" on:click={() => { openTeamsModal(); showShareMenu = false; }}>
              Save/Load Team
            </button>
            <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" on:click={() => { printTeam(); showShareMenu = false; }}>
              Print Team
            </button>
            <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" data-testid="print-with-photos" on:click={() => { printTeamWithPhotos(); showShareMenu = false; }}>
              Print with photos
            </button>
            <div class="share-team-group" role="presentation" on:mouseenter={onShareGroupEnter} on:mouseleave={onShareGroupLeave}>
              <button
                type="button"
                class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600 flex items-center justify-between share-team-trigger"
                aria-haspopup="true"
                aria-expanded={showShareSubmenu}
                aria-controls="share-team-submenu"
                bind:this={shareTeamButton}
                on:click={toggleShareSubmenu}
                on:keydown={onShareTriggerKey}
              >
                <span>Share Team</span>
                <svg class="ml-2 w-3 h-3 share-team-caret" class:open={showShareSubmenu} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"></path>
                </svg>
              </button>
              {#if showShareSubmenu}
                <div
                  id="share-team-submenu"
                  class="share-team-submenu py-1"
                  role="group"
                  aria-label="Share Team"
                  bind:this={shareSubmenuEl}
                >
                  <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" on:click={() => runShareAction(copyDraft)} on:keydown={onShareSubmenuKey}>
                    Copy to Clipboard
                  </button>
                  <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" on:click={() => runShareAction(shareLink)} on:keydown={onShareSubmenuKey}>
                    Share Link
                  </button>
                  <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" on:click={() => runShareAction(generateQRCode)} on:keydown={onShareSubmenuKey}>
                    Generate QR Code
                  </button>
                </div>
              {/if}
            </div>
            <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" on:click={() => { importBuild(); showShareMenu = false; }}>
              Import Build
            </button>
          </div>
            {/if}
          </div>
          <div class="relative">
            <button
              type="button"
              class="menu-item flex items-center players-menu-trigger"
              on:click={togglePlayersMenu}
              aria-haspopup="true"
              aria-expanded={showPlayersMenu}
              style="height: auto !important; min-height: auto !important;"
            >
              Players and Events
              <svg class="ml-1 w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"></path>
              </svg>
            </button>

            {#if showPlayersMenu}
            <div
              class="absolute w-44 bg-black border-2 border-amber-500 shadow-xl rounded-lg overflow-hidden z-30 py-2 players-menu-dropdown"
              style="box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5); background-color: #000000 !important; top: 40px; left: 0;"
              transition:fade={{ duration: 150 }}
            >
              <a href="/players" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600 block" on:click={() => showPlayersMenu = false}>
                Players Map
              </a>
              <a href="/profile" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600 block" on:click={() => showPlayersMenu = false}>
                My Profile
              </a>
              <a href="/buddies" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600 block" on:click={() => showPlayersMenu = false}>
                Gaming Buddies
              </a>
              <a href="/gallery" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600 block" data-testid="gallery-link" on:click={() => showPlayersMenu = false}>
                Gallery
              </a>
              <a
                href={wgeHref}
                target="_blank"
                rel="noopener noreferrer"
                class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600 block"
                data-testid="wargaming-events-link"
                on:click={() => showPlayersMenu = false}
              >
                Wargaming Events<span class="sr-only"> (opens in a new tab)</span>
                <svg class="inline ml-1 w-3 h-3 align-baseline" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"></path><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"></path></svg>
              </a>
            </div>
            {/if}
          </div>
          <div class="relative">
            <button
              type="button"
              class="menu-item flex items-center settings-menu-trigger"
              on:click={() => { showSettingsMenu = !showSettingsMenu; void clampHeaderMenus(); }}
              aria-haspopup="true"
              aria-expanded={showSettingsMenu}
              style="height: auto !important; min-height: auto !important;"
            >
              Settings
              <svg class="ml-1 w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"></path>
              </svg>
            </button>

            {#if showSettingsMenu}
            <div
              class="absolute w-56 bg-black border-2 border-amber-500 shadow-xl rounded-lg overflow-hidden z-30 py-2 settings-menu-dropdown"
              style="box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5); background-color: #000000 !important; top: 40px; left: 0;"
              transition:fade={{ duration: 150 }}
            >
              <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" on:click={() => { openGeneralSettings(); showSettingsMenu = false; }}>
                General Settings
              </button>
              <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" on:click={() => { openPrintSettings(); showSettingsMenu = false; }}>
                Print Settings
              </button>
            </div>
            {/if}
          </div>
          <div class="relative">
            <button
              type="button"
              class="menu-item flex items-center help-menu-trigger"
              on:click={() => { showHelpMenu = !showHelpMenu; void clampHeaderMenus(); }}
              aria-haspopup="true"
              aria-expanded={showHelpMenu}
              style="height: auto !important; min-height: auto !important;"
            >
              Help
              <svg class="ml-1 w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"></path>
              </svg>
            </button>

            {#if showHelpMenu}
            <div
              class="absolute w-56 bg-black border-2 border-amber-500 shadow-xl rounded-lg overflow-hidden z-30 py-2 help-menu-dropdown"
              style="box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5); background-color: #000000 !important; top: 40px; left: 0;"
              transition:fade={{ duration: 150 }}
            >
              <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" on:click={() => { openAbout(); showHelpMenu = false; }}>
                About Gaslands Garage
              </button>
              <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" on:click={() => { openAboutGaslands(); showHelpMenu = false; }}>
                About Gaslands
              </button>
              <a href="/stats" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600 block" on:click={() => showHelpMenu = false}>
                Usage Stats
              </a>
              {#if SHOW_CHANGE_LOG}
                <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" on:click={() => { openChangeLog(); showHelpMenu = false; }}>
                  Change Log
                </button>
              {/if}
              {#if SHOW_UPCOMING_FEATURES}
                <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" on:click={() => { openUpcomingFeatures(); showHelpMenu = false; }}>
                  Upcoming Features
                </button>
              {/if}
              <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" on:click={() => { openContributors(); showHelpMenu = false; }}>
                Contributors
              </button>
              <button type="button" class="menu-item w-full text-left px-4 py-2 text-white hover:bg-amber-600" on:click={() => { openContactUs(); showHelpMenu = false; }}>
                Contact Us
              </button>
            </div>
            {/if}
          </div>
          {#if $isAdministrator}
            <a href="/admin/users" class="menu-item">Admin</a>
          {/if}
          <Auth />
        </div>
      </div>
    </nav>
  </header>
  
  <!-- Ad banner slot removed -->

  <!-- Content area without sidebar ad -->
  <div class="flex-1">
    <!-- Main content area (full width) -->
    <main class="w-full max-w-7xl mx-auto px-2 sm:px-4 lg:px-8">
      <NewsletterPrompt />
      <slot />
    </main>
  </div>

  <footer class="print-hide print:hidden border-t border-stone-200 dark:border-gray-700">
    <div class="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 py-4 text-sm text-stone-600 dark:text-gray-300">
      <a href="/privacy" class="text-amber-600 dark:text-amber-400 hover:underline">Privacy Policy</a>
      <span aria-hidden="true"> · </span>
      <a href="/terms" class="text-amber-600 dark:text-amber-400 hover:underline">Terms and Conditions</a>
      <span aria-hidden="true"> · </span>
      <button
        type="button"
        class="text-amber-600 underline-offset-2 hover:underline dark:text-amber-400"
        data-testid="privacy-settings"
        on:click={openPrivacySettings}
      >
        Privacy settings
      </button>
    </div>
  </footer>
</div>

<ConsentBanner />

{#if !$page.url.pathname.includes('/builder')}
  <LayoutSettingsHost />
{/if}

{#if showSignInPrompt}
  <div class="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-4">
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sign in to save"
      class="bg-white rounded-xl border-2 border-amber-500 p-6 max-w-md w-full shadow-xl"
    >
      <h2 class="text-lg font-bold text-stone-800 mb-2">Sign in to save</h2>
      <p class="text-stone-700 mb-4">Teams are stored on your Google account.</p>
      <div class="flex flex-wrap gap-2 justify-end">
        <button
          type="button"
          class="px-4 py-2 rounded-lg border border-stone-300 text-stone-700"
          on:click={() => showSignInPrompt = false}
        >
          Not now
        </button>
        <button
          type="button"
          class="px-4 py-2 rounded-lg bg-amber-500 text-white font-medium"
          on:click={startGoogleSignIn}
        >
          Sign in with Google
        </button>
      </div>
    </div>
  </div>
{/if}

{#if $disabledNotice}
  <div class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 p-4">
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Account disabled"
      data-testid="account-disabled"
      class="bg-white rounded-xl border-2 border-amber-500 p-6 max-w-md w-full shadow-xl"
    >
      <h2 class="text-lg font-bold text-stone-800 mb-2">Your account has been disabled</h2>
      <p class="text-stone-700 mb-4">An administrator turned off access for this account. You have been signed out.</p>
      <div class="flex justify-end">
        <button
          type="button"
          class="px-4 py-2 rounded-lg bg-amber-500 text-white font-medium"
          on:click={() => disabledNotice.set(false)}
        >
          OK
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- About Modal -->
{#if showAboutModal}
  <div
    class="fixed inset-0 bg-black z-50"
    role="dialog"
    aria-modal="true"
    aria-label="About Gaslands Garage"
    tabindex="-1"
    transition:fade={{ duration: 150 }}
  >
    <!-- Background overlay -->
    <button
      class="absolute inset-0 w-full h-full border-0 cursor-pointer"
      on:click={() => showAboutModal = false}
      on:keydown={e => e.key === 'Escape' && (showAboutModal = false)}
      aria-label="Close modal background"
    ></button>
    
    <!-- Modal content -->
    <div
      class="bg-white dark:bg-gray-800 rounded-xl shadow-[0_0_25px_rgba(0,0,0,0.3)] w-11/12 sm:w-4/5 md:w-4/5 lg:w-4/5 mx-auto relative z-10 border-2 border-amber-500"
      role="document"
      style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); max-height: 90vh; overflow-y: auto; box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 0 0 4px rgba(245,158,11,0.4), 0 10px 25px -5px rgba(0,0,0,0.4); background-color: var(--modal-bg-color, white); padding: 1.5rem;"
    >
      <div class="flex justify-between items-center mb-6">
        <h3 class="text-xl font-bold text-stone-800 dark:text-white modal-heading">About Gaslands Garage</h3>
        <button
          class="py-0.25 px-2 h-[2rem] flex items-center justify-center rounded transition-colors text-sm amber-button"
          on:click={() => showAboutModal = false}
          aria-label="Close about modal"
        >
          <span>Close</span>
        </button>
      </div>
      
      <div class="space-y-6 text-stone-700 dark:text-gray-200 modal-text">
        <p>
          Gaslands Garage is a free tool for building and managing your Gaslands teams. The app includes all the official rules, vehicle types, weapons, upgrades, and sponsor perks.
        </p>
        
        <div class="px-4">
          <h4 class="font-bold text-stone-800 dark:text-white text-lg mb-3">Features:</h4>
          <ul class="list-disc pl-6 space-y-2">
            <li>Build teams with any combination of vehicles, weapons, and upgrades</li>
            <li>Validation ensures your team follows Gaslands rules</li>
            <li>Save teams to your account for easy access</li>
            <li>Share your builds with QR codes</li>
            <li>Print vehicle cards for your games</li>
            <li>Dark mode support</li>
          </ul>
        </div>
        
        <div class="border-t border-stone-200 dark:border-gray-700 pt-4 mt-4">
          <p class="italic text-stone-600 dark:text-gray-400">
            This is an unofficial fan-made tool. The Gaslands game is © 2017 Mike Hutchinson and this application is done under the Friends of Gaslands program. The Application Copyright © 2025 Anes & Rincon LLC d.b.a. FunBoardGames.Etsy.com.
          </p>

          <p class="italic text-stone-600 dark:text-gray-400 mt-2">
            This work is licensed under a <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline">Creative Commons Attribution-NonCommercial 4.0 International License</a>. You are free to share and adapt this work for non-commercial purposes, provided you give appropriate credit.
          </p>

          <p class="text-stone-600 dark:text-gray-400 mt-2">
            This project is open source! Check out the <a href="https://github.com/joseanes/gaslandsgarage" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline">GitHub repository</a> to contribute or report issues.
          </p>

          <p class="text-stone-600 dark:text-gray-400 mt-4">
            <span class="font-semibold text-stone-800 dark:text-white">Legal.</span>
            <a href="/privacy" class="text-amber-600 dark:text-amber-400 hover:underline" on:click={() => (showAboutModal = false)}>Privacy Policy</a>
            <span aria-hidden="true"> · </span>
            <a href="/terms" class="text-amber-600 dark:text-amber-400 hover:underline" on:click={() => (showAboutModal = false)}>Terms and Conditions</a>
          </p>

          <div class="mt-4">
            <h4 class="font-bold text-stone-800 dark:text-white text-lg mb-3">Gaslands Garage</h4>
            <p class="mb-2">The ultimate team builder for Gaslands tabletop game</p>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <div>
                <h5 class="font-semibold">Create</h5>
                <p class="text-sm">Design your perfect Gaslands team with all weapons, upgrades, and sponsor perks.</p>
              </div>
              <div>
                <h5 class="font-semibold">Share</h5>
                <p class="text-sm">Generate QR codes, links, or export your team to share with friends.</p>
              </div>
              <div>
                <h5 class="font-semibold">Print</h5>
                <p class="text-sm">Print vehicle cards for your games with all the information you need.</p>
              </div>
            </div>
            
            <!-- Friends of Gaslands Banner -->
            <div class="mt-10 p-4 bg-amber-100 dark:bg-amber-900 rounded-lg text-center">
              <h2 class="text-lg font-bold text-amber-800 dark:text-amber-100">Friends of Gaslands</h2>
              <div class="flex justify-center my-4">
                <img src="/images/friend-of-gaslands.webp" alt="Friend of Gaslands Logo" class="h-24" />
              </div>
              <p class="text-amber-700 dark:text-amber-200 mt-2">
                This is an unofficial fan-made tool. Gaslands is © 2017 Mike Hutchinson.
              </p>
              <p class="text-amber-600 dark:text-amber-300 mt-1 text-sm">
                <a href="https://gaslands.com" target="_blank" rel="noopener noreferrer" class="underline hover:text-amber-800 dark:hover:text-amber-100">Visit the official Gaslands website</a>
              </p>
              <div class="mt-3 flex justify-center">
                <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener noreferrer">
                  <img src="https://mirrors.creativecommons.org/presskit/buttons/88x31/png/by-nc.png" alt="Creative Commons BY-NC License" class="h-8" />
                </a>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Change Log Modal -->
{#if showChangeLogModal}
  <div
    class="fixed inset-0 bg-black z-50"
    role="dialog"
    aria-modal="true"
    aria-label="Change Log"
    tabindex="-1"
    transition:fade={{ duration: 150 }}
  >
    <!-- Background overlay -->
    <button
      class="absolute inset-0 w-full h-full border-0 cursor-pointer"
      on:click={() => showChangeLogModal = false}
      on:keydown={e => e.key === 'Escape' && (showChangeLogModal = false)}
      aria-label="Close modal background"
    ></button>

    <!-- Modal content -->
    <div
      class="bg-white dark:bg-gray-800 rounded-xl shadow-[0_0_25px_rgba(0,0,0,0.3)] w-11/12 sm:w-4/5 md:w-4/5 lg:w-4/5 mx-auto relative z-10 border-2 border-amber-500"
      role="document"
      style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); max-height: 90vh; overflow-y: auto; box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 0 0 4px rgba(245,158,11,0.4), 0 10px 25px -5px rgba(0,0,0,0.4); background-color: var(--modal-bg-color, white); padding: 1.5rem;"
    >
      <div class="flex justify-between items-center mb-6">
        <h3 class="text-xl font-bold text-stone-800 dark:text-white modal-heading">Change Log</h3>
        <button
          class="py-0.25 px-2 h-[2rem] flex items-center justify-center rounded transition-colors text-sm amber-button"
          on:click={() => showChangeLogModal = false}
          aria-label="Close change log modal"
        >
          <span>Close</span>
        </button>
      </div>

      <div class="space-y-6 text-stone-700 dark:text-gray-200 modal-text">
        <p>
          Below is a history of major updates and improvements to Gaslands Garage.
        </p>
        <ul><li><b>May 13, 2025</b> - Initial Alpha release.</li></ul>

        <div class="space-y-4 px-4">
          <!-- Change log entries will go here -->
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Upcoming Features Modal -->
{#if showUpcomingFeaturesModal}
  <div
    class="fixed inset-0 bg-black z-50"
    role="dialog"
    aria-modal="true"
    aria-label="Upcoming Features"
    tabindex="-1"
    transition:fade={{ duration: 150 }}
  >
    <!-- Background overlay -->
    <button
      class="absolute inset-0 w-full h-full border-0 cursor-pointer"
      on:click={() => showUpcomingFeaturesModal = false}
      on:keydown={e => e.key === 'Escape' && (showUpcomingFeaturesModal = false)}
      aria-label="Close modal background"
    ></button>

    <!-- Modal content -->
    <div
      class="bg-white dark:bg-gray-800 rounded-xl shadow-[0_0_25px_rgba(0,0,0,0.3)] w-11/12 sm:w-4/5 md:w-4/5 lg:w-4/5 mx-auto relative z-10 border-2 border-amber-500"
      role="document"
      style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); max-height: 90vh; overflow-y: auto; box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 0 0 4px rgba(245,158,11,0.4), 0 10px 25px -5px rgba(0,0,0,0.4); background-color: var(--modal-bg-color, white); padding: 1.5rem;"
    >
      <div class="flex justify-between items-center mb-6">
        <h3 class="text-xl font-bold text-stone-800 dark:text-white modal-heading">Upcoming Features</h3>
        <button
          class="py-0.25 px-2 h-[2rem] flex items-center justify-center rounded transition-colors text-sm amber-button"
          on:click={() => showUpcomingFeaturesModal = false}
          aria-label="Close upcoming features modal"
        >
          <span>Close</span>
        </button>
      </div>

      <div class="space-y-6 text-stone-700 dark:text-gray-200 modal-text">
        <p>
          Here's what we're working on for future updates to Gaslands Garage:
        </p>
        <ul class="px-4 space-y-2">
          <li>Improved validation of upgrades, perks, and weapons.</li>
          <li>Printing Options</li>
          <li>Apple Login</li>
          <li>Where to purchase accessories</li>
        </ul>

        <div class="space-y-4">
          <!-- Upcoming features list will go here -->
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Contributors Modal -->
{#if showContributorsModal}
  <div
    class="fixed inset-0 bg-black z-50"
    role="dialog"
    aria-modal="true"
    aria-label="Contributors"
    tabindex="-1"
    transition:fade={{ duration: 150 }}
  >
    <!-- Background overlay -->
    <button
      class="absolute inset-0 w-full h-full border-0 cursor-pointer"
      on:click={() => showContributorsModal = false}
      on:keydown={e => e.key === 'Escape' && (showContributorsModal = false)}
      aria-label="Close modal background"
    ></button>

    <!-- Modal content -->
    <div
      class="bg-white dark:bg-gray-800 rounded-xl shadow-[0_0_25px_rgba(0,0,0,0.3)] w-11/12 sm:w-4/5 md:w-4/5 lg:w-4/5 mx-auto relative z-10 border-2 border-amber-500"
      role="document"
      style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); max-height: 90vh; overflow-y: auto; box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 0 0 4px rgba(245,158,11,0.4), 0 10px 25px -5px rgba(0,0,0,0.4); background-color: var(--modal-bg-color, white); padding: 1.5rem;"
    >
      <div class="flex justify-between items-center mb-6">
        <h3 class="text-xl font-bold text-stone-800 dark:text-white modal-heading">Contributors</h3>
        <button
          class="py-0.25 px-2 h-[2rem] flex items-center justify-center rounded transition-colors text-sm amber-button"
          on:click={() => showContributorsModal = false}
          aria-label="Close contributors modal"
        >
          <span>Close</span>
        </button>
      </div>

      <div class="space-y-6 text-stone-700 dark:text-gray-200 modal-text">
        <p>
          Gaslands Garage is made possible by the following contributors:
        </p>
        <ul class="px-4 space-y-2">
          <li>Jose Anes, Project creator and <a href="https://FunBoardGames.Etsy.com">Gaslands Purveyor at FunBoardGames.</a></li>
          <li>Luca Vince Caltabiano from <a href="https://www.youtube.com/c/gaslandstv">Gaslands TV</a> for the video content</li>
        </ul>

        <div class="space-y-4">
          <!-- Contributors list will go here -->
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- About Gaslands Modal -->
{#if showAboutGaslandsModal}
  <div
    class="fixed inset-0 bg-black z-50"
    role="dialog"
    aria-modal="true"
    aria-label="About Gaslands"
    tabindex="-1"
    transition:fade={{ duration: 150 }}
  >
    <!-- Background overlay -->
    <button
      class="absolute inset-0 w-full h-full border-0 cursor-pointer"
      on:click={() => showAboutGaslandsModal = false}
      on:keydown={e => e.key === 'Escape' && (showAboutGaslandsModal = false)}
      aria-label="Close modal background"
    ></button>

    <!-- Modal content -->
    <div
      class="bg-white dark:bg-gray-800 rounded-xl shadow-[0_0_25px_rgba(0,0,0,0.3)] w-11/12 sm:w-4/5 md:w-4/5 lg:w-4/5 mx-auto relative z-10 border-2 border-amber-500"
      role="document"
      style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); max-height: 90vh; overflow-y: auto; box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 0 0 4px rgba(245,158,11,0.4), 0 10px 25px -5px rgba(0,0,0,0.4); background-color: var(--modal-bg-color, white); padding: 1.5rem;"
    >
      <div class="flex justify-between items-center mb-6">
        <h3 class="text-xl font-bold text-stone-800 dark:text-white modal-heading">About Gaslands</h3>
        <button
          class="py-0.25 px-2 h-[2rem] flex items-center justify-center rounded transition-colors text-sm amber-button"
          on:click={() => showAboutGaslandsModal = false}
          aria-label="Close about gaslands modal"
        >
          <span>Close</span>
        </button>
      </div>

      <div class="space-y-6 text-stone-700 dark:text-gray-200 modal-text">
        <p>
          Gaslands is a tabletop game of post-apocalyptic vehicular combat. Using converted Hot Wheels or Matchbox cars, it simulates a televised bloodsport where drivers compete in a variety of deadly scenarios.  Gaslands puts players in control of custom battle cars, buggies, trucks, and other vehicles armed with machine guns, rockets, flamethrowers and more. Players are encourage to modify readily available Hotwheels or Matchbox vehicles with bits and paint to make them look like a post-apocalyptical combat vehicle.  The game is set in a dystopian future where Earth has been devastated and Mars has been colonized by the wealthy elite. The poor left behind on Earth compete in televised death races for a chance to win citizenship on Mars.
        The game was created by Mike Hutchinson and published by Osprey Games.    To learn more about Gaslands, visit the <a href="https://gaslands.com" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline">official Gaslands website</a>.
          
        
        


        <div class="border-t border-stone-200 dark:border-gray-700 pt-4 mt-4 px-4">
          <h4 class="font-bold text-stone-800 dark:text-white text-lg mb-3">What You Need to Start Playing:</h4>
          <ul class="list-disc pl-5 space-y-2">
            <li><a href="https://amzn.to/4m7OQYa" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline">Rulebook</a> - The Gaslands Refuelled rulebook contains all the rules and scenarios</li>
            <li><a href="https://creatoriq.cc/434pUIp" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline">Gaslands Dice</a> - Version 2 requires special dice designed for the game. Version 3 doesn't.</li>
            <li><a href="https://amzn.to/4kaUcA2" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline">Regular 6-Sided Dice</a> - For resolving various game mechanics</li>
            <li><a href="https://creatoriq.cc/3GR0qqD" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline">Gaslands Templates</a> - Movement templates for driving your vehicles</li>
            <li><a href="https://creatoriq.cc/3GR0qqD" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline">Vehicles</a> - Hotwheels or Matchbox cars that you can modify</li>
          </ul>
        </div>


        <div class="border-t border-stone-200 dark:border-gray-700 pt-4 mt-4 px-4">
          <h4 class="font-bold text-stone-800 dark:text-white text-lg mb-3">Recommended Resources:</h4>
          <div class="bg-stone-100 dark:bg-gray-700 p-4 rounded-lg">
            <div class="flex items-center gap-3 mb-2">
              <div>
                <center><iframe width="560" height="315" src="https://www.youtube.com/embed/CL66NMhWwHo?si=KltcYCh9RbCqU2HQ" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
                <p class="text-sm">
                  Gaslands TV features game tutorials, battle reports, and showcases of custom Gaslands vehicles. A must-watch resource for beginners and experienced players alike.
                </p></center>
                <center class="mt-4"><iframe width="560" height="315" src="https://www.youtube.com/embed/j1iz_dMMhpg" title="Tiki bug build.  #hotwheels  #customdiecast #diecastcustom #gaslands #vwbeetle #tiki" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
                <p class="text-sm">
                  <a href="https://www.youtube.com/@bjscustoms/videos" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline">Bj's Customs</a> is Brandon's channel of diecast customs and Gaslands builds.
                </p></center>
                <ul><li><a href="https://www.etsy.com/shop/CreepyHeroStudios">Creepy Hero Studios</a> - Vehicule Accessories</li>
                  <li><a href="https://www.patreon.com/c/sablebadger/">Sable Badger</a> - 3D Printing Models</li></ul>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Teams Modal -->
{#if showTeamsModal && typeof window !== 'undefined' && window.location.pathname.includes('/builder')}
  <!-- Get the current draft data -->
  {@const draftValue = window.currentDraftFn ? window.currentDraftFn() : null}

  <!-- Get team name from any possible source -->
  {@const teamNameFromInput = (() => {
    try {
      const input = document.querySelector('input[placeholder="Team Name"]');
      return input instanceof HTMLInputElement && input.value ? input.value : null;
    } catch(e) {
      console.error("Error finding team name input:", e);
      return null;
    }
  })()}

  <!-- Ensure teamName is available for TeamsModal using best available source -->
  {@const ____ = (() => {
    // If window.teamName is missing or empty, try to set it from best available source
    if (!window.teamName || window.teamName.trim() === '') {
      if (teamNameFromInput) {
        window.teamName = teamNameFromInput;
      } else if (draftValue && draftValue.teamName) {
        window.teamName = draftValue.teamName;
      }
    }
    return null;
  })()}

  {@const bestTeamName = (() => {
      // Try to get the best team name from available sources
      if (typeof window.teamName === 'string' && window.teamName.trim() !== '') {
        return window.teamName;
      }
      if (teamNameFromInput) {
        return teamNameFromInput;
      }
      if (draftValue && draftValue.teamName) {
        return draftValue.teamName;
      }
      try {
        const input = document.querySelector('input[aria-label="Team Name"]');
        if (input instanceof HTMLInputElement && input.value) {
          return input.value;
        }
      } catch (e) {
        console.error("Error getting team name from input:", e);
      }
      return "My Gaslands Team";
    })()}
  
  <TeamsModal
    bind:showModal={showTeamsModal}
    currentDraft={{...draftValue, teamName: bestTeamName}}
    teamName={bestTeamName} 
    importDraft={(draft: unknown) => {
      // Try using custom event first (most reliable method)
      if (typeof window !== 'undefined' && draft) {
        try {
          window.dispatchEvent(new CustomEvent('gaslands-menu-action', {
            detail: { 
              action: 'importDraft',
              draft: draft
            }
          }));

          // Also try direct function call as fallback
          if (window.importDraftFn) {
            window.importDraftFn(draft);
          }
        } catch (error) {
          console.error('Error importing draft:', error);
          alert('There was an error loading the team. Please try again.');
        }
      } else {
        console.error('Cannot import draft - window object not available or draft is null');
      }
    }}
  />
{/if}

<style>
:root {
  --modal-bg-color: white;
}

:global(.dark), :global(.dark-mode) {
  --modal-bg-color: #1f2937; /* Matches dark:bg-gray-800 */
}

/* Menu styles */
:global(.menu-bar) {
  background-color: #000000;
  color: white;
  padding: 8px 0;
  margin-bottom: 12px;
  position: sticky;
  top: 0;
  /* Above the map's stacking context (z-index 0). Dialogs start at 50. */
  z-index: 10;
}

/* Dropdowns stack inside the sticky bar, above the account button.
   The account menu uses z-index 50 inside that same bar. */
:global(.share-menu-dropdown),
:global(.settings-menu-dropdown),
:global(.players-menu-dropdown),
:global(.help-menu-dropdown) {
  z-index: 30;
}

/* Share Team submenu. Narrow screens: an indented group under its button.
   Wide screens: a flyout beside the Teams menu, clamped to the viewport. */
:global(.share-team-group) {
  position: relative;
}

:global(.share-team-submenu) {
  border-left: 2px solid #f59e0b;
  margin-left: 0.75rem;
  background-color: #000000;
}

:global(.share-team-caret) {
  transition: transform 0.15s;
}

:global(.share-team-caret.open) {
  transform: rotate(90deg);
}

@media (min-width: 641px) {
  :global(.share-team-submenu) {
    position: absolute;
    top: -0.5rem;
    left: 100%;
    width: 11rem;
    /* No gap, so moving the pointer from the button to the flyout keeps it open. */
    margin-left: 0;
    border: 2px solid #f59e0b;
    border-radius: 0.5rem;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    z-index: 31;
  }

  :global(.share-team-caret.open) {
    transform: none;
  }
}

/* Removed the menu-container class as we're using the max-w-7xl class directly in the HTML */

:global(.logo) {
  font-weight: bold;
  font-size: 1.25rem;
  line-height: 1.2;
  letter-spacing: 0.02em;
}

:global(a.logo) {
  color: inherit;
  text-decoration: none;
}

:global(a.logo:focus) {
  outline: none;
}

:global(a.logo:focus-visible) {
  outline: 2px solid #f59e0b;
  outline-offset: 2px;
}

/* Responsive adjustments for mobile screens */
@media (max-width: 640px) {
  :global(.logo) {
    font-size: 1rem;
  }
  :global(.logo-sponsor) {
    font-size: 0.6rem;
  }
}

:global(.logo-highlight) {
  color: #f59e0b;
}

:global(.logo-sponsor) {
  font-size: 0.65rem;
  color: #cccccc;
  letter-spacing: 0.02em;
  line-height: 1;
  margin-top: -2px;
}

:global(.etsy-link) {
  color: #f59e0b;
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s;
}

:global(.etsy-link:hover) {
  color: #fcd34d;
  text-decoration: underline;
}

:global(.menu-item) {
  color: white;
  background: transparent;
  border: none;
  padding: 5px 10px;
  margin: 0;
  cursor: pointer;
  font: inherit;
  font-size: 0.9rem;
  border-radius: 4px;
}

@media (max-width: 640px) {
  :global(.menu-item) {
    padding: 4px 8px;
    font-size: 0.8rem;
  }
}

:global(.menu-item:hover) {
  color: #fcd34d;
  background-color: rgba(255, 255, 255, 0.1);
}

/* Print styles moved to separate print.css file */
</style>

<!-- Contact Us Modal -->
{#if showContactUsModal}
  <div
    class="fixed inset-0 bg-black z-50"
    role="dialog"
    aria-modal="true"
    aria-label="Contact Us"
    tabindex="-1"
    transition:fade={{ duration: 150 }}
  >
    <!-- Background overlay -->
    <button
      class="absolute inset-0 w-full h-full border-0 cursor-pointer"
      on:click={() => showContactUsModal = false}
      on:keydown={e => e.key === 'Escape' && (showContactUsModal = false)}
      aria-label="Close modal background"
    ></button>

    <!-- Modal content -->
    <div
      class="bg-white dark:bg-gray-800 rounded-xl shadow-[0_0_25px_rgba(0,0,0,0.3)] w-11/12 sm:w-4/5 md:w-4/5 lg:w-4/5 mx-auto relative z-10 border-2 border-amber-500"
      role="document"
      style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); max-height: 90vh; overflow-y: auto; box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 0 0 4px rgba(245,158,11,0.4), 0 10px 25px -5px rgba(0,0,0,0.4); background-color: var(--modal-bg-color, white); padding: 1.5rem;"
    >
      <div class="flex justify-between items-center mb-6">
        <h3 class="text-xl font-bold text-stone-800 dark:text-white modal-heading">Contact Us</h3>
        <button
          class="py-0.25 px-2 h-[2rem] flex items-center justify-center rounded transition-colors text-sm amber-button"
          on:click={() => showContactUsModal = false}
          aria-label="Close contact us modal"
        >
          <span>Close</span>
        </button>
      </div>

      <div class="space-y-6 text-stone-700 dark:text-gray-200 modal-text">
        {#if $user}
          <!-- Contact form for authenticated users -->
          <div class="max-w-2xl mx-auto">
            <p class="mb-4">We'd love to hear from you! Please fill out the form below and we'll get back to you as soon as possible.</p>

            <form class="space-y-4" on:submit|preventDefault={handleContactFormSubmit}>
              <div>
                <label for="contact-subject" class="block text-sm font-medium mb-1">Subject</label>
                <input
                  type="text"
                  id="contact-subject"
                  bind:value={contactSubject}
                  required
                  class="w-full px-3 py-2 border border-stone-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white dark:bg-gray-700 text-stone-800 dark:text-white"
                  placeholder="How can we help you?"
                />
              </div>

              <div>
                <label for="contact-message" class="block text-sm font-medium mb-1">Message</label>
                <textarea
                  id="contact-message"
                  bind:value={contactMessage}
                  required
                  rows="5"
                  class="w-full px-3 py-2 border border-stone-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white dark:bg-gray-700 text-stone-800 dark:text-white"
                  placeholder="Please provide details about your question or feedback..."
                ></textarea>
              </div>

              <div class="flex justify-end gap-3">
                <button
                  type="button"
                  class="px-4 py-2 border border-stone-300 dark:border-gray-600 rounded-lg text-stone-700 dark:text-gray-300 hover:bg-stone-100 dark:hover:bg-gray-700 transition-colors"
                  on:click={() => {
                    contactSubject = '';
                    contactMessage = '';
                    showContactUsModal = false;
                  }}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  class="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                  disabled={contactSubmitting}
                >
                  {#if contactSubmitting}
                    Sending...
                  {:else}
                    Send Message
                  {/if}
                </button>
              </div>

              {#if contactError}
                <div class="p-3 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 rounded-lg">
                  {contactError}
                </div>
              {/if}

              {#if contactSuccess}
                <div class="p-3 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 rounded-lg">
                  Your message has been sent successfully! We'll get back to you soon.
                </div>
              {/if}
            </form>
          </div>
        {:else}
          <!-- Message for unauthenticated users -->
          <div class="p-6 bg-stone-100 dark:bg-gray-700 rounded-lg text-center">
            <div class="text-amber-600 dark:text-amber-400 text-5xl mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
              </svg>
            </div>
            <h4 class="text-lg font-bold mb-2">Authentication Required</h4>
            <p class="mb-4">You need to be logged in to contact us. This helps us prevent spam and provide better support.</p>
            <button
              class="py-2 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors"
              on:click={() => {
                showContactUsModal = false;
                // Add logic here to open sign-in dialog if needed
              }}
            >
              Sign In to Continue
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}