// app/src/lib/validate/calc.ts
export function sum(nums: number[]) {
  return nums.reduce((s, n) => s + n, 0);
}

import type { Vehicle, Weapon, Upgrade } from '$lib/rules/types';

export function vehicleBaseCost(v: Vehicle) {
  return v.baseCost;
}

export function weaponCost(w: Weapon) {
  return w.cost;
}

export function upgradeCost(u: Upgrade) {
  return u.cost;
}

/**
 * Cans charged for a perk.
 * Rules data stores the price on `cost`. Older drafts and tests used `level`
 * as a stand-in, so that remains a fallback. A missing price is free (0),
 * including an explicit cost of 0 for sponsor perks.
 */
export function perkCost(p: { cost?: number; level?: number } | null | undefined) {
  if (!p) return 0;
  if (typeof p.cost === 'number') return p.cost;
  if (typeof p.level === 'number') return p.level;
  return 0;
}
