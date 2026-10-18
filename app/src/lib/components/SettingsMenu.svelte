<script lang="ts">
  import { user } from '$lib/firebase';
  import AccountPrivacy from '$lib/components/AccountPrivacy.svelte';
  import { NEWSLETTER_CONSENT_COPY } from '$lib/privacy/marketingConsent';
  import { newsletterView } from '$lib/services/settings';

  // Props
  export let showSettingsModal = false;
  export let hasRules = false;
  export let enableSponsorships = true;
  export let includeAdvanced = true;
  export let darkMode = false;
  export let showTeamSummary = true;
  export let showGaslandsMath = false;
  export let printStyle = 'classic';
  export let showEquipmentDescriptions = false;
  export let showPerkDescriptions = false;
  export let showSpecialRules = false;
  export let showExperimentalFeatures = false;
  export let showOnPlayersMap = false;
  export let allowContactFromPlayers = false;
  export let location = '';
  export let receiveUpdates = false;
  export let saveSettingsToFirebase: (settings: Record<string, unknown>) => void | Promise<void> = async () => {};

  let newsletterOptIn = false;
  let newsletterTouched = false;
  let newsletterAnswered = false;
  let settingsWereOpen = false;

  function onNewsletterChange(event: Event) {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    newsletterOptIn = input.checked;
    newsletterTouched = true;
  }

  $: if ($newsletterView.loaded && !newsletterTouched) {
    newsletterOptIn = $newsletterView.optIn;
    newsletterAnswered = $newsletterView.answered;
  }

  $: if (showSettingsModal && !settingsWereOpen) {
    settingsWereOpen = true;
    newsletterTouched = false;
    newsletterOptIn = $newsletterView.optIn;
    newsletterAnswered = $newsletterView.answered;
  } else if (!showSettingsModal && settingsWereOpen) {
    settingsWereOpen = false;
    newsletterTouched = false;
  }
  
  // Local state - either 'general' or 'print'
  export let activeSettingsTab = 'general';
  
  // Update modal background color based on dark mode
  $: if (showSettingsModal) {
    setTimeout(() => {
      const modal = document.querySelector('.settings-modal-content');
      if (modal instanceof HTMLElement) {
        modal.style.backgroundColor = darkMode ? '#1f2937' : 'white';
      }
    }, 0);
  }
  
  // Direct save to localStorage whenever print settings change
  $: {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        // Use consistent key names between reactive saving and explicit button saving
        window.localStorage.setItem('user_print_style', printStyle);
        window.localStorage.setItem('user_show_equipment', showEquipmentDescriptions ? '1' : '0');
        window.localStorage.setItem('user_show_perks', showPerkDescriptions ? '1' : '0');
        window.localStorage.setItem('user_show_special_rules', showSpecialRules ? '1' : '0');
        console.log("Print settings reactively saved to localStorage:", { 
          printStyle, 
          showEquipmentDescriptions, 
          showPerkDescriptions,
          showSpecialRules 
        });
      } catch (e) {
        console.error("Error saving print settings to localStorage:", e);
      }
    }
  }
</script>

{#if showSettingsModal}
  <div
    class="fixed inset-0 bg-black/90 z-50"
    role="dialog"
    aria-modal="true"
    aria-label="Settings"
    tabindex="-1"
  >
    <!-- Adding a button to make the whole backdrop clickable/accessible -->
    <button
      class="absolute inset-0 w-full h-full border-0 bg-transparent cursor-pointer"
      on:click={() => (showSettingsModal = false)}
      on:keydown={e => e.key === 'Escape' && (showSettingsModal = false)}
      aria-label="Close modal background"
    ></button>
    <div
      class="bg-white dark:bg-gray-800 rounded-xl shadow-[0_0_25px_rgba(0,0,0,0.3)] px-3 py-6 md:py-8 w-11/12 sm:w-4/5 md:w-4/5 lg:w-4/5 mx-auto relative z-10 border-2 border-amber-500 settings-modal-content"
      role="document"
      style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); max-height: 90vh; overflow-y: auto; box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 0 0 4px rgba(245,158,11,0.4), 0 10px 25px -5px rgba(0,0,0,0.4);"
    >
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-bold text-stone-800 dark:text-white">Settings</h3>
        <div class="flex gap-2">
          <button
            class="py-0.25 px-6 h-[32px] flex items-center justify-center rounded-lg transition-colors text-sm amber-button shadow-md"
            style="height: 32px !important; min-height: 32px !important;"
            on:click={async () => {
              console.log("[SettingsMenu] Save & Close clicked");
              console.log("[SettingsMenu] Print settings: ", {
                printStyle,
                showEquipmentDescriptions,
                showPerkDescriptions,
                showSpecialRules
              });
              
              // EXPLICITLY SAVE MOST IMPORTANT SETTINGS TO LOCALSTORAGE
              localStorage.setItem('printStyle', printStyle);
              localStorage.setItem('showEquipmentDescriptions', String(showEquipmentDescriptions));
              localStorage.setItem('showPerkDescriptions', String(showPerkDescriptions));
              localStorage.setItem('showSpecialRules', String(showSpecialRules));
              
              // ALSO SAVE WITH ALTERNATE NAMING FOR COMPATIBILITY
              localStorage.setItem('user_print_style', printStyle);
              localStorage.setItem('user_show_equipment', showEquipmentDescriptions ? '1' : '0');
              localStorage.setItem('user_show_perks', showPerkDescriptions ? '1' : '0');
              localStorage.setItem('user_show_special_rules', showSpecialRules ? '1' : '0');
              
              // SAVE OTHER SETTINGS
              localStorage.setItem('darkMode', String(darkMode));
              localStorage.setItem('hasRules', String(hasRules));
              localStorage.setItem('includeAdvanced', String(includeAdvanced));
              localStorage.setItem('enableSponsorships', String(enableSponsorships));
              
              console.log("[SettingsMenu] Settings saved to localStorage, printStyle:", printStyle);
              
              // SAVE TO FIREBASE IF LOGGED IN
              if ($user) {
                console.log("[SettingsMenu] User logged in, saving to Firebase");
                try {
                  // Create ALL settings
                  const settings = {
                    printStyle,
                    showEquipmentDescriptions,
                    showPerkDescriptions,
                    showSpecialRules,
                    hasRules,
                    darkMode,
                    enableSponsorships,
                    includeAdvanced,
                    showTeamSummary,
                    showGaslandsMath,
                    showExperimentalFeatures,
                    showOnPlayersMap,
                    allowContactFromPlayers,
                    location,
                    receiveUpdates,
                    ...(newsletterTouched || newsletterAnswered ? { newsletterOptIn } : {})
                  };
                  
                  await saveSettingsToFirebase(settings);
                  console.log("[SettingsMenu] Settings saved to Firebase");
                } catch (error) {
                  console.error("[SettingsMenu] Error saving to Firebase:", error);
                }
              }
              
              // Close the modal
              showSettingsModal = false;
            }}
            aria-label="Save and close settings"
          >
            <span>Save & Close</span>
          </button>
          <button
            class="py-0.25 px-2 h-[32px] flex items-center justify-center rounded transition-colors text-sm amber-button"
            on:click={() => (showSettingsModal = false)}
            aria-label="Close settings modal without saving"
            style="height: 32px !important; min-height: 32px !important;"
          >
            <span>Cancel</span>
          </button>
        </div>
      </div>
      
      <!-- Hidden heading to indicate which tab we're on -->
      <div class="mb-4 py-2 px-4 font-medium text-lg text-amber-600 dark:text-amber-400 border-b border-amber-500">
        {activeSettingsTab === 'general' ? 'General Settings' : 'Print Settings'}
      </div>

      <!-- Tab Content Wrapper -->
      <div class="space-y-3 px-4">
        {#if activeSettingsTab === 'general'}
          <!-- Gaslands Refueled Book Acknowledgment - At the top -->
          <div class="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 space-y-3">
            <div class="flex items-center">
              <input
                type="checkbox"
                id="has-rules-setting"
                bind:checked={hasRules}
                class="w-5 h-5 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 rounded focus:ring-amber-500"
              />
              <label for="has-rules-setting" class="ml-3 text-stone-800 dark:text-white font-medium">
                I have the Gaslands Refuelled rulebook
              </label>
            </div>
            <p class="text-stone-600 dark:text-gray-200 text-sm ml-8">
              Acknowledge that you own a copy of the Gaslands Refuelled rules. This is required to use Play Mode and Print features.
              <a href="https://amzn.to/4m7OQYa" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline ml-1">
                Purchase the book here
              </a>
            </p>
          </div>

          <!-- Game Options Section -->
          <div class="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 space-y-3">
            <h4 class="font-medium text-stone-800 dark:text-white mb-3">Game Options</h4>

            <div class="flex items-center mt-3">
              <input
                type="checkbox"
                id="enable-sponsorships"
                bind:checked={enableSponsorships}
                class="w-5 h-5 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 rounded focus:ring-amber-500"
              />
              <label for="enable-sponsorships" class="ml-3 text-stone-800 dark:text-white font-medium">
                Enable Sponsorships
              </label>
            </div>
            <p class="text-stone-600 dark:text-gray-200 text-sm ml-8">
              If you prefer to build a team without using Sponsor or driver perks, uncheck this option.
            </p>

            <div class="flex items-center mt-3">
              <input
                type="checkbox"
                id="include-advanced"
                bind:checked={includeAdvanced}
                class="w-5 h-5 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 rounded focus:ring-amber-500"
              />
              <label for="include-advanced" class="ml-3 text-stone-800 dark:text-white font-medium">
                Include Advanced
              </label>
            </div>
            <p class="text-stone-600 dark:text-gray-200 text-sm ml-8">
              Enable this option to include advanced vehicles, weapons, and upgrades from the rulebook. When disabled, only basic options will be shown.
            </p>
          </div>

          <!-- Display Options Section -->
          <div class="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 space-y-3">
            <h4 class="font-medium text-stone-800 dark:text-white mb-3">Display Options</h4>

            <div class="flex items-center mt-3">
              <input
                type="checkbox"
                id="dark-mode"
                bind:checked={darkMode}
                class="w-5 h-5 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 rounded focus:ring-amber-500"
              />
              <label for="dark-mode" class="ml-3 text-stone-800 dark:text-white font-medium">
                Dark Mode
              </label>
            </div>
            <p class="text-stone-600 dark:text-gray-200 text-sm ml-8">
              Enable dark mode for better visibility in low-light conditions.
            </p>

            <div class="flex items-center mt-3">
              <input
                type="checkbox"
                id="show-team-summary"
                bind:checked={showTeamSummary}
                class="w-5 h-5 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 rounded focus:ring-amber-500"
              />
              <label for="show-team-summary" class="ml-3 text-stone-800 dark:text-white font-medium">
                Show Team Summary
              </label>
            </div>
            <p class="text-stone-600 dark:text-gray-200 text-sm ml-8">
              Show or hide the Team Summary section at the bottom of the page.
            </p>

            <div class="flex items-center mt-3">
              <input
                type="checkbox"
                id="show-gaslands-math"
                bind:checked={showGaslandsMath}
                class="w-5 h-5 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 rounded focus:ring-amber-500"
              />
              <label for="show-gaslands-math" class="ml-3 text-stone-800 dark:text-white font-medium">
                Show Gaslands Coach
              </label>
            </div>
            <p class="text-stone-600 dark:text-gray-200 text-sm ml-8">
              Show or hide the Gaslands Coach section with team analysis and suggestions.
            </p>
          </div>

          <!-- Experimental Features Option -->
          <div class="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 space-y-3">
            <div class="flex items-center">
              <input
                type="checkbox"
                id="show-experimental-features"
                bind:checked={showExperimentalFeatures}
                class="w-5 h-5 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 rounded focus:ring-amber-500"
              />
              <label for="show-experimental-features" class="ml-3 text-stone-800 dark:text-white font-medium">
                Show Experimental Features
              </label>
            </div>
            <p class="text-stone-600 dark:text-gray-200 text-sm ml-8">
              Enable this option to access features that are still under development.
            </p>
          </div>

          <!-- Email Updates Option - Only shown when logged in -->
          {#if $user}
            <div class="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 space-y-3">
              <div class="flex items-center">
                <input
                  type="checkbox"
                  id="receive-updates"
                  bind:checked={receiveUpdates}
                  class="w-5 h-5 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 rounded focus:ring-amber-500"
                />
                <label for="receive-updates" class="ml-3 text-stone-800 dark:text-white font-medium">
                  Keep me up to date
                </label>
              </div>
              <p class="text-stone-600 dark:text-gray-200 text-sm ml-8">
                Receive emails with Gaslands and Gaslands Garage feature updates and marketing materials.
              </p>
            </div>

            <div class="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 space-y-3" data-testid="newsletter-setting">
              <div class="flex items-start">
                <input
                  type="checkbox"
                  id="newsletter-opt-in"
                  checked={newsletterOptIn}
                  on:change={onNewsletterChange}
                  data-testid="newsletter-opt-in"
                  class="mt-1 w-5 h-5 shrink-0 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 rounded focus:ring-amber-500"
                />
                <label for="newsletter-opt-in" class="ml-3 text-stone-800 dark:text-white font-medium">
                  {NEWSLETTER_CONSENT_COPY}
                </label>
              </div>
            </div>

            <AccountPrivacy />
          {/if}
        {/if}
        
        {#if activeSettingsTab === 'print'}
          <div class="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 space-y-3">
            <h4 class="font-medium text-stone-800 dark:text-white mb-3">Print Style</h4>
            <div class="space-y-2">
              <div class="flex items-center">
                <input
                  type="radio"
                  id="print-style-classic"
                  name="print-style"
                  value="classic"
                  bind:group={printStyle}
                  class="w-4 h-4 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 focus:ring-amber-500"
                />
                <label for="print-style-classic" class="ml-3 text-stone-800 dark:text-white">
                  Classic
                </label>
              </div>
              <div class="flex items-center">
                <input
                  type="radio"
                  id="print-style-dashboard"
                  name="print-style"
                  value="dashboard"
                  bind:group={printStyle}
                  class="w-4 h-4 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 focus:ring-amber-500"
                />
                <label for="print-style-dashboard" class="ml-3 text-stone-800 dark:text-white">
                  Dashboard
                </label>
              </div>
              <div class="flex items-center">
                <input
                  type="radio"
                  id="print-style-roster"
                  name="print-style"
                  value="roster"
                  bind:group={printStyle}
                  class="w-4 h-4 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 focus:ring-amber-500"
                />
                <label for="print-style-roster" class="ml-3 text-stone-800 dark:text-white">
                  Roster
                </label>
              </div>
              
            </div>
            <p class="text-stone-600 dark:text-gray-200 text-sm ml-8">
              Choose your preferred print layout style:
            </p>
            <ul class="text-stone-600 dark:text-gray-200 text-sm ml-12 list-disc space-y-1 my-2">
              <li><strong>Classic:</strong> Traditional vehicle cards with detailed information</li>
              <li><strong>Dashboard:</strong> Vehicle dashboard view with visual hull/gear trackers</li>
              <li><strong>Roster:</strong> Clean, compact format optimized for reference during gameplay</li>
            </ul>

            <!-- Print Description Options -->
            <div class="mt-4 border-t pt-4 border-amber-100 dark:border-amber-900/50">
              <h5 class="font-medium text-stone-800 dark:text-white mb-3">Print Content Options</h5>

              <div class="flex items-center mt-3">
                <input
                  type="checkbox"
                  id="show-equipment-descriptions"
                  bind:checked={showEquipmentDescriptions}
                  class="w-5 h-5 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 rounded focus:ring-amber-500"
                />
                <label for="show-equipment-descriptions" class="ml-3 text-stone-800 dark:text-white font-medium">
                  Show Equipment Descriptions
                </label>
              </div>
              <p class="text-stone-600 dark:text-gray-200 text-sm ml-8 mb-3">
                Include descriptions of weapons and upgrades in the printout.
              </p>

              <div class="flex items-center">
                <input
                  type="checkbox"
                  id="show-perk-descriptions"
                  bind:checked={showPerkDescriptions}
                  class="w-5 h-5 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 rounded focus:ring-amber-500"
                />
                <label for="show-perk-descriptions" class="ml-3 text-stone-800 dark:text-white font-medium">
                  Show Perk Descriptions
                </label>
              </div>
              <p class="text-stone-600 dark:text-gray-200 text-sm ml-8 mb-3">
                Include descriptions of perks in the printout.
              </p>

              <div class="flex items-center">
                <input
                  type="checkbox"
                  id="show-special-rules"
                  bind:checked={showSpecialRules}
                  class="w-5 h-5 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 rounded focus:ring-amber-500"
                />
                <label for="show-special-rules" class="ml-3 text-stone-800 dark:text-white font-medium">
                  Show Special Rules
                </label>
              </div>
              <p class="text-stone-600 dark:text-gray-200 text-sm ml-8">
                Include descriptions of vehicle special rules in the printout.
              </p>
            </div>
          </div>

          <!-- Players Map Section - Only shown when logged in -->
          {#if $user && showExperimentalFeatures}
            <div class="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 space-y-3">
              <h4 class="font-medium text-stone-800 dark:text-white mb-3">Players Map</h4>

              <div class="flex items-center">
                <input
                  type="checkbox"
                  id="show-on-players-map"
                  bind:checked={showOnPlayersMap}
                  class="w-5 h-5 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 rounded focus:ring-amber-500"
                />
                <label for="show-on-players-map" class="ml-3 text-stone-800 dark:text-white font-medium">
                  Show me on the Gaslands Players map
                </label>
              </div>
              <p class="text-stone-600 dark:text-gray-200 text-sm ml-8 mb-4">
                Appear on the global map of Gaslands players to connect with local players.
              </p>

              <div class="flex items-center">
                <input
                  type="checkbox"
                  id="allow-contact-from-players"
                  bind:checked={allowContactFromPlayers}
                  class="w-5 h-5 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 rounded focus:ring-amber-500"
                />
                <label for="allow-contact-from-players" class="ml-3 text-stone-800 dark:text-white font-medium">
                  Allow other players to contact me to setup a game
                </label>
              </div>
              <p class="text-stone-600 dark:text-gray-200 text-sm ml-8 mb-4">
                Let other players in your area reach out to organize games.
              </p>

              <div class="mt-2">
                <label for="location-input" class="block text-stone-800 dark:text-white font-medium mb-1">
                  Your location
                </label>
                <input
                  type="text"
                  id="location-input"
                  bind:value={location}
                  placeholder="Enter your town/city/county, province/state, country"
                  list="location-suggestions"
                  class="w-full px-4 py-2 border border-stone-300 dark:border-gray-600 rounded-md text-stone-800 dark:text-white bg-white dark:bg-gray-700 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
                <datalist id="location-suggestions">
                  <option value="New York, NY, USA"></option>
                  <option value="Los Angeles, CA, USA"></option>
                  <option value="Chicago, IL, USA"></option>
                  <option value="London, UK"></option>
                  <option value="Sydney, NSW, Australia"></option>
                  <option value="Toronto, ON, Canada"></option>
                  <option value="Berlin, Germany"></option>
                  <option value="Paris, France"></option>
                  <option value="Tokyo, Japan"></option>
                </datalist>
                <p class="text-stone-600 dark:text-gray-200 text-sm mt-1">
                  Provide your location to help find nearby players. We recommend including your town/city, state/province, and country.
                </p>
              </div>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}