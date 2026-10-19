<script lang="ts">
    import { nanoid } from 'nanoid';
    import { createEventDispatcher } from 'svelte';
    import BuildHeader from './BuildHeader.svelte';
    import VehiclePhotos from './VehiclePhotos.svelte';
    import { loadWeaponSpecialRules } from '$lib/rules/loadRules';
    import { perkCost } from '$lib/validate/calc';
    import Tooltip from './Tooltip.svelte';
    import AddCombobox from './AddCombobox.svelte';
    import { perkAddOptions, upgradeAddOptions, weaponAddOptions } from '$lib/builder/gearAddOptions';
    import type { Perk, Upgrade, Vehicle, VehicleRule, Weapon } from '$lib/rules/types';
    import { resolveById } from '$lib/validate/v3/lookup';
    import { v3BuildSlots } from '$lib/validate/v3/slots';

    interface TeamVehicle {
        id: string;
        type: string;
        name: string;
        weapons: string[];
        weaponFacings?: Record<string, string>;
        upgrades: string[];
        perks: string[];
        driverArchetype?: string;
        driverName?: string;
        secondPerkClass?: string;
        turretWeaponId?: string;
        upgradeFacings?: Record<string, string>;
    }

    interface VehicleValidationReport {
        vehicleId?: string;
        cans?: number;
        errors?: string[];
        warnings?: string[];
    }

    const dispatch = createEventDispatcher();

    // Load weapon special rules
    const weaponSpecialRules = loadWeaponSpecialRules();
    
    // Props are declared below, don't try to use them here
    
    // Props
    export let vehicle: TeamVehicle;
    export let teamId: string | null = null;
    export let sharedPhotos: { photoId: string; url: string; caption: string; vehicleType: string }[] = [];
    export let photoViewOnly = false;

    // A loaded vehicle often has no gear arrays or facings map. Repair those
    // before cost and `{#each}` run, or the card boundary replaces the vehicle.
    function asIdList(value: unknown): string[] {
        if (!Array.isArray(value)) return [];
        return value.filter((item): item is string => typeof item === 'string');
    }

    function listIsIds(value: unknown): value is string[] {
        return Array.isArray(value) && value.every((item) => typeof item === 'string');
    }

    $: if (vehicle) {
        if (!listIsIds(vehicle.weapons)) vehicle.weapons = asIdList(vehicle.weapons);
        if (!listIsIds(vehicle.upgrades)) vehicle.upgrades = asIdList(vehicle.upgrades);
        if (!listIsIds(vehicle.perks)) vehicle.perks = asIdList(vehicle.perks);
        if (!vehicle.weaponFacings || typeof vehicle.weaponFacings !== 'object' || Array.isArray(vehicle.weaponFacings)) {
            vehicle.weaponFacings = {};
        }
    }
    export let vehicleTypes: Vehicle[] = [];
    export let weapons: Weapon[] = [];
    export let upgrades: Upgrade[] = [];
    export let perks: Perk[] = [];
    export let vehicleRules: VehicleRule[] = [];
    export let collapsed: boolean = false;
    export let playMode: boolean = false;
    export let validationReport: VehicleValidationReport | null = null;
    export let hazardCount: number = 0;
    export let filteredWeapons: Weapon[] = [];
    export let filteredUpgrades: Upgrade[] = [];
    export let filteredTrailerUpgrades: Upgrade[] = [];
    export let filteredPerks: Perk[] = [];
    export let usedBuildSlots: number = 0;
    export let rulesVersion: 2 | 3 = 2;
    export let drivers: { id: string; name: string; perkClass: string; ability: string }[] = [];
    export let perkClasses: { id: string; name: string }[] = [];
    
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
    
    function addWeapon(weaponId: string, facing = 'front') {
        dispatch('addWeapon', { vehicleId: vehicle.id, weaponId, facing });
    }
    
    function removeWeapon(index: number) {
        dispatch('removeWeapon', { vehicleId: vehicle.id, weaponIndex: index });
    }
    
    function addUpgrade(upgradeId: string) {
        dispatch('addUpgrade', { vehicleId: vehicle.id, upgradeId });
    }
    
    function removeUpgrade(index: number) {
        dispatch('removeUpgrade', { vehicleId: vehicle.id, upgradeIndex: index });
    }
    
    function addPerk(perkId: string) {
        dispatch('addPerk', { vehicleId: vehicle.id, perkId });
    }

    function removePerk(index: number) {
        dispatch('removePerk', { vehicleId: vehicle.id, perkIndex: index });
    }

    const FACING_OPTIONS = ['front', 'side', 'rear', '360'];

    function setWeaponFacing(weaponId: string, facing: string) {
        const next = { ...(vehicle.weaponFacings || {}), [weaponId]: facing };
        vehicle.weaponFacings = next;
        patch({ weaponFacings: next });
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
    $: resolvedWeapons = (vehicle.weapons || [])
        .map((id) => resolveById(weapons, id))
        .filter((entry): entry is Weapon => !!entry);
    $: resolvedUpgrades = (vehicle.upgrades || [])
        .map((id) => upgrades.find((entry) => entry.id === id))
        .filter((entry): entry is Upgrade => !!entry);
    $: v3Slots = rulesVersion === 3 && vehicleType
        ? v3BuildSlots(vehicleType, resolvedWeapons, resolvedUpgrades)
        : null;
    $: maxBuildSlots = v3Slots ? v3Slots.capacity : (vehicleType?.buildSlots ?? 2);
    // Recalculate slots whenever weapons or upgrades change
    $: usedBuildSlots = v3Slots ? v3Slots.used : calculateUsedBuildSlots(vehicle);
    $: slotContext = {
        rulesVersion,
        vehicleType,
        maxBuildSlots,
        usedBuildSlots,
        resolvedWeapons,
        resolvedUpgrades,
        capacity: v3Slots?.capacity ?? null
    };
    $: weaponOptions = weaponAddOptions(filteredWeapons, slotContext);
    $: upgradeOptions = upgradeAddOptions(filteredUpgrades, slotContext);
    $: perkOptions = perkAddOptions(filteredPerks);

    function patch(partial: Partial<TeamVehicle>) {
        dispatch('patch', { vehicleId: vehicle.id, patch: partial });
    }

    function setDriverArchetype(id: string) {
        patch({ driverArchetype: id });
    }

    function setDriverName(name: string) {
        const patchBody: Record<string, string> = { driverName: name };
        if (!name.trim()) patchBody.secondPerkClass = '';
        patch(patchBody);
    }

    function className(id: string) {
        return perkClasses.find((entry) => entry.id === id)?.name || id;
    }

    function calculateVehicleCost(vehicle: TeamVehicle, vehicleType: Vehicle | undefined) {
        // Use the passed vehicleType to avoid redundant lookups
        if (!vehicleType) return 0;

        let totalCost = vehicleType.baseCost || 0;

        // Add weapon costs
        for (const weaponInstanceId of vehicle.weapons || []) {
            if (typeof weaponInstanceId !== 'string') continue;
            // Use a more robust method to find the base weapon ID
            // Try increasingly longer potential base IDs until we find a match
            const parts = weaponInstanceId.split('_');
            let baseWeaponId = '';
            let weaponObj: Weapon | undefined;
            
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
        for (const upgradeId of asIdList(vehicle.upgrades)) {
            const upgradeObj = upgrades.find(u => u.id === upgradeId);
            if (upgradeObj && upgradeObj.cost) {
                totalCost += upgradeObj.cost;
            }
        }

        // Add perk costs
        for (const perkId of asIdList(vehicle.perks)) {
            const perkObj = perks.find(p => p.id === perkId);
            totalCost += perkCost(perkObj);
        }

        if (rulesVersion === 3 && vehicle.upgrades?.includes('turret_mount') && vehicle.turretWeaponId) {
            const turretWeapon = resolveById(weapons, vehicle.turretWeaponId);
            if (turretWeapon?.cost) totalCost += turretWeapon.cost;
        }

        return totalCost;
    }

    function calculateUsedBuildSlots(vehicle: TeamVehicle) {
        let totalSlots = 0;

        // Calculate slots used by weapons
        for (const weaponInstanceId of vehicle.weapons || []) {
            if (typeof weaponInstanceId !== 'string') continue;
            // Use a more robust method to find the base weapon ID
            // Try increasingly longer potential base IDs until we find a match
            const parts = weaponInstanceId.split('_');
            let baseWeaponId = '';
            let weaponObj: Weapon | undefined;
            
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
                totalSlots += weaponObj.slots || 0;
            }
        }

        // Calculate slots used by upgrades
        for (const upgradeId of asIdList(vehicle.upgrades)) {
            const upgradeObj = upgrades.find(u => u.id === upgradeId);
            if (upgradeObj) {
                // Special case: Some upgrades don't use build slots in Gaslands Refueled
                if (['grenades'].includes(upgradeId)) {
                    // These upgrades don't consume build slots
                    continue;
                }
                totalSlots += upgradeObj.slots || 0;
            }
        }

        return totalSlots;
    }

    function calculateMaxHull(): number {
        const vehicleType = vehicleTypes.find(vt => vt.id === vehicle.type);
        if (!vehicleType) return 0;

        let maxHull = vehicleType.maxHull;

        // Add hull points from upgrades
        for (const upgradeId of asIdList(vehicle.upgrades)) {
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
        for (const perkId of asIdList(vehicle.perks)) {
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
        for (const upgradeId of asIdList(vehicle.upgrades)) {
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
        for (const upgradeId of asIdList(vehicle.upgrades)) {
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
        for (const upgradeId of asIdList(vehicle.upgrades)) {
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
        for (const weaponInstanceId of vehicle.weapons || []) {
            if (typeof weaponInstanceId !== 'string') continue;
            // Use a more robust method to find the base weapon ID
            // Try increasingly longer potential base IDs until we find a match
            const parts = weaponInstanceId.split('_');
            let baseWeaponId = '';
            let weaponObj: Weapon | undefined;
            
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
        if (typeof specialRulesString !== 'string' || !specialRulesString) return [];

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
    function trackerMarks(count: number) {
        if (!Number.isFinite(count) || count <= 0) return [];
        return Array(Math.min(40, Math.floor(count)));
    }

    function findBaseWeaponId(weaponInstanceId: string, parts?: string[]) {
        if (typeof weaponInstanceId !== 'string') return '';
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

<div id="vehicle-{vehicle.id}" class="vehicle-card scroll-mt-20 bg-stone-200 dark:bg-gray-800 rounded-lg shadow-md overflow-hidden border-2 p-1 mb-1" style="border-color: {vehicleTypes.find(vt => vt.id === vehicle.type)?.color || '#f59e0b'};">
    {#if !vehicleTypes.some((vt) => vt.id === vehicle.type)}
        <p class="px-4 py-2 text-sm text-red-800 bg-red-50" data-testid="vehicle-warning">
            This vehicle isn't in the current rules list ({vehicle.type || 'no type'}). It is still on the team.
        </p>
    {/if}
    {#if maxBuildSlots > 0 && usedBuildSlots > maxBuildSlots}
        <p class="px-4 py-2 text-sm text-amber-900 bg-amber-50" data-testid="slot-warning">
            This vehicle uses {usedBuildSlots} build slots and only has {maxBuildSlots}.
        </p>
    {/if}
    {#if collapsed}
        {@const typeName = vehicleTypes.find(vt => vt.id === vehicle.type)?.name || vehicle.type}
        {@const driverLabel = drivers.find(driver => driver.id === vehicle.driverArchetype)?.name || 'No driver'}
        <div class="px-4 py-3 bg-stone-100 dark:bg-gray-800 flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-medium text-stone-800 dark:text-gray-100" data-testid="vehicle-summary">
                {typeName} · {vehicle.name || 'Unnamed'} · {vehicleCost} cans · {usedBuildSlots}/{maxBuildSlots} slots
                {#if rulesVersion === 3} · {driverLabel}{/if}
            </p>
            <div class="flex gap-2">
                <button
                    class="h-[32px] px-2 flex items-center justify-center rounded-md text-xs amber-button"
                    on:click={toggleCollapse}
                    aria-label="Expand vehicle"
                >
                    <span>+ Expand</span>
                </button>
                <button
                    class="h-[32px] px-2 flex items-center justify-center rounded-md text-xs red-button"
                    on:click={removeVehicle}
                    aria-label="Remove vehicle"
                >
                    <span>× Remove</span>
                </button>
            </div>
        </div>
    {:else}
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
    {/if}
    
    <!-- Vehicle details - Hidden when collapsed -->
    <div class="px-1 py-2" class:hidden={collapsed}>
        {#if vehicleType && vehicleType.armour !== undefined && vehicleType.armour !== null}
            <div class="flex flex-wrap gap-2 mb-3 text-xs">
                <span class="bg-stone-200 dark:bg-gray-600 px-2 py-1 rounded">Gear {vehicleType.maxGear}</span>
                <span class="bg-stone-200 dark:bg-gray-600 px-2 py-1 rounded">Handling {vehicleType.handling}</span>
                <span class="bg-stone-200 dark:bg-gray-600 px-2 py-1 rounded">Crew {vehicleType.crew}</span>
                <span class="bg-stone-200 dark:bg-gray-600 px-2 py-1 rounded">Weight {vehicleType.weight}</span>
                <span class="bg-stone-200 dark:bg-gray-600 px-2 py-1 rounded">Armour {vehicleType.armour}</span>
                <span class="bg-stone-200 dark:bg-gray-600 px-2 py-1 rounded">Hull {vehicleType.maxHull}</span>
                <span class="bg-stone-200 dark:bg-gray-600 px-2 py-1 rounded">Slots {vehicleType.buildSlots}</span>
                {#if vehicleType.rarity}
                    <span class="bg-amber-100 dark:bg-amber-900/40 px-2 py-1 rounded">{vehicleType.rarity}</span>
                {/if}
            </div>
        {/if}

        {#if rulesVersion === 3 && !playMode}
            <div class="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <label class="text-sm">
                    <span class="block font-semibold mb-1">Driver</span>
                    <select
                        class="w-full py-1 px-2 border border-stone-300 rounded bg-white text-stone-800 text-sm"
                        value={vehicle.driverArchetype || ''}
                        on:change={(e) => setDriverArchetype(e.currentTarget.value)}
                    >
                        <option value="">No driver</option>
                        {#each drivers as driver}
                            <option value={driver.id}>{driver.name} — {className(driver.perkClass)}</option>
                        {/each}
                    </select>
                    {#if vehicle.driverArchetype}
                        <span class="block text-xs text-stone-500 mt-1">{drivers.find((entry) => entry.id === vehicle.driverArchetype)?.ability}</span>
                    {/if}
                </label>
                <label class="text-sm">
                    <span class="block font-semibold mb-1">Driver name</span>
                    <input
                        class="w-full py-1 px-2 border border-stone-300 rounded bg-white text-stone-800 text-sm"
                        value={vehicle.driverName || ''}
                        placeholder="Name unlocks a second perk class"
                        on:input={(e) => setDriverName(e.currentTarget.value)}
                    />
                </label>
                <label class="text-sm md:col-span-2">
                    <span class="block font-semibold mb-1">Second perk class</span>
                    <select
                        class="w-full py-1 px-2 border border-stone-300 rounded bg-white text-stone-800 text-sm"
                        disabled={!(vehicle.driverName || '').trim()}
                        value={vehicle.secondPerkClass || ''}
                        on:change={(e) => patch({ secondPerkClass: e.currentTarget.value })}
                    >
                        <option value="">None</option>
                        {#each perkClasses as perkClass}
                            <option value={perkClass.id}>{perkClass.name}</option>
                        {/each}
                    </select>
                </label>
            </div>
        {/if}
        
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
                        {#each trackerMarks(calculateMaxHull()) as _, i}
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
                            {#each trackerMarks(calculateMaxGear()) as _, i}
                                <span class="gear-number text-xs font-bold">{i+1}</span>
                            {/each}
                        </div>
                    </div>
                </div>
                
                <div class="crew-hazard-row flex gap-4 col-span-1 md:col-span-2">
                    <div class="crew-tracker p-3 bg-white dark:bg-gray-800 rounded-lg border border-stone-300 dark:border-gray-600 flex-1">
                        <div class="tracker-label text-sm font-semibold text-stone-600 dark:text-gray-300 uppercase mb-2">Crew: {calculateCrew()}</div>
                        <div class="flex flex-wrap gap-1">
                            {#each trackerMarks(calculateCrew()) as _, i}
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
                        {@const specialRulesStr = typeof vType?.specialRules === 'string' ? vType.specialRules : ''}
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
                                                (typeof weaponObj?.specialRules === 'string' && weaponObj.specialRules.toUpperCase().includes("CREW FIRED")) || 
                                                parseSpecialRules(weaponObj.specialRules).includes("crew_fired")
                                            ))}
                                            {@const isDropped = weaponObj?.dropped || (weaponObj?.range && weaponObj?.range.includes('Dropped'))}
                                            {@const storedFacing = vehicle.weaponFacings?.[weaponId] || ''}
                                            {@const optionValues = isCrewFired ? ['360'] : isDropped ? ['side', 'rear'] : FACING_OPTIONS}
                                            {@const displayFacing = optionValues.includes(storedFacing) ? storedFacing : (storedFacing || (isCrewFired ? '360' : isDropped ? 'rear' : 'front'))}
                                            {@const extraFacing = optionValues.includes(displayFacing) ? '' : displayFacing}
                                            
                                            <!-- One-way value. bind:value writes a missing or illegal facing during render and loops until the card boundary gives up. -->
                                            <div class="flex items-center">
                                                
                                                <select
                                                    value={displayFacing}
                                                    on:change={(event) => setWeaponFacing(weaponId, (event.currentTarget as HTMLSelectElement).value)}
                                                    class="text-xs py-0.5 px-1 border border-stone-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-stone-800 dark:text-gray-200"
                                                    disabled={weaponObj?.facing === 'fixed' || isCrewFired || playMode}
                                                    aria-label="Weapon facing direction"
                                                    title="Weapon facing direction"
                                                >
                                                    {#if extraFacing}
                                                        <option value={extraFacing}>📍 {extraFacing}</option>
                                                    {/if}
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
                                        class="py-0.25 px-2 flex items-center justify-center rounded transition-colors flex-shrink-0 text-xs h-6 compact-remove red-button"
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
            
            <AddCombobox
                id="add-weapon-{vehicle.id}"
                label="Add a weapon"
                placeholder="+ Add weapon… (type to search)"
                options={weaponOptions}
                on:select={(event) => {
                    addWeapon(event.detail.id, 'front');
                    setTimeout(() => {
                        usedBuildSlots = calculateUsedBuildSlots(vehicle);
                    }, 50);
                }}
            />
            

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
                                {#if upgrade?.effect}
                                    <div class="text-stone-500 dark:text-gray-400 text-xs mt-1">{upgrade.effect}</div>
                                {/if}
                                {#if rulesVersion === 3 && upgrade?.needsFacing}
                                    <label class="block text-xs mt-1">
                                        Facing
                                        <select
                                            class="ml-1 py-0.5 px-1 border border-stone-300 rounded bg-white text-stone-800"
                                            value={vehicle.upgradeFacings?.[upgrade.id] || ''}
                                            on:change={(e) => patch({
                                                upgradeFacings: { ...(vehicle.upgradeFacings || {}), [upgrade.id]: e.currentTarget.value }
                                            })}
                                        >
                                            <option value="">Choose</option>
                                            <option value="front">Front</option>
                                            <option value="side">Side</option>
                                            <option value="rear">Rear</option>
                                        </select>
                                    </label>
                                {/if}
                                {#if rulesVersion === 3 && upgrade?.id === 'turret_mount'}
                                    <label class="block text-xs mt-1">
                                        Turret weapon
                                        <select
                                            class="ml-1 py-0.5 px-1 border border-stone-300 rounded bg-white text-stone-800"
                                            value={vehicle.turretWeaponId || ''}
                                            on:change={(e) => patch({ turretWeaponId: e.currentTarget.value })}
                                        >
                                            <option value="">Choose a shooting weapon</option>
                                            {#each vehicle.weapons as weaponId}
                                                {@const weapon = resolveById(weapons, weaponId)}
                                                {#if weapon && weapon.category !== 'dropped'}
                                                    <option value={weaponId}>{weapon.name}</option>
                                                {/if}
                                            {/each}
                                        </select>
                                    </label>
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
                                class="py-0.25 px-2 flex items-center justify-center rounded transition-colors ml-2 flex-shrink-0 text-xs h-6 compact-remove red-button"
                                on:click={() => removeUpgrade(i)}
                                aria-label="Remove upgrade"
                            >
                                <span>× Remove</span>
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}
            
            <AddCombobox
                id="add-upgrade-{vehicle.id}"
                label="Add an upgrade"
                placeholder="+ Add upgrade… (type to search)"
                options={upgradeOptions}
                on:select={(event) => {
                    addUpgrade(event.detail.id);
                    setTimeout(() => {
                        usedBuildSlots = calculateUsedBuildSlots(vehicle);
                    }, 50);
                }}
            />
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
                                class="py-0.25 px-2 flex items-center justify-center rounded transition-colors ml-2 flex-shrink-0 text-xs h-6 compact-remove red-button"
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
                                class="py-0.25 px-2 flex items-center justify-center rounded transition-colors ml-2 flex-shrink-0 text-xs h-6 compact-remove red-button"
                                on:click={() => removePerk(i)}
                                aria-label="Remove perk"
                            >
                                <span>× Remove</span>
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}

            <AddCombobox
                id="add-perk-{vehicle.id}"
                label="Add a perk"
                placeholder="+ Add perk… (type to search)"
                options={perkOptions}
                on:select={(event) => addPerk(event.detail.id)}
            />

            <!-- Special Rules Section - Only in Edit Mode -->
            {#if vehicleTypes.find(vt => vt.id === vehicle.type)?.specialRules}
                {@const vType = vehicleTypes.find(vt => vt.id === vehicle.type)}
                {@const specialRulesStr = typeof vType?.specialRules === 'string' ? vType.specialRules : ''}
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

        <svelte:boundary>
            <VehiclePhotos {teamId} vehicleId={vehicle.id} {playMode} viewOnly={photoViewOnly} viewPhotos={sharedPhotos} />
            {#snippet failed()}
                <p class="mt-4 text-sm text-stone-600 dark:text-gray-300" data-testid="vehicle-photos-error">Photos could not be shown on this vehicle.</p>
            {/snippet}
        </svelte:boundary>
    </div>
</div>

<style>
    /* Tooltips are now handled by the Tooltip component */
</style>