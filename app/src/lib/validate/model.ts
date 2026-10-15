// app/src/lib/validate/model.ts
import type { RulesVersion } from '$lib/rules/version';

export type SponsorID = string;
export type VehicleID = string;

export interface DraftVehicle {
  id: VehicleID;
  type: string;
  weapons: string[];
  weaponFacings?: Record<string, string>;  // Maps weaponId to facing
  upgrades?: string[];  // Optional for backward compatibility
  perks: string[];
  name: string;
  /** 3rd Edition driver archetype id. Free, and unique on the team. */
  driverArchetype?: string;
  /** A non-empty name unlocks a second perk class. */
  driverName?: string;
  secondPerkClass?: string;
  /** Shooting weapon the turret mount is fitted to. */
  turretWeaponId?: string;
  upgradeFacings?: Record<string, string>;
}

export interface Draft {
  sponsor: SponsorID;
  vehicles: DraftVehicle[];
  teamName?: string;   // Optional for backward compatibility
  maxCans?: number;    // Optional for backward compatibility
  darkMode?: boolean;  // Optional dark mode setting
  /** Missing means Refuelled (version 2). */
  rulesVersion?: RulesVersion;
  weaponAndUpgradeSpecialRules?: {  // Special rules for weapons and upgrades
    id: string;
    ruleName: string;
    rule: string;
  }[];
}

export interface VehicleReport {
  vehicleId: VehicleID;
  cans: number;
  errors: string[];
}

export interface Validation {
  cans: number;
  errors: string[];
  vehicleReports: VehicleReport[];
}

export interface Team {
  sponsor: import('$lib/rules/types').Sponsor;
  vehicles: {
    instance: Draft['vehicles'][0];
    class: import('$lib/rules/types').Vehicle;
    weapons: import('$lib/rules/types').Weapon[];
    upgrades: import('$lib/rules/types').Upgrade[];
    perks: import('$lib/rules/types').Perk[];
  }[];
}

