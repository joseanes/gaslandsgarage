// runs in browser *and* during dev SSR
import { loadSponsors, loadVehicles, loadWeapons, loadUpgrades, loadPerks, loadVehicleRules } from '$lib/rules/loadRules';
import { loadV3Catalog } from '../../data/rules/v3';

export const prerender = false;   // keep SPA behaviour

export async function load() {
  return {
    sponsors: await loadSponsors(),
    vehicleTypes: await loadVehicles(),
    weapons: await loadWeapons(),
    upgrades: await loadUpgrades(),
    perks: await loadPerks(),
    vehicleRules: await loadVehicleRules(),
    v3: loadV3Catalog()
  };
}

