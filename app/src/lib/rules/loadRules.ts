
// app/src/lib/rules/loadRules.ts
import { Sponsor, Vehicle, Weapon, Upgrade, Perk, VehicleRule, WeaponSpecialRule } from './types';

/* ── vehicle rules ─────────────────────────────────────────── */
import vehicleRulesRaw from '../../data/rules/vehicleRules.json';
export function loadVehicleRules() {
  return VehicleRule.array().parse(vehicleRulesRaw);
}

/* ── sponsors (one file per sponsor) ───────────────────────── */
const sponsorMods = import.meta.glob('../../data/rules/sponsors/*.json', {
  eager: true
});
export function loadSponsors() {
  return Object.values(sponsorMods).map((m: any) => Sponsor.parse(m.default));
}

/* ── vehicles.json ─────────────────────────────────────────── */
import vehiclesRaw from '../../data/rules/vehicles.json';
export function loadVehicles() {
  return Vehicle.array().parse(vehiclesRaw);
}

/* ── weapons.json ──────────────────────────────────────────── */
import weaponsRaw from '../../data/rules/weapons.json';
export function loadWeapons() {
  return Weapon.array().parse(weaponsRaw);
}

/* ── upgrades.json ─────────────────────────────────────────── */
import upgradesRaw from '../../data/rules/upgrades.json';
export function loadUpgrades() {
  return Upgrade.array().parse(upgradesRaw);
}

/* ── perks.json ────────────────────────────────────────────── */
import perksRaw from '../../data/rules/perks.json';
export function loadPerks() {
  return Perk.array().parse(perksRaw);
}

/* ── weaponAndUpgradeSpecialRules.json ────────────────────────── */
import weaponSpecialRulesRaw from '../../data/rules/weaponAndUpgradeSpecialRules.json';
export function loadWeaponSpecialRules() {
  return WeaponSpecialRule.array().parse(weaponSpecialRulesRaw);
}
