<script lang="ts">
  import { user } from '$lib/firebase';
  import { SHOW_BUDDY_HIDE_TOGGLE } from '$lib/features/buddyHide';
  import { getUserTeams, saveTeam, deleteTeam, setTeamHiddenFromBuddies } from '$lib/services/team';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import Auth from './Auth.svelte';

  type ScrapedVehicle = {
    id: string;
    type: string;
    name: string;
    weapons: string[];
    upgrades: string[];
    perks: string[];
  };

  type SaveDraft = {
    sponsor: string;
    sponsorId?: string;
    vehicles: ScrapedVehicle[];
    teamName: string;
    maxCans: number;
    darkMode: boolean;
    rulesVersion?: 2 | 3;
  };

  type SavedTeam = {
    id: string;
    teamName?: string;
    updatedAt?: string;
    hiddenFromBuddies?: boolean;
    teamData?: {
      sponsor?: string;
      sponsorId?: string;
      vehicles?: unknown;
      teamName?: string;
    };
  };

  export let showModal = false;
  export let currentDraft: { teamName?: string } | null = null;
  export let importDraft: (draft: unknown) => void;
  
  // Add explicit teamName prop that can be passed directly
  export let teamName = ""; // Allow direct passing of team name
  
  let isLoading = false;
  let isSaving = false;
  let deletingTeamId: string | null = null;
  let userTeams: SavedTeam[] = [];
  let newTeamName = '';
  
  // Load user's teams when the modal opens
  $: if (showModal && $user) {
    loadUserTeams();
  }

  // Watch for modal opening to set default values
  let previousModalState = false;
  $: {
    if (showModal && !previousModalState) {
      // Modal was just opened
      console.log("Modal opened with currentDraft:", currentDraft);
      console.log("window.teamName available:", typeof window !== 'undefined' ? window.teamName : 'window not defined');
      
      // Get the team name from multiple sources, prioritized
      if (typeof window !== 'undefined') {
        try {
          // First check if the teamName prop was provided directly (highest priority)
          if (teamName && teamName.trim() !== '') {
            newTeamName = teamName;
            console.log("Got team name from direct prop:", newTeamName);
          }
          // Then check currentDraft (second priority)
          else if (currentDraft && currentDraft.teamName) {
            newTeamName = currentDraft.teamName;
            console.log("Got team name from currentDraft:", newTeamName);
          }
          // Try window.teamName third
          else if (typeof window.teamName === 'string' && window.teamName.trim() !== '') {
            newTeamName = window.teamName;
            console.log("Got team name from window:", newTeamName);
          }
          // Try to find team name in the DOM as the fourth option
          else {
            try {
              // Try specific selector for the team name input
              const teamNameInput = document.querySelector('input[aria-label="Team Name"]');
              if (teamNameInput instanceof HTMLInputElement && teamNameInput.value) {
                newTeamName = teamNameInput.value;
                console.log("Got team name from DOM input field (aria-label):", newTeamName);
                // Also set window.teamName for future reference
                window.teamName = newTeamName;
              }
              // Fallback to placeholder attribute
              else {
                const altTeamNameInput = document.querySelector('input[placeholder*="Team Name"]');
                if (altTeamNameInput instanceof HTMLInputElement && altTeamNameInput.value) {
                  newTeamName = altTeamNameInput.value;
                  console.log("Got team name from DOM input field (placeholder):", newTeamName);
                  // Also set window.teamName for future reference
                  window.teamName = newTeamName;
                }
                // Last resort - use default
                else {
                  newTeamName = "My Gaslands Team";
                  console.log("Using default team name, couldn't find name anywhere");
                }
              }
            } catch (domError) {
              console.error("Error finding team name in DOM:", domError);
              newTeamName = "My Gaslands Team";
            }
          }
          
          // Debug output to help understand what's happening
          console.log("Final newTeamName value:", newTeamName);
          console.log("window.teamName value:", window.teamName);
          console.log("currentDraft?.teamName value:", currentDraft?.teamName);
          
        } catch (e) {
          console.error("Error getting team name:", e);
          // Set a default team name if there's an error
          newTeamName = "My Gaslands Team";
        }
      }
    }
    previousModalState = showModal;
  }
  
  // Add onMount to try getting team name directly when the modal is mounted
  onMount(() => {
    // When the modal is opened, immediately try to get the team name from the input field 
    if (typeof document !== 'undefined') {
      // Add event listener for the custom team name update event
      const handleTeamNameUpdate = (event: Event) => {
        if (!(event instanceof CustomEvent)) return;
        const detail = event.detail as { teamName?: string };
        if (detail.teamName) {
          newTeamName = detail.teamName;
          console.log("Got team name from custom event:", newTeamName);
        }
      };
      
      // Add the event listener
      document.addEventListener('gaslands-team-name-update', handleTeamNameUpdate);
      
      // Use a slight delay to ensure DOM is available and window.teamName has been set
      if (showModal) {
        setTimeout(() => {
          try {
            // Look specifically for the team name input
            const teamNameInput = document.querySelector('input[aria-label="Team Name"]');
            if (teamNameInput instanceof HTMLInputElement && teamNameInput.value && teamNameInput.value.trim() !== '') {
              newTeamName = teamNameInput.value;
              console.log("onMount: Got team name directly from DOM input:", newTeamName);
            } else {
              console.log("onMount: Couldn't find team name input in DOM or it was empty");
            }
          } catch (e) {
            console.error("onMount: Error getting team name from DOM:", e);
          }
        }, 50);
      }
      
      // Clean up the event listener when the component is destroyed
      return () => {
        document.removeEventListener('gaslands-team-name-update', handleTeamNameUpdate);
      };
    }
  });
  
  async function loadUserTeams() {
    if (!$user) {
      console.log("No user logged in, unable to load teams");
      return;
    }

    isLoading = true;
    console.log("Loading teams for user:", $user.uid);
    const result = await getUserTeams();
    isLoading = false;

    if (result.success && result.teams) {
      userTeams = result.teams;
      console.log(`Successfully loaded ${result.teams.length} teams`);
    } else {
      console.error("Failed to load teams:", result.error);
    }
  }
  
  // Save current team
  async function saveCurrentTeam() {
    if (!$user || !newTeamName.trim()) return;
    
    console.log("About to save team");

    // First check if a team with this name already exists
    const existingTeam = userTeams.find(team => team.teamName === newTeamName.trim());

    // If team exists, ask for confirmation before overwriting
    if (existingTeam) {
      const confirmOverwrite = confirm(`A team named "${newTeamName}" already exists. Do you want to overwrite it?`);
      if (!confirmOverwrite) {
        return; // User canceled the overwrite
      }
      
      // Set isSaving flag
      isSaving = true;
      
      // Note: We'll pass the existing team ID to saveTeam later
      console.log(`User confirmed overwrite of team "${existingTeam.teamName}" with ID: ${existingTeam.id}`);
    } else {
      isSaving = true;
    }

    try {
      let draftToSave: SaveDraft | null = null;
      
      // Try to create a team with the most detailed data we can extract from the DOM
      // This is the most reliable approach that doesn't depend on any window functions
      const vehicleCards = document.querySelectorAll('.vehicle-card');
      
      if (vehicleCards && vehicleCards.length > 0) {
        console.log("Found vehicle cards in DOM:", vehicleCards.length);
        
        // Get sponsor from any select we can find
        const allSelects = document.querySelectorAll('select');
        let sponsorId = 'miyazaki'; // Default fallback
        
        // Look for sponsor selects
        for (const select of allSelects) {
          const selectedOption = select.options[select.selectedIndex];
          if (selectedOption && select.id && select.id.includes('sponsor')) {
            sponsorId = select.value;
            break;
          }
        }
        
        // Try to extract detailed vehicle information from the cards
        const vehicles: ScrapedVehicle[] = [];
        
        // Process each vehicle card to extract as much info as possible
        vehicleCards.forEach((card, index) => {
          try {
            // Basic vehicle structure
            const vehicle: ScrapedVehicle = {
              id: `vehicle_${index + 1}`,
              type: 'car', // Default
              weapons: [],
              upgrades: [],
              perks: [],
              name: `Vehicle ${index + 1}`
            };
            
            // Try to get vehicle type from select boxes within this card
            const typeSelects = card.querySelectorAll('select');
            for (const select of typeSelects) {
              if (select.id && select.id.toLowerCase().includes('type')) {
                vehicle.type = select.value || 'car';
                break;
              }
            }
            
            // Try to find vehicle name from inputs
            const nameInputs = card.querySelectorAll('input');
            for (const input of nameInputs) {
              if (input.placeholder && input.placeholder.toLowerCase().includes('name')) {
                vehicle.name = input.value || `Vehicle ${index + 1}`;
                break;
              }
            }
            
            // Try different ways to find weapons, upgrades, and perks
            // Use wider selectors with multiple ways to identify these items
            
            // Look for weapon elements - try different query selectors
            const weaponElements = card.querySelectorAll('.weapon-item, [data-weapon-id], [data-item-type="weapon"], .weapon');
            if (weaponElements && weaponElements.length > 0) {
              for (const element of weaponElements) {
                if (!(element instanceof HTMLElement)) continue;
                // Try to extract weapon ID from data attribute, class, or id
                const weaponId = element.dataset.weaponId || 
                                 element.dataset.itemId || 
                                 element.id || 
                                 element.getAttribute('data-id') ||
                                 element.textContent?.trim();
                                 
                if (weaponId && !vehicle.weapons.includes(weaponId)) {
                  vehicle.weapons.push(weaponId);
                  console.log(`Found weapon: ${weaponId}`);
                }
              }
            }
            
            // Look for upgrade elements - try different query selectors
            const upgradeElements = card.querySelectorAll('.upgrade-item, [data-upgrade-id], [data-item-type="upgrade"], .upgrade');
            if (upgradeElements && upgradeElements.length > 0) {
              for (const element of upgradeElements) {
                if (!(element instanceof HTMLElement)) continue;
                // Try to extract upgrade ID from data attribute, class, or id
                const upgradeId = element.dataset.upgradeId || 
                                  element.dataset.itemId || 
                                  element.id || 
                                  element.getAttribute('data-id') ||
                                  element.textContent?.trim();
                                  
                if (upgradeId && !vehicle.upgrades.includes(upgradeId)) {
                  vehicle.upgrades.push(upgradeId);
                  console.log(`Found upgrade: ${upgradeId}`);
                }
              }
            }
            
            // Look for perk elements - try different query selectors
            const perkElements = card.querySelectorAll('.perk-item, [data-perk-id], [data-item-type="perk"], .perk');
            if (perkElements && perkElements.length > 0) {
              for (const element of perkElements) {
                if (!(element instanceof HTMLElement)) continue;
                // Try to extract perk ID from data attribute, class, or id
                const perkId = element.dataset.perkId || 
                               element.dataset.itemId || 
                               element.id || 
                               element.getAttribute('data-id') ||
                               element.textContent?.trim();
                               
                if (perkId && !vehicle.perks.includes(perkId)) {
                  vehicle.perks.push(perkId);
                  console.log(`Found perk: ${perkId}`);
                }
              }
            }
            
            // Also try to find item lists with common elements
            const itemLists = card.querySelectorAll('.weapon-list, .upgrade-list, .perk-list, .items-list');
            if (itemLists && itemLists.length > 0) {
              for (const list of itemLists) {
                // Check all children for data attributes or IDs
                const items = list.querySelectorAll('*');
                for (const item of items) {
                  if (!(item instanceof HTMLElement)) continue;
                  // Try to determine the item type
                  let itemType = 'unknown';
                  if (list.classList.contains('weapon-list') || item.classList.contains('weapon')) {
                    itemType = 'weapon';
                  } else if (list.classList.contains('upgrade-list') || item.classList.contains('upgrade')) {
                    itemType = 'upgrade';
                  } else if (list.classList.contains('perk-list') || item.classList.contains('perk')) {
                    itemType = 'perk';
                  } else if (item.dataset.itemType) {
                    itemType = item.dataset.itemType;
                  }
                  
                  // Get the item ID
                  const itemId = item.dataset.id || item.dataset.itemId || item.id || item.textContent?.trim();
                  
                  // Add to appropriate array if valid
                  if (itemId) {
                    if (itemType === 'weapon' && !vehicle.weapons.includes(itemId)) {
                      vehicle.weapons.push(itemId);
                      console.log(`Found weapon in list: ${itemId}`);
                    } else if (itemType === 'upgrade' && !vehicle.upgrades.includes(itemId)) {
                      vehicle.upgrades.push(itemId);
                      console.log(`Found upgrade in list: ${itemId}`);
                    } else if (itemType === 'perk' && !vehicle.perks.includes(itemId)) {
                      vehicle.perks.push(itemId);
                      console.log(`Found perk in list: ${itemId}`);
                    }
                  }
                }
              }
            }
            
            // Add this vehicle to our list
            vehicles.push(vehicle);
          } catch (error) {
            console.error(`Error extracting data for vehicle ${index}:`, error);
            // Add a basic vehicle as fallback
            vehicles.push({
              id: `vehicle_${index + 1}`,
              type: 'car',
              weapons: [],
              upgrades: [],
              perks: [],
              name: `Vehicle ${index + 1}`
            });
          }
        });
        
        // Get maxCans from input if available
        let maxCans = 50; // Default
        const maxCansInputs = document.querySelectorAll('input[type="number"]');
        for (const input of maxCansInputs) {
          if (!(input instanceof HTMLInputElement)) continue;
          if (input.id && input.id.toLowerCase().includes('cans')) {
            maxCans = parseInt(input.value) || 50;
            break;
          }
        }
        
        // Try to get window values as they are likely more accurate if available
        if (typeof window !== 'undefined') {
          // Use window global data if available
          if (window.vehicles && Array.isArray(window.vehicles) && window.vehicles.length > 0) {
            console.log("Found window.vehicles, using that instead of DOM extraction");
            vehicles.length = 0; // Clear the array
            
            // Deep clone each vehicle to avoid reference issues
            window.vehicles.forEach(v => {
              // Ensure each vehicle has the required properties
              const vehicleClone = JSON.parse(JSON.stringify(v));
              
              // Make sure arrays exist
              if (!Array.isArray(vehicleClone.weapons)) {
                console.warn(`Vehicle ${vehicleClone.id || 'unknown'} is missing weapons array, adding empty array`);
                vehicleClone.weapons = [];
              }
              
              if (!Array.isArray(vehicleClone.upgrades)) {
                console.warn(`Vehicle ${vehicleClone.id || 'unknown'} is missing upgrades array, adding empty array`);
                vehicleClone.upgrades = [];
              }
              
              if (!Array.isArray(vehicleClone.perks)) {
                console.warn(`Vehicle ${vehicleClone.id || 'unknown'} is missing perks array, adding empty array`);
                vehicleClone.perks = [];
              }
              
              // Log what we're saving
              console.log(`Saving vehicle with ID ${vehicleClone.id}: ${vehicleClone.weapons.length} weapons, ${vehicleClone.upgrades.length} upgrades, ${vehicleClone.perks.length} perks`);
              console.log(`Weapons: ${vehicleClone.weapons.join(', ')}`);
              console.log(`Upgrades: ${vehicleClone.upgrades.join(', ')}`);
              console.log(`Perks: ${vehicleClone.perks.join(', ')}`);
              
              vehicles.push(vehicleClone);
            });
          }
          
          if (window.sponsorId) {
            sponsorId = window.sponsorId;
          }
          
          if (window.maxCans) {
            maxCans = window.maxCans;
          }
        }
        
        // Create the draft with the data we collected
        draftToSave = {
          sponsor: sponsorId,
          vehicles: vehicles,
          teamName: newTeamName.trim(),
          maxCans: maxCans,
          rulesVersion: window.rulesVersion === 3 ? 3 : 2,
          darkMode: document.documentElement.classList.contains('dark-mode')
        };
        
        console.log("Created draft with visible vehicle cards:", draftToSave);
      }
      
      // If no vehicles were found in DOM, offer to save a basic empty team
      if (!draftToSave) {
        if (confirm("Unable to detect existing vehicles. Would you like to save a basic team with a single empty vehicle?")) {
          draftToSave = {
            sponsor: "miyazaki",
            rulesVersion: window.rulesVersion === 3 ? 3 : 2,
            vehicles: [
              {
                id: "vehicle_1",
                type: "car",
                weapons: [],
                upgrades: [],
                perks: [],
                name: "Vehicle 1"
              }
            ],
            teamName: newTeamName.trim(),
            maxCans: 50,
            darkMode: document.documentElement.classList.contains('dark-mode')
          };
        } else {
          isSaving = false;
          return;
        }
      }
      
      // Always use the new team name
      draftToSave.teamName = newTeamName.trim();
      
      // Check that required properties exist, handling both sponsor and sponsorId
      const hasSponsor = draftToSave.sponsor || draftToSave.sponsorId;
      
      if (!hasSponsor || !Array.isArray(draftToSave.vehicles)) {
        console.error("Current draft is missing required fields:", draftToSave);
        alert("Cannot save team: Team data is incomplete (missing sponsor or vehicles)");
        isSaving = false;
        return;
      }
      
      // Make sure the draft has a sponsor property (for consistency)
      if (!draftToSave.sponsor && draftToSave.sponsorId) {
        draftToSave.sponsor = draftToSave.sponsorId;
      }
      
      // Add the team name to the draft
      draftToSave.teamName = newTeamName.trim();

      // Log info that might help identify issues
      console.log("Saving team with name:", newTeamName);
      console.log("Draft to save:", JSON.stringify(draftToSave, null, 2));

      // Pass the existing team ID if we're overwriting
      const result = await saveTeam(
        draftToSave, 
        newTeamName,
        existingTeam ? existingTeam.id : undefined
      );

      if (result.success) {
        // Keep the name field populated with the team name for convenience
        // since the user may want to create multiple saves with different names
        await loadUserTeams(); // Reload teams
        alert(existingTeam ? "Team updated successfully!" : "Team saved successfully!");
      } else {
        console.error("Failed to save team:", result.error);
        alert(`Failed to save team: ${result.error}`);
      }
    } catch (error) {
      console.error("Exception in saveCurrentTeam:", error);
      alert(`Error saving team: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      isSaving = false;
    }
  }
  
  // Load selected team
  function loadTeam(team: SavedTeam) {
    console.log('loadTeam called with:', team);
    console.log('teamData structure:', JSON.stringify(team.teamData, null, 2));
    
    // Just log if functions are missing, but continue anyway
    if (typeof window === 'undefined') {
      console.error('Window object not available');
    } else if (typeof window.importDraftFn !== 'function') {
      console.error('importDraftFn not available on window object, will try prop-based method');
    }
    
    // Make sure we have valid data before proceeding
    if (!team || !team.teamData) {
      console.error('Invalid team data:', team);
      alert('Unable to load team: Invalid team data');
      return;
    }
    
    // Check the team structure - handle both sponsor and sponsorId (for backwards compatibility)
    const sponsor = team.teamData.sponsor || team.teamData.sponsorId;
    
    if (!sponsor || !Array.isArray(team.teamData.vehicles)) {
      console.error('Invalid team structure:', team.teamData);
      alert('Unable to load team: Team data is missing required information');
      return;
    }
    
    // Create a normalized version of the team data with deep clone to avoid reference issues
    const normalizedTeamData = JSON.parse(JSON.stringify({
      ...team.teamData,
      sponsor: sponsor,  // Ensure we always use 'sponsor' as the property name
      teamName: team.teamName || "My Gaslands Team",
      savedTeamId: team.id
    }));
    
    console.log("Prepared normalized team data for import:", normalizedTeamData);
    
    // Apply during the click. A deferred load lands after the player has
    // kept editing the restored draft and would wipe that work.
    closeModal();
    try {
      if (typeof document !== 'undefined') {
        const teamDataEvent = new CustomEvent('gaslands-load-team-data', {
          detail: normalizedTeamData,
          bubbles: true,
          cancelable: true
        });
        document.dispatchEvent(teamDataEvent);
        if (!teamDataEvent.defaultPrevented) importDraft(normalizedTeamData);
      } else {
        importDraft(normalizedTeamData);
      }
    } catch (error) {
      console.error('Error importing team:', error);
      alert('Error loading team. Please try again.');
    }
  }

  // Delete team
  async function removeTeam(teamId: string) {
    if (!confirm('Are you sure you want to delete this team?')) return;
    
    deletingTeamId = teamId;
    const result = await deleteTeam(teamId);
    deletingTeamId = null;
    
    if (result.success) {
      await loadUserTeams(); // Reload teams
    } else {
      console.error("Failed to delete team");
      alert('Failed to delete team. Please try again.');
    }
  }
  
  function closeModal() {
    showModal = false;
  }

  async function toggleBuddyVisibility(team: SavedTeam) {
    const hidden = team.hiddenFromBuddies !== true;
    const result = await setTeamHiddenFromBuddies(team.id, hidden);
    if (!result.success) {
      alert('Could not update buddy visibility. Please try again.');
      return;
    }
    await loadUserTeams();
  }
</script>

{#if showModal}
<div
  class="fixed inset-0 bg-black z-50"
  role="dialog"
  aria-modal="true"
  aria-label="My Teams"
  tabindex="-1"
  transition:fade={{ duration: 150 }}
>
  <!-- Background overlay -->
  <button
    class="absolute inset-0 w-full h-full border-0 bg-transparent cursor-pointer"
    on:click={closeModal}
    on:keydown={e => e.key === 'Escape' && closeModal()}
    aria-label="Close modal background"
  ></button>
  
  <!-- Modal content -->
  <div
    class="bg-white dark:bg-gray-800 rounded-xl shadow-[0_0_25px_rgba(0,0,0,0.3)] w-11/12 sm:w-4/5 md:w-2/5 lg:w-1/3 mx-auto relative z-10 border-2 border-amber-500"
    role="document"
    style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); max-height: 90vh; overflow-y: auto; box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 0 0 4px rgba(245,158,11,0.4), 0 10px 25px -5px rgba(0,0,0,0.4); background-color: var(--modal-bg-color, white); padding: 1.5rem;"
    data-modal-content="true"
  >
    <div class="flex justify-between items-center mb-6">
      <h3 class="text-lg font-bold text-stone-800 dark:text-white modal-heading">My Teams</h3>
      <button
        class="py-0.25 px-2 h-[2rem] flex items-center justify-center rounded transition-colors text-sm amber-button"
        on:click={closeModal}
        aria-label="Close teams modal"
      >
        <span>Close</span>
      </button>
    </div>
    
    <div class="space-y-6">
      {#if !$user}
        <div class="text-center py-6 space-y-4">
          <p class="text-stone-600 dark:text-gray-300 modal-text">
            Please sign in to save and load teams.
          </p>
          <div class="flex justify-center">
            <Auth />
          </div>
        </div>
      {:else}
        <!-- Save current team section -->
        <div class="border-b border-stone-200 dark:border-amber-900 pb-6">
          <h4 class="font-medium text-stone-800 dark:text-white text-lg mb-4 modal-heading">Save Current Team</h4>
          <div class="flex gap-3">
            <input
              type="text"
              placeholder="Enter team name"
              bind:value={newTeamName}
              class="flex-1 px-4 py-0.25 border-2 border-stone-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-stone-800 dark:text-white modal-input"
              style="height: 32px !important; min-height: 32px !important; max-height: 32px !important;"
            />
            <button
              class="px-4 py-1.5 amber-button rounded-md disabled:opacity-50 flex items-center shadow-md text-sm"
              on:click={saveCurrentTeam}
              disabled={isSaving || !newTeamName.trim()}
              style="height: 32px !important; min-height: 32px !important; max-height: 32px !important;"
            >
              {#if isSaving}
                <div class="animate-spin mr-2 h-4 w-4 border-b-2 border-white rounded-full"></div>
                Saving...
              {:else}
                Save
              {/if}
            </button>
          </div>
        </div>
        
        <!-- Teams list -->
        <div>
          <h4 class="font-medium text-stone-800 dark:text-white text-lg mb-4 modal-heading">Your Saved Teams</h4>
          
          {#if isLoading}
            <div class="py-6 text-center text-stone-600 dark:text-gray-300">
              <div class="flex justify-center">
                <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-600"></div>
              </div>
              <p class="mt-3">Loading teams...</p>
            </div>
          {:else if userTeams.length === 0}
            <div class="py-6 text-center text-stone-600 dark:text-gray-300">
              You haven't saved any teams yet.
            </div>
          {:else}
            <div class="space-y-3 max-h-72 overflow-y-auto pr-2">
              {#each userTeams as team}
                <div class="flex flex-col items-stretch justify-between gap-3 p-4 sm:flex-row sm:items-center bg-stone-100 dark:bg-gray-700 rounded-lg border border-stone-200 dark:border-gray-600">
                  <div class="min-w-0 sm:flex-1">
                    <div class="font-medium text-stone-800 dark:text-white text-lg break-words">{team.teamName}</div>
                    <div class="text-sm text-stone-500 dark:text-gray-400">
                      {new Date(team.updatedAt ?? '').toLocaleDateString()}
                    </div>
                  </div>
                  <div class="flex w-full shrink-0 gap-3 sm:w-auto">
                    {#if SHOW_BUDDY_HIDE_TOGGLE}
                      <button
                        type="button"
                        class="px-4 py-1.5 rounded-md border border-stone-300 bg-white text-sm text-stone-800 dark:border-gray-500 dark:bg-gray-800 dark:text-gray-100"
                        aria-pressed={team.hiddenFromBuddies === true}
                        aria-label="{team.hiddenFromBuddies ? 'Show' : 'Hide'} {team.teamName || 'team'} from buddies"
                        data-testid="team-hide-from-buddies"
                        on:click={() => toggleBuddyVisibility(team)}
                      >
                        {team.hiddenFromBuddies ? 'Hidden from buddies' : 'Hide from buddies'}
                      </button>
                    {/if}
                    <button
                      class="px-4 py-1.5 amber-button rounded-md shadow-md transition-colors flex-1 sm:flex-none text-sm"
                      on:click={() => loadTeam(team)}
                      style="height: 32px !important; min-height: 32px !important; max-height: 32px !important;"
                    >
                      Load
                    </button>
                    <button
                      class="px-4 py-1.5 red-button rounded-md shadow-md transition-colors flex items-center flex-1 sm:flex-none justify-center text-sm"
                      on:click={() => removeTeam(team.id)}
                      disabled={deletingTeamId === team.id}
                      style="height: 32px !important; min-height: 32px !important; max-height: 32px !important;"
                    >
                      {#if deletingTeamId === team.id}
                        <div class="animate-spin mr-2 h-4 w-4 border-b-2 border-white rounded-full"></div>
                        Deleting...
                      {:else}
                        Delete
                      {/if}
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
{/if}