<script lang="ts">
    import { nanoid } from 'nanoid';
    import { createEventDispatcher } from 'svelte';
    import BuildHeader from './BuildHeader.svelte';
    import { loadWeaponSpecialRules } from '$lib/rules/loadRules';
    import { perkCost } from '$lib/validate/calc';
    import Tooltip from './Tooltip.svelte';

    const dispatch = createEventDispatcher();

    // Load weapon special rules
    const weaponSpecialRules = loadWeaponSpecialRules();
    
    // Props are declared below, don't try to use them here
    
    // Props
    export let vehicle: {
        id: string;
        type: string;
        name: string;
        weapons: string[];
        weaponFacings?: Record<string, string>;
        upgrades: string[];
        perks: string[];
    };

    // Initialize weaponFacings if undefined
    if (!vehicle.weaponFacings) {
        vehicle.weaponFacings = {};
    }
    export let vehicleTypes = [];
    export let weapons = [];
    export let upgrades = [];
    export let perks = [];
    export let vehicleRules = [];
    export let collapsed: boolean = false;
    export let playMode: boolean = false;
    export let validationReport = null;
    export let hazardCount: number = 0;
    export let filteredWeapons = [];
    export let filteredUpgrades = [];
    export let filteredTrailerUpgrades = [];
    export let filteredPerks = [];
    export let usedBuildSlots: number = 0;
    
    // Now we can safely access the props
    $: if (vehicleRules) {
        // Validate vehicleRules is an array with proper data
        if (!Array.isArray(vehicleRules) || vehicleRules.length === 0) {
            console.warn("VehicleCard received empty or invalid vehicleRules");
        }
    }

    // Local state for hazard tokens that can be immediately updated
    let localHazardCount = hazardCount;
    $: localHazardCount = hazardCount; // Update local count when prop changes

    // Functions for vehicle state modification
    // These will dispatch events to the parent component
    function removeVehicle() {
        dispatch('remove', { id: vehicle.id });
    }

    function cloneVehicle() {
        dispatch('clone', { id: vehicle.id });
    }
    
    function toggleCollapse() {
        dispatch('toggleCollapse', { id: vehicle.id });
    }
    
    function addWeapon(weaponId, facing = 'front') {
        dispatch('addWeapon', { vehicleId: vehicle.id, weaponId, facing });
    }
    
    function removeWeapon(index) {
        dispatch('removeWeapon', { vehicleId: vehicle.id, weaponIndex: index });
    }
    
    function addUpgrade(upgradeId) {
        dispatch('addUpgrade', { vehicleId: vehicle.id, upgradeId });
    }
    
    function removeUpgrade(index) {
        dispatch('removeUpgrade', { vehicleId: vehicle.id, upgradeIndex: index });
    }
    
    function addPerk(perkId) {
        dispatch('addPerk', { vehicleId: vehicle.id, perkId });
    }
    
    function removePerk(index) {
        dispatch('removePerk', { vehicleId: vehicle.id, perkIndex: index });
    }
    
    function incrementHazard() {
        localHazardCount += 1; // Immediately update local UI
        dispatch('incrementHazard', { vehicleId: vehicle.id });
    }

    function decrementHazard() {
        if (localHazardCount > 0) {
            localHazardCount -= 1; // Immediately update local UI
            dispatch('decrementHazard', { vehicleId: vehicle.id });
        }
    }
    
    // Helper functions
    // We now use the usedBuildSlots prop from the parent component

    // Create reactive statements to recalculate values when properties change
    $: vehicleType = vehicleTypes.find(vt => vt.id === vehicle.type);
    $: vehicleCost = calculateVehicleCost(vehicle, vehicleType);
    $: maxBuildSlots = vehicleType?.buildSlots || 2;
    // Recalculate slots whenever weapons or upgrades change
    $: usedBuildSlots = calculateUsedBuildSlots(vehicle);
    // Force reactivity for weapon/upgrade changes
    $: { vehicle.weapons; vehicle.upgrades; usedBuildSlots = calculateUsedBuildSlots(vehicle); }

    function calculateVehicleCost(vehicle, vehicleType) {
        // Use the passed vehicleType to avoid redundant lookups
        if (!vehicleType) return 0;

        let totalCost = vehicleType.baseCost || 0;

        // Add weapon costs
        for (const weaponInstanceId of vehicle.weapons) {
            // Use a more robust method to find the base weapon ID
            // Try increasingly longer potential base IDs until we find a match
            const parts = weaponInstanceId.split('_');
            let baseWeaponId = null;
            let weaponObj = null;
            
            // Handle case with no underscores
            if (parts.length === 1) {
                weaponObj = weapons.find(w => w.id === weaponInstanceId);
            } else {
                // Try increasingly longer potential base IDs until we find a match
                for (let i = parts.length - 1; i >= 1; i--) {
                    const potentialBaseId = parts.slice(0, i).join('_');
                    const match = weapons.find(w => w.id === potentialBaseId);
                    if (match) {
                        baseWeaponId = potentialBaseId;
                        weaponObj = match;
                        break;
                    }
                }
                
                // If no match found, use the default approach (all but last part)
                if (!baseWeaponId) {
                    baseWeaponId = parts.slice(0, -1).join('_');
                    weaponObj = weapons.find(w => w.id === baseWeaponId);
                }
            }
            
            if (weaponObj && weaponObj.cost) {
                totalCost += weaponObj.cost;
            }
        }

        // Add upgrade costs
        for (const upgradeId of vehicle.upgrades) {
            const upgradeObj = upgrades.find(u => u.id === upgradeId);
            if (upgradeObj && upgradeObj.cost) {
                totalCost += upgradeObj.cost;
            }
        }

        // Add perk costs
        for (const perkId of vehicle.perks) {
            const perkObj = perks.find(p => p.id === perkId);
            totalCost += perkCost(perkObj);
        }

        return totalCost;
    }

    function calculateUsedBuildSlots(vehicle) {
        let totalSlots = 0;

        // Calculate slots used by weapons
        for (const weaponInstanceId of vehicle.weapons) {
            // Use a more robust method to find the base weapon ID
            // Try increasingly longer potential base IDs until we find a match
            const parts = weaponInstanceId.split('_');
            let baseWeaponId = null;
            let weaponObj = null;
            
            // Handle case with no underscores
            if (parts.length === 1) {
                weaponObj = weapons.find(w => w.id === weaponInstanceId);
                baseWeaponId = weaponInstanceId;
            } else {
                // Try increasingly longer potential base IDs until we find a match
                for (let i = parts.length - 1; i >= 1; i--) {
                    const potentialBaseId = parts.slice(0, i).join('_');
                    const match = weapons.find(w => w.id === potentialBaseId);
                    if (match) {
                        baseWeaponId = potentialBaseId;
                        weaponObj = match;
                        break;
                    }
                }
                
                // If no match found, use the default approach (all but last part)
                if (!baseWeaponId) {
                    baseWeaponId = parts.slice(0, -1).join('_');
                    weaponObj = weapons.find(w => w.id === baseWeaponId);
                }
            }
            
            if (weaponObj) {
                // Special case: Some weapons don't use build slots in Gaslands Refueled
                if (['handgun', 'molotov', 'grenades', 'ram', 'oil_slick', 'smokescreen'].includes(baseWeaponId)) {
                    // These weapons don't consume build slots
                    continue;
                }
                // Just use the slots field directly
                totalSlots += weaponObj.slots;
            }
        }

        // Calculate slots used by upgrades
        for (const upgradeId of vehicle.upgrades) {
            const upgradeObj = upgrades.find(u => u.id === upgradeId);
            if (upgradeObj) {
                // Special case: Some upgrades don't use build slots in Gaslands Refueled
                if (['grenades'].includes(upgradeId)) {
                    // These upgrades don't consume build slots
                    continue;
                }
                // Just use the slots field directly
                totalSlots += upgradeObj.slots;
            }
        }

        return totalSlots;
    }

    function calculateMaxHull(): number {
        const vehicleType = vehicleTypes.find(vt => vt.id === vehicle.type);
        if (!vehicleType) return 0;

        let maxHull = vehicleType.maxHull;

        // Add hull points from upgrades
        for (const upgradeId of vehicle.upgrades) {
            const upgradeObj = upgrades.find(u => u.id === upgradeId);

            // Use new hull property if available
            if (upgradeObj?.hull) {
                maxHull += upgradeObj.hull;
            }
            // Backward compatibility for armor upgrade
            else if (upgradeId === 'armor') {
                maxHull += 1;
            }
            // Backward compatibility for old property name
            else if (upgradeObj?.hullModifier) {
                maxHull += upgradeObj.hullModifier;
            }
        }

        // Add hull points from perks (if any)
        for (const perkId of vehicle.perks) {
            // Add any perks that affect hull here
            // For example: if (perkId === 'fortified' || perkId === 'tank_commander') maxHull += 1;
        }

        return maxHull;
    }
    
    function calculateHandling(): number {
        const vehicleType = vehicleTypes.find(vt => vt.id === vehicle.type);
        if (!vehicleType) return 0;

        let handling = vehicleType.handling || 4; // Default to 4 if not specified

        // Add handling modifiers from upgrades
        for (const upgradeId of vehicle.upgrades) {
            const upgradeObj = upgrades.find(u => u.id === upgradeId);

            // Use new handling property if available
            if (upgradeObj?.handling) {
                handling += upgradeObj.handling;
            }
            // Backward compatibility for old property name
            else if (upgradeObj?.handlingModifier) {
                handling += upgradeObj.handlingModifier;
            }
        }

        return handling;
    }

    function calculateMaxGear(): number {
        const vehicleType = vehicleTypes.find(vt => vt.id === vehicle.type);
        if (!vehicleType) return 0;

        let maxGear = vehicleType.maxGear;

        // Add gear modifiers from upgrades
        for (const upgradeId of vehicle.upgrades) {
            const upgradeObj = upgrades.find(u => u.id === upgradeId);

            // Use new gear property if available
            if (upgradeObj?.gear) {
                maxGear += upgradeObj.gear;
            }
            // Backward compatibility for old property name
            else if (upgradeObj?.gearModifier) {
                maxGear += upgradeObj.gearModifier;
            }
        }

        return maxGear;
    }

    function calculateCrew(): number {
        const vehicleType = vehicleTypes.find(vt => vt.id === vehicle.type);
        if (!vehicleType) return 0;

        let crew = vehicleType.crew || 1; // Default to 1 if not specified

        // Add crew modifiers from upgrades
        for (const upgradeId of vehicle.upgrades) {
            const upgradeObj = upgrades.find(u => u.id === upgradeId);

            // Use new crew property if available
            if (upgradeObj?.crew) {
                crew += upgradeObj.crew;
            }
            // Backward compatibility for old property name
            else if (upgradeObj?.crewModifier) {
                crew += upgradeObj.crewModifier;
            }
        }

        // Ensure crew doesn't go below zero
        return Math.max(0, crew);
    }

    function calculateTotalAttackDice(): number {
        if (!vehicle || !vehicle.weapons || vehicle.weapons.length === 0) return 0;

        let totalAttackDice = 0;

        // Calculate total attack dice from all weapons
        for (const weaponInstanceId of vehicle.weapons) {
            // Use a more robust method to find the base weapon ID
            // Try increasingly longer potential base IDs until we find a match
            const parts = weaponInstanceId.split('_');
            let baseWeaponId = null;
            let weaponObj = null;
            
            // Handle case with no underscores
            if (parts.length === 1) {
                weaponObj = weapons.find(w => w.id === weaponInstanceId);
            } else {
                // Try increasingly longer potential base IDs until we find a match
                for (let i = parts.length - 1; i >= 1; i--) {
                    const potentialBaseId = parts.slice(0, i).join('_');
                    const match = weapons.find(w => w.id === potentialBaseId);
                    if (match) {
                        baseWeaponId = potentialBaseId;
                        weaponObj = match;
                        break;
                    }
                }
                
                // If no match found, use the default approach (all but last part)
                if (!baseWeaponId) {
                    baseWeaponId = parts.slice(0, -1).join('_');
                    weaponObj = weapons.find(w => w.id === baseWeaponId);
                }
            }
            
            if (weaponObj && weaponObj.attackDice) {
                totalAttackDice += weaponObj.attackDice;
            }
        }

        return totalAttackDice;
    }
    
    function getVehicleRuleDetails(ruleName: string) {
        if (!ruleName) return null;
        if (!Array.isArray(vehicleRules) || vehicleRules.length === 0) {
            return null;
        }

        // Clean the ruleName to handle potential variations
        const cleanedRuleName = ruleName.trim();
        
        // First check if rules might be using ruleName for matching
        // This is the case if the first rule doesn't have an id field
        const firstRule = vehicleRules[0];
        const usingRuleNameForMatching = firstRule && !firstRule.id;
        
        if (usingRuleNameForMatching) {
            // Primary match by ruleName directly since id isn't available
            const directMatch = vehicleRules.find(rule => 
                rule.ruleName && rule.ruleName.toUpperCase() === cleanedRuleName.toUpperCase());
            if (directMatch) return directMatch;
            
            // Try fuzzy match with ruleName
            const fuzzyMatch = vehicleRules.find(rule => 
                rule.ruleName && rule.ruleName.toUpperCase().includes(cleanedRuleName.toUpperCase()));
            if (fuzzyMatch) return fuzzyMatch;
        } else {
            // Standard flow when id field is present
            
            // Try exact match first using id field
            const exactMatch = vehicleRules.find(rule => rule.id === cleanedRuleName);
            if (exactMatch) return exactMatch;
    
            // If no exact match, try case-insensitive match on id
            const caseInsensitiveMatch = vehicleRules.find(rule =>
                rule.id && rule.id.toLowerCase() === cleanedRuleName.toLowerCase());
            if (caseInsensitiveMatch) return caseInsensitiveMatch;
            
            // If still no match, try matching by ruleName field
            const ruleNameMatch = vehicleRules.find(rule => 
                rule.ruleName && rule.ruleName.toUpperCase() === cleanedRuleName.toUpperCase());
            if (ruleNameMatch) return ruleNameMatch;
            
            // Last resort - try fuzzy match with ruleName field 
            const fuzzyMatch = vehicleRules.find(rule => 
                rule.ruleName && rule.ruleName.toUpperCase().includes(cleanedRuleName.toUpperCase()));
            if (fuzzyMatch) return fuzzyMatch;
        }
        
        return null;
    }

    function getWeaponSpecialRuleDetails(ruleId: string) {
        if (!ruleId) return null;

        // Clean the ruleId to handle potential variations
        const cleanedRuleId = ruleId.trim();

        // Try to find exact ID match first
        const exactMatch = weaponSpecialRules.find(rule => rule.id === cleanedRuleId);
        if (exactMatch) return exactMatch;

        // If no exact match, try case-insensitive match
        const caseInsensitiveMatch = weaponSpecialRules.find(rule =>
            rule.id.toLowerCase() === cleanedRuleId.toLowerCase());
        if (caseInsensitiveMatch) return caseInsensitiveMatch;

        // Try matching by rule name if ID doesn't match
        const nameMatch = weaponSpecialRules.find(rule =>
            rule.ruleName.toLowerCase() === cleanedRuleId.toLowerCase());
        if (nameMatch) return nameMatch;

        // If still no match, create a fallback object
        return {
            id: cleanedRuleId,
            ruleName: cleanedRuleId,
            rule: "Rule description not found."
        };
    }

    function parseSpecialRules(specialRulesString: string) {
        if (!specialRulesString) return [];

        // Handle special cases where text might be "SEE SPECIAL RULES"
        if (specialRulesString.toUpperCase().includes("SEE SPECIAL RULES")) {
            // Return the string before "SEE SPECIAL RULES" if any
            const parts = specialRulesString.split(/see special rules/i);
            if (parts[0].trim()) {
                return parts[0].split(',').map(rule => rule.trim());
            }
            return [];
        }

        return specialRulesString.split(',').map(rule => rule.trim());
    }
    
    // Helper function to find base weapon ID from instance ID
    function findBaseWeaponId(weaponInstanceId: string, parts?: string[]) {
        if (!parts) {
            parts = weaponInstanceId.split('_');
        }
        
        // Handle case with no underscores
        if (parts.length === 1) {
            return weaponInstanceId;
        }
        
        // Try increasingly longer potential base IDs until we find a match
        for (let i = parts.length - 1; i >= 1; i--) {
            const potentialBaseId = parts.slice(0, i).join('_');
            const match = weapons.find(w => w.id === potentialBaseId);
            if (match) {
                return potentialBaseId;
            }
        }
        
        // If no match found, use the default approach (all but last part)
        return parts.slice(0, -1).join('_');
    }
    
    // Helper function to find weapon by ID
    function findWeaponById(baseWeaponId: string) {
        return weapons.find(w => w.id === baseWeaponId);
    }
</script>

<div class="vehicle-card bg-stone-200 dark:bg-gray-800 rounded-lg shadow-md overflow-hidden border-2 p-1 mb-1" style="border-color: {vehicleTypes.find(vt => vt.id === vehicle.type)?.color || '#f59e0b'};">
    <div class="px-4 py-3 bg-stone-100 dark:bg-gray-800 flex flex-wrap justify-between items-center">
        <div class="flex flex-col md:flex-row items-start md:items-center gap-2 flex-grow w-full">
            <div class="form-group mb-0 flex-grow">
                <label for="vehicle-type-{vehicle.id}" class="form-label uppercase">Vehicle Type</label>
                <div class="form-field mb-0">
                    <select
                        id="vehicle-type-{vehicle.id}"
                        class="form-select compact-select"
                        bind:value={vehicle.type}
                        on:change={() => {
                            // Immediately dispatch event for parent to handle
                            dispatch('vehicleTypeChanged', { id: vehicle.id, vehicleType: vehicle.type });
                        }}
                        disabled={playMode}
                        class:opacity-50={playMode}
                        class:cursor-not-allowed={playMode}
                    >
                        {#each vehicleTypes.slice().sort((a, b) => a.name.localeCompare(b.name)) as vt}
                            <option value={vt.id}>{vt.name}</option>
                        {/each}
                    </select>
                </div>
            </div>

            <div class="form-group mb-0 flex-grow">
                <label for="vehicle-name-{vehicle.id}" class="form-label uppercase">Vehicle Name</label>
                <div class="form-field mb-0">
                    <input
                        type="text"
                        id="vehicle-name-{vehicle.id}"
                        bind:value={vehicle.name}
                        class="form-input h-[2rem] dark-text-input"
                        placeholder="Vehicle name"
                        style="height: 2rem !important; min-height: 2rem !important;"
                    />
                </div>
            </div>
        </div>
        <div class="flex flex-col md:flex-row gap-2 self-end mt-3 md:mt-0 w-full md:w-auto">
            <!-- Build header (cans and slots) in top row on mobile -->
            <div class="flex gap-2 justify-center md:justify-start w-full md:w-auto">
                <BuildHeader
                    vehicleCost={vehicleCost}
                    usedBuildSlots={usedBuildSlots}
                    maxBuildSlots={maxBuildSlots}
                />
            </div>

            <!-- Action buttons in second row on mobile -->
            <div class="flex gap-2 justify-center md:justify-start w-full md:w-auto">
                <button
                    class="h-[32px] min-h-[32px] max-h-[32px] px-2 flex-1 md:flex-auto flex items-center justify-center rounded-md transition-colors text-xs md:text-sm amber-button"
                    on:click={cloneVehicle}
                    aria-label="Clone vehicle"
                    disabled={playMode}
                    class:opacity-50={playMode}
                    class:cursor-not-allowed={playMode}
                >
                    <span>+ Clone</span>
                    <span class="sr-only">Clone vehicle</span>
                </button>

                <button
                    class="h-[32px] min-h-[32px] max-h-[32px] px-2 flex-1 md:flex-auto flex items-center justify-center rounded-md transition-colors text-xs md:text-sm amber-button"
                    on:click={toggleCollapse}
                    aria-label={collapsed ? "Expand vehicle" : "Collapse vehicle"}
                >
                    <span>{collapsed ? "+ Expand" : "- Collapse"}</span>
                </button>

                <!-- Delete / Remove Vehicle Button-->
                <button
                    class="h-[32px] min-h-[32px] max-h-[32px] px-2 flex-1 md:flex-auto flex items-center justify-center rounded-md transition-colors text-xs md:text-sm red-button"
                    on:click={removeVehicle}
                    aria-label="Remove vehicle"
                >
                    <span>× Remove</span>
                </button>
            </div>
        </div>
    </div>
    
    <!-- Collapsed view - Only shown when collapsed -->
    {#if collapsed}
        <div class="p-2 flex flex-col md:flex-row md:items-center md:justify-between bg-stone-100 dark:bg-gray-800">
            <div class="flex items-center gap-2 mb-2 md:mb-0">
                <div class="vehicle-type-icon vehicle-type-{vehicle.type}" title="{vehicleTypes.find(vt => vt.id === vehicle.type)?.name || 'Unknown'}"></div>
                <div class="font-medium text-sm md:text-base">
                    {#if vehicle.weapons && vehicle.weapons.length > 0}
                        {vehicle.weapons.length} weapons
                    {/if}
                    {#if vehicle.upgrades && vehicle.upgrades.length > 0}
                        <span class="mx-1">|</span> {vehicle.upgrades.length} upgrades
                    {/if}
                    {#if vehicle.perks && vehicle.perks.length > 0}
                        <span class="mx-1">|</span> {vehicle.perks.length} perks
                    {/if}
                </div>
            </div>

            <div class="flex flex-col md:flex-row gap-2 md:gap-4">
                <div class="flex gap-2 justify-start">
                    <BuildHeader
                        vehicleCost={vehicleCost}
                        usedBuildSlots={usedBuildSlots}
                        maxBuildSlots={maxBuildSlots}
                    />
                </div>

                <div class="weight-class-indicator weight-{typeof vehicleTypes.find(vt => vt.id === vehicle.type)?.weight === 'string' ? 'custom' : vehicleTypes.find(vt => vt.id === vehicle.type)?.weight || 1} text-xs md:text-sm">
                    {(() => {
                        const weight = vehicleTypes.find(vt => vt.id === vehicle.type)?.weight;
                        if (typeof weight === 'string') {
                            return weight;
                        } else {
                            return weight === 1 ? 'Light' :
                                   weight === 2 ? 'Medium' :
                                   weight === 3 ? 'Heavy' : 'Massive';
                        }
                    })()}
                </div>
            </div>
        </div>
    {/if}
    
    <!-- Vehicle details - Hidden when collapsed -->
    <div class="px-1 py-2" class:hidden={collapsed}>
        
        <!-- Interactive dashboard elements - Always visible in Play Mode -->
        <div class="interactive-dashboard bg-stone-50 dark:bg-gray-700 border border-stone-300 dark:border-gray-600 rounded-lg p-3 mb-3" class:hidden={!playMode}>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="hull-tracker p-3 bg-white dark:bg-gray-800 rounded-lg border border-stone-300 dark:border-gray-600">
                    <div class="tracker-label text-sm font-semibold text-stone-600 dark:text-gray-300 uppercase mb-2">
                        Hull Points
                        {#if calculateMaxHull() > (vehicleTypes.find(vt => vt.id === vehicle.type)?.maxHull || 0)}
                            <span class="text-green-500 text-xs">(+{calculateMaxHull() - (vehicleTypes.find(vt => vt.id === vehicle.type)?.maxHull || 0)})</span>
                        {/if}
                    </div>
                    <div class="flex flex-wrap gap-1">
                        {#each Array(calculateMaxHull()) as _, i}
                            <div class="hull-checkbox">
                                <input type="checkbox" id="hull-{vehicle.id}-{i}" class="hull-checkbox-input" />
                                <label for="hull-{vehicle.id}-{i}" class="hull-checkbox-label"></label>
                            </div>
                        {/each}
                    </div>
                </div>
                
                <div class="gear-tracker p-3 bg-white dark:bg-gray-800 rounded-lg border border-stone-300 dark:border-gray-600">
                    <div class="tracker-label text-sm font-semibold text-stone-600 dark:text-gray-300 uppercase mb-2">Current Gear</div>
                    <div class="gear-slider">
                        <input 
                            type="range" 
                            min="1" 
                            max="{calculateMaxGear()}" 
                            value="1" 
                            class="gear-range w-full h-7 appearance-none bg-stone-200 dark:bg-gray-600 rounded-full" 
                        />
                        <div class="gear-markers flex justify-between px-2 mt-1">
                            {#each Array(calculateMaxGear()) as _, i}
                                <span class="gear-number text-xs font-bold">{i+1}</span>
                            {/each}
                        </div>
                    </div>
                </div>
                
                <div class="crew-hazard-row flex gap-4 col-span-1 md:col-span-2">
                    <div class="crew-tracker p-3 bg-white dark:bg-gray-800 rounded-lg border border-stone-300 dark:border-gray-600 flex-1">
                        <div class="tracker-label text-sm font-semibold text-stone-600 dark:text-gray-300 uppercase mb-2">Crew: {calculateCrew()}</div>
                        <div class="flex flex-wrap gap-1">
                            {#each Array(calculateCrew()) as _, i}
                                <div class="crew-checkbox">
                                    <input type="checkbox" id="crew-{vehicle.id}-{i}" class="crew-checkbox-input" />
                                    <label for="crew-{vehicle.id}-{i}" class="crew-checkbox-label"></label>
                                </div>
                            {/each}
                        </div>
                    </div>
                    
                    <div class="hazard-tracker p-3 bg-white dark:bg-gray-800 rounded-lg border border-stone-300 dark:border-gray-600 flex-1">
                        <div class="tracker-label text-sm font-semibold text-stone-600 dark:text-gray-300 uppercase mb-2">Hazard Tokens</div>
                        <div class="hazard-counter flex items-center justify-center gap-3">
                            <button 
                                class="counter-btn counter-minus w-7 h-7 bg-stone-200 dark:bg-gray-600 hover:bg-stone-300 dark:hover:bg-gray-500 rounded-full flex items-center justify-center font-bold text-lg"
                                on:click={decrementHazard}
                            >-</button>
                            <span class="counter-value text-2xl font-bold">{localHazardCount}</span>
                            <button 
                                class="counter-btn counter-plus w-7 h-7 bg-stone-200 dark:bg-gray-600 hover:bg-stone-300 dark:hover:bg-gray-500 rounded-full flex items-center justify-center font-bold text-lg"
                                on:click={incrementHazard}
                            >+</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Play Mode Loadout summary -->
        {#if playMode}
            <div class="loadout-summary mt-3 bg-white dark:bg-gray-800 rounded-lg border border-stone-300 dark:border-gray-600 p-2">
                <!-- Add Handling and Weight pills at the top -->
                <div class="flex flex-wrap gap-2 mb-3">
                    <div class="bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 font-medium px-3 py-1 rounded-full text-sm">
                        Handling: {calculateHandling()}
                    </div>
                    <div class="bg-stone-100 dark:bg-gray-700 text-stone-800 dark:text-gray-200 font-medium px-3 py-1 rounded-full text-sm">
                        Weight: {
                            (() => {
                                const weight = vehicleTypes.find(vt => vt.id === vehicle.type)?.weight;
                                if (typeof weight === 'string') {
                                    return weight;
                                } else {
                                    return weight === 1 ? 'Light' :
                                           weight === 2 ? 'Medium' :
                                           weight === 3 ? 'Heavy' : 'Massive';
                                }
                            })()
                        }
                    </div>
                </div>
                <div class="mb-2">
                    {#each vehicle.weapons as weaponId, i}
                        {@const baseWeaponId = findBaseWeaponId(weaponId)}
                        {@const weaponObj = findWeaponById(baseWeaponId)}
                        {@const facing = vehicle.weaponFacings?.[weaponId] || 'front'}
                        <div class="text-sm py-2.5 border-b border-stone-200 dark:border-gray-700">
                            <div class="flex items-center">
                                <span class="font-bold text-stone-700 dark:text-gray-300">{weaponObj?.name || baseWeaponId}</span>
                                <span class="text-xs text-stone-500 dark:text-gray-400 ml-2">({facing})</span>
                                {#if weaponObj?.range}
                                    <span class="text-xs bg-stone-100 dark:bg-gray-600 text-stone-700 dark:text-gray-300 px-1.5 py-0.5 rounded ml-2">{weaponObj.range}</span>
                                {/if}
                                {#if weaponObj?.attackDice}
                                    <span class="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded ml-2">🎲 {weaponObj.attackDice}</span>
                                {/if}
                                {#if weaponObj?.electrical}
                                    <span class="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded ml-2">⚡ Electrical</span>
                                {/if}
                            </div>
                            {#if weaponObj?.specialRules}
                                <div class="text-xs text-stone-500 dark:text-gray-400 mt-1.5">
                                    {#each parseSpecialRules(weaponObj.specialRules) as ruleId}
                                        {@const ruleDetails = getWeaponSpecialRuleDetails(ruleId)}
                                        <span class="inline-block mr-1">
                                            <Tooltip
                                                text="{ruleDetails?.ruleName || ruleId}{parseSpecialRules(weaponObj.specialRules).indexOf(ruleId) < parseSpecialRules(weaponObj.specialRules).length - 1 ? ',' : ''}"
                                                content="{ruleDetails?.rule || `No description available for ${ruleDetails?.ruleName || ruleId}`}"
                                            />
                                        </span>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    {/each}
                    
                    {#each vehicle.upgrades as upgradeId}
                        {@const upgrade = upgrades.find(u => u.id === upgradeId)}
                        <div class="text-sm py-2.5 border-b border-stone-200 dark:border-gray-700">
                            <div class="flex items-center">
                                <span class="font-bold text-stone-700 dark:text-gray-300">{upgrade?.name || upgradeId}</span>
                                {#if upgrade?.electrical}
                                    <span class="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded ml-2">⚡ Electrical</span>
                                {/if}
                            </div>
                            {#if upgrade?.specialRules}
                                <div class="text-xs text-stone-500 dark:text-gray-400 mt-1.5">
                                    {#each parseSpecialRules(upgrade.specialRules) as ruleId}
                                        {@const ruleDetails = getWeaponSpecialRuleDetails(ruleId)}
                                        <span class="inline-block mr-1">
                                            <Tooltip
                                                text="{ruleDetails?.ruleName || ruleId}{parseSpecialRules(upgrade.specialRules).indexOf(ruleId) < parseSpecialRules(upgrade.specialRules).length - 1 ? ',' : ''}"
                                                content="{ruleDetails?.rule || `No description available for ${ruleDetails?.ruleName || ruleId}`}"
                                            />
                                        </span>
                                    {/each}
                                </div>
                            {/if}
                            {#if upgrade?.hullModifier || upgrade?.crewModifier || upgrade?.gearModifier || upgrade?.handlingModifier}
                                <div class="text-xs text-stone-500 dark:text-gray-400 mt-1.5">
                                    {upgrade.hullModifier ? `Hull: ${upgrade.hullModifier > 0 ? '+' : ''}${upgrade.hullModifier} ` : ''}
                                    {upgrade.crewModifier ? `Crew: ${upgrade.crewModifier > 0 ? '+' : ''}${upgrade.crewModifier} ` : ''}
                                    {upgrade.gearModifier ? `Gear: ${upgrade.gearModifier > 0 ? '+' : ''}${upgrade.gearModifier} ` : ''}
                                    {upgrade.handlingModifier ? `Handling: ${upgrade.handlingModifier > 0 ? '+' : ''}${upgrade.handlingModifier}` : ''}
                                </div>
                            {/if}
                        </div>
                    {/each}
                    
                    {#each vehicle.perks as perkId}
                        {@const perk = perks.find(p => p.id === perkId)}
                        <div class="text-sm py-2.5 border-b border-stone-200 dark:border-gray-700">
                            <div class="flex items-center">
                                <span class="font-bold text-stone-700 dark:text-gray-300">{perk?.name || perkId}</span>
                                {#if perk?.electrical}
                                    <span class="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded ml-2">⚡ Electrical</span>
                                {/if}
                            </div>
                            {#if perk?.text}
                                <div class="text-xs text-stone-500 dark:text-gray-400 mt-2">{@html perk.text}</div>
                            {/if}
                        </div>
                    {/each}

                    <!-- Special rules in Play Mode -->
                    {#if vehicleTypes.find(vt => vt.id === vehicle.type)?.specialRules}
                        {@const vType = vehicleTypes.find(vt => vt.id === vehicle.type)}
                        {@const specialRulesStr = vType?.specialRules || ''}
                        {@const specialRules = specialRulesStr.split(',').map(rule => rule.trim()) || []}

                        {#each specialRules as ruleName}
                            {@const ruleDetails = getVehicleRuleDetails(ruleName.trim())}
                            <div class="text-sm py-1 border-b border-stone-200 dark:border-gray-700">
                                <span class="font-bold text-stone-700 dark:text-gray-300">{ruleDetails?.ruleName || ruleName.trim()}</span>
                                {#if ruleDetails}
                                    <div class="text-xs text-stone-500 dark:text-gray-400">{@html ruleDetails.rule}</div>
                                {:else}
                                    <div class="text-xs text-stone-500 dark:text-gray-400 italic">Rule details not found for "{ruleName.trim()}".</div>
                                {/if}
                            </div>
                        {/each}
                    {/if}
                    
                    {#if vehicle.weapons.length === 0 && vehicle.upgrades.length === 0 && vehicle.perks.length === 0 && !vehicleTypes.find(vt => vt.id === vehicle.type)?.specialRules}
                        <div class="text-sm text-stone-500 dark:text-gray-400 italic">No weapons, upgrades, perks, or special rules</div>
                    {/if}
                </div>
            </div>
        {/if}
        
        <!-- Weapons section - Hidden in Play Mode -->
        <div class="mb-4" class:hidden={playMode}>
            <h3 class="text-sm font-bold text-stone-800 dark:text-gray-200 mb-1 flex items-center justify-between border-b border-stone-300 dark:border-gray-600 pb-1">
                <span class="bg-stone-300 dark:bg-gray-600 px-2 py-0.5 rounded-t mr-2 text-xs uppercase">Weapons</span>
                <span class="text-xs text-stone-500 dark:text-gray-400 md:hidden">📍= facing</span>
            </h3>
            
            {#if vehicle.weapons && vehicle.weapons.length === 0}
                <p class="text-stone-500 dark:text-gray-400 text-sm italic px-2">No weapons installed.</p>
            {:else}
                <ul class="space-y-1 mb-3 border border-stone-300 dark:border-gray-600 rounded overflow-hidden divide-y divide-stone-300 dark:divide-gray-600">
                    {#each vehicle.weapons as weaponId, i}
                        {@const baseWeaponId = findBaseWeaponId(weaponId)}
                        {@const weaponObj = findWeaponById(baseWeaponId)}
                        {@const facing = vehicle.weaponFacings?.[weaponId] || 'front'}
                        <li class="bg-stone-50 dark:bg-gray-700 px-3 py-2">
                            <div class="flex items-center justify-between">
                                <div class="flex-1">
                                    <div class="flex items-center">
                                        <b><span class="text-stone-700 dark:text-gray-200 font-bold">
                                            {weaponObj?.name || baseWeaponId}
                                        </span></b>
                                        {#if weaponObj?.range}
                                            <span class="text-xs bg-stone-100 dark:bg-gray-600 text-stone-700 dark:text-gray-300 px-1.5 py-0.5 rounded ml-2">{weaponObj.range}</span>
                                        {/if}
                                        {#if weaponObj?.attackDice}
                                            <span class="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded ml-2">🎲 {weaponObj.attackDice}</span>
                                        {/if}
                                        {#if weaponObj?.electrical}
                                            <span class="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded ml-2">⚡ Electrical</span>
                                        {/if}
                                    </div>
                                    <div class="flex items-center gap-2">
                                        {#if weaponObj?.specialRules}
                                        <div class="text-stone-500 dark:text-gray-400 text-xs">
                                            {#each parseSpecialRules(weaponObj.specialRules) as ruleId}
                                                {@const ruleDetails = getWeaponSpecialRuleDetails(ruleId)}
                                                <span class="inline-block mr-1">
                                                    <Tooltip
                                                        text="{ruleDetails?.ruleName || ruleId}{parseSpecialRules(weaponObj.specialRules).indexOf(ruleId) < parseSpecialRules(weaponObj.specialRules).length - 1 ? ',' : ''}"
                                                        content="{ruleDetails?.rule || `No description available for ${ruleDetails?.ruleName || ruleId}`}"
                                                    />
                                                </span>
                                            {/each}
                                        </div>
                                    {/if}
                                    </div>
                                </div>
                                <div class="flex items-center gap-2">
                                    {#if weaponObj}
                                        <!-- Compute necessary values before using them -->
                                        {#if true}
                                            {@const has360Upgrade = vehicle.upgrades.some(upgradeId => {
                                                const upgrade = upgrades.find(u => u.id === upgradeId);
                                                return upgrade && upgrade["360"] === true;
                                            })}
                                            {@const isCrewFired = weaponObj?.crewFired || (weaponObj?.specialRules && (
                                                weaponObj?.specialRules.toUpperCase().includes("CREW FIRED") || 
                                                parseSpecialRules(weaponObj.specialRules).includes("crew_fired")
                                            ))}
                                            {@const isDropped = weaponObj?.dropped || (weaponObj?.range && weaponObj?.range.includes('Dropped'))}
                                            
                                            <!-- Weapon facing controls - Mobile optimized -->
                                            <div class="flex items-center">
                                                
                                                <select
                                                    bind:value={vehicle.weaponFacings[weaponId]}
                                                    class="text-xs py-0.5 px-1 border border-stone-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-stone-800 dark:text-gray-200"
                                                    disabled={weaponObj?.facing === 'fixed' || isCrewFired || playMode}
                                                    aria-label="Weapon facing direction"
                                                    title="Weapon facing direction"
                                                >
                                                    {#if isCrewFired}
                                                        <!-- Crew fired weapons must be 360° -->
                                                        <option value="360">📍 360°</option>
                                                    {:else if isDropped}
                                                        <!-- Dropped weapons can only be side or rear -->
                                                        <option value="side">📍 Side</option>
                                                        <option value="rear">📍 Rear</option>
                                                    {:else}
                                                        <!-- Standard weapons -->
                                                        <option value="front">📍 Front</option>
                                                        <option value="side">📍 Side</option>
                                                        <option value="rear">📍 Rear</option>
                                                        <option value="360" disabled={!has360Upgrade}>📍 360°</option>
                                                    {/if}
                                                </select>
                                            </div>
                                        {/if}
                                    {/if}
                                    <button
                                        class="py-0.25 px-2 flex items-center justify-center rounded transition-colors flex-shrink-0 text-xs h-[1.5rem] red-button"
                                        on:click={() => removeWeapon(i)}
                                        aria-label="Remove weapon"
                                    >
                                        <span>× Remove</span>
                                    </button>
                                </div>
                            </div>
                        </li>
                    {/each}
                </ul>
            {/if}
            
            <div class="relative">
                <label for="add-weapon-{vehicle.id}" class="sr-only">Add a weapon</label>
                <select
                    id="add-weapon-{vehicle.id}"
                    class="w-full py-1 px-2 border border-stone-300 rounded bg-white text-stone-800 appearance-none pr-10 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-sm"
                    on:change={e => {
                        const target = e.target as HTMLSelectElement;
                        const weaponId = target.value;
                        if (weaponId) {
                            addWeapon(weaponId, 'front');
                            // Reset selection and blur to force UI refresh
                            target.value = "";
                            target.blur();
                            setTimeout(() => {
                                // Force reactivity by recalculating slots
                                usedBuildSlots = calculateUsedBuildSlots(vehicle);
                            }, 50);
                        }
                    }}
                    disabled={!filteredWeapons.some(w => w.slots === 0) && usedBuildSlots >= (vehicleTypes.find(vt => vt.id === vehicle.type)?.buildSlots || 2)}
                >
                    <option value="" disabled selected>+ Add weapon</option>
                    
                    <!-- Move Machine Gun to the top of the list -->
                    {#if true}
                        {@const machineGun = filteredWeapons.find(w => w.id === 'machine_gun')}
                        {#if machineGun}
                            {@const weaponSlots = machineGun.slots}
                            {@const canAddWeapon = weaponSlots === 0 || usedBuildSlots + weaponSlots <= (vehicleTypes.find(vt => vt.id === vehicle.type)?.buildSlots || 2)}
                            <option
                                value={machineGun.id}
                                disabled={!canAddWeapon}
                                class={!canAddWeapon ? 'text-gray-400' : ''}
                            >
                                {machineGun.name}
                                {weaponSlots === 0 ? " (0 Slots)" : ` (${weaponSlots} slot${weaponSlots > 1 ? 's' : ''})`}
                                {machineGun.cost ? ` (${machineGun.cost} cans)` : ""}
                                {!canAddWeapon ? " - Insufficient slots" : ""}
                            </option>
                        {/if}
                    {/if}
                    
                    {#each filteredWeapons.filter(w => w.id !== 'machine_gun').slice().sort((a, b) => a.name.localeCompare(b.name)) as w}
                        {@const weaponSlots = w.slots}
                        {@const canAddWeapon = weaponSlots === 0 || usedBuildSlots + weaponSlots <= (vehicleTypes.find(vt => vt.id === vehicle.type)?.buildSlots || 2)}
                        <option
                            value={w.id}
                            disabled={!canAddWeapon}
                            class={!canAddWeapon ? 'text-gray-400' : ''}
                        >
                            {w.name}
                            {weaponSlots === 0 ? " (0 Slots)" : ` (${weaponSlots} slot${weaponSlots > 1 ? 's' : ''})`}
                            {w.cost ? ` (${w.cost} cans)` : ""}
                            {!canAddWeapon ? " - Insufficient slots" : ""}
                        </option>
                    {/each}
                </select>
                <div class="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                    <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M19 9l-7 7-7-7"></path>
                    </svg>
                </div>
            </div>
            

        </div>
        
        <!-- Upgrades section - Hidden in Play Mode -->
        <div class="mb-4 mt-6" class:hidden={playMode}>
            <h3 class="text-sm font-bold text-stone-800 dark:text-gray-200 mb-1 flex items-center border-b border-stone-300 dark:border-gray-600 pb-1">
                <span class="bg-stone-300 dark:bg-gray-600 px-2 py-0.5 rounded-t mr-2 text-xs uppercase">Upgrades</span>
            </h3>
            
            {#if vehicle.upgrades && vehicle.upgrades.length === 0}
                <p class="text-stone-500 text-sm italic px-2">No upgrades installed.</p>
            {:else}
                <ul class="space-y-1 mb-3 border border-stone-300 rounded overflow-hidden divide-y divide-stone-300">
                    {#each vehicle.upgrades as upgradeId, i}
                        {@const upgrade = upgrades.find(u => u.id === upgradeId)}
                        <li class="flex items-center justify-between bg-stone-50 px-3 py-2">
                            <div class="flex-1">
                                <div class="flex items-center">
                                    <b><span class="text-stone-700 dark:text-gray-200 font-bold">
                                        {upgrade?.name || upgradeId}
                                    </span></b>
                                    {#if upgrade?.electrical}
                                        <span class="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded ml-2">⚡ Electrical</span>
                                    {/if}
                                    {#if upgrade?.trailer === true || upgrade?.trailer === "true"}
                                        <span class="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded ml-2">🚚 Trailer</span>
                                    {/if}
                                </div>
                                {#if upgrade?.specialRules}
                                    <div class="text-stone-500 dark:text-gray-400 text-xs">
                                        {#each parseSpecialRules(upgrade.specialRules) as ruleId}
                                            {@const ruleDetails = getWeaponSpecialRuleDetails(ruleId)}
                                            <span class="inline-block mr-1">
                                                <Tooltip
                                                    text="{ruleDetails?.ruleName || ruleId}{parseSpecialRules(upgrade.specialRules).indexOf(ruleId) < parseSpecialRules(upgrade.specialRules).length - 1 ? ',' : ''}"
                                                    content="{ruleDetails?.rule || `No description available for ${ruleDetails?.ruleName || ruleId}`}"
                                                />
                                            </span>
                                        {/each}
                                    </div>
                                {/if}
                                {#if upgrade?.hullModifier || upgrade?.crewModifier || upgrade?.gearModifier || upgrade?.handlingModifier}
                                    <div class="text-xs text-stone-500 dark:text-gray-400 mt-1">
                                        {upgrade.hullModifier ? `Hull: ${upgrade.hullModifier > 0 ? '+' : ''}${upgrade.hullModifier} ` : ''}
                                        {upgrade.crewModifier ? `Crew: ${upgrade.crewModifier > 0 ? '+' : ''}${upgrade.crewModifier} ` : ''}
                                        {upgrade.gearModifier ? `Gear: ${upgrade.gearModifier > 0 ? '+' : ''}${upgrade.gearModifier} ` : ''}
                                        {upgrade.handlingModifier ? `Handling: ${upgrade.handlingModifier > 0 ? '+' : ''}${upgrade.handlingModifier}` : ''}
                                    </div>
                                {/if}
                            </div>
                            <button
                                class="py-0.25 px-2 flex items-center justify-center rounded transition-colors ml-2 flex-shrink-0 text-xs h-[1.5rem] red-button"
                                on:click={() => removeUpgrade(i)}
                                aria-label="Remove upgrade"
                            >
                                <span>× Remove</span>
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}
            
            <div class="relative">
                <label for="add-upgrade-{vehicle.id}" class="sr-only">Add an upgrade</label>
                <select
                    id="add-upgrade-{vehicle.id}"
                    class="w-full py-1 px-2 border border-stone-300 rounded bg-white text-stone-800 appearance-none pr-10 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-sm"
                    on:change={e => {
                        const target = e.target as HTMLSelectElement;
                        const upgradeId = target.value;
                        if (upgradeId) {
                            addUpgrade(upgradeId);
                            // Reset selection and blur to force UI refresh
                            target.value = "";
                            target.blur();
                            setTimeout(() => {
                                // Force reactivity by recalculating slots
                                usedBuildSlots = calculateUsedBuildSlots(vehicle);
                            }, 50);
                        }
                    }}
                    disabled={!filteredUpgrades.some(u => u.slots === 0) && usedBuildSlots >= (vehicleTypes.find(vt => vt.id === vehicle.type)?.buildSlots || 2)}
                >
                    <option value="" disabled selected>+ Add upgrade</option>
                    {#each filteredUpgrades.slice().sort((a, b) => a.name.localeCompare(b.name)) as u}
                        {@const upgradeSlots = u.slots}
                        {@const canAddUpgrade = upgradeSlots === 0 || usedBuildSlots + upgradeSlots <= (vehicleTypes.find(vt => vt.id === vehicle.type)?.buildSlots || 2)}
                        <option
                            value={u.id}
                            disabled={!canAddUpgrade}
                            class={!canAddUpgrade ? 'text-gray-400' : ''}
                        >
                            {u.name}
                            {upgradeSlots === 0 ? " (0 Slots)" : ` (${upgradeSlots} slot${upgradeSlots > 1 ? 's' : ''})`}
                            {u.cost ? ` (${u.cost} cans)` : ""}
                            {!canAddUpgrade ? " - Insufficient slots" : ""}
                        </option>
                    {/each}
                </select>
            </div>
        </div>
        
        <!-- Trailer Upgrades section - Only shown when vehicle has a trailer -->
        {#if vehicle.upgrades && vehicle.upgrades.some(upgradeId => {
            const upgrade = upgrades.find(u => u.id === upgradeId);
            return upgrade && (upgrade.trailer === true || upgrade.trailer === "true");
        }) && !playMode}
            <div class="mb-4 mt-6">
                <h3 class="text-sm font-bold text-stone-800 dark:text-gray-200 mb-1 flex items-center border-b border-stone-300 dark:border-gray-600 pb-1">
                    <span class="bg-amber-300 dark:bg-amber-600 px-2 py-0.5 rounded-t mr-2 text-xs uppercase">Trailer Upgrade</span>
                    <span class="text-xs text-stone-500 dark:text-gray-400 ml-1">(limit 1)</span>
                </h3>
                
                <!-- List current trailer upgrades -->
                <ul class="space-y-1 mb-3 border border-stone-300 rounded overflow-hidden divide-y divide-stone-300">
                    {#each vehicle.upgrades.filter(upgradeId => {
                        const upgrade = upgrades.find(u => u.id === upgradeId);
                        return upgrade && upgrade.trailerUpgrade;
                    }) as trailerUpgradeId, i}
                        {@const upgrade = upgrades.find(u => u.id === trailerUpgradeId)}
                        <li class="flex items-center justify-between bg-stone-50 px-3 py-2">
                            <div class="flex-1">
                                <div class="flex items-center">
                                    <b><span class="text-stone-700 dark:text-gray-200 font-bold">
                                        {upgrade?.name || trailerUpgradeId}
                                    </span></b>
                                    {#if upgrade?.electrical}
                                        <span class="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded ml-2">⚡ Electrical</span>
                                    {/if}
                                </div>
                                {#if upgrade?.specialRules}
                                    <div class="text-stone-500 dark:text-gray-400 text-xs">
                                        {#each parseSpecialRules(upgrade.specialRules) as ruleId}
                                            {@const ruleDetails = getWeaponSpecialRuleDetails(ruleId)}
                                            <span class="inline-block mr-1">
                                                <Tooltip
                                                    text="{ruleDetails?.ruleName || ruleId}{parseSpecialRules(upgrade.specialRules).indexOf(ruleId) < parseSpecialRules(upgrade.specialRules).length - 1 ? ',' : ''}"
                                                    content="{ruleDetails?.rule || `No description available for ${ruleDetails?.ruleName || ruleId}`}"
                                                />
                                            </span>
                                        {/each}
                                    </div>
                                {/if}
                                {#if upgrade?.effect}
                                    <div class="text-stone-500 dark:text-gray-400 text-xs mt-1">{upgrade.effect}</div>
                                {/if}
                            </div>
                            <button
                                class="py-0.25 px-2 flex items-center justify-center rounded transition-colors ml-2 flex-shrink-0 text-xs h-[1.5rem] red-button"
                                on:click={() => {
                                    // Find index in the main upgrades array and remove
                                    const mainIndex = vehicle.upgrades.findIndex(id => id === trailerUpgradeId);
                                    if (mainIndex >= 0) {
                                        removeUpgrade(mainIndex);
                                    }
                                }}
                                aria-label="Remove trailer upgrade"
                            >
                                <span>× Remove</span>
                            </button>
                        </li>
                    {/each}
                </ul>
                
                <!-- Add trailer upgrade dropdown -->
                <!-- Only show add dropdown if no trailer upgrade is present -->
                {#if !vehicle.upgrades.some(upgradeId => {
                    const upgrade = upgrades.find(u => u.id === upgradeId);
                    return upgrade && upgrade.trailerUpgrade;
                })}
                    <div class="relative">
                        <label for="add-trailer-upgrade-{vehicle.id}" class="sr-only">Add a trailer upgrade</label>
                        <select
                            id="add-trailer-upgrade-{vehicle.id}"
                            class="w-full py-1 px-2 border border-stone-300 rounded bg-white text-stone-800 appearance-none pr-10 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-sm"
                            on:change={e => {
                                const target = e.target as HTMLSelectElement;
                                const upgradeId = target.value;
                                if (upgradeId) {
                                    addUpgrade(upgradeId);
                                    // Reset selection and blur to force UI refresh
                                    target.value = "";
                                    target.blur();
                                    setTimeout(() => {
                                        // Force reactivity by recalculating slots
                                        usedBuildSlots = calculateUsedBuildSlots(vehicle);
                                    }, 50);
                                }
                            }}
                        >
                            <option value="" disabled selected>+ Add trailer upgrade</option>
                            {#each filteredTrailerUpgrades.slice().sort((a, b) => a.name.localeCompare(b.name)) as u}
                                <option value={u.id}>{u.name}{u.cost ? ` (${u.cost} cans)` : ""}</option>
                            {/each}
                        </select>
                    </div>
                {:else}
                    <p class="text-xs text-stone-500 dark:text-gray-400 italic px-2 mt-1">Only one trailer upgrade allowed per vehicle.</p>
                {/if}
            </div>
        {/if}
        
        <!-- Perks section - Hidden in Play Mode -->
        <div class="mb-4 mt-6" class:hidden={playMode}>
            <h3 class="text-sm font-bold text-stone-800 dark:text-gray-200 mb-1 flex items-center border-b border-stone-300 dark:border-gray-600 pb-1">
                <span class="bg-stone-300 dark:bg-gray-600 px-2 py-0.5 rounded-t mr-2 text-xs uppercase">Perks</span>
            </h3>
            
            {#if vehicle.perks && vehicle.perks.length === 0}
                <p class="text-stone-500 dark:text-gray-400 text-sm italic px-2">No perks selected.</p>
            {:else}
                <ul class="space-y-2 mb-3 border border-stone-300 dark:border-gray-600 rounded overflow-hidden divide-y divide-stone-300 dark:divide-gray-600">
                    {#each vehicle.perks as perkId, i}
                        {@const perk = perks.find(p => p.id === perkId)}
                        <li class="flex items-center justify-between bg-stone-50 dark:bg-gray-700 px-3 py-3">
                            <div class="flex-1">
                                <div class="flex items-center mb-1">
                                    <b><span class="text-stone-700 dark:text-gray-200 font-bold">{perk?.name || perkId}</span></b>
                                    {#if perk?.electrical}
                                        <span class="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded ml-2">⚡ Electrical</span>
                                    {/if}
                                </div>
                                <span class="text-stone-500 dark:text-gray-400 text-xs block mt-1">{@html perk?.text || ""}</span>
                            </div>
                            <button
                                class="py-0.25 px-2 flex items-center justify-center rounded transition-colors ml-2 flex-shrink-0 text-xs h-[1.5rem] red-button"
                                on:click={() => removePerk(i)}
                                aria-label="Remove perk"
                            >
                                <span>× Remove</span>
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}

            <div class="relative">
                <label for="add-perk-{vehicle.id}" class="sr-only">Add a perk</label>
                <select
                    id="add-perk-{vehicle.id}"
                    class="w-full py-1 px-2 border border-stone-300 rounded bg-white text-stone-800 appearance-none pr-10 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-sm"
                    on:change={e => {
                        const target = e.target as HTMLSelectElement;
                        const perkId = target.value;
                        if (perkId) {
                            addPerk(perkId);
                            target.value = ""; // Reset selection
                        }
                    }}
                >
                    <option value="" disabled selected>+ Add perk</option>
                    {#each filteredPerks.slice().sort((a, b) => a.name.localeCompare(b.name)) as p}
                        <option value={p.id}>{p.name}{p.cost ? ` (${p.cost} cans)` : ""}</option>
                    {/each}
                </select>
            </div>

            <!-- Special Rules Section - Only in Edit Mode -->
            {#if vehicleTypes.find(vt => vt.id === vehicle.type)?.specialRules}
                {@const vType = vehicleTypes.find(vt => vt.id === vehicle.type)}
                {@const specialRulesStr = vType?.specialRules || ''}
                {@const specialRules = specialRulesStr.split(',').map(rule => rule.trim()) || []}
                <div class="mt-4">
                    <h3 class="text-sm font-bold text-stone-800 dark:text-gray-200 mb-1 flex items-center border-b border-stone-300 dark:border-gray-600 pb-1">
                        <span class="bg-stone-300 dark:bg-gray-600 px-2 py-0.5 rounded-t mr-2 text-xs uppercase">Special Rules</span>
                    </h3>

                    {#if specialRules.length === 0}
                        <p class="text-stone-500 dark:text-gray-400 text-sm italic px-2">No special rules.</p>
                    {:else}
                        <ul class="space-y-2 mb-3 border border-stone-300 dark:border-gray-600 rounded overflow-hidden divide-y divide-stone-300 dark:divide-gray-600">
                            {#each specialRules as ruleName}
                                {@const ruleDetails = getVehicleRuleDetails(ruleName.trim())}
                                <li class="bg-stone-50 dark:bg-gray-700 px-3 py-3">
                                    <div class="flex-1">
                                        <b><span class="text-stone-700 dark:text-gray-200 font-bold block mb-1">{ruleDetails?.ruleName || ruleName.trim()}</span></b>
                                        {#if ruleDetails}
                                            <div class="text-stone-500 dark:text-gray-400 text-sm mt-1">{@html ruleDetails.rule}</div>
                                        {:else}
                                            <div class="text-stone-500 dark:text-gray-400 text-sm italic mt-1">Rule details not found for "{ruleName.trim()}".</div>
                                        {/if}
                                    </div>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </div>
            {/if}
        </div>
        
        <!-- Validation errors section -->
        {#if validationReport && validationReport.errors && validationReport.errors.length > 0}
            <div class="mt-4 p-3 bg-red-100 dark:bg-red-900 rounded-md border border-red-300 dark:border-red-700">
                <h4 class="text-sm font-bold text-red-800 dark:text-red-200 mb-2">Validation Errors:</h4>
                <ul class="list-disc pl-5 text-sm text-red-700 dark:text-red-300">
                    {#each validationReport.errors as error}
                        <li>{error}</li>
                    {/each}
                </ul>
            </div>
        {/if}
        
        <!-- Validation warnings section -->
        {#if validationReport && validationReport.warnings && validationReport.warnings.length > 0}
            <div class="mt-4 p-3 bg-amber-100 dark:bg-amber-900 rounded-md border border-amber-300 dark:border-amber-700">
                <h4 class="text-sm font-bold text-amber-800 dark:text-amber-200 mb-2">Warnings:</h4>
                <ul class="list-disc pl-5 text-sm text-amber-700 dark:text-amber-300">
                    {#each validationReport.warnings as warning}
                        <li>{warning}</li>
                    {/each}
                </ul>
            </div>
        {/if}
    </div>
</div>

<style>
    /* Tooltips are now handled by the Tooltip component */
</style>