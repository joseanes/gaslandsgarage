// Mock data for validation tests
import type { Draft } from '../model';
import type { Sponsor, Vehicle, Weapon, Upgrade, Perk } from '$lib/rules/types';

// Mock Sponsors
export const mockSponsors: Sponsor[] = [
  {
    id: 'no_sponsor',
    name: 'No Sponsor',
    perks: ['perk1', 'perk2']
  },
  {
    id: 'rutherford',
    name: 'Rutherford',
    perks: ['perk1', 'perk3', 'perk4']
  },
  {
    id: 'miyazaki',
    name: 'Miyazaki',
    perks: ['perk2', 'perk5']
  }
];

// Mock Vehicles
export const mockVehicles: Vehicle[] = [
  {
    id: 'car',
    name: 'Car',
    baseCost: 10,
    buildSlots: 2,
    maxGear: 4,
    weight: 1,
    handling: 3,
    maxHull: 4,
    upgradeSlots: 2
  },
  {
    id: 'buggy',
    name: 'Buggy',
    baseCost: 8,
    buildSlots: 1,
    maxGear: 6,
    weight: 0,
    handling: 4,
    maxHull: 2,
    upgradeSlots: 1
  },
  {
    id: 'truck',
    name: 'Truck',
    baseCost: 15,
    buildSlots: 3,
    maxGear: 3,
    weight: 2,
    handling: 2,
    maxHull: 6,
    upgradeSlots: 3,
    sponsors: ['rutherford'] // Only available for Rutherford sponsor
  }
];

// Mock Weapons
export const mockWeapons: Weapon[] = [
  {
    id: 'machine_gun',
    name: 'Machine Gun',
    cost: 2,
    slots: 1,
    type: 'weapon',
    range: 'Medium',
    attackDice: 1,
    unique: false
  },
  {
    id: 'rocket',
    name: 'Rocket Launcher',
    cost: 4,
    slots: 2,
    type: 'weapon',
    range: 'Long',
    attackDice: 3,
    unique: true
  },
  {
    id: 'flamethrower',
    name: 'Flamethrower',
    cost: 4,
    slots: 1,
    type: 'weapon',
    range: 'Short',
    attackDice: 2,
    unique: false,
    electrical: true
  }
];

// Mock Upgrades
export const mockUpgrades: Upgrade[] = [
  {
    id: 'armor',
    name: 'Armor',
    cost: 2,
    type: 'upgrade',
    hull: 1,
    slots: 1
  },
  {
    id: 'nitro',
    name: 'Nitro Booster',
    cost: 3,
    type: 'upgrade',
    slots: 1
  },
  {
    id: 'trailer',
    name: 'Trailer',
    cost: 4,
    type: 'upgrade',
    trailer: true,
    slots: 1
  },
  {
    id: 'trailer_armor',
    name: 'Trailer Armor',
    cost: 2,
    type: 'upgrade',
    trailerUpgrade: true,
    hull: 1,
    slots: 1
  }
];

// Mock Perks
export const mockPerks: Perk[] = [
  { id: 'perk1', name: 'Perk 1', level: 1, text: 'Description for Perk 1' },
  { id: 'perk2', name: 'Perk 2', level: 2, text: 'Description for Perk 2' },
  { id: 'perk3', name: 'Perk 3', level: 3, text: 'Description for Perk 3' },
  { id: 'perk4', name: 'Perk 4', level: 1, text: 'Description for Perk 4' },
  { id: 'perk5', name: 'Perk 5', level: 2, text: 'Description for Perk 5' },
  { id: 'perk_costed', name: 'Costed Perk', cost: 4, text: 'Perk priced by the cost field' }
];

// Mock valid draft
export const mockValidDraft: Draft = {
  sponsor: 'rutherford',
  vehicles: [
    {
      id: 'vehicle1',
      type: 'car',
      name: 'Test Car',
      weapons: ['machine_gun_1'],
      upgrades: ['armor'],
      perks: ['perk1']
    }
  ],
  teamName: 'Test Team',
  maxCans: 50
};

// Mock invalid draft (exceeds maxCans limit)
export const mockInvalidCansDraft: Draft = {
  sponsor: 'rutherford',
  vehicles: [
    {
      id: 'vehicle1',
      type: 'car',
      name: 'Expensive Car',
      weapons: ['machine_gun_1', 'rocket_1', 'flamethrower_1'],
      upgrades: ['armor', 'nitro'],
      perks: ['perk1', 'perk3']
    },
    {
      id: 'vehicle2',
      type: 'truck',
      name: 'Expensive Truck',
      weapons: ['rocket_2', 'machine_gun_2'],
      upgrades: ['armor', 'nitro', 'trailer'],
      perks: ['perk1', 'perk4']
    }
  ],
  teamName: 'Expensive Team',
  maxCans: 20 // Too low for the vehicles configured
};

// Mock draft with duplicate unique weapon
export const mockDuplicateUniqueWeaponDraft: Draft = {
  sponsor: 'rutherford',
  vehicles: [
    {
      id: 'vehicle1',
      type: 'car',
      name: 'Duplicate Weapons Car',
      weapons: ['rocket_1', 'rocket_2'], // Duplicate unique weapons
      upgrades: ['armor'],
      perks: ['perk1']
    }
  ],
  teamName: 'Duplicate Team',
  maxCans: 50
};

// Mock draft with too many upgrades
export const mockTooManyUpgradesDraft: Draft = {
  sponsor: 'rutherford',
  vehicles: [
    {
      id: 'vehicle1',
      type: 'buggy',
      name: 'Upgraded Buggy',
      weapons: ['machine_gun_1'],
      upgrades: ['armor', 'nitro'], // Buggy only allows 1 upgrade
      perks: ['perk1']
    }
  ],
  teamName: 'Too Many Upgrades Team',
  maxCans: 50
};

// Mock draft with invalid perks for sponsor
export const mockInvalidPerksDraft: Draft = {
  sponsor: 'rutherford',
  vehicles: [
    {
      id: 'vehicle1',
      type: 'car',
      name: 'Invalid Perks Car',
      weapons: ['machine_gun_1'],
      upgrades: ['armor'],
      perks: ['perk5'] // perk5 belongs to Miyazaki, not Rutherford
    }
  ],
  teamName: 'Invalid Perks Team',
  maxCans: 50
};

// Mock draft with invalid vehicle type for sponsor
export const mockInvalidVehicleTypeDraft: Draft = {
  sponsor: 'miyazaki',
  vehicles: [
    {
      id: 'vehicle1',
      type: 'truck', // truck is only for Rutherford sponsor
      name: 'Invalid Vehicle Type',
      weapons: ['machine_gun_1'],
      upgrades: ['armor'],
      perks: ['perk2']
    }
  ],
  teamName: 'Invalid Vehicle Type Team',
  maxCans: 50
};