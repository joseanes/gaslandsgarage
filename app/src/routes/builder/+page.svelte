<!-- Updated from the content provided by the user - Refactored with VehicleCard component -->
<script lang="ts">
	/**
	 * IMPORTANT: VALIDATION APPROACH
	 * 
	 * This component previously experienced infinite update loops (effect_update_depth_exceeded)
	 * due to circular dependencies in Svelte's reactive declarations.
	 * 
	 * We have implemented a safer automatic validation approach that:
	 * 
	 * 1. Avoids reactive declarations for validation (no $: validation = ...)
	 * 2. Uses timeouts to break reactive update chains
	 * 3. Uses validation flags (isValidating, isForceValidating) to prevent duplicate calls
	 * 4. Deep copies objects with JSON.parse/stringify to prevent reference sharing
	 * 5. Updates happen automatically through the updateCurrentDraft function
	 * 
	 * This maintains automatic validation while preventing infinite update loops.
	 */
	
	import { nanoid } from 'nanoid';
	import { validateDraft } from '$lib/validate';
	import type { Draft, Validation } from '$lib/validate/model';
	import { encodeDraft, decodeDraft } from '$lib/draft/io';
	import { countedVehicleTotal, defaultRulesVersion, maxCountedVehicles, normalizeRulesVersion, type RulesVersion } from '$lib/rules/version';
	import { resolveById } from '$lib/validate/v3/lookup';
	import { v3BuildSlots } from '$lib/validate/v3/slots';
	import { goto } from '$app/navigation';
	import { draftToDataURL } from '$lib/draft/qr';
	import Auth from '$lib/components/Auth.svelte';
import SettingsMenu from '$lib/components/SettingsMenu.svelte';
	import VehicleCard from '$lib/components/VehicleCard.svelte';
	import Coach from '$lib/components/Coach.svelte';
	import Tooltip from '$lib/components/Tooltip.svelte';
	// Import print functions - we alias printTeam to avoid name collision with local function
	import { printTeam as printServiceFunc, printTeamDashboard } from '$lib/components/printing/PrintService';
	import { user, signInWithGoogle } from '$lib/firebase';
import { getUserSettings, saveUserSettings, DEFAULT_SETTINGS } from '$lib/services/settings';
import { saveTeam, getUserTeams } from '$lib/services/team';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import '../../print.css';

	/* ---------- server data ---------- */
	export let data: {
		sponsors: import('$lib/rules/types').Sponsor[];
		vehicleTypes: import('$lib/rules/types').Vehicle[];
		weapons: import('$lib/rules/types').Weapon[];
		upgrades: import('$lib/rules/types').Upgrade[];
		perks: import('$lib/rules/types').Perk[];
		vehicleRules: import('$lib/rules/types').VehicleRule[];
		v3: import('../../data/rules/v3').V3Catalog;
	};
	let rulesVersion: RulesVersion = defaultRulesVersion();
	let drivers: import('../../data/rules/v3').V3Driver[] = [];
	let perkClasses: { id: string; name: string }[] = [];
	let sponsors = data.sponsors;
	let vehicleTypes = data.vehicleTypes;
	let weapons = data.weapons;
	let upgrades = data.upgrades;
	let perks = data.perks;
	let vehicleRules = data.vehicleRules;

	function applyCatalog(version: RulesVersion) {
		if (version === 3) {
			sponsors = data.v3.sponsors as unknown as typeof sponsors;
			vehicleTypes = data.v3.vehicleTypes as unknown as typeof vehicleTypes;
			weapons = data.v3.weapons as unknown as typeof weapons;
			upgrades = data.v3.upgrades as unknown as typeof upgrades;
			perks = data.v3.perks as unknown as typeof perks;
			vehicleRules = data.v3.vehicleRules;
			drivers = data.v3.drivers;
			perkClasses = data.v3.perkClasses;
		} else {
			sponsors = data.sponsors;
			vehicleTypes = data.vehicleTypes;
			weapons = data.weapons;
			upgrades = data.upgrades;
			perks = data.perks;
			vehicleRules = data.vehicleRules;
			drivers = [];
			perkClasses = [];
		}
	}
	applyCatalog(rulesVersion);

	function adoptRulesVersion(raw: { rulesVersion?: unknown } | null | undefined) {
		rulesVersion = normalizeRulesVersion(raw?.rulesVersion);
		applyCatalog(rulesVersion);
	}
  
	// Log detailed vehicle type information to check sponsor restrictions
	console.log('LOADED DATA: All vehicle types:', vehicleTypes.map(v => ({
		id: v.id,
		name: v.name, 
		sponsors: v.sponsors || []
	})));
	
	// Special focus on vehicles with sponsor restrictions
	const restrictedVehicles = vehicleTypes.filter(v => v.sponsors && v.sponsors.length > 0);
	console.log('RESTRICTED VEHICLES:', restrictedVehicles.map(v => ({
		id: v.id,
		name: v.name,
		sponsors: v.sponsors
	})));
  
	/* ---------- settings ---------- */
	let includeAdvanced = true;
	let enableSponsorships = true;
	let darkMode = false;
	let printStyle = 'classic';
	let hasRules = false; // Whether user has acknowledged having the Gaslands Refuelled rules
		let showExperimentalFeatures = false; // Whether to show experimental features
		let receiveUpdates = false; // Whether user wants to receive updates and marketing emails
	let showOnPlayersMap = false; // Whether to show on the Gaslands Players map
	let allowContactFromPlayers = false; // Whether other players can contact for game setup
	let location = ''; // User's location for the players map
	let showEquipmentDescriptions = true; // Whether to show equipment descriptions in printouts
	let showPerkDescriptions = true; // Whether to show perk descriptions in printouts
let showSpecialRules = true; // Whether to show vehicle special rules in printouts

	// Rules acknowledgment modal state
	let showRulesAcknowledgmentModal = false;
	let rulesModalAction = ''; // To track which action triggered the rules modal

	// Load settings on mount
	// Load settings directly
	onMount(async () => {
		console.log("[Builder] IMMEDIATE onMount - Loading settings");
		await initializeSettings();
		
		// Check if we have stored team data from a failed load attempt
		try {
			const storedTeamData = localStorage.getItem('gaslands-team-data');
			if (storedTeamData) {
				console.log("[Builder] Found stored team data, attempting to load");
				// Parse the team data
				const teamData = JSON.parse(storedTeamData);
				
				// Clear the storage immediately to prevent loops
				localStorage.removeItem('gaslands-team-data');
				
				// Wait a moment for the page to fully initialize
				setTimeout(() => {
					// Dispatch an event to load this team data
					document.dispatchEvent(new CustomEvent('gaslands-load-team-data', {
						detail: teamData,
						bubbles: true
					}));
				}, 300);
			}
		} catch (error) {
			console.error("[Builder] Error loading stored team data:", error);
		}
	});

	// Filter vehicle types based on includeAdvanced setting and sponsor restrictions
	$: filteredVehicleTypes = vehicleTypes.filter(v => {
		// First filter based on advanced setting
		if (!includeAdvanced && v.advanced) {
			return false;
		}
		
		// Vehicle can only be taken if:
		// a) It has no sponsors list, OR
		// b) The current sponsor matches one in the vehicle's sponsors list
		if (v.sponsors && v.sponsors.length > 0) {
			// This vehicle has a sponsors restriction - check if current sponsor is in the list
			const allowed = v.sponsors.includes(sponsorId);
			
			// Log for debugging
			console.log(`Vehicle ${v.id} with sponsors [${v.sponsors.join(', ')}] - Current sponsor: ${sponsorId} - Allowed: ${allowed}`);
			
			return allowed;
		}
		
		// No sponsor restriction - vehicle is allowed with any sponsor
		return true;
	});
	// Sort all data alphabetically
	$: sortedSponsors = [...sponsors].sort((a, b) => a.name.localeCompare(b.name));
  $: sortedVehicleTypes = [...filteredVehicleTypes].sort((a, b) => a.name.localeCompare(b.name));
  $: sortedWeapons = [...weapons].sort((a, b) => a.name.localeCompare(b.name));
  $: sortedUpgrades = [...upgrades].sort((a, b) => a.name.localeCompare(b.name));
  $: sortedPerks = [...perks].sort((a, b) => a.name.localeCompare(b.name));

	/* ---------- UI state ---------- */
	// Find "No Sponsor" ID or use first sponsor as fallback
	let sponsorId: string = sponsors.find(s => s.id === 'no_sponsor')?.id ?? sponsors[0]?.id ?? '';
	let validation: Validation = { cans: 0, errors: [], vehicleReports: [] };
	let totalCans = 0;
	
	// Validation state flags to prevent infinite update loops
	let isValidating = false;
	let isForceValidating = false;
	let pendingSponsorValidation = false;
	let lastSponsorId = '';
	type Veh = { 
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
	};
	let vehicles: Veh[] = [];
	// Track hazard tokens for each vehicle
	let vehicleHazards: Record<string, number> = {};



	function canUseElectrical(vehicle: Veh) {
		if (rulesVersion !== 3) return !!currentSponsor?.electrical;
		if (vehicle.type === 'van') return true;
		return vehicles.some((entry) => entry.driverArchetype === 'spark');
	}

	function resolvedLoadout(vehicle: Veh) {
		return {
			vehicleType: vehicleTypes.find((entry) => entry.id === vehicle.type),
			weapons: vehicle.weapons
				.map((id) => resolveById(weapons, id))
				.filter((entry): entry is NonNullable<typeof entry> => !!entry),
			upgrades: (vehicle.upgrades || [])
				.map((id) => upgrades.find((entry) => entry.id === id))
				.filter((entry): entry is NonNullable<typeof entry> => !!entry)
		};
	}

	function projectedSlots(vehicle: Veh, extra: { weapon?: { slots: number }; upgrade?: { id: string; slots: number; isTrailer?: boolean; bonusSlots?: number } }) {
		const loadout = resolvedLoadout(vehicle);
		if (!loadout.vehicleType) return null;
		return v3BuildSlots(
			loadout.vehicleType,
			extra.weapon ? [...loadout.weapons, extra.weapon] : loadout.weapons,
			extra.upgrade ? [...loadout.upgrades, extra.upgrade] : loadout.upgrades
		);
	}

	function perksFor(vehicle: Veh) {
		if (rulesVersion !== 3) return availablePerks;
		const driver = drivers.find((entry) => entry.id === vehicle.driverArchetype);
		const classes = new Set<string>();
		if (driver) classes.add(driver.perkClass);
		if ((vehicle.driverName || '').trim() && vehicle.secondPerkClass) classes.add(vehicle.secondPerkClass);
		return perks.filter((perk) => perk.class && classes.has(perk.class));
	}

	function weaponsFor(vehicle: Veh) {
		const electricalOk = canUseElectrical(vehicle);
		return weapons.filter((weapon) => {
			if (!includeAdvanced && weapon.advanced) return false;
			if (weapon.electrical && !electricalOk) return false;
			return true;
		});
	}

	function upgradesFor(vehicle: Veh) {
		const electricalOk = canUseElectrical(vehicle);
		return upgrades.filter((upgrade) => !upgrade.electrical || electricalOk);
	}

	function patchVehicle(id: string, patch: Partial<Veh>) {
		vehicles = vehicles.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
		updateCurrentDraft();
	}

	function changeRulesVersion(next: number) {
		const version: RulesVersion = next === 3 ? 3 : 2;
		if (version === rulesVersion) return;
		if (vehicles.length > 0 && !confirm('Switching rules versions clears the vehicles on this team. Continue?')) {
			rulesVersion = rulesVersion;
			return;
		}
		rulesVersion = version;
		applyCatalog(version);
		vehicles = [];
		sponsorId = sponsors.find((entry) => entry.id === 'no_sponsor')?.id ?? sponsors[0]?.id ?? '';
		updateCurrentDraft();
	}

	function calculateUsedBuildSlots(vehicle) {
		let totalSlots = 0;
		
		// Calculate slots used by weapons
		for (const weaponInstanceId of vehicle.weapons) {
			const lastUnderscoreIndex = weaponInstanceId.lastIndexOf('_');
				const baseWeaponId = lastUnderscoreIndex !== -1 ? 
					weaponInstanceId.substring(0, lastUnderscoreIndex) : 
					weaponInstanceId;
			const weaponObj = weapons.find(w => w.id === baseWeaponId);
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

	function addVehicle(type = rulesVersion === 3 ? 'buggy' : 'car') {
		console.log('addVehicle called');
		
		// Get filtered vehicle types that respect sponsor restrictions
		const availableTypes = filteredVehicleTypes;
		console.log('Available vehicle types:', availableTypes.map(v => v.id));
		
		// First, check if the requested type is valid and available with current sponsor
		const vt = availableTypes.find((v) => v.id === type);
		
		if (!vt) {
			console.error("No valid vehicle type found or type not available with current sponsor", 
				type, availableTypes.map(v => v.id));

			// Requested type not found or not available, look for a fallback
			const carType = availableTypes.find(v => v.id === 'car');

			// If car type is available, use it
			if (carType) {
				console.log('Falling back to car type');
				return addVehicle('car');
			}

			// Otherwise, try to use the first available vehicle type
			if (availableTypes.length > 0) {
				console.log('Falling back to first available type:', availableTypes[0].id);
				return addVehicle(availableTypes[0].id);
			}
			
			alert('No vehicle types are available with the current sponsor');
			return; // Can't add a vehicle without a type
		}
		
		const newVehicleId = nanoid(6);
		
		// Create the new vehicle
		const newVehicle = {
			id: newVehicleId,
			type: vt.id,
			name: `New Vehicle`,
			weapons: [],
			weaponFacings: {},
			upgrades: [],
			perks: []
		};
		
		// Add to vehicles list - ensure reactivity by creating a new array
		vehicles = [...vehicles, newVehicle];
		
		// Update totalCans immediately for better responsiveness
		totalCans = calculateTotalCansDirectly();
		console.log('vehicles', vehicles);
		
		// For immediate UI feedback, manually update the validation
		// Create a basic vehicle report with just the base cost
		if (validation && validation.vehicleReports) {
			const newVehicleReport = {
				vehicleId: newVehicleId,
				cans: vt.baseCost || 0,
				errors: []
			};
			
			// Update the validation object
			validation.vehicleReports = [...validation.vehicleReports, newVehicleReport];
			validation.cans += newVehicleReport.cans;
			
			// Ensure reactivity by forcing the update
			validation = { ...validation };
		}
		
		// Log the current state to verify
		console.log("Added new vehicle", newVehicle);
		console.log("Current vehicles", vehicles.length);
		
		// Update draft to trigger automatic validation
		updateCurrentDraft();
	}

	function removeVehicle(id: string) {
		// Remove the vehicle
		vehicles = vehicles.filter((v) => v.id !== id);

		// Handle collapse state
		collapsedVehicles.delete(id);
		collapsedVehicles = collapsedVehicles; // Trigger reactivity

		// Update totalCans immediately for better responsiveness
		totalCans = calculateTotalCansDirectly();
		
		// Update draft to trigger automatic validation
		updateCurrentDraft();
	}

	function cloneVehicle(id: string) {
		const sourceVehicle = vehicles.find(v => v.id === id);
		if (!sourceVehicle) return;

		// Generate new IDs for the cloned vehicle and its weapons
		const clonedVehicleId = nanoid(6);
		const clonedWeaponFacings: Record<string, string> = {};

		// Clone the weapons with new instance IDs
		let clonedTurret = sourceVehicle.turretWeaponId;
		const clonedWeapons = sourceVehicle.weapons.map(weaponId => {
			const baseWeaponId = resolveById(weapons, weaponId)?.id ?? weaponId;
			const newWeaponId = `${baseWeaponId}_${nanoid(4)}`;
			if (clonedTurret === weaponId) clonedTurret = newWeaponId;

			// Copy the facing for this weapon
			if (sourceVehicle.weaponFacings && sourceVehicle.weaponFacings[weaponId]) {
				clonedWeaponFacings[newWeaponId] = sourceVehicle.weaponFacings[weaponId];
			}

			return newWeaponId;
		});
        
		// Start with the source vehicle's perks
		const clonedPerks = [...sourceVehicle.perks];
		
		// Add any perks from upgrades that aren't already included
		sourceVehicle.upgrades.forEach(upgradeId => {
			const upgradeObj = upgrades.find(u => u.id === upgradeId);
			if (upgradeObj && upgradeObj.perks && Array.isArray(upgradeObj.perks)) {
				upgradeObj.perks.forEach(perkId => {
					if (!clonedPerks.includes(perkId)) {
						clonedPerks.push(perkId);
					}
				});
			}
		});

		// Create the cloned vehicle
		const clonedVehicle = {
			id: clonedVehicleId,
			type: sourceVehicle.type,
			name: `${sourceVehicle.name} (Clone)`,
			weapons: clonedWeapons,
			weaponFacings: clonedWeaponFacings,
			upgrades: [...sourceVehicle.upgrades],
			perks: clonedPerks,
			driverArchetype: sourceVehicle.driverArchetype,
			driverName: sourceVehicle.driverName,
			secondPerkClass: sourceVehicle.secondPerkClass,
			turretWeaponId: clonedTurret,
			upgradeFacings: { ...(sourceVehicle.upgradeFacings || {}) }
		};

		// Add the cloned vehicle to the vehicles array
		vehicles = [...vehicles, clonedVehicle];
		
		// Update totalCans immediately for better responsiveness
		totalCans = calculateTotalCansDirectly();
		
		// For immediate UI feedback, manually update the validation
		// Find the source vehicle report to copy its values
		if (validation && validation.vehicleReports) {
			const sourceReport = validation.vehicleReports.find(r => r.vehicleId === sourceVehicle.id);
			if (sourceReport) {
				const clonedReport = {
					vehicleId: clonedVehicleId,
					cans: sourceReport.cans,
					errors: [...sourceReport.errors]
				};
				
				// Update the validation object
				validation.vehicleReports = [...validation.vehicleReports, clonedReport];
				validation.cans += clonedReport.cans;
			}
		}
		
		// Update draft to trigger automatic validation
		updateCurrentDraft();
	}
	
	function toggleVehicleCollapse(id: string) {
		if (collapsedVehicles.has(id)) {
			collapsedVehicles.delete(id);
		} else {
			collapsedVehicles.add(id);
		}
		collapsedVehicles = collapsedVehicles; // Trigger reactivity
	}

	function addWeapon(vehicleId: string, weaponId: string, facing?: string) {
		const weaponObj = weapons.find(w => w.id === weaponId);
		if (!weaponObj) return; // Don't add if weapon not found

		// Check if adding this weapon would exceed the vehicle's build slots
		const vehicle = vehicles.find(v => v.id === vehicleId);
		if (!vehicle) return; // Don't add if vehicle not found

		const vehicleType = vehicleTypes.find(vt => vt.id === vehicle.type);
		if (!vehicleType) return; // Don't add if vehicle type not found

		// Validate electrical weapons - v2 sponsors, or a v3 van / Spark
		if (weaponObj.electrical && !canUseElectrical(vehicle)) {
			console.warn(`Cannot add electrical weapon ${weaponObj.name} - electrical gear is locked`);
			return;
		}

		// Update vehicle report for immediate UI feedback
		const vehicleReport = validation.vehicleReports.find(r => r.vehicleId === vehicleId);
		if (vehicleReport) {
			// Subtract vehicle's current cost, then add it back after weapon is added
			validation.cans -= vehicleReport.cans;
		}
		
		const currentBuildSlots = calculateUsedBuildSlots(vehicle);
		const weaponSlots = weaponObj.slots;
		
		// Skip buildSlot validation for free weapons
		const isSpecialFreeWeapon = ['handgun', 'molotov', 'grenades', 'ram', 'oil_slick', 'smokescreen'].includes(weaponObj.id) || weaponSlots === 0;
		
		// Validate build slots unless it's a free weapon or the vehicle has 0 build slots (unlimited)
		if (rulesVersion === 3) {
			const next = projectedSlots(vehicle, { weapon: weaponObj });
			if (next && next.used > next.capacity) {
				console.warn(`Cannot add weapon ${weaponObj.name} - exceeds build slot limit`);
				return;
			}
		} else if (!isSpecialFreeWeapon && vehicleType.buildSlots > 0 && currentBuildSlots + weaponSlots > vehicleType.buildSlots) {
			console.warn(`Cannot add weapon ${weaponObj.name} - exceeds build slot limit`);
			return; // Do not add the weapon if it would exceed build slots
		}
		
		// Apply weapon facing rules:
		// 1. Crew Fired weapons are always 360° (any)
		// 2. Dropped weapons (range includes 'Dropped') are rear or side only (default to rear)
		// 3. Fixed facing weapons use their specified facing
		// 4. Otherwise use provided facing or default to front
		let actualFacing = 'front';

		if (weaponObj.specialRules && weaponObj.specialRules.toUpperCase().includes("CREW FIRED")) {
			actualFacing = '360'; // Crew fired weapons are always 360°
		} else if (weaponObj.dropped || (weaponObj as { arc?: string }).arc === 'dropped' || (weaponObj.range && weaponObj.range.includes('Dropped'))) {
			actualFacing = 'rear'; // Dropped weapons default to rear
		} else if ((weaponObj as { arc?: string }).arc === '360' || (weaponObj.specialRules && weaponObj.specialRules.includes('360'))) {
			actualFacing = '360';
		} else if (weaponObj.facing && weaponObj.facing !== 'any') {
			actualFacing = weaponObj.facing; // Use fixed facing
		} else if (facing) {
			actualFacing = facing; // Use provided facing
		}
		
		vehicles = vehicles.map(v => {
			if (v.id === vehicleId) {
				// Generate a unique ID for this weapon instance
				// Make sure the nanoid is always at the end, even if the original weaponId contains underscores
				const weaponInstanceId = `${weaponId}_${nanoid(4)}`;
				return { 
					...v, 
					weapons: [...v.weapons, weaponInstanceId],
					weaponFacings: { 
						...(v.weaponFacings || {}), 
						[weaponInstanceId]: actualFacing 
					}
				};
			}
			return v;
		});
		
		// Manual trigger validation update to ensure costs are recalculated
		setTimeout(() => updateValidation(), 0);
	}

	function removeWeapon(vehicleId: string, weaponIndex: number) {
		vehicles = vehicles.map(v => {
			if (v.id === vehicleId) {
				// Get the weapon ID to remove
				const weaponIdToRemove = v.weapons[weaponIndex];
				
				// Create a new facings object without the removed weapon
				const newFacings = { ...(v.weaponFacings || {}) };
				delete newFacings[weaponIdToRemove];
				
				return { 
					...v, 
					weapons: v.weapons.filter((_, idx) => idx !== weaponIndex),
					weaponFacings: newFacings
				};
			}
			return v;
		});
		
		// Manual trigger validation update to ensure costs are recalculated
		setTimeout(() => updateValidation(), 0);
	}

	function addUpgrade(vehicleId: string, upgradeId: string) {
		const upgradeObj = upgrades.find(u => u.id === upgradeId);
		if (!upgradeObj) return; // Don't add if upgrade not found

		// Check if adding this upgrade would exceed the vehicle's build slots
		const vehicle = vehicles.find(v => v.id === vehicleId);
		if (!vehicle) return; // Don't add if vehicle not found

		const vehicleType = vehicleTypes.find(vt => vt.id === vehicle.type);
		if (!vehicleType) return; // Don't add if vehicle type not found

		// Validate electrical upgrades - v2 sponsors, or a v3 van / Spark
		if (upgradeObj.electrical && !canUseElectrical(vehicle)) {
			console.warn(`Cannot add electrical upgrade ${upgradeObj.name} - electrical gear is locked`);
			return;
		}
		
		// Validate trailer upgrades - only allow if sponsor supports them
		if (upgradeObj.trailer && !(currentSponsor?.trailer)) {
			console.warn(`Cannot add trailer upgrade ${upgradeObj.name} - current sponsor doesn't support trailers`);
			return; // Do not add the upgrade if it's a trailer but sponsor doesn't support it
		}
		
		// STRICT validation: Check if the vehicle already has a trailer upgrade (limit to one trailer per vehicle)
		// This is a critical business rule: a vehicle can have at most ONE trailer upgrade
		if (upgradeObj.trailer === true || upgradeObj.trailer === "true") {
			// Search for ANY existing trailer upgrades on this vehicle
			const existingTrailers = vehicle.upgrades.filter(upId => {
				const up = upgrades.find(u => u.id === upId);
				return up && (up.trailer === true || up.trailer === "true");
			});
			
			// If ANY trailer upgrade exists, prevent adding another one
			if (existingTrailers.length > 0) {
				const trailerNames = existingTrailers.map(upId => {
					const up = upgrades.find(u => u.id === upId);
					return up ? up.name : upId;
				});
				console.warn(`Cannot add another trailer to vehicle ${vehicle.name || vehicle.id} - vehicle already has trailer: ${trailerNames.join(', ')}`);
				return; // Strictly enforce: Do not add the upgrade if vehicle already has a trailer
			}
		}
		
		// Validate trailerUpgrade - only allow if vehicle has a trailer upgrade
		if (upgradeObj.trailerUpgrade) {
			// Check if the vehicle has any trailer upgrade
			const hasTrailer = vehicle.upgrades.some(upId => {
				const up = upgrades.find(u => u.id === upId);
				return up && (up.trailer === "true" || up.trailer === true);
			});
			
			if (!hasTrailer) {
				console.warn(`Cannot add trailer-only upgrade ${upgradeObj.name} - vehicle does not have a trailer`);
				return; // Do not add the upgrade if it's a trailer upgrade but vehicle has no trailer
			}
			
			// Check if the vehicle already has a trailer upgrade (limit to one)
			const hasTrailerUpgrade = vehicle.upgrades.some(upId => {
				const up = upgrades.find(u => u.id === upId);
				return up && up.trailerUpgrade;
			});
			
			if (hasTrailerUpgrade) {
				console.warn(`Cannot add trailer-only upgrade ${upgradeObj.name} - vehicle already has a trailer upgrade`);
				return; // Do not add the upgrade if vehicle already has a trailer upgrade
			}
		}
		
		const currentBuildSlots = calculateUsedBuildSlots(vehicle);
		const upgradeSlots = upgradeObj.slots;
		
		// Skip buildSlot validation for free upgrades
		const isSpecialFreeUpgrade = ['grenades'].includes(upgradeObj.id) || upgradeSlots === 0;
		if (rulesVersion === 3) {
			const next = projectedSlots(vehicle, { upgrade: upgradeObj });
			if (next && next.used > next.capacity) {
				console.warn(`Cannot add upgrade ${upgradeObj.name} - exceeds build slot limit`);
				return;
			}
		}
		
		// Validate build slots unless it's a free upgrade or the vehicle has 0 build slots (unlimited)
		if (rulesVersion !== 3 && !isSpecialFreeUpgrade && vehicleType.buildSlots > 0 && currentBuildSlots + upgradeSlots > vehicleType.buildSlots) {
			console.warn(`Cannot add upgrade ${upgradeObj.name} - exceeds build slot limit`);
			return; // Do not add the upgrade if it would exceed build slots
		}
		
		// Process additional perks granted by this upgrade
		let additionalPerks: string[] = [];
		if (upgradeObj.perks && Array.isArray(upgradeObj.perks)) {
			additionalPerks = upgradeObj.perks;
		}
		
		vehicles = vehicles.map(v => {
			if (v.id === vehicleId) {
				const updatedVehicle = {
					...v,
					upgrades: [...v.upgrades, upgradeId]
				};
				
				// If the upgrade has perks, add them to the vehicle
				if (additionalPerks.length > 0) {
					// Filter out any perks that the vehicle already has
					const newPerks = additionalPerks.filter(perkId => !v.perks.includes(perkId));
					if (newPerks.length > 0) {
						updatedVehicle.perks = [...v.perks, ...newPerks];
					}
				}
				
				return updatedVehicle;
			}
			return v;
		});
		
		// Manual trigger validation update to ensure costs are recalculated
		setTimeout(() => updateValidation(), 0);
	}

	function removeUpgrade(vehicleId: string, upgradeIndex: number) {
		// Find the vehicle first so we can access its data
		const vehicle = vehicles.find(v => v.id === vehicleId);
		if (!vehicle) return;
		
		// Get the upgrade being removed
		const upgradeId = vehicle.upgrades[upgradeIndex];
		const upgradeObj = upgrades.find(u => u.id === upgradeId);
		if (!upgradeObj) return;
		
		// Check if this is a 360 degree upgrade that's being removed
		const is360Upgrade = upgradeObj && upgradeObj["360"] === true;
		
		// Prepare updates for the vehicle
		let updatedVehicle = {
			...vehicle,
			upgrades: vehicle.upgrades.filter((_, idx) => idx !== upgradeIndex)
		};
		
		// Remove any perks granted by this upgrade
		if (upgradeObj.perks && Array.isArray(upgradeObj.perks) && upgradeObj.perks.length > 0) {
			// Check if other remaining upgrades also provide these perks
			const remainingUpgradePerks = new Set<string>();
			
			// Collect all perks from remaining upgrades
			updatedVehicle.upgrades.forEach(upId => {
				const up = upgrades.find(u => u.id === upId);
				if (up && up.perks && Array.isArray(up.perks)) {
					up.perks.forEach(perkId => remainingUpgradePerks.add(perkId));
				}
			});
			
			// Remove perks that were provided by this upgrade and are not provided by any other upgrade
			const perksToRemove = upgradeObj.perks.filter(perkId => !remainingUpgradePerks.has(perkId));
			
			if (perksToRemove.length > 0) {
				updatedVehicle.perks = updatedVehicle.perks.filter(perkId => !perksToRemove.includes(perkId));
			}
		}
		
		// If removing a 360 upgrade, check remaining upgrades to see if vehicle still has any 360 capability
		if (is360Upgrade) {
			const still360Capable = updatedVehicle.upgrades.some(id => {
				const upgrade = upgrades.find(u => u.id === id);
				return upgrade && upgrade["360"] === true;
			});
			
			// If not 360 capable anymore, reset any weapons with 360 facing to 'front'
			if (!still360Capable) {
				// Find weapons with 360 facing
				const updatedFacings = { ...vehicle.weaponFacings };
				let facingsChanged = false;
				
				// For each weapon with 360 facing, check if it should be reset
				Object.entries(updatedFacings).forEach(([weaponId, facing]) => {
					// Skip if not 360 facing
					if (facing !== '360') return;
					
					// Get weapon details
					const lastUnderscoreIndex = weaponId.lastIndexOf('_');
					const baseWeaponId = lastUnderscoreIndex !== -1 ?
						weaponId.substring(0, lastUnderscoreIndex) :
						weaponId;
					const weapon = weapons.find(w => w.id === baseWeaponId);
					
					// Skip crew fired weapons (they should stay 360)
					const isCrewFired = weapon?.crewFired || 
						(weapon?.specialRules && weapon.specialRules.toUpperCase().includes("CREW FIRED"));
					
					// Skip dropped weapons (they should be side/rear)
					const isDropped = weapon?.dropped || 
						(weapon?.range && weapon.range.includes('Dropped'));
					
					// If not crew fired or dropped, reset to 'front'
					if (!isCrewFired && !isDropped) {
						updatedFacings[weaponId] = 'front';
						facingsChanged = true;
					}
				});
				
				// Only update facings if changes were made
				if (facingsChanged) {
					updatedVehicle = {
						...updatedVehicle,
						weaponFacings: updatedFacings
					};
					
					// Show user a notification that weapons were reset
					alert("Warning: Some weapons had 360° firing arc due to the removed upgrade. They have been reset to front facing.");
				}
			}
		}
		
		// Update the vehicles array with our modified vehicle
		vehicles = vehicles.map(v => 
			v.id === vehicleId ? updatedVehicle : v
		);
		
		// Manual trigger validation update to ensure costs are recalculated
		setTimeout(() => updateValidation(), 0);
	}

	function addPerk(vehicleId: string, perkId: string) {
		// Check if the vehicle already has this perk
		const vehicle = vehicles.find(v => v.id === vehicleId);
		if (vehicle && vehicle.perks.includes(perkId)) {
			alert('This vehicle already has this perk. Vehicles cannot have duplicate perks.');
			return;
		}
		
		vehicles = vehicles.map(v =>
			v.id === vehicleId ?
			{ ...v, perks: [...v.perks, perkId] } :
			v
		);
		
		// Immediately recalculate total cans for display
		totalCans = calculateTotalCansDirectly();
		
		// Manual trigger validation update to ensure costs are recalculated
		setTimeout(() => updateValidation(), 0);
	}

	function removePerk(vehicleId: string, perkIndex: number) {
		vehicles = vehicles.map(v =>
			v.id === vehicleId ?
			{ ...v, perks: v.perks.filter((_, idx) => idx !== perkIndex) } :
			v
		);
		
		// Immediately recalculate total cans for display
		totalCans = calculateTotalCansDirectly();
		
		// Manual trigger validation update to ensure costs are recalculated
		setTimeout(() => updateValidation(), 0);
	}

	// Calculate max hull points including modifiers from upgrades and perks
	function calculateMaxHull(vehicle): number {
		const vehicleType = vehicleTypes.find(vt => vt.id === vehicle.type);
		if (!vehicleType) return 0;

		let maxHull = vehicleType.maxHull;

		// Add hull points from upgrades
		for (const upgradeId of vehicle.upgrades) {
			const upgrade = upgrades.find(u => u.id === upgradeId);
			if (upgrade) {
				// Use the hull property if present
				if (upgrade.hull) {
					maxHull += upgrade.hull;
				}
				// Keep backward compatibility for armor upgrade
				else if (upgradeId === 'armor') {
					maxHull += 1;
				}
			}
		}

		// Add hull points from perks (if any)
		for (const perkId of vehicle.perks) {
			// Add any perks that affect hull here
			// For example: if (perkId === 'fortified' || perkId === 'tank_commander') maxHull += 1;
		}

		return maxHull;
	}

	// Calculate handling with modifiers from upgrades
	function calculateHandling(vehicle): number {
		const vehicleType = vehicleTypes.find(vt => vt.id === vehicle.type);
		if (!vehicleType) return 0;

		let handling = vehicleType.handling || 4; // Default to 4 if not specified

		// Add handling modifiers from upgrades
		for (const upgradeId of vehicle.upgrades) {
			const upgrade = upgrades.find(u => u.id === upgradeId);
			if (upgrade && upgrade.handling) {
				handling += upgrade.handling;
			}
		}

		return handling;
	}

	// Calculate max gear with modifiers from upgrades
	function calculateMaxGear(vehicle): number {
		const vehicleType = vehicleTypes.find(vt => vt.id === vehicle.type);
		if (!vehicleType) return 0;

		let maxGear = vehicleType.maxGear;

		// Add gear modifiers from upgrades
		for (const upgradeId of vehicle.upgrades) {
			const upgrade = upgrades.find(u => u.id === upgradeId);
			if (upgrade && upgrade.gear) {
				maxGear += upgrade.gear;
			}
		}

		return maxGear;
	}

	// Calculate crew with modifiers from upgrades
	function calculateCrew(vehicle): number {
		const vehicleType = vehicleTypes.find(vt => vt.id === vehicle.type);
		if (!vehicleType) return 0;

		let crew = vehicleType.crew || 1; // Default to 1 if not specified

		// Add crew modifiers from upgrades
		for (const upgradeId of vehicle.upgrades) {
			const upgrade = upgrades.find(u => u.id === upgradeId);
			if (upgrade && upgrade.crew) {
				crew += upgrade.crew;
			}
		}

		// Ensure crew doesn't go below zero
		return Math.max(0, crew);
	}

	function calculateTotalAttackDice(vehicle): number {
		if (!vehicle || !vehicle.weapons || vehicle.weapons.length === 0) return 0;

		let totalAttackDice = 0;

		// Calculate total attack dice from all weapons
		for (const weaponInstanceId of vehicle.weapons) {
			const lastUnderscoreIndex = weaponInstanceId.lastIndexOf('_');
				const baseWeaponId = lastUnderscoreIndex !== -1 ? 
					weaponInstanceId.substring(0, lastUnderscoreIndex) : 
					weaponInstanceId;
			const weaponObj = weapons.find(w => w.id === baseWeaponId);
			if (weaponObj && weaponObj.attackDice) {
				totalAttackDice += weaponObj.attackDice;
			}
		}

		return totalAttackDice;
	}

	function getVehicleRuleDetails(ruleName: string) {
		return vehicleRules.find(rule => rule.id === ruleName);
	}

	// Hazard token management
	function getHazardCount(vehicleId: string): number {
		return vehicleHazards[vehicleId] || 0;
	}

	function incrementHazard(vehicleId: string) {
		vehicleHazards = {
			...vehicleHazards,
			[vehicleId]: getHazardCount(vehicleId) + 1
		};
	}

	function decrementHazard(vehicleId: string) {
		if (getHazardCount(vehicleId) > 0) {
			vehicleHazards = {
				...vehicleHazards,
				[vehicleId]: getHazardCount(vehicleId) - 1
			};
		}
	}

	/* ---------- modals & menu state ---------- */
	// For settings and modals that need persistence
	let qrDataUrl: string | null = null;
	let showQRModal = false; // Whether to show the QR code modal
	let showImportModal = false;
	let showSettingsModal = false;
	let activeSettingsTab = 'general'; // Which tab to show in settings: 'general' or 'print'
	let quickSaving = false;
	
	// Update modal background color based on dark mode
	$: if (showSettingsModal) {
		setTimeout(() => {
			const modal = document.querySelector('.settings-modal-content');
			if (modal) {
				if (darkMode) {
					modal.style.backgroundColor = '#1f2937';
				} else {
					modal.style.backgroundColor = 'white';
				}
			}
		}, 0);
	}
	let showTeamsModal = false;
	let showMenu = false;
	let showShareMenu = false;
	
	// Add click outside handler for the share menu
	onMount(() => {
		const handleClickOutside = (event) => {
			const shareMenuButton = document.querySelector('.share-menu-trigger');
			const shareMenu = document.querySelector('.share-menu-dropdown');
			
			if (showShareMenu && 
				shareMenuButton && 
				shareMenu && 
				!shareMenuButton.contains(event.target) && 
				!shareMenu.contains(event.target)) {
				showShareMenu = false;
			}
		};
		
		document.addEventListener('click', handleClickOutside);
		
		// Load user settings from Firebase if user is logged in
		const unsubscribe = user.subscribe(async currentUser => {
			if (currentUser) {
				try {
					const result = await getUserSettings();
					if (result.success && result.settings) {
						enableSponsorships = result.settings.enableSponsorships;
						includeAdvanced = result.settings.includeAdvanced;
						darkMode = result.settings.darkMode;
						hasRules = result.settings.hasRules ?? DEFAULT_SETTINGS.hasRules;

						// Initialize new settings with defaults if not present
						showTeamSummary = result.settings.showTeamSummary !== undefined
							? result.settings.showTeamSummary
							: DEFAULT_SETTINGS.showTeamSummary;

						showGaslandsMath = result.settings.showGaslandsMath !== undefined
							? result.settings.showGaslandsMath
							: DEFAULT_SETTINGS.showGaslandsMath;

						// Initialize player map settings
						showOnPlayersMap = result.settings.showOnPlayersMap !== undefined
							? result.settings.showOnPlayersMap
							: DEFAULT_SETTINGS.showOnPlayersMap;

						allowContactFromPlayers = result.settings.allowContactFromPlayers !== undefined
							? result.settings.allowContactFromPlayers
							: DEFAULT_SETTINGS.allowContactFromPlayers;

						location = result.settings.location !== undefined
							? result.settings.location
							: DEFAULT_SETTINGS.location;

							// Initialize experimental features and updates settings
							showExperimentalFeatures = result.settings.showExperimentalFeatures !== undefined
								? result.settings.showExperimentalFeatures
								: DEFAULT_SETTINGS.showExperimentalFeatures;

							receiveUpdates = result.settings.receiveUpdates !== undefined
								? result.settings.receiveUpdates
								: DEFAULT_SETTINGS.receiveUpdates;
					}
				} catch (error) {
					console.error("Error loading settings:", error);
				}
			}
		});
		
		return () => {
			unsubscribe();
			document.removeEventListener('click', handleClickOutside);
		};
	});

	/* ---------- settings state ---------- */
	// let enableSponsorships = true;  // Already declared at the top
	// let includeAdvanced = true;     // Already declared at the top
	let maxCans = 50;
	let teamName = "My Gaslands Team";

	// Mode toggle for Edit/Play mode
	let playMode = false;

	// Function to check if user has acknowledged owning the rules
	function checkRulesAcknowledgment(action) {
		if (hasRules) {
			return true;
		} else {
			showRulesAcknowledgmentModal = true;
			rulesModalAction = action;
			return false;
		}
	}

	// Wrapper function for toggling play mode with rules check
	function togglePlayMode() {
		if (checkRulesAcknowledgment('playMode')) {
			playMode = !playMode;
		}
	}

	// Single print flag to prevent multiple prints
	let isPrinting = false;
	
	// Wrapper function for printing with rules check
	// Direct dashboard printing test
	function printDashboardDirect() {
		console.log('[printDashboardDirect] Called');
		
		// Check if we have vehicles
		if (!vehicles || !Array.isArray(vehicles) || vehicles.length === 0) {
			console.log('[printDashboardDirect] No vehicles to print');
			alert('You need to add at least one vehicle before printing.');
			return;
		}
		
		try {
			// Create a simplified vehicle object for printing
			const simplifiedVehicles = vehicles.map(v => ({
				id: v.id,
				name: v.name,
				type: v.type
			}));
			
			// Create HTML directly
			const html = `<!DOCTYPE html>
<html>
<head>
  <title>Dashboard Test</title>
  <style>
    body { font-family: Arial; padding: 20px; }
  </style>
</head>
<body>
  <h1>DIRECT DASHBOARD PRINT TEST</h1>
  <h2>Team: ${teamName || 'Unnamed Team'}</h2>
  <h3>Sponsor: ${sponsors.find(s => s.id === sponsorId)?.name || 'No Sponsor'}</h3>
  <p>Vehicle count: ${vehicles.length}</p>
  
  ${vehicles.map(v => `
  <div style="border: 1px solid black; padding: 10px; margin: 10px 0;">
    <h3>Vehicle: ${v.name || 'Unnamed'}</h3>
    <p>Type: ${vehicleTypes.find(vt => vt.id === v.type)?.name || v.type || 'Unknown'}</p>
  </div>
  `).join('')}
  
  <p>Printed directly from builder page at ${new Date().toLocaleString()}</p>
</body>
</html>`;
			
			// Open and print
			const printWindow = window.open('', '_blank', 'width=800,height=600');
			if (!printWindow) {
				alert('Please allow popups to print your team');
				return;
			}
			
			printWindow.document.write(html);
			printWindow.document.close();
			
			// Print after a delay
			setTimeout(() => {
				try {
					printWindow.print();
				} catch (e) {
					console.error('[printDashboardDirect] Print error:', e);
				}
			}, 500);
			
		} catch (err) {
			console.error('[printDashboardDirect] Error:', err);
			alert('Error preparing direct dashboard print');
		}
	}
	
	function printWithRulesCheck() {
		console.log('[printWithRulesCheck] Called');
		
		// Check if we have vehicles before proceeding
		if (!vehicles || !Array.isArray(vehicles) || vehicles.length === 0) {
			console.log('[printWithRulesCheck] No vehicles to print');
			alert('You need to add at least one vehicle before printing.');
			return;
		}
		
		// Check if we're already printing to prevent multiple prints
		if (isPrinting) {
			console.log('[printWithRulesCheck] Already printing, ignoring call');
			return;
		}
		
		// Direct dashboard print disabled - now using main function
		if (false) { // Disabled direct approach
			console.log('[printWithRulesCheck] Using direct dashboard print');
			if (hasRules) {
				printDashboardDirect();
			} else {
				showRulesAcknowledgmentModal = true;
				rulesModalAction = 'printDashboard';
			}
			return;
		}
		
		// Check if user has acknowledged having rules
		if (hasRules) {
			// User has already acknowledged having the rules
			console.log('[printWithRulesCheck] Rules acknowledged, printing team');
			// Use the proper print service instead of window.print()
			isPrinting = true;
			printTeam()
				.then(() => {
					setTimeout(() => { isPrinting = false; }, 3000);
				})
				.catch(err => {
					console.error('[printWithRulesCheck] Error printing:', err);
					isPrinting = false;
				});
			
			// Manual trigger validation update to ensure costs are recalculated
			setTimeout(() => updateValidation(), 0);
		} else {
			// Show the rules acknowledgment modal
			console.log('[printWithRulesCheck] Rules not acknowledged, showing modal');
			showRulesAcknowledgmentModal = true;
			rulesModalAction = 'printTeam';
		}
	}

	// Display settings
	let showTeamSummary = true;
	let showGaslandsMath = true;

	// For vehicle card collapse state
	let collapsedVehicles = new Set();
	// let darkMode = false;  // Already declared at the top

	// Save settings to Firebase when they change
	// SIMPLE FUNCTION TO SAVE SETTINGS TO FIREBASE
	async function saveSettingsToFirebase(settings) {
		console.log("[Builder] saveSettingsToFirebase called with:", settings);
		console.log("[Builder] printStyle:", settings.printStyle);
		
		if (!$user) {
			console.log("[Builder] No user logged in, cannot save to Firebase");
			return;
		}
		
		try {
			await saveUserSettings(settings);
			console.log("[Builder] Settings saved to Firebase successfully");
		} catch (error) {
			console.error("[Builder] Error saving to Firebase:", error);
		}
	}

	// Quick save team function
	async function quickSaveTeam() {
		if (!$user) {
			alert("Please log in to save your team.");
			return;
		}

		if (!teamName.trim()) {
			alert("Please enter a team name before saving.");
			return;
		}

		quickSaving = true;

		try {
			// First check if a team with this name already exists
			const teamsResult = await getUserTeams();
			if (teamsResult.success && teamsResult.teams) {
				const existingTeam = teamsResult.teams.find(team => team.teamName === teamName.trim());

				// If team exists, ask for confirmation before overwriting
				if (existingTeam) {
					const confirmOverwrite = confirm(`A team named "${teamName}" already exists. Do you want to overwrite it?`);
					if (!confirmOverwrite) {
						quickSaving = false;
						return; // User canceled the overwrite
					}

					// Will proceed to save and overwrite
				}
			}

			// Prepare draft data (similar to TeamsModal.svelte)
			const draftData = {
				teamName,
				sponsor: sponsorId,
				sponsorId,
				vehicles,
				maxCans,
				rulesVersion
			};

			// Save the team
			const result = await saveTeam(draftData, teamName);

			if (result.success) {
				alert("Team saved successfully!");
			} else {
				console.error("Failed to save team:", result.error);
				alert(`Failed to save team: ${result.error}`);
			}
		} catch (error) {
			console.error("Error saving team:", error);
			alert(`Error saving team: ${error instanceof Error ? error.message : "Unknown error"}`);
		} finally {
			quickSaving = false;
		}
	}

	/* ---------- menu actions ---------- */
	async function copyDraft() {
		await navigator.clipboard.writeText(encodeDraft(currentDraft));
		alert('Draft copied to clipboard!');
	}

	function shareLink() {
		const encoded = encodeDraft(currentDraft);
		goto(`?draft=${encoded}`, { replaceState: true });
		alert('Link updated in address bar. Copy the current URL to share your build.');
	}

	async function generateQRCode() {
		console.log('[generateQRCode] Generating QR code');
		try {
			// Generate QR code and show the modal
			qrDataUrl = await draftToDataURL(currentDraft);
			console.log('[generateQRCode] QR code generated');
			// Make sure qrDataUrl is shown
			showQRModal = true;
		} catch (error) {
			console.error('[generateQRCode] Error:', error);
		}
	}

	async function printTeam() {
		console.log("[printTeam] Print function called");
		
		// Debug: Check for extra crewmember upgrade in vehicles
		vehicles.forEach((vehicle, index) => {
			if (vehicle.upgrades.includes('extra_crewmember')) {
				console.log(`[printTeam] Vehicle ${index} has Extra Crewmember upgrade`);
			}
		});
		
		// Check for vehicles again (defensive coding)
		if (!vehicles || !Array.isArray(vehicles) || vehicles.length === 0) {
			console.log("[printTeam] No vehicles to print");
			isPrinting = false;
			alert("You need to add at least one vehicle before printing.");
			return;
		}
		
		// First generate QR code for the team
		let qrCode;
		try {
			console.log("[printTeam] Generating QR code for team:", teamName);
			qrCode = await draftToDataURL(currentDraft);
			console.log("[printTeam] QR code generated, length:", qrCode?.length || 0);
		} catch (e) {
			console.error("[printTeam] Error generating QR code:", e);
			qrCode = null;
		}

		// Use our new standalone print service
		// This builds a modified draft with more information for printing
		const enhancedDraft = {
			...currentDraft,
			// Add extra data needed for printing
			teamName: teamName || "My Gaslands Team",
			totalCans: validation.cans, // Use validation.cans directly for consistency
			maxCans: maxCans,
			sponsorName: currentSponsor?.name || 'No Sponsor',
			// Explicitly add ALL print settings - ensure we're using the latest values
			printStyle: printStyle,
			showEquipmentDescriptions: showEquipmentDescriptions,
			showPerkDescriptions: showPerkDescriptions,
			showSpecialRules: showSpecialRules,
			// Include special rules for weapons and upgrades
			weaponAndUpgradeSpecialRules: await import('$lib/rules/loadRules').then(module => module.loadWeaponSpecialRules()),
			// Include sponsor perks information
			sponsor: currentSponsor,
			sponsorPerks: {
				perksClasses: currentSponsor?.perksClasses || [],
				classPerksList: classPerksList || [],
				sponsorPerksList: sponsorPerksList || []
			},
			// Add QR code explicitly - this should be a data URL string
			qrCode: qrCode,
			// Add vehicle data with more details including full objects
			vehicles: vehicles.map(v => ({
				...v,
				// Include calculated cost - use validation if available, otherwise calculate directly
				cost: validation.vehicleReports.find(r => r.vehicleId === v.id)?.cans || calculateVehicleCost(v),
				// Include vehicle type details with special rules
				vehicleType: vehicleTypes.find(vt => vt.id === v.type),
				// Explicitly include special rules from the vehicle type for easier access
				specialRules: vehicleTypes.find(vt => vt.id === v.type)?.specialRules || '',
				// Include stats
				stats: {
					hull: calculateMaxHull(v),
					handling: vehicleTypes.find(vt => vt.id === v.type)?.handling || 4,
					gear: vehicleTypes.find(vt => vt.id === v.type)?.maxGear || 6,
					crew: vehicleTypes.find(vt => vt.id === v.type)?.crew || 1,
					weight: vehicleTypes.find(vt => vt.id === v.type)?.weight || 2
				},
				// Include full weapon objects with names
				weaponObjects: v.weapons.map(weaponId => {
					// Use our robust method to find the base weapon ID
					const parts = weaponId.split('_');
					let baseWeaponId = null;
					
					// Try increasingly longer potential base IDs until we find a match
					for (let i = parts.length - 1; i >= 1; i--) {
						const potentialBaseId = parts.slice(0, i).join('_');
						const match = weapons.find(w => w.id === potentialBaseId);
						if (match) {
							baseWeaponId = potentialBaseId;
							break;
						}
					}
					
					// If no match found, use the default approach (all but last part)
					if (!baseWeaponId) {
						baseWeaponId = parts.slice(0, -1).join('_');
					}
					
					const weapon = weapons.find(w => w.id === baseWeaponId);
					return {
						id: weaponId,
						name: weapon?.name || weaponId,
						facing: v.weaponFacings?.[weaponId] || weapon?.facing || 'front',
						range: weapon?.range || 'Short',
						attackDice: weapon?.attackDice || '-',
						cost: weapon?.cost || 0,
						specialRules: weapon?.specialRules || ''
					};
				}),
				// Include full upgrade objects with names
				upgradeObjects: v.upgrades.map(upgradeId => {
					const upgrade = upgrades.find(u => u.id === upgradeId);
					// Debug log for crew property
					if (upgrade && upgrade.id === 'extra_crewmember') {
						console.log('Found Extra Crewmember upgrade:', upgrade);
						console.log('Crew property:', upgrade.crew);
					}
					return {
						id: upgradeId,
						name: upgrade?.name || upgradeId,
						cost: upgrade?.cost || 0,
						specialRules: upgrade?.specialRules || '',
						// Include all stat modifiers
						crew: upgrade?.crew || 0,
						crewModifier: upgrade?.crewModifier || 0,
						hull: upgrade?.hull || 0,
						hullModifier: upgrade?.hullModifier || 0,
						handling: upgrade?.handling || 0,
						handlingModifier: upgrade?.handlingModifier || 0,
						gear: upgrade?.gear || 0,
						gearModifier: upgrade?.gearModifier || 0
					};
				}),
				// Include full perk objects with names
				perkObjects: v.perks.map(perkId => {
					const perk = perks.find(p => p.id === perkId);
					return {
						id: perkId,
						name: perk?.name || perkId,
						level: perk?.level || 1,
						text: perk?.text || ''
					};
				}),
				// Include vehicle rules for special rules descriptions
				vehicleRules: vehicleRules
			})),
			// Add print settings
			showEquipmentDescriptions: showEquipmentDescriptions,
			showPerkDescriptions: showPerkDescriptions,
			showSpecialRules: showSpecialRules
		};

		// Last chance to update print settings from localStorage if they've changed
		if (typeof localStorage !== 'undefined') {
			const storedPrintStyle = localStorage.getItem('user_print_style');
			if (storedPrintStyle) {
				printStyle = storedPrintStyle;
				enhancedDraft.printStyle = storedPrintStyle;
			}
			
			const storedEquipDesc = localStorage.getItem('user_show_equipment');
			if (storedEquipDesc !== null) {
				showEquipmentDescriptions = storedEquipDesc === '1' || storedEquipDesc === 'true';
				enhancedDraft.showEquipmentDescriptions = showEquipmentDescriptions;
			}
			
			const storedPerkDesc = localStorage.getItem('user_show_perks');
			if (storedPerkDesc !== null) {
				showPerkDescriptions = storedPerkDesc === '1' || storedPerkDesc === 'true';
				enhancedDraft.showPerkDescriptions = showPerkDescriptions;
			}
			
			const storedSpecialRules = localStorage.getItem('user_show_special_rules');
			if (storedSpecialRules !== null) {
				showSpecialRules = storedSpecialRules === '1' || storedSpecialRules === 'true';
				enhancedDraft.showSpecialRules = showSpecialRules;
			}
		}

		console.log("Printing team with options:", {
			printStyle,
			showEquipmentDescriptions,
			showPerkDescriptions,
			showSpecialRules,
			totalCans,
			maxCans
		});

		// Call the imported function with proper service name
		try {
			console.log("[printTeam] --- DEBUG ---");
			console.log("[printTeam] Current printStyle value:", printStyle);
			console.log("[printTeam] Settings menu printStyle:", document.getElementById('print-style-dashboard')?.checked ? 'dashboard' : 'not-dashboard');
			console.log("[printTeam] enhancedDraft.printStyle:", enhancedDraft.printStyle);
			console.log("[printTeam] typeof enhancedDraft.printStyle:", typeof enhancedDraft.printStyle);
			console.log("[printTeam] --- END DEBUG ---");
			
			// Use the proper print function based on style
			const finalPrintStyle = printStyle || enhancedDraft.printStyle || 'classic';
			if (finalPrintStyle === 'dashboard' || finalPrintStyle.includes('dashboard')) {
				console.log("[printTeam] Using dedicated dashboard print function");
				enhancedDraft.printStyle = 'dashboard'; // Ensure consistent naming
				await printTeamDashboard(enhancedDraft);
			} else {
				console.log("[printTeam] Using classic print function with style:", finalPrintStyle);
				await printServiceFunc(finalPrintStyle, enhancedDraft);
			}
			console.log("[printTeam] Print completed successfully");
			return true;
		} catch (error) {
			console.error("[printTeam] Error calling print service:", error);
			isPrinting = false;
			alert("There was an error while printing. Please try again.");
			return false;
		}
	}

	// Explicitly declare this at the top level of component scope
	// to ensure it's available to be bound to the window object
	function importBuild() {
		console.log('[importBuild] Showing import modal');
		// Make sure modal is visible
		showImportModal = true;
		console.log('[importBuild] Import modal shown:', showImportModal);
	}

	function openSettings(tab = 'general') {
		console.log(`[openSettings] Opening settings modal with tab: ${tab}`);
		activeSettingsTab = tab;
		showSettingsModal = true;
		console.log(`[openSettings] showSettingsModal set to: ${showSettingsModal}`);
	}
	
	// Expose these functions to the global window object for use by the layout
	onMount(() => {
		if (typeof window !== 'undefined') {
			// Set up a custom event listener for menu commands
			// Listen for custom team loading events
			document.addEventListener('gaslands-load-team-data', (event) => {
				console.log('[Event] Received gaslands-load-team-data event with full team data:', event.detail);
				
				if (event.detail) {
					if (window.importDraftFn) {
						console.log('[Event] Using window.importDraftFn to load team');
						window.importDraftFn(event.detail);
					} else {
						console.log('[Event] importDraftFn not available, setting team data manually');
						try {
							adoptRulesVersion(event.detail);
							// Set team properties directly
							if (event.detail.sponsor) {
								sponsorId = event.detail.sponsor;
							}
							
							if (event.detail.teamName) {
								teamName = event.detail.teamName;
								// Also update window.teamName for cross-component access
								if (typeof window !== 'undefined') {
									console.log("Setting window.teamName from event:", event.detail.teamName);
									window.teamName = event.detail.teamName;
								}
							}
							
							if (Array.isArray(event.detail.vehicles)) {
								// Process vehicles with additional logging for debugging
								const processedVehicles = event.detail.vehicles.map(v => {
									// Create a safe vehicle object with all required arrays
									const safeVehicle = {
										...v,
										weapons: Array.isArray(v.weapons) ? [...v.weapons] : [],
										upgrades: Array.isArray(v.upgrades) ? [...v.upgrades] : [],
										perks: Array.isArray(v.perks) ? [...v.perks] : []
									};
									
									// Log for debugging
									console.log(`Loading vehicle from event:
										- ID: ${safeVehicle.id}
										- Weapons: ${safeVehicle.weapons.join(', ')}
										- Upgrades: ${safeVehicle.upgrades.join(', ')}
										- Perks: ${safeVehicle.perks.join(', ')}`);
									
									// Add any perks from upgrades
									const allPerks = [...safeVehicle.perks];
									safeVehicle.upgrades.forEach(upgradeId => {
										const upgradeObj = upgrades.find(u => u.id === upgradeId);
										if (upgradeObj && upgradeObj.perks && Array.isArray(upgradeObj.perks)) {
											upgradeObj.perks.forEach(perkId => {
												if (!allPerks.includes(perkId)) {
													allPerks.push(perkId);
												}
											});
										}
									});
									
									return {
										...safeVehicle,
										perks: allPerks
									};
								});
								
								// Update the vehicles array
								vehicles = processedVehicles;
							}
							
							// Update maxCans if specified
							if (event.detail.maxCans && typeof event.detail.maxCans === 'number') {
								maxCans = event.detail.maxCans;
							}
							
							// Update dark mode if specified
							if (typeof event.detail.darkMode === 'boolean') {
								darkMode = event.detail.darkMode;
								if (darkMode) {
									document.documentElement.classList.add('dark-mode');
								} else {
									document.documentElement.classList.remove('dark-mode');
								}
							}
							
							// Calculate total cans after loading all team data
							totalCans = calculateTotalCansDirectly();
							
							// Run validation to ensure everything is properly updated
							validateSponsorRestrictions();
						} catch (error) {
							console.error('[Event] Error setting team data manually:', error);
						}
					}
				}
			});
			
			// Also listen on window for backup
			window.addEventListener('gaslands-team-loaded', (event) => {
				console.log('[Event] Received gaslands-team-loaded window event:', event.detail);
				if (event.detail && !window.importDraftFn) {
					// Try to reload the page with the team data stored in localStorage
					try {
						// Ensure we're not being called from jQuery which might not have the right context
						if (event.type !== 'gaslands-team-loaded') {
							console.warn('Called with wrong event type, ignoring:', event.type);
							return;
						}
						
						// Store the data
						localStorage.setItem('gaslands-team-data', JSON.stringify(event.detail));
						
						// Avoid using jQuery's reload or any method that might cause errors
						console.log("Redirecting to same page to reload...");
						
						// Use a simple redirect instead of reload() to avoid any jQuery conflicts
						if (typeof window !== 'undefined' && window.location) {
							const currentUrl = window.location.href.split('#')[0]; // Remove any hash
							window.location.replace(currentUrl);
						}
					} catch (error) {
						console.error('[Event] Error storing team data for reload:', error);
					}
				}
			});
			
			// Normal menu action listener
			window.addEventListener('gaslands-menu-action', (event) => {
				console.log('[Event] Received gaslands-menu-action event:', event.detail);
				const { action } = event.detail || {};
				
				if (action === 'importBuild') {
					console.log('[Event] Showing import modal from event');
					showImportModal = true;
				} else if (action === 'importDraft' && event.detail.draft) {
					console.log('[Event] Importing draft from event');
					// Call importDraftFn directly with the draft data
					if (window.importDraftFn) {
						window.importDraftFn(event.detail.draft);
					}
				} else if (action === 'generateQRCode') {
					console.log('[Event] Showing QR modal from event');
					generateQRCode();
				} else if (action === 'printTeam') {
					console.log('[Event] Printing team from event');
					printWithRulesCheck();
				} else if (action === 'openSettings') {
					console.log('[Event] Opening settings from event with tab:', event.detail.tab || 'general');
					openSettings(event.detail.tab || 'general');
				}
			});
			
			// Make openSettings function globally available
			window.openSettings = openSettings;
			window.openSettingsFn = openSettings;
			console.log("[onMount] Defined window.openSettings and window.openSettingsFn");
			
			// Check localStorage for print settings request
			const openPrintSettingsFlag = localStorage.getItem('openPrintSettings');
			if (openPrintSettingsFlag) {
				// Clear the flag immediately
				localStorage.removeItem('openPrintSettings');
				console.log("Detected openPrintSettings flag in localStorage");
				
				// Use setTimeout to ensure DOM is fully loaded
				setTimeout(() => {
					openSettings('print');
				}, 200);
			}
			
			// Set up interval to periodically check localStorage
			const storageCheckInterval = setInterval(() => {
				const newFlag = localStorage.getItem('openPrintSettings');
				if (newFlag) {
					// Clear the flag immediately
					localStorage.removeItem('openPrintSettings');
					console.log("Detected openPrintSettings flag in localStorage (interval check)");
					openSettings('print');
				}
			}, 1000);
			
			// Clear interval when component is destroyed
			return () => {
				clearInterval(storageCheckInterval);
			};
			
			// Check URL parameters for settings tab request
			const urlParams = new URLSearchParams(window.location.search);
			if (urlParams.has('openSettingsTab')) {
				const tabToOpen = urlParams.get('openSettingsTab');
				console.log("Opening settings tab from URL parameter:", tabToOpen);
				// Use setTimeout to ensure DOM is fully loaded
				setTimeout(() => {
					openSettings(tabToOpen);
					// Clean up URL to prevent reopening on refresh
					window.history.replaceState({}, document.title, window.location.pathname);
				}, 100);
			}
		
			// Setup message listener for print window communication
			window.addEventListener('message', (event) => {
				if (event.data && event.data.type === 'openPrintSettings') {
					openSettings('print');
				}
			});
			
			// Directly assign functions from the component scope to the window
			window.copyDraftFn = copyDraft;
			window.shareLinkFn = shareLink;
			window.generateQRCodeFn = generateQRCode;
			window.importBuildFn = importBuild;
			window.printTeamFn = printWithRulesCheck;
			// Make sure we use the direct function reference, not a wrapper
			window.openSettingsFn = openSettings;

			// Also expose functions directly on the window object as a backup
			window.copyDraft = copyDraft;
			window.shareLink = shareLink;
			window.generateQRCode = generateQRCode;
			window.importBuild = importBuild;
			window.printTeam = printTeam;
			window.printWithRulesCheck = printWithRulesCheck;
			window.openTeamsModalFn = () => { 
				// Make sure teamName is updated in the window object before opening modal
				console.log("Setting window.teamName to:", teamName);
				window.teamName = teamName;
				
				// Create a custom DOM event to ensure that other components can get the current team name
				try {
					const teamNameEvent = new CustomEvent('gaslands-team-name-update', {
						detail: { teamName: teamName },
						bubbles: true
					});
					document.dispatchEvent(teamNameEvent);
					console.log("Dispatched team name update event with:", teamName);
				} catch (e) {
					console.error("Error dispatching team name event:", e);
				}
				
				// Force a quick timeout to ensure the value is set before the modal opens
				setTimeout(() => {
					console.log("Opening teams modal with window.teamName:", window.teamName);
					showTeamsModal = true;
				}, 10);
			};

			// Expose showExperimentalFeatures for the menu visibility
			Object.defineProperty(window, 'showExperimentalFeatures', {
				get: () => showExperimentalFeatures
			});

			// Add functions for the Teams Modal in the layout
			// Make teamName available on the window object for other components to use
			// Make all team variables available globally for other components
			window.teamName = teamName;
			window.sponsorId = sponsorId;
			window.vehicles = vehicles;
			window.maxCans = maxCans;
			window.darkMode = darkMode;
			window.rulesVersion = rulesVersion;
			
			window.currentDraftFn = () => {
				// Make sure we check for actual content, not just empty arrays
				if (!sponsorId || !vehicles || vehicles.length === 0) {
					console.log("currentDraftFn: No valid team data available yet");
					return null;
				}
				// Create a current draft object with the current state
				const currentState = {
					sponsor: sponsorId,
					vehicles: vehicles,
					teamName: teamName || "My Gaslands Team",
					maxCans: maxCans,
					darkMode: darkMode,
					rulesVersion
				};
				console.log("currentDraftFn returning:", currentState);
				return currentState;
			};
			window.importDraftFn = (draft) => {
				console.log("importDraftFn called with:", JSON.stringify(draft, null, 2));
				
				// Clear the current state to make sure we don't mix old and new data
				if (draft) {
					try {
						// Make sure we have valid draft data
						let draftData = draft;
						
						// If draft is wrapped in a teamData property, unwrap it
						if (draft.teamData && typeof draft.teamData === 'object') {
							console.log("Found nested teamData, using that instead");
							draftData = draft.teamData;
						}
						
						// Handle the case where we have sponsorId instead of sponsor (backward compatibility)
						if (draftData && draftData.sponsorId && typeof draftData.sponsor === 'undefined') {
							console.log("Found sponsorId instead of sponsor, normalizing");
							draftData.sponsor = draftData.sponsorId;
						}
						
						console.log("Draft structure check:", {
							sponsorExists: draftData && (typeof draftData.sponsor !== "undefined" || typeof draftData.sponsorId !== "undefined"),
							vehiclesExists: draftData && Array.isArray(draftData.vehicles),
							vehiclesLength: draftData && draftData.vehicles ? draftData.vehicles.length : "N/A"
						});
						
						// Ensure draft has all required properties
						if (typeof draftData.sponsor === 'undefined' && typeof draftData.sponsorId === 'undefined') {
							console.error("Missing sponsor in draft data");
							return;
						}
						
						// If we only have sponsorId, use that as sponsor
						if (typeof draftData.sponsor === 'undefined' && typeof draftData.sponsorId !== 'undefined') {
							draftData.sponsor = draftData.sponsorId;
						}

						adoptRulesVersion(draftData);
						
						if (!Array.isArray(draftData.vehicles)) {
							console.error("Vehicles is not an array in draft data");
							return;
						}
						
						// Set sponsor ID
						sponsorId = draftData.sponsor;
						
						// Process imported vehicles to ensure they have all required properties
						const processedVehicles = draftData.vehicles.map(vehicle => {
							console.log("Processing vehicle:", vehicle);
							
							// Make sure the vehicle has all required arrays
							const safeVehicle = {
								...vehicle,
								weapons: Array.isArray(vehicle.weapons) ? [...vehicle.weapons] : [],
								upgrades: Array.isArray(vehicle.upgrades) ? [...vehicle.upgrades] : [],
								perks: Array.isArray(vehicle.perks) ? [...vehicle.perks] : []
							};
							
							// Start with the vehicle's explicit perks
							const allPerks = [...safeVehicle.perks];
							
							// Add any perks from the vehicle's upgrades
							safeVehicle.upgrades.forEach(upgradeId => {
								const upgradeObj = upgrades.find(u => u.id === upgradeId);
								if (upgradeObj && upgradeObj.perks && Array.isArray(upgradeObj.perks)) {
									upgradeObj.perks.forEach(perkId => {
										if (!allPerks.includes(perkId)) {
											allPerks.push(perkId);
										}
									});
								}
							});
							
							// Log what we're loading for debugging
							console.log(`Loaded vehicle ${safeVehicle.id} with:
								- Weapons: ${safeVehicle.weapons.join(', ')}
								- Upgrades: ${safeVehicle.upgrades.join(', ')}
								- Perks: ${allPerks.join(', ')}`);
							
							// Return the vehicle with possibly updated perks
							return {
								...safeVehicle,
								perks: allPerks
							};
						});
						
						vehicles = processedVehicles;

					// Import team name if available
					if (draftData.teamName) {
						teamName = draftData.teamName;
						// Also update window.teamName for cross-component access
						if (typeof window !== 'undefined') {
							console.log("Setting window.teamName from draft data:", draftData.teamName);
							window.teamName = draftData.teamName;
						}
					}

					// Import maxCans if available
					if (draftData.maxCans) {
						maxCans = draftData.maxCans;
					}

					// Import darkMode if available
					if (draftData.darkMode !== undefined) {
						darkMode = draftData.darkMode;
					}
					
					// Calculate and update totalCans after loading the team
					totalCans = calculateTotalCansDirectly();
					
					// Run validation to make sure everything is properly updated
					validateSponsorRestrictions();
					
					// Close the try block
					} catch (error) {
						console.error("Error importing draft:", error);
					}
				}
			};
		}

		return () => {
			// Clean up when component is destroyed
			if (typeof window !== 'undefined') {
				console.log("[onUnmount] Cleaning up global functions");
				// Clean up function references with Fn suffix
				window.copyDraftFn = undefined;
				window.shareLinkFn = undefined;
				window.generateQRCodeFn = undefined;
				window.importBuildFn = undefined;
				window.printTeamFn = undefined;
				window.openSettings = undefined;
				window.openSettingsFn = undefined;
				window.openTeamsModalFn = undefined;
				window.currentDraftFn = undefined;
				window.importDraftFn = undefined;
				
				// Clean up global team variables
				window.teamName = undefined;
				window.sponsorId = undefined;
				window.vehicles = undefined;
				window.maxCans = undefined;
				window.darkMode = undefined;
				
				// Clean up direct function references
				window.copyDraft = undefined;
				window.shareLink = undefined;
				window.generateQRCode = undefined;
				window.importBuild = undefined;
				window.printTeam = undefined;
				window.printWithRulesCheck = undefined;
				delete window.showExperimentalFeatures;
			}
		};
	});

	function importDraftString() {
		const draft = decodeDraft(importString.trim());
		if (draft) {
			adoptRulesVersion(draft);
			sponsorId = draft.sponsor;
			
			// Process imported vehicles to ensure they have all required properties and perks from upgrades are included
			const processedVehicles = (draft.vehicles as Veh[]).map(vehicle => {
				// Make sure the vehicle has all required arrays
				const safeVehicle = {
					...vehicle,
					weapons: Array.isArray(vehicle.weapons) ? [...vehicle.weapons] : [],
					upgrades: Array.isArray(vehicle.upgrades) ? [...vehicle.upgrades] : [],
					perks: Array.isArray(vehicle.perks) ? [...vehicle.perks] : []
				};
				
				// Start with the vehicle's explicit perks
				const allPerks = [...safeVehicle.perks];
				
				// Add any perks from the vehicle's upgrades
				safeVehicle.upgrades.forEach(upgradeId => {
					const upgradeObj = upgrades.find(u => u.id === upgradeId);
					if (upgradeObj && upgradeObj.perks && Array.isArray(upgradeObj.perks)) {
						upgradeObj.perks.forEach(perkId => {
							if (!allPerks.includes(perkId)) {
								allPerks.push(perkId);
							}
						});
					}
				});
				
				// Log what we're loading for debugging
				console.log(`Loaded vehicle ${safeVehicle.id} with:
					- Weapons: ${safeVehicle.weapons.join(', ')}
					- Upgrades: ${safeVehicle.upgrades.join(', ')}
					- Perks: ${allPerks.join(', ')}`);
				
				// Return the vehicle with possibly updated perks
				return {
					...safeVehicle,
					perks: allPerks
				};
			});
			
			vehicles = processedVehicles;
			
			// Import team name if available
			if (draft.teamName) {
				teamName = draft.teamName;
				// Also update window.teamName for cross-component access
				if (typeof window !== 'undefined') {
					console.log("Setting window.teamName from draft:", draft.teamName);
					window.teamName = draft.teamName;
				}
			}
			
			// Import maxCans if available
			if (draft.maxCans) {
				maxCans = draft.maxCans;
			}
			
			// Import darkMode if available
			if (draft.darkMode !== undefined) {
				darkMode = draft.darkMode;
			}
			
			// Calculate and update totalCans after loading the team
			totalCans = calculateTotalCansDirectly();
			
			// Run validation to make sure everything is properly updated
			validateSponsorRestrictions();
			
			importString = '';
			showImportModal = false;
		} else {
			alert('Invalid draft string');
		}
	}

	/* ---------- load from URL param (once) ---------- */
	if (typeof window !== 'undefined') {
		// First load settings from localStorage if available
		const savedDarkMode = localStorage.getItem('darkMode');
		if (savedDarkMode !== null) {
			darkMode = savedDarkMode === 'true';
		}

		// Then check for URL params (these override localStorage)
		const url = new URL(window.location.href);
		const encoded = url.searchParams.get('draft');
		if (encoded) {
			const imported = decodeDraft(encoded);
			if (imported) {
				adoptRulesVersion(imported);
				sponsorId = imported.sponsor;
				vehicles = imported.vehicles as Veh[];
				
				// Import team name if available
				if (imported.teamName) {
					teamName = imported.teamName;
					// Also update window.teamName for cross-component access
					if (typeof window !== 'undefined') {
						console.log("Setting window.teamName from imported team:", imported.teamName);
						window.teamName = imported.teamName;
					}
				}
				
				// Import maxCans if available
				if (imported.maxCans) {
					maxCans = imported.maxCans;
				}
				
				// Import darkMode if available
				if (imported.darkMode !== undefined) {
					darkMode = imported.darkMode;
				}
				
				// Calculate and update totalCans after loading the team
				totalCans = calculateTotalCansDirectly();
				
				// Run validation to make sure everything is properly updated
				validateSponsorRestrictions();
			}
		}
	}
	
	/* ---------- setting changes effects ---------- */
	// When enableSponsorships is disabled, set to "No Sponsor"
	$: if (!enableSponsorships && rulesVersion !== 3) {
		const noSponsorId = sponsors.find(s => s.id === 'no_sponsor')?.id ?? '';
		sponsorId = noSponsorId;
	}
	
	// When sponsor changes, validate restrictions and clean up invalid components
	// DISABLED reactive sponsor changing to prevent infinite loops
	// $: if (sponsorId && sponsorId !== lastSponsorId) { ... }

	/**
	 * Handles sponsor changes manually without triggering automatic validation
	 * Instead of validating immediately, this sets a pendingSponsorValidation flag
	 * and shows a UI notification asking the user to apply sponsor rules manually
	 * 
	 * This approach is part of our solution to prevent infinite update loops
	 */
	function handleSponsorChange(newSponsorId) {
		if (newSponsorId && newSponsorId !== lastSponsorId) {
			console.log(`Sponsor changed to: ${newSponsorId}`);
			lastSponsorId = newSponsorId;
			sponsorId = newSponsorId;
			
			// Apply sponsor validation immediately
			validateSponsorRestrictions();
			
			// Update cans directly
			totalCans = calculateTotalCansDirectly();
			
			// Update the draft object - this will also trigger validation
			updateCurrentDraft();
		}
	}

	/**
	 * Applies sponsor validation rules to the current team
	 * This is part of our manual validation approach to prevent infinite update loops
	 * We completely disabled automatic validation after encountering "effect_update_depth_exceeded" errors
	 * when updating vehicle configurations
	 */
	function applySponsorValidation() {
		if (pendingSponsorValidation) {
			console.log("Applying sponsor validation");
			
			// Call validation function which does checking and cleanup
			const changesRequired = validateSponsorRestrictions();
			
			// Update cans after validation
			totalCans = calculateTotalCansDirectly();
			
			// Explicitly update the draft
			updateCurrentDraft();
			
			// Reset pending flag
			pendingSponsorValidation = false;
			
			// Hide validation notice
			if (document.getElementById('validation-notice')) {
				document.getElementById('validation-notice').style.display = 'none';
			}
			
			// Return whether changes were made
			return changesRequired;
		}
		return false;
	}
	
	// Remove any advanced vehicle types when includeAdvanced is disabled
	$: if (!includeAdvanced) {
		vehicles = vehicles.filter(v => {
			const vehicleType = vehicleTypes.find(vt => vt.id === v.type);
			return vehicleType && !vehicleType.advanced;
		});
	}
	
	// Remove any advanced weapons when includeAdvanced is disabled
	$: if (!includeAdvanced) {
		vehicles = vehicles.map(v => ({
			...v,
			weapons: v.weapons.filter(weaponInstanceId => {
				// Extract the base weapon ID from the instance ID (format: baseId_instanceHash)
				const lastUnderscoreIndex = weaponInstanceId.lastIndexOf('_');
				const baseWeaponId = lastUnderscoreIndex !== -1 ? 
					weaponInstanceId.substring(0, lastUnderscoreIndex) : 
					weaponInstanceId;
				const weapon = weapons.find(w => w.id === baseWeaponId);
				return weapon && !weapon.advanced;
			}),
			// Also clean up any facings for removed weapons
			weaponFacings: v.weaponFacings ? 
				Object.fromEntries(
					Object.entries(v.weaponFacings).filter(([weaponInstanceId]) => {
						const lastUnderscoreIndex = weaponInstanceId.lastIndexOf('_');
				const baseWeaponId = lastUnderscoreIndex !== -1 ? 
					weaponInstanceId.substring(0, lastUnderscoreIndex) : 
					weaponInstanceId;
						const weapon = weapons.find(w => w.id === baseWeaponId);
						return weapon && !weapon.advanced;
					})
				) : {}
		}));
	}
	
	// Remove any advanced upgrades when includeAdvanced is disabled
	$: if (!includeAdvanced) {
		vehicles = vehicles.map(v => ({
			...v,
			upgrades: v.upgrades.filter(upgradeId => {
				const upgrade = upgrades.find(u => u.id === upgradeId);
				return upgrade && !upgrade.advanced;
			})
		}));
	}
	
	// Remove perks when enableSponsorships is disabled (v2 sponsor perks only)
	$: if (!enableSponsorships && rulesVersion !== 3) {
		vehicles = vehicles.map(v => ({
			...v,
			perks: []
		}));
	}
	
	// Save dark mode preference to localStorage when it changes
	$: if (typeof window !== 'undefined') {
		localStorage.setItem('darkMode', darkMode.toString());
		// Add dark mode classes to html element for global styling
		if (darkMode) {
			document.documentElement.classList.add('dark-mode');
			document.documentElement.classList.add('dark');
		} else {
			document.documentElement.classList.remove('dark-mode');
			document.documentElement.classList.remove('dark');
		}
	}

	/* ---------- draft & validation ---------- */
	$: currentDraft = { 
		sponsor: sponsorId, 
		vehicles,
		teamName,
		maxCans,
		darkMode,
		rulesVersion
	} satisfies Draft;
	$: countedVehicles = countedVehicleTotal(vehicles.map((entry) => entry.type));
	$: vehicleAllowance = maxCountedVehicles(Number(maxCans) || 50);

	// Function to force validation to run immediately
	/**
	 * Manually validates the team without triggering reactive updates
	 * 
	 * This function uses several techniques to prevent the infinite update loops that were
	 * causing "effect_update_depth_exceeded" errors:
	 * 1. Flags to prevent concurrent validation (isForceValidating, isValidating)
	 * 2. setTimeout to break reactive update chains
	 * 3. Deep copying of objects with JSON.parse/stringify to prevent reference sharing
	 * 4. Manual draft updates instead of reactive declarations
	 */
	function forceValidation() {
		// Skip if already validating to prevent recursive calls
		if (isForceValidating || isValidating) {
			console.log("Skipping duplicate validation request");
			return;
		}
		
		// Set flag to prevent recursive validation
		isForceValidating = true;
		console.log("Starting force validation");
		
		// First, ensure sponsor validation is applied if needed
		if (pendingSponsorValidation) {
			applySponsorValidation();
		}
		
		// Calculate cans directly for immediate feedback
		totalCans = calculateTotalCansDirectly();
		
		// Use a setTimeout to break any reactive chain
		setTimeout(() => {
			try {
				// Create a manual draft object with deep copy to prevent reactivity issues
				const draftToValidate = {
					sponsor: sponsorId,
					vehicles: JSON.parse(JSON.stringify(vehicles)),
					teamName,
					maxCans,
					darkMode,
					rulesVersion
				};
				
				// Use direct validation in a separate execution context to avoid reactivity
				validateDraft(draftToValidate)
					.then(result => {
						console.log("Force validation completed successfully");
						
						// Process the validation result
						if (result.errors.length > 0) {
							result.errors = result.errors.map(err => {
								if (err.includes("cans limit") || err.includes("can limit")) {
									return `Team exceeds ${maxCans} cans limit`;
								}
								return err;
							});
						}
						
						// Update validation in a separate execution context to break reactivity
						setTimeout(() => {
							validation = Object.assign({}, result);
							isForceValidating = false;
						}, 10);
					})
					.catch(err => {
						console.error("Error in force validation:", err);
						isForceValidating = false;
					});
			} catch (error) {
				console.error("Error during force validation setup:", error);
				isForceValidating = false;
			}
		}, 10);
	}

	// Function to handle vehicle type changes
	function handleVehicleTypeChange(vehicleId, newVehicleType) {
		// Find the vehicle to update
		const vehicle = vehicles.find(v => v.id === vehicleId);
		if (vehicle) {
			// Update vehicle type
			vehicle.type = newVehicleType;
			// Update draft to trigger automatic validation
			updateCurrentDraft();
		}
	}

	// Function to calculate vehicle cost for immediate updates
	function calculateVehicleCost(vehicle) {
		// Get the base cost from the vehicle type
		const vehicleType = vehicleTypes.find(vt => vt.id === vehicle.type);
		if (!vehicleType) return 0;

		let totalCost = vehicleType.baseCost || 0;

		// Add weapon costs
		for (const weaponInstanceId of vehicle.weapons) {
			const lastUnderscoreIndex = weaponInstanceId.lastIndexOf('_');
				const baseWeaponId = lastUnderscoreIndex !== -1 ? 
					weaponInstanceId.substring(0, lastUnderscoreIndex) : 
					weaponInstanceId;
			const weaponObj = weapons.find(w => w.id === baseWeaponId);
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
			if (perkObj && perkObj.level) {
				totalCost += perkObj.level; // Perk cost is its level
			}
		}

		return totalCost;
	}
	// Create a non-reactive function to calculate current total cans directly
	function calculateTotalCansDirectly() {
		let totalCost = 0;
		
		// Calculate cost vehicle by vehicle
		for (const vehicle of vehicles) {
			// Get vehicle base cost
			const vehicleType = vehicleTypes.find(vt => vt.id === vehicle.type);
			if (!vehicleType) continue;
			
			// Add base vehicle cost
			totalCost += vehicleType.baseCost || 0;
			
			// Add weapon costs
			for (const weaponInstanceId of vehicle.weapons) {
				const lastUnderscoreIndex = weaponInstanceId.lastIndexOf('_');
				const baseWeaponId = lastUnderscoreIndex !== -1 ? 
					weaponInstanceId.substring(0, lastUnderscoreIndex) : 
					weaponInstanceId;
				const weaponObj = weapons.find(w => w.id === baseWeaponId);
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
				if (rulesVersion === 3) {
					if (perkObj) totalCost += perkObj.cost || perkObj.level || 0;
				} else if (perkObj && perkObj.level) {
					totalCost += perkObj.level; // Perk cost is its level
				}
			}

			if (rulesVersion === 3 && vehicle.upgrades?.includes('turret_mount') && vehicle.turretWeaponId) {
				const turretWeapon = resolveById(weapons, vehicle.turretWeaponId);
				if (turretWeapon?.cost) totalCost += turretWeapon.cost;
			}
		}
		
		return totalCost;
	}
	
	// Create a function to validate sponsor restrictions and clean up invalid components
	function validateSponsorRestrictions() {
		// Get the current sponsor object for capability checks
		const currentSponsorObj = sponsors.find(s => s.id === sponsorId);
		let changesRequired = false;
		let removalMessages = [];
		
		console.log(`Validating for sponsor: ${currentSponsorObj?.name} (${sponsorId})`);
		console.log(`Sponsor trailer support: ${currentSponsorObj?.trailer ? 'Yes' : 'No'}`);
		console.log(`Sponsor electrical support: ${currentSponsorObj?.electrical ? 'Yes' : 'No'}`);
		
		// 1. Check for invalid vehicles based on sponsor restrictions
		const invalidVehicles = vehicles.filter(v => {
			const vehicleType = vehicleTypes.find(vt => vt.id === v.type);
			
			// Vehicle is only invalid if:
			// 1. We have a vehicle type definition, AND
			// 2. It has a sponsors list, AND
			// 3. The current sponsor is not in that list
			if (vehicleType && vehicleType.sponsors && vehicleType.sponsors.length > 0) {
				// Check if current sponsor is NOT in the list
				return !vehicleType.sponsors.includes(sponsorId);
			}
			
			// Vehicle type has no sponsor restrictions or doesn't exist
			return false;
		});
		
		// If we found invalid vehicles, remove them and track for user notification
		if (invalidVehicles.length > 0) {
			console.log(`Removing ${invalidVehicles.length} vehicles not available with sponsor ${sponsorId}`);
			changesRequired = true;
			
			// Get the names of the removed vehicles for the alert
			const removedVehicleNames = invalidVehicles.map(v => {
				const vehicleType = vehicleTypes.find(vt => vt.id === v.type);
				return vehicleType ? vehicleType.name : v.type;
			});
			
			removalMessages.push(`Vehicles removed: ${removedVehicleNames.join(', ')}`);
			
			// Remove the invalid vehicles
			vehicles = vehicles.filter(v => {
				const vehicleType = vehicleTypes.find(vt => vt.id === v.type);
				
				// Only filter if the vehicle has sponsor restrictions
				if (vehicleType && vehicleType.sponsors && vehicleType.sponsors.length > 0) {
					return vehicleType.sponsors.includes(sponsorId);
				}
				
				// Keep vehicles with no sponsor restrictions
				return true;
			});
		}
		
		// 2. For remaining vehicles, check for invalid upgrades, weapons, and perks
		let vehiclesWithChanges = [];
		
		const updatedVehicles = vehicles.map(vehicle => {
			let vehicleChanged = false;
			let vehicleTrailerRemoved = false;
			const invalidUpgrades = [];
			
			// v2 sponsors gate electrical gear. v3 unlocks it per vehicle (Spark or a van).
			if (rulesVersion !== 3 && currentSponsorObj && !currentSponsorObj.electrical) {
				const electricalUpgrades = vehicle.upgrades.filter(upId => {
					const upgrade = upgrades.find(u => u.id === upId);
					return upgrade && upgrade.electrical;
				});
				
				if (electricalUpgrades.length > 0) {
					vehicleChanged = true;
					electricalUpgrades.forEach(upId => {
						const upgrade = upgrades.find(u => u.id === upId);
						if (upgrade) {
							invalidUpgrades.push(upgrade.name);
						}
					});
					
					// Remove electrical upgrades
					vehicle.upgrades = vehicle.upgrades.filter(upId => {
						const upgrade = upgrades.find(u => u.id === upId);
						return !(upgrade && upgrade.electrical);
					});
				}
			}
			
			// v3 trailers are ordinary upgrades gated by weight and airborne, not by the sponsor.
			if (rulesVersion !== 3 && currentSponsorObj && !currentSponsorObj.trailer) {
				console.log(`Checking vehicle ${vehicle.name} for trailer upgrades (sponsor doesn't support trailers)`);
				
				// First, find any actual trailer upgrades
				const actualTrailers = vehicle.upgrades.filter(upId => {
					const upgrade = upgrades.find(u => u.id === upId);
					return upgrade && (upgrade.trailer === true || upgrade.trailer === "true");
				});
				
				// Then find trailer-specific upgrades
				const trailerSpecificUpgrades = vehicle.upgrades.filter(upId => {
					const upgrade = upgrades.find(u => u.id === upId);
					return upgrade && upgrade.trailerUpgrade;
				});
				
				const allTrailerUpgrades = [...actualTrailers, ...trailerSpecificUpgrades];
				
				console.log(`Found ${actualTrailers.length} trailer(s) and ${trailerSpecificUpgrades.length} trailer-specific upgrade(s)`);
				
				if (allTrailerUpgrades.length > 0) {
					vehicleChanged = true;
					if (actualTrailers.length > 0) vehicleTrailerRemoved = true;
					
					allTrailerUpgrades.forEach(upId => {
						const upgrade = upgrades.find(u => u.id === upId);
						if (upgrade) {
							invalidUpgrades.push(upgrade.name);
						}
					});
					
					// Remove trailer-related upgrades
					vehicle.upgrades = vehicle.upgrades.filter(upId => {
						const upgrade = upgrades.find(u => u.id === upId);
						return !(upgrade && 
							((upgrade.trailer === true || upgrade.trailer === "true") || upgrade.trailerUpgrade));
					});
				}
			}
			
			// Check for sponsor-limited upgrades
			const limitedUpgrades = vehicle.upgrades.filter(upId => {
				const upgrade = upgrades.find(u => u.id === upId);
				return upgrade && upgrade.limited_sponsor && upgrade.limited_sponsor !== currentSponsorObj?.id;
			});
			
			if (limitedUpgrades.length > 0) {
				vehicleChanged = true;
				limitedUpgrades.forEach(upId => {
					const upgrade = upgrades.find(u => u.id === upId);
					if (upgrade) {
						invalidUpgrades.push(upgrade.name);
					}
				});
				
				// Remove sponsor-limited upgrades
				vehicle.upgrades = vehicle.upgrades.filter(upId => {
					const upgrade = upgrades.find(u => u.id === upId);
					return !(upgrade && upgrade.limited_sponsor && upgrade.limited_sponsor !== currentSponsorObj?.id);
				});
			}
			
			if (rulesVersion !== 3 && currentSponsorObj && !currentSponsorObj.electrical) {
				const electricalWeapons = vehicle.weapons.filter(weaponId => {
					const baseWeaponId = weaponId.includes('_') ? weaponId.split('_').slice(0, -1).join('_') : weaponId;
					const weapon = weapons.find(w => w.id === baseWeaponId);
					return weapon && weapon.electrical;
				});
				
				if (electricalWeapons.length > 0) {
					vehicleChanged = true;
					changesRequired = true;
					const invalidWeaponNames = electricalWeapons.map(weaponId => {
						const baseWeaponId = weaponId.includes('_') ? weaponId.split('_').slice(0, -1).join('_') : weaponId;
						const weapon = weapons.find(w => w.id === baseWeaponId);
						return weapon ? weapon.name : baseWeaponId;
					});
					
					// Record weapon removal message
					if (invalidWeaponNames.length > 0) {
						removalMessages.push(`Electrical weapons removed from ${vehicle.name || "a vehicle"}: ${invalidWeaponNames.join(', ')}`);
					}
					
					// Remove electrical weapons
					vehicle.weapons = vehicle.weapons.filter(weaponId => {
						const baseWeaponId = weaponId.includes('_') ? weaponId.split('_').slice(0, -1).join('_') : weaponId;
						const weapon = weapons.find(w => w.id === baseWeaponId);
						return !(weapon && weapon.electrical);
					});
				}
			}
			
			// If we removed upgrades or made changes, track the vehicle and add to messages
			if (vehicleChanged) {
				changesRequired = true;
				vehiclesWithChanges.push(vehicle.name || `Vehicle ${vehicle.id}`);
				
				if (vehicleTrailerRemoved) {
					removalMessages.push(`Trailer removed from ${vehicle.name || "a vehicle"} (this sponsor doesn't support trailers)`);
				}
				
				if (invalidUpgrades.length > 0) {
					removalMessages.push(`Upgrades removed from ${vehicle.name || "a vehicle"}: ${invalidUpgrades.join(', ')}`);
				}
			}
			
			return vehicleChanged ? {...vehicle} : vehicle;
		});
		
		// Update vehicles if any changes were needed
		if (changesRequired) {
			console.log(`Updating ${vehiclesWithChanges.length} vehicles with sponsor restriction changes`);
			vehicles = updatedVehicles;
			
			// Inform the user about removed items
			if (removalMessages.length > 0) {
				alert(`The following items were removed because they're not available with the selected sponsor:\n\n${removalMessages.join('\n')}`);
			}
			
			return true; // Return true to indicate changes were made
		}
		
		return false; // Return false to indicate no changes were needed
	}
	
	// Create a non-reactive function to update validation
	function updateValidation() {
		// First calculate cans directly for immediate feedback
		totalCans = calculateTotalCansDirectly();
		
		// Then run the full validation for rules checks
		validateDraft(currentDraft).then((r) => {
			// Create a copy of the validation result
			const validationCopy = { ...r };

			// Replace the max cans error with custom max cans if it exists
			if (validationCopy.errors.length > 0) {
				validationCopy.errors = validationCopy.errors.map(err => {
					if (err.includes("cans limit") || err.includes("can limit")) {
						return `Team exceeds ${maxCans} cans limit`;
					}
					return err;
				});
			}

			// Check against custom max cans
			if (validationCopy.cans > maxCans && !validationCopy.errors.some(e => e.includes("cans limit"))) {
				validationCopy.errors.push(`Team exceeds ${maxCans} cans limit`);
			}

			// Update the validation object (non-reactively) but keep our directly calculated totalCans
			validation = validationCopy;
			
			// Double-check if the direct calculation matches validation
			if (Math.abs(totalCans - validationCopy.cans) > 0.1) {
				console.warn(`Direct cans calculation (${totalCans}) differs from validation (${validationCopy.cans})`);
			}

			// Explicitly update the totalCans value for display and debug
			console.log(`Team validation completed - Total cans: ${totalCans}`);
		}).catch(err => {
			console.error("Error in validation:", err);
		});
	}
	
	// Function to enforce the one-trailer-per-vehicle rule across the entire team
	function enforceOneTrailerPerVehicle() {
		let madeChanges = false;
		
		// Check each vehicle
		vehicles = vehicles.map(vehicle => {
			// Find trailer upgrades
			const trailerUpgrades = vehicle.upgrades.filter(upId => {
				const up = upgrades.find(u => u.id === upId);
				return up && (up.trailer === true || up.trailer === "true");
			});
			
			// If multiple trailers found, keep only the first one
			if (trailerUpgrades.length > 1) {
				console.warn(`Fixing invalid vehicle ${vehicle.name || vehicle.id} - detected ${trailerUpgrades.length} trailers`);
				
				// Keep only the first trailer upgrade
				const keepTrailer = trailerUpgrades[0];
				
				// Create new upgrades array without the excess trailers
				const filteredUpgrades = vehicle.upgrades.filter(upId => {
					// Keep non-trailer upgrades
					const up = upgrades.find(u => u.id === upId);
					if (!up || !(up.trailer === true || up.trailer === "true")) return true;
					
					// Only keep the first trailer upgrade
					return upId === keepTrailer;
				});
				
				// Return fixed vehicle
				madeChanges = true;
				return {
					...vehicle,
					upgrades: filteredUpgrades
				};
			}
			
			return vehicle;
		});
		
		// If changes were made, update validation
		if (madeChanges) {
			updateValidation();
		}
	}
	
	// Function to check vehicle sponsor restrictions (for debugging)
	function checkVehicleSponsors() {
		// Get the current sponsor
		const currentSponsorObj = sponsors.find(s => s.id === sponsorId);
		if (!currentSponsorObj) {
			console.warn("No current sponsor found!");
			return;
		}
		
		console.log(`Checking vehicle restrictions for sponsor: ${currentSponsorObj.name} (${currentSponsorObj.id})`);
		
		// Check war rig specifically
		const warRig = vehicleTypes.find(v => v.id === 'war_rig');
		if (warRig) {
			const canUseWarRig = !warRig.sponsors || warRig.sponsors.includes(currentSponsorObj.id);
			console.log(`Can ${currentSponsorObj.name} use War Rig? ${canUseWarRig}`);
			if (!canUseWarRig) {
				console.log(`War Rig sponsors: ${warRig.sponsors?.join(', ')}`);
			}
		}
		
		// List all available vehicles for current sponsor
		const availableVehicles = vehicleTypes.filter(v => 
			!v.sponsors || v.sponsors.includes(currentSponsorObj.id)
		);
		
		console.log(`Available vehicles for ${currentSponsorObj.name}: ${availableVehicles.map(v => v.name).join(', ')}`);
	}
	
	// Run sponsor check once to verify
	checkVehicleSponsors();
	
	// DISABLED automatic validation to prevent infinite update loops
	// $: { 
	//   const triggerValidation = JSON.stringify(currentDraft);
	//   updateValidation();
	// }
	
	function updateCurrentDraft() {
		currentDraft = { 
			sponsor: sponsorId, 
			vehicles,
			teamName,
			maxCans,
			darkMode,
			rulesVersion
		};
		
		// Automatically validate with each update
		enforceOneTrailerPerVehicle();
		
		// Queue validation to happen after current operation finishes
		// Only if we're not already validating
		if (!isValidating && !isForceValidating) {
			setTimeout(() => {
				forceValidation();
			}, 10);
		}
	}
	$: teamErrors = validation.errors;

	/* ---------- filtered assets based on settings ---------- */
	// Trigger re-rendering when vehicles array changes its length
	$: vehicleCount = vehicles.length;

	// Filter weapons based on includeAdvanced setting and electrical property
	$: filteredWeapons = weapons.filter(w => {
		// Filter by advanced setting
		if (!includeAdvanced && w.advanced) return false;

		// Filter by electrical property
		if (w.electrical && !(currentSponsor?.electrical)) return false;

		return true;
	});

	// Filter upgrades based on includeAdvanced setting, electrical property, and trailer compatibility
	$: filteredUpgrades = upgrades.filter(u => {
		// Filter by advanced setting
		if (!includeAdvanced && u.advanced) return false;

		// Filter by electrical property
		if (u.electrical && !(currentSponsor?.electrical)) return false;

		// Filter by sponsor restriction if applicable
		if (u.limited_sponsor && u.limited_sponsor !== currentSponsor?.id) return false;

		// Filter by trailer compatibility
		if (u.trailer && !(currentSponsor?.trailer)) return false;

		// Filter trailer-only upgrades (don't show in main list)
		if (u.trailerUpgrade) return false;

		return true;
	});
	
	// Filter trailer upgrades - only for use on trailers
	$: filteredTrailerUpgrades = upgrades.filter(u => {
		// Filter by advanced setting
		if (!includeAdvanced && u.advanced) return false;

		// Filter by electrical property
		if (u.electrical && !(currentSponsor?.electrical)) return false;

		// Filter by sponsor restriction if applicable
		if (u.limited_sponsor && u.limited_sponsor !== currentSponsor?.id) return false;
		
		// Only show trailer upgrades and only if sponsor supports trailers
		if (!u.trailerUpgrade || !(currentSponsor?.trailer)) return false;

		return true;
	});
	
	// Get available perks for the current sponsor
	$: currentSponsor = sponsors.find(s => s.id === sponsorId);

	// Filter perks based on class match (perksClasses) - only class perks, not sponsor perks
	$: classPerksList = enableSponsorships
		? perks.filter(p => {
			// Only include perks that have empty sponsor field (class perks)
			if (p.sponsor && p.sponsor.trim() !== '') return false;
			
			// If sponsor has perksClasses and the perk has a class, do normal filtering
			if (currentSponsor?.perksClasses?.length > 0 && p.class) {
				return currentSponsor.perksClasses.some(
					sponsorClass => sponsorClass.toLowerCase() === p.class.toLowerCase()
				);
			}
			// If sponsor has perks directly specified, include perks matching those IDs
			else if (currentSponsor?.perks?.length > 0) {
				return currentSponsor.perks.includes(p.id);
			}
			// No matching criteria found
			return false;
		})
		: [];

	// Filter sponsor-specific perks (based on sponsor field)
	// Map of sponsor ID aliases for backward compatibility with perks.json
	const sponsorIdAliases = {
		'rus': ['rusty'], // Rusty's Bootleggers
		'thp': ['highway_patrol', 'highway patrol'], // The Highway Patrol
		'war': ['warden'], // The Warden
	};

	$: sponsorPerksList = enableSponsorships && currentSponsor
		? perks.filter(p => {
			// Only include perks that have a non-empty sponsor field (sponsor-specific perks)
			if (p.sponsor && p.sponsor.trim() !== '') {
				const perkSponsorLower = p.sponsor.toLowerCase();
				const sponsorIdLower = currentSponsor.id.toLowerCase();
				const sponsorNameLower = currentSponsor.name.toLowerCase();

				// Get any aliases for this sponsor
				const aliases = sponsorIdAliases[sponsorIdLower] || [];

				// Match by sponsor ID, sponsor name, or any of the aliases
				return perkSponsorLower === sponsorIdLower ||
				       perkSponsorLower === sponsorNameLower ||
				       aliases.includes(perkSponsorLower);
			}
			return false;
		})
		: [];

	// Available perks for vehicle selection (only class perks, not sponsor-specific perks)
	$: availablePerks = classPerksList.filter(perk => {
		// Only include class perks (sponsor field should be empty)
		if (perk.sponsor && perk.sponsor.trim() !== '') return false;
		// Filter by electrical property
		if (perk.electrical && !(currentSponsor?.electrical)) return false;
		return true;
	});

	// For legacy support, also include perks with matching id
	$: legacyPerks = enableSponsorships
		? perks.filter(p => (currentSponsor?.perks && currentSponsor.perks.includes(p.id)))
		: [];

	/* ---------- import box ---------- */
	let importString = '';

	// Remove all duplicate settings declarations
	// Load settings from localStorage
	function loadFromLocalStorage() {
		if (typeof localStorage === 'undefined') return;
		
		console.log("[Builder] Loading settings from localStorage");
		
		// PRINT SETTINGS - TRY BOTH NAMING CONVENTIONS
		const storedPrintStyle = localStorage.getItem('printStyle') || localStorage.getItem('user_print_style');
		if (storedPrintStyle) {
			printStyle = storedPrintStyle;
			console.log("[Builder] Loaded printStyle from localStorage:", printStyle);
		}
		
		// EQUIPMENT DESCRIPTIONS
		const storedEquipDesc = localStorage.getItem('showEquipmentDescriptions') || localStorage.getItem('user_show_equipment');
		if (storedEquipDesc) {
			showEquipmentDescriptions = storedEquipDesc === 'true' || storedEquipDesc === '1';
			console.log("[Builder] Loaded showEquipmentDescriptions from localStorage:", showEquipmentDescriptions);
		}
		
		// PERK DESCRIPTIONS
		const storedPerkDesc = localStorage.getItem('showPerkDescriptions') || localStorage.getItem('user_show_perks');
		if (storedPerkDesc) {
			showPerkDescriptions = storedPerkDesc === 'true' || storedPerkDesc === '1';
			console.log("[Builder] Loaded showPerkDescriptions from localStorage:", showPerkDescriptions);
		}
		
		// SPECIAL RULES
		const storedSpecialRules = localStorage.getItem('showSpecialRules') || localStorage.getItem('user_show_special_rules');
		if (storedSpecialRules) {
			showSpecialRules = storedSpecialRules === 'true' || storedSpecialRules === '1';
			console.log("[Builder] Loaded showSpecialRules from localStorage:", showSpecialRules);
		}
		
		// OTHER SETTINGS
		const storedDarkMode = localStorage.getItem('darkMode');
		if (storedDarkMode) {
			darkMode = storedDarkMode === 'true';
		}
		
		const storedHasRules = localStorage.getItem('hasRules');
		if (storedHasRules) {
			hasRules = storedHasRules === 'true';
		}
	}
	
	// Load settings from Firebase
	async function loadFromFirebase() {
		if (!$user) return;
		
		console.log("[Builder] Loading settings from Firebase");
		
		try {
			const { success, settings } = await getUserSettings();
			
			if (success && settings) {
				console.log("[Builder] Got settings from Firebase:", settings);
				
				// Apply Firebase settings, prioritizing printStyle
				if (settings.printStyle) {
					printStyle = settings.printStyle;
					console.log("[Builder] Set printStyle from Firebase:", printStyle);
					
					// Also update localStorage for consistency
					if (typeof localStorage !== 'undefined') {
						localStorage.setItem('printStyle', printStyle);
					}
				}
				
				// Apply other settings if they exist
				if (settings.showEquipmentDescriptions !== undefined) {
					showEquipmentDescriptions = settings.showEquipmentDescriptions;
				}
				
				if (settings.showPerkDescriptions !== undefined) {
					showPerkDescriptions = settings.showPerkDescriptions;
				}
				
				if (settings.showSpecialRules !== undefined) {
					showSpecialRules = settings.showSpecialRules;
				}
				
				// Other common settings
				if (settings.darkMode !== undefined) darkMode = settings.darkMode;
				if (settings.hasRules !== undefined) hasRules = settings.hasRules;
				if (settings.includeAdvanced !== undefined) includeAdvanced = settings.includeAdvanced;
				if (settings.enableSponsorships !== undefined) enableSponsorships = settings.enableSponsorships;
				
				console.log("[Builder] Applied settings from Firebase");
			} else {
				console.log("[Builder] No settings found in Firebase");
			}
		} catch (error) {
			console.error("[Builder] Error loading from Firebase:", error);
		}
	}
	
	// Initialize settings on page load
	async function initializeSettings() {
		console.log("[Builder] Initializing settings");
		
		// First load from localStorage
		loadFromLocalStorage();
		
		// Then try Firebase if logged in
		if ($user) {
			await loadFromFirebase();
		}
		
		// Apply defaults if necessary
		if (!printStyle) printStyle = 'classic';
		
		console.log("[Builder] Settings initialized:", {
			printStyle,
			showEquipmentDescriptions,
			showPerkDescriptions,
			showSpecialRules
		});
	}

</script>

<svelte:head>
	<title>Gaslands Garage - Team Builder</title>
	<script>
		// Ensure modals have proper background in dark mode
		document.addEventListener('DOMContentLoaded', function() {
			function fixModalBackgrounds() {
				const isDarkMode = document.documentElement.classList.contains('dark-mode') ||
                                     document.documentElement.classList.contains('dark');
				const modals = document.querySelectorAll('.bg-white.dark\\:bg-gray-800, .settings-modal-content');
				modals.forEach(modal => {
					if (isDarkMode) {
						modal.style.backgroundColor = '#1f2937';
					} else {
						modal.style.backgroundColor = 'white';
					}
				});
			}
			
			// Run immediately and when dark mode changes
			fixModalBackgrounds();
			
			// Create a mutation observer to watch for dark mode class changes
			const observer = new MutationObserver(mutations => {
				mutations.forEach(mutation => {
					if (mutation.attributeName === 'class') {
						fixModalBackgrounds();
					}
				});
			});
			
			// Start observing
			observer.observe(document.documentElement, { attributes: true });
		});
	</script>
</svelte:head>

<!-- Menu removed - now in layout.svelte -->

<style>
/* Menu styles removed - now in layout.svelte */

/* Removed unused selector: no-card-padding */

/* Tooltip styles removed */

/* Vehicle type icon styles removed */

/* Weight class indicators removed */

/* Interactive dashboard styles removed */

/* Print styles have been moved to a separate file */
</style>

<section id="builder-ui" class="p-2 sm:p-4 md:p-6 bg-stone-100 min-h-screen w-full {darkMode ? 'dark' : ''}">
    <!-- Debug controls - Only visible in experimental mode -->
    {#if showExperimentalFeatures}
      <div class="fixed bottom-4 right-4 z-50 bg-gray-800 p-2 rounded-lg shadow-lg text-white text-xs">
        <div class="font-bold mb-1">Debug Controls</div>
        <div class="flex flex-col gap-1">
          <button
            class="bg-purple-600 hover:bg-purple-800 px-2 py-1 rounded"
            on:click={() => {
              console.log('Import Modal Debug Button clicked');
              showImportModal = true;
            }}
          >
            Show Import Modal
          </button>
          <button
            class="bg-blue-600 hover:bg-blue-800 px-2 py-1 rounded"
            on:click={() => {
              console.log('QR Modal Debug Button clicked');
              showQRModal = true;
            }}
          >
            Show QR Modal
          </button>
        </div>
      </div>
    {/if}
	<header class="mb-3 md:mb-4">
		<div class="text-3xl md:text-4xl font-extrabold text-stone-800 dark:text-gray-100 tracking-tight flex flex-wrap justify-between items-center">
			<div class="flex flex-col gap-2 w-full">
				<div class="flex items-center gap-4 w-full">
					<b class="text-base font-bold whitespace-nowrap" style="min-width: 95px;">Rules:</b>
					<select
						id="rules-version"
						class="form-select h-[32px] flex items-center"
						style="height: 32px !important; min-height: 32px !important; max-height: 32px !important;"
						value={rulesVersion}
						on:change={(e) => changeRulesVersion(Number(e.currentTarget.value))}
						aria-label="Rules version"
					>
						<option value={2}>Version 2 — Refuelled</option>
						<option value={3}>Version 3</option>
					</select>
				</div>
				<div class="flex items-center justify-between w-full gap-4">
					<div class="flex items-center gap-4">
						<b class="text-base font-bold whitespace-nowrap" style="min-width: 50px;">Name:</b>
						<input
							type="text"
							bind:value={teamName}
							class="bg-transparent border-2 border-amber-500 rounded-lg px-3 py-0.25 font-bold text-amber-700 dark:text-white focus:outline-none focus:border-amber-600 min-w-[127px] w-auto max-w-[150px] text-base dark-text-input"
							style="height: 32px !important; min-height: 32px !important; max-height: 32px !important;"
							aria-label="Team Name"
						/>
					</div>
					<!-- Edit/Play Mode Toggle Button -->
					<button
						class="py-2 px-4 w-32 flex items-center justify-center rounded-md transition-colors amber-button"
						on:click={togglePlayMode}
					>
						<span class="w-3 h-3 rounded-full {playMode ? 'bg-green-500' : 'bg-amber-500'} transition-colors mr-2"></span>
						<span class="text-sm font-medium">{playMode ? 'Edit Team' : 'Play Mode'}</span>
					</button>
				</div>
				<div class="flex items-center justify-between w-full gap-4">
					<div class="flex items-center gap-4">
						<b class="text-base font-bold whitespace-nowrap">Cans: </b>
						<span class="font-extrabold text-amber-700 dark:text-amber-300 text-lg md:text-xl">{totalCans || calculateTotalCansDirectly()}</span>
						<span class="text-lg font-bold text-amber-700 dark:text-amber-300">/</span>
						<input
							type="number"
							bind:value={maxCans}
							min="1"
							max="1000"
							class="bg-transparent border-2 border-amber-500 rounded-lg px-3 py-0.25 font-bold text-amber-700 dark:text-white focus:outline-none focus:border-amber-600 min-w-[80px] w-auto text-base dark-text-input"
							style="height: 32px !important; min-height: 32px !important; max-height: 32px !important;"
							aria-label="Maximum Cans"
						/>
					</div>
					<!-- Quick Save Button -->
					<button
						class="py-2 px-4 w-32 flex items-center justify-center rounded-md transition-colors amber-button"
						on:click={quickSaveTeam}
						disabled={quickSaving}
					>
						{#if quickSaving}
							<div class="animate-spin mr-2 h-3 w-3 border-b-2 border-white rounded-full"></div>
							<span class="text-sm font-medium">Saving...</span>
						{:else}
							<span class="text-sm font-medium">Quick Save</span>
						{/if}
					</button>
				</div>

				{#if enableSponsorships || rulesVersion === 3}
				<div class="flex flex-col w-full mt-1">
					<div class="flex items-center gap-4">
						<b class="text-base font-bold whitespace-nowrap flex items-center" style="min-width: 95px;">Sponsor:</b>
						<div class="relative flex-grow">
							<select
								id="sponsor-select"
								on:change={(e) => {
									// Use our manual sponsor change handler to prevent infinite loops
									handleSponsorChange(e.target.value);
								}}
								value={sponsorId}
								class="form-select h-[32px] flex items-center"
								style="height: 32px !important; min-height: 32px !important; max-height: 32px !important;"
							>
								{#each [...sponsors].sort((a, b) => {
									// Always put "No Sponsor" first
									if (a.id === 'no_sponsor') return -1;
									if (b.id === 'no_sponsor') return 1;
									// Then sort alphabetically
									return a.name.localeCompare(b.name);
								}) as s}
									<option value={s.id}>{s.name}</option>
								{/each}
							</select>
						</div>
						
						{#if vehicles.length > 0}
						{/if}
					</div>

					{#if rulesVersion === 3 && currentSponsor && currentSponsor.id !== 'no_sponsor'}
						{@const note = currentSponsor as { requirement?: string; perkName?: string; perkText?: string }}
						<div class="text-sm text-stone-700 dark:text-gray-300 text-left mt-1 space-y-1">
							<p><span class="font-medium">Requirement:</span> {note.requirement}</p>
							{#if note.perkName}
								<p><span class="font-medium">{note.perkName}:</span> {note.perkText}</p>
							{/if}
						</div>
					{/if}

					{#if rulesVersion !== 3 && classPerksList.length > 0}
						<div class="text-sm text-stone-700 dark:text-gray-300 text-left mt-1">
							<div class="flex flex-wrap items-center gap-2">
								<span class="font-medium mr-2">Available Perks:</span>
								{#each classPerksList as perk}
									<Tooltip
										text={perk.name}
										content="{perk.name}{perk.cost ? ` (${perk.cost} cans)` : ''}: {perk.text}"
									/>
								{/each}
							</div>
						</div>
					{/if}

					{#if sponsorPerksList.length > 0}
						<div class="text-sm text-stone-700 dark:text-gray-300 text-left mt-2">
							<div class="flex flex-wrap items-center gap-2">
								<span class="font-medium mr-2">Sponsor Perks:</span>
								{#each sponsorPerksList as perk}
									<Tooltip
										text={perk.name}
										content="{perk.name}{perk.cost ? ` (${perk.cost} cans)` : ''}: {perk.text}"
									/>
								{/each}
							</div>
						</div>
					{/if}
				</div>
				{/if}
			</div>
		</div>
	</header>

	<!-- Info message when sponsorships are disabled -->
	{#if !enableSponsorships && rulesVersion !== 3}
		<div class="bg-blue-50 p-5 rounded-lg shadow-md mb-6">
			<div class="flex items-start">
				<div class="flex-shrink-0">
					<svg class="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
						<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path>
					</svg>
				</div>
				<div class="ml-3">
					<h3 class="text-lg font-medium text-blue-800">Sponsorships Disabled</h3>
					<div class="mt-2 text-sm text-blue-700">
						<p>You are building a team without a sponsor. Sponsorship perks are unavailable.
						Enable sponsorships in Settings to access sponsor-specific perks and abilities.</p>
					</div>
					<div class="mt-3">
						<button
							type="button"
							class="text-sm text-blue-600 hover:text-blue-800 font-medium underline"
							on:click={openSettings}
						>
							Open Settings
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}
	<!-- Vehicle list - Current count: {vehicles.length} -->
	<div class="mb-3">
		<div class="flex items-center justify-between mb-2">
			<div class="flex items-center gap-4">
				<h2 class="text-2xl font-bold text-stone-800 dark:text-gray-100">Vehicles</h2>
				{#if rulesVersion === 3}
					<p class="text-sm text-stone-600 dark:text-gray-300">
						{countedVehicles}/{vehicleAllowance} toward the limit
						<span class="text-stone-500">(first bike is free, 3 max)</span>
					</p>
				{/if}
			</div>
			<button
				class="py-2 px-4 w-32 flex items-center justify-center rounded-md transition-colors amber-button"
				on:click={() => addVehicle()}
				disabled={playMode}
				class:opacity-50={playMode}
				class:cursor-not-allowed={playMode}
			>
				<span class="text-sm font-medium">+ Add Vehicle</span>
			</button>
		</div>

		{#if vehicles.length === 0}
			<div class="bg-white dark:bg-gray-800 rounded-lg shadow-md text-center">
				<p class="text-stone-600 dark:text-gray-300 text-lg font-bold py-4 px-8">Your team has no vehicles yet. Get started by adding a vehicle to your team.</p>
			</div>

			<!-- About Gaslands Content when no vehicles -->
			<div class="mt-3 bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
				<div class="flex justify-between items-center mb-6">
					<h3 class="text-xl font-bold text-stone-800 dark:text-white">Gaslands: The Post Apocalyptic Car Combat Game</h3>
				</div>

				<div class="space-y-6 text-stone-700 dark:text-gray-200">
					<h4 class="font-bold text-stone-800 dark:text-white text-lg mb-3">What You Need to Start Playing:</h4>
					<ul class="list-disc pl-5 space-y-2">
						<li><a href="https://amzn.to/4m7OQYa" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline">Rulebook</a> - The Gaslands Refuelled rulebook contains all the rules and scenarios.  <b>You must purchase the rulebook to use this website.</b>  It is available in printed and electronic formats.</li>
						<li><a href="https://creatoriq.cc/434pUIp" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline">Gaslands Dice</a> - Special dice designed for the game.</li>
						<li><a href="https://amzn.to/4kaUcA2" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline">Regular 6-Sided Dice</a> - For resolving various game mechanics.</li>
						<li><a href="https://creatoriq.cc/3GR0qqD" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline">Gaslands Templates</a> - Movement templates for driving your vehicles.</li>
						<li><a href="https://creatoriq.cc/3GR0qqD" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline">Vehicles</a> - Hotwheels or Matchbox cars that you can modify.</li>
					</ul>

					<h4 class="font-bold text-stone-800 dark:text-white text-lg mb-3">Recommended Resources:</h4>
					<div class="bg-stone-100 dark:bg-gray-700 p-4 rounded-lg">
						<div class="flex items-center gap-3 mb-2">
							<div class="w-full">
								<div class="flex justify-center">
									<iframe width="560" height="315" src="https://www.youtube.com/embed/CL66NMhWwHo?si=KltcYCh9RbCqU2HQ" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-10">
				{#each vehicles as vehicle (vehicle.id)}
					<VehicleCard
						{vehicle}
						vehicleTypes={sortedVehicleTypes}
						{weapons}
						{upgrades}
						{perks}
						{vehicleRules}
						{currentSponsor}
						collapsed={collapsedVehicles.has(vehicle.id)}
						{playMode}
						{validation}
						{showTeamSummary}
						{showGaslandsMath}
						{totalCans}
						{maxCans}
						{rulesVersion}
						{drivers}
						{perkClasses}
						filteredWeapons={rulesVersion === 3 ? weaponsFor(vehicle) : filteredWeapons}
						filteredUpgrades={rulesVersion === 3 ? upgradesFor(vehicle) : filteredUpgrades}
						filteredTrailerUpgrades={filteredTrailerUpgrades}
						filteredPerks={rulesVersion === 3 ? perksFor(vehicle) : availablePerks}
						on:patch={(e) => patchVehicle(e.detail.vehicleId, e.detail.patch)}
						on:remove={e => removeVehicle(e.detail.id)}
						on:clone={e => cloneVehicle(e.detail.id)}
						on:toggleCollapse={e => toggleVehicleCollapse(e.detail.id)}
						on:addWeapon={e => addWeapon(e.detail.vehicleId, e.detail.weaponId, e.detail.facing)}
						on:removeWeapon={e => removeWeapon(e.detail.vehicleId, e.detail.weaponIndex)}
						on:addUpgrade={e => addUpgrade(e.detail.vehicleId, e.detail.upgradeId)}
						on:removeUpgrade={e => removeUpgrade(e.detail.vehicleId, e.detail.upgradeIndex)}
						on:addPerk={e => addPerk(e.detail.vehicleId, e.detail.perkId)}
						on:removePerk={e => removePerk(e.detail.vehicleId, e.detail.perkIndex)}
						on:incrementHazard={e => incrementHazard(e.detail.vehicleId)}
						on:decrementHazard={e => decrementHazard(e.detail.vehicleId)}
						on:vehicleTypeChanged={e => handleVehicleTypeChange(e.detail.id, e.detail.vehicleType)}
					/>
				{/each}
			</div>
		{/if}
	</div>

	<hr>

<!-- Totals / legality -->
{#if showTeamSummary && vehicles.length > 0}
<div class="bg-white p-5 rounded-lg shadow-md mb-6">
	<div class="flex items-center justify-between mb-4">
		<div>
			<h2 class="text-xl font-bold text-stone-800">{teamName}</h2>
			<p class="text-sm text-stone-600">Team Summary</p>
		</div>
		<div class="text-lg font-bold">
			<span class="text-stone-600">Total:</span>
			<span class="text-amber-600 ml-1">{totalCans}/{maxCans} cans</span>
		</div>
	</div>

	<!-- Sponsor info (when enabled) -->
	{#if enableSponsorships && sponsorId}
		<div class="mb-4 bg-stone-100 p-3 rounded">
			<div class="flex flex-col text-left">
				<div class="flex items-center">
					<span class="font-medium text-stone-800">Sponsor:</span>
					<span class="font-bold text-amber-700 ml-2">{currentSponsor?.name || 'None'}</span>
				</div>

				{#if (currentSponsor?.perksClasses?.length) && classPerksList.length > 0}
					<div class="mt-2">
						<div>
							<span class="font-medium text-stone-800">Perks:</span>
						</div>
						<div class="text-stone-700 flex flex-wrap mt-1 gap-2">
							{#each classPerksList as perk, i}
								<Tooltip
									text="{perk.name}"
									content="{perk.name}{perk.cost ? ` (${perk.cost} cans)` : ''}: {perk.text}"
								/>
							{/each}
						</div>
					</div>
				{/if}

				{#if sponsorPerksList.length > 0}
					<div class="mt-3">
						<div>
							<span class="font-medium text-stone-800">Sponsor Perks:</span>
						</div>
						<div class="text-stone-700 flex flex-wrap mt-1 gap-2">
							{#each sponsorPerksList as perk, i}
								<Tooltip
									text="{perk.name}"
									content="{perk.name}{perk.cost ? ` (${perk.cost} cans)` : ''}: {perk.text}"
								/>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if teamErrors.length === 0}
		<div class="flex items-center bg-green-50 text-green-800 p-4 rounded-lg">
			<span class="mr-2 text-green-500">✓</span>
			<span class="font-medium">Your team is legal and ready to race!</span>
		</div>
	{:else}
		<div class="bg-red-50 text-red-800 p-4 rounded-lg">
			<div class="flex items-center mb-2">
				<span class="mr-2 text-red-500">!</span>
				<span class="font-medium">Your team has issues that need fixing:</span>
			</div>
			<ul class="list-disc ml-12 space-y-1">
				{#each teamErrors as err}
					<li>{err}</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
{/if}
<!-- Gaslands Coach -->
{#if showGaslandsMath && vehicles.length > 0}
    <Coach 
        {vehicles}
        {vehicleTypes}
        {weapons}
        {upgrades}
        {perks}
        {vehicleRules}
        currentSponsor={currentSponsor}
        {totalCans}
        {maxCans}
    />
{/if}

<!-- QR Modal -->
    {#if qrDataUrl && showQRModal}
      <div
        class="fixed inset-0 bg-black/90 z-50"
        role="dialog"
        aria-modal="true"
        aria-label="QR Code"
        tabindex="-1"
      >
        <!-- Adding a button to make the whole backdrop clickable/accessible -->
        <button
          class="absolute inset-0 w-full h-full border-0 bg-transparent cursor-pointer"
          on:click={() => { showQRModal = false; }}
          on:keydown={e => e.key === 'Escape' && (showQRModal = false)}
          aria-label="Close modal background"
        ></button>
        <div
          class="bg-white dark:bg-gray-800 rounded-xl shadow-[0_0_25px_rgba(0,0,0,0.3)] p-10 border-2 border-amber-500 z-10 fixed left-1/2 top-1/2 w-auto max-w-md overflow-y-auto transform -translate-x-1/2 -translate-y-1/2 max-h-[90vh]"
          role="document"
          style="box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 0 0 4px rgba(245,158,11,0.4), 0 10px 25px -5px rgba(0,0,0,0.4); background-color: white;"
          data-modal-content
        >
          <div class="flex justify-between items-center mb-6">
            <h3 class="text-lg font-bold text-stone-800 dark:text-white">Team QR Code</h3>
            <button
              class="py-0.25 px-2 h-[32px] flex items-center justify-center rounded transition-colors text-sm amber-button"
              on:click={() => { showQRModal = false; }}
              aria-label="Close QR code modal"
              style="height: 32px !important; min-height: 32px !important;"
            >
              <span>Close</span>
            </button>
          </div>
          <div class="bg-white dark:bg-gray-700 p-6 rounded-lg border-2 border-stone-200 dark:border-gray-600">
            <img src={qrDataUrl} alt="team QR code" class="mx-auto w-64 h-64" />
          </div>
          <p class="mt-6 text-center text-stone-600 dark:text-amber-300 text-sm font-medium">
            Scan this QR code to share your team build
          </p>
          <div class="flex justify-end gap-4 mt-8 pt-4 border-t border-stone-200 dark:border-amber-900">
            <button
              class="py-0.25 px-6 h-[32px] flex items-center justify-center rounded-lg transition-colors text-sm amber-button shadow-md"
              style="height: 32px !important; min-height: 32px !important;"
              on:click={() => (qrDataUrl = null)}
            >
              Close
            </button>
            <button
              class="py-0.25 px-6 h-[32px] flex items-center justify-center rounded-lg transition-colors text-sm shadow-md"
              style="height: 32px !important; min-height: 32px !important; background-color: #2563eb !important; color: white !important;"
              on:click={() => {
                // Give the QR code another moment to ensure it's fully rendered
                setTimeout(() => window.print(), 100);
              }}
            >
              Print
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Import Modal -->
    {#if showImportModal}
      <div
        class="fixed inset-0 bg-black/90 z-50"
        role="dialog"
        aria-modal="true"
        aria-label="Import Build"
        tabindex="-1"
      >
        <!-- Adding a button to make the whole backdrop clickable/accessible -->
        <button
          class="absolute inset-0 w-full h-full border-0 bg-transparent cursor-pointer"
          on:click={() => (showImportModal = false)}
          on:keydown={e => e.key === 'Escape' && (showImportModal = false)}
          aria-label="Close modal background"
        ></button>
        <div
          class="bg-white dark:bg-gray-800 rounded-xl shadow-[0_0_25px_rgba(0,0,0,0.3)] p-6 md:p-8 w-11/12 sm:w-4/5 md:w-2/5 lg:w-1/3 mx-auto relative z-10 border-2 border-amber-500"
          role="document"
          style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); max-height: 90vh; overflow-y: auto; box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 0 0 4px rgba(245,158,11,0.4), 0 10px 25px -5px rgba(0,0,0,0.4); background-color: white;"
          data-modal-content
        >
          <div class="flex justify-between items-center mb-6">
            <h3 class="text-lg font-bold text-stone-800 dark:text-white">Import Team Build</h3>
            <button
              class="py-0.25 px-2 h-[32px] flex items-center justify-center rounded transition-colors text-sm amber-button"
              on:click={() => (showImportModal = false)}
              aria-label="Close import modal"
              style="height: 32px !important; min-height: 32px !important;"
            >
              <span>Close</span>
            </button>
          </div>
          
          <div class="space-y-6">
            <p class="text-stone-600 dark:text-gray-200">
              Paste a team build code below to import a shared build
            </p>
            <div class="space-y-3">
              <label for="import-draft" class="sr-only">Import team build code</label>
              <textarea
                id="import-draft"
                bind:value={importString}
                class="w-full px-4 py-3 border-2 border-stone-300 dark:border-gray-600 rounded-lg focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[120px] bg-white dark:bg-gray-700 text-stone-800 dark:text-white"
                placeholder="Paste encoded draft here"
              ></textarea>
            </div>
            <div class="flex justify-end gap-4 mt-8 pt-4 border-t border-stone-200 dark:border-amber-900">
              <button
                class="px-6 py-2 rounded-lg bg-stone-300 hover:bg-stone-400 text-stone-700 dark:bg-gray-600 dark:hover:bg-gray-700 dark:text-white font-medium transition-colors shadow-md"
                on:click={() => (showImportModal = false)}
              >
                Cancel
              </button>
              <button
                class="py-0.25 px-6 h-[32px] flex items-center justify-center rounded-lg transition-colors text-sm amber-button shadow-md"
                style="height: 32px !important; min-height: 32px !important;"
                on:click={importDraftString}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      </div>
    {/if}
    
    <!-- Settings Modal -->
    <SettingsMenu 
      bind:showSettingsModal={showSettingsModal}
      bind:activeSettingsTab={activeSettingsTab}
      bind:hasRules
      bind:enableSponsorships
      bind:includeAdvanced
      bind:darkMode
      bind:showTeamSummary
      bind:showGaslandsMath
      bind:printStyle
      bind:showEquipmentDescriptions
      bind:showPerkDescriptions
      bind:showSpecialRules
      bind:showExperimentalFeatures
      bind:showOnPlayersMap
      bind:allowContactFromPlayers
      bind:location
      bind:receiveUpdates
      saveSettingsToFirebase={saveSettingsToFirebase}
    />
    


</section>

{#if showRulesAcknowledgmentModal}
  <div
    class="fixed inset-0 bg-black/90 z-50"
    role="dialog"
    aria-modal="true"
    aria-label="Gaslands Rules Acknowledgment"
    tabindex="-1"
  >
    <button
      class="absolute inset-0 w-full h-full border-0 bg-transparent cursor-pointer"
      on:click={() => (showRulesAcknowledgmentModal = false)}
      on:keydown={e => e.key === 'Escape' && (showRulesAcknowledgmentModal = false)}
      aria-label="Close modal background"
    ></button>
    <div
      class="bg-white dark:bg-gray-800 rounded-xl shadow-[0_0_25px_rgba(0,0,0,0.3)] p-6 md:p-8 w-11/12 sm:w-4/5 md:w-2/5 lg:w-1/3 mx-auto relative z-10 border-2 border-amber-500"
      role="document"
      style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); max-height: 90vh; overflow-y: auto; box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 0 0 4px rgba(245,158,11,0.4), 0 10px 25px -5px rgba(0,0,0,0.4);"
    >
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-bold text-stone-800 dark:text-white">Gaslands Rules Required</h3>
        <button
          class="py-0.25 px-2 h-[32px] flex items-center justify-center rounded transition-colors text-sm amber-button"
          on:click={() => (showRulesAcknowledgmentModal = false)}
          aria-label="Close rules acknowledgment modal"
          style="height: 32px !important; min-height: 32px !important;"
        >
          <span>Close</span>
        </button>
      </div>

      <div class="space-y-4">
        <div class="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30">
          <p class="text-stone-800 dark:text-white mb-4">
            To use the Play Mode or Print features of Gaslands Garage, you need to acknowledge that you own a copy of the <strong>Gaslands Refuelled</strong> rulebook.
          </p>

          <p class="text-stone-700 dark:text-gray-300 mb-4">
            This app is a companion to the tabletop game and is designed to be used alongside the official rules, not as a replacement.
          </p>

          <div class="flex items-center mb-4">
            <input
              type="checkbox"
              id="rules-acknowledgment"
              bind:checked={hasRules}
              class="w-5 h-5 text-amber-600 bg-stone-100 dark:bg-gray-700 border-stone-300 dark:border-gray-600 rounded focus:ring-amber-500"
            />
            <label for="rules-acknowledgment" class="ml-3 text-stone-800 dark:text-white font-medium">
              I confirm that I own the Gaslands Refuelled rulebook
            </label>
          </div>

          <p class="text-stone-600 dark:text-gray-400 text-sm italic">
            You can purchase the rulebook from <a href="https://ospreypublishing.com/uk/gaslands-refuelled-9781472838445/" target="_blank" rel="noopener noreferrer" class="text-amber-600 dark:text-amber-400 hover:underline">Osprey Publishing</a> or other game retailers.
          </p>
        </div>

        {#if !$user}
          <div class="p-4 rounded-lg bg-stone-100 dark:bg-gray-700">
            <h4 class="font-medium text-stone-800 dark:text-white mb-2">Save your preferences</h4>
            <p class="text-stone-700 dark:text-gray-300 mb-3">
              Log in to save this preference so you won't be asked again.
            </p>

            <div class="flex justify-end space-x-3">
              <button
                class="py-2 px-4 text-white rounded transition-colors flex items-center"
                style="background-color: #4285F4; font-family: 'Roboto', sans-serif;"
                on:click={async () => {
                  try {
                    const result = await signInWithGoogle();
                    if (result.success) {
                      showRulesAcknowledgmentModal = false;
                    } else {
                      console.error("Login failed:", result.error);
                      alert("Failed to sign in with Google. Please try again.");
                    }
                  } catch (error) {
                    console.error("Sign in error:", error);
                    alert("An error occurred during sign in. Please try again.");
                  }
                }}
              >
                <span class="flex items-center justify-center bg-white rounded p-1 mr-2">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" class="h-4 w-4">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  </svg>
                </span>
                Sign in with Google
              </button>
              
              <button
                class="py-2 px-4 bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors"
                on:click={() => {
                  showRulesAcknowledgmentModal = false;
                  if (rulesModalAction === 'playMode' && hasRules) {
                    playMode = !playMode;
                  }
                  else if (rulesModalAction === 'printTeam' && hasRules) {
                    // Use the same wrapper function as used elsewhere
                    console.log('[Rules Modal] Printing after acknowledgment');
                    // Just set the flag - printWithRulesCheck will handle checking
                    isPrinting = false;
                    printWithRulesCheck();
                  }
                  else if (rulesModalAction === 'printDashboard' && hasRules) {
                    console.log('[Rules Modal] Dashboard printing after acknowledgment');
                    printDashboardDirect();
                  }
                }}
              >
                Continue without logging in
              </button>
            </div>
          </div>
        {:else}
          <div class="flex justify-end">
            <button
              class="py-2 px-4 bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors"
              on:click={() => {
                saveSettingsToFirebase();
                showRulesAcknowledgmentModal = false;
                if (rulesModalAction === 'playMode' && hasRules) {
                  playMode = !playMode;
                }
                else if (rulesModalAction === 'printTeam' && hasRules) {
                  // Use the same wrapper function as used elsewhere
                  console.log('[Rules Modal] Printing after saving acknowledgment');
                  // Just set the flag - printWithRulesCheck will handle checking
                  isPrinting = false;
                  printWithRulesCheck();
                }
              }}
            >
              Save & Continue
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- No print view needed - using standalone print system -->
<!-- Hidden QR code for new print system to use -->
<img id="print-qr-code" src="" alt="QR Code" style="display: none;" />