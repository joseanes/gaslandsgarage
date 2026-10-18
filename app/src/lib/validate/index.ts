// app/src/lib/validate/index.ts
import type { Draft, Team, VehicleReport, Validation } from './model';
import { normalizeRulesVersion } from '$lib/rules/version';
import { validateDraftV3 } from './v3';
import { runAllChecks } from './checks';
import {
  loadSponsors,
  loadVehicles,
  loadWeapons,
  loadUpgrades,
  loadPerks
} from '$lib/rules/loadRules';
import {
  vehicleBaseCost,
  weaponCost,
  upgradeCost,
  perkCost
} from './calc';

const DEFAULT_TEAM_CAP = 50;

// Cached rule data to avoid repeated loading
// Use explicit initialization to avoid test environment issues
let cachedSponsors: any[] | null = null;
let cachedVehicles: any[] | null = null;
let cachedWeapons: any[] | null = null;
let cachedUpgrades: any[] | null = null;
let cachedPerks: any[] | null = null;

// For testing - allows cache to be reset (not currently needed with new test approach)
export function resetCache() {
  cachedSponsors = null;
  cachedVehicles = null;
  cachedWeapons = null;
  cachedUpgrades = null;
  cachedPerks = null;
}

export async function validateDraft(draft: Draft): Promise<Validation> {
  if (normalizeRulesVersion(draft.rulesVersion) === 3) {
    return validateDraftV3(draft);
  }

  // Use custom maxCans if provided, otherwise use default
  const TEAM_CAP = draft.maxCans || DEFAULT_TEAM_CAP;
  
  /* 1 — load all rule data */
  // Use cached data if available to prevent repeated loading
  if (!cachedSponsors || !cachedVehicles || !cachedWeapons || !cachedUpgrades || !cachedPerks) {
    [cachedSponsors, cachedVehicles, cachedWeapons, cachedUpgrades, cachedPerks] = await Promise.all([
      loadSponsors(),
      loadVehicles(),
      loadWeapons(),
      loadUpgrades(),
      loadPerks()
    ]);
  }
  
  // Use cached data
  const sponsors = cachedSponsors;
  const vehicles = cachedVehicles;
  const weapons = cachedWeapons;
  const upgrades = cachedUpgrades;
  const perks = cachedPerks;

  /* 2 — look-up chosen sponsor BEFORE constructing team */
  const sponsor = sponsors.find((s) => s.id === draft.sponsor);
  if (!sponsor) {
    return { cans: 0, errors: ['Unknown sponsor'], vehicleReports: [] };
  }

  /* 3 — hydrate team */
  const team: Team = {
    sponsor,
    vehicles: draft.vehicles
      .filter(v => {
        const vehicleType = vehicles.find(vc => vc.id === v.type);
        return !!vehicleType; // Filter out any vehicles with unknown types
      })
      .map((v) => {
        const vehicleClass = vehicles.find(vc => vc.id === v.type);
        if (!vehicleClass) {
          // This should never happen due to the filter above, but it's a safety check
          throw new Error(`Vehicle type ${v.type} not found`);
        }

        // Process weapons with careful error handling
        const processedWeapons = v.weapons.map(weaponInstanceId => {
          try {
            // Extract base weapon ID from instance ID (format: baseId_instanceHash)
            // For weapons with underscores in their base ID (like combat_laser_oYHC),
            // we need to identify the actual base ID without the nanoid suffix
            
            // Safer approach: Isolate the last part (which is the unique instance identifier)
            // and then check if a weapon exists with that partial ID
            const parts = weaponInstanceId.split('_');
            
            // Handle case with no underscores
            if (parts.length === 1) {
              const weaponObj = weapons.find(w => w.id === weaponInstanceId);
              if (!weaponObj) {
                console.warn(`Weapon not found: ${weaponInstanceId}`);
              }
              return weaponObj;
            }
            
            // Try increasingly longer potential base IDs until we find a match
            let baseWeaponId = null;
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

            const weaponObj = weapons.find(w => w.id === baseWeaponId);
            if (!weaponObj) {
              console.warn(`Weapon not found: ${baseWeaponId} (from ${weaponInstanceId})`);
            }
            return weaponObj;
          } catch (err) {
            console.error(`Error processing weapon ID: ${weaponInstanceId}`, err);
            return undefined;
          }
        }).filter((w): w is NonNullable<typeof w> => w !== undefined);

        return {
          instance: v,
          class: vehicleClass,
          weapons: processedWeapons,
          upgrades: (v.upgrades || [])  // Handle existing drafts without upgrades
            .map(id => upgrades.find(u => u.id === id))
            .filter((u): u is NonNullable<typeof u> => u !== undefined),
          perks: v.perks
            .map(id => perks.find(p => p.id === id))
            .filter((p): p is NonNullable<typeof p> => p !== undefined)
        };
      })
  };

  /* 4 — per-vehicle reports with cans */
  const vehicleReports: VehicleReport[] = team.vehicles.map((v) => {
    // Safety check for missing data
    if (!v.instance || !v.class) {
      return {
        vehicleId: v.instance?.id || 'unknown',
        cans: 0,
        errors: ['Invalid vehicle data']
      };
    }

    // Calculate total cans safely
    const baseCost = vehicleBaseCost(v.class);

    const weaponDetails = v.weapons.map(w => {
      if (!w) return { id: 'unknown', cost: 0 };
      const cost = weaponCost(w);
      return { id: w.id, name: w.name, cost };
    });
    const weaponsCost = weaponDetails.reduce((s, w) => s + w.cost, 0);

    const upgradeDetails = (v.upgrades || []).map(u => {
      if (!u) return { id: 'unknown', cost: 0, isTrailer: false, isTrailerUpgrade: false };
      const cost = upgradeCost(u);
      const isTrailer = u.trailer === true || u.trailer === "true";
      const isTrailerUpgrade = u.trailerUpgrade === true || u.trailerUpgrade === "true";
      return { id: u.id, name: u.name, cost, isTrailer, isTrailerUpgrade };
    });
    const upgradesCost = upgradeDetails.reduce((s, u) => s + u.cost, 0);

    // Calculate perk costs
    const perksCost = v.perks.reduce((s, p) => s + (p ? perkCost(p) : 0), 0);

    return {
      vehicleId: v.instance.id,
      cans: baseCost + weaponsCost + upgradesCost + perksCost,
      errors: []
    };
  });

  /* 5 — rule checks */
  runAllChecks(team, vehicleReports);

  /* 6 — team total + cap */
  const totalCans = vehicleReports.reduce((s, r) => s + r.cans, 0);
  const errors: string[] = [];

  if (totalCans > TEAM_CAP) {
    errors.push(`Team exceeds ${TEAM_CAP} cans (currently ${totalCans})`);
  }

  return { cans: totalCans, errors, vehicleReports };
}