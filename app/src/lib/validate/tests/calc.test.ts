import { describe, it, expect } from 'vitest';
import { sum, vehicleBaseCost, weaponCost, upgradeCost, perkCost } from '../calc';
import { mockVehicles, mockWeapons, mockUpgrades, mockPerks } from './mockData';

describe('Calculation Functions', () => {
  describe('sum', () => {
    it('should correctly sum an array of numbers', () => {
      expect(sum([1, 2, 3, 4, 5])).toBe(15);
    });

    it('should return 0 for an empty array', () => {
      expect(sum([])).toBe(0);
    });

    it('should handle negative numbers', () => {
      expect(sum([-1, 2, -3, 4])).toBe(2);
    });
  });

  describe('vehicleBaseCost', () => {
    it('should return the base cost of a vehicle', () => {
      const car = mockVehicles[0]; // Car with baseCost 10
      expect(vehicleBaseCost(car)).toBe(10);
      
      const buggy = mockVehicles[1]; // Buggy with baseCost 8
      expect(vehicleBaseCost(buggy)).toBe(8);
      
      const truck = mockVehicles[2]; // Truck with baseCost 15
      expect(vehicleBaseCost(truck)).toBe(15);
    });
  });

  describe('weaponCost', () => {
    it('should return the cost of a weapon', () => {
      const machineGun = mockWeapons[0]; // Machine Gun with cost 2
      expect(weaponCost(machineGun)).toBe(2);
      
      const rocket = mockWeapons[1]; // Rocket Launcher with cost 4
      expect(weaponCost(rocket)).toBe(4);
      
      const flamethrower = mockWeapons[2]; // Flamethrower with cost 4
      expect(weaponCost(flamethrower)).toBe(4);
    });
  });

  describe('upgradeCost', () => {
    it('should return the cost of an upgrade', () => {
      const armor = mockUpgrades[0]; // Armor with cost 2
      expect(upgradeCost(armor)).toBe(2);
      
      const nitro = mockUpgrades[1]; // Nitro with cost 3
      expect(upgradeCost(nitro)).toBe(3);
      
      const trailer = mockUpgrades[2]; // Trailer with cost 4
      expect(upgradeCost(trailer)).toBe(4);
    });
  });

  describe('perkCost', () => {
    it('should fall back to level when the rules cost field is missing', () => {
      const perk1 = mockPerks[0]; // Perk 1 with level 1
      expect(perkCost(perk1)).toBe(1);
      
      const perk2 = mockPerks[1]; // Perk 2 with level 2
      expect(perkCost(perk2)).toBe(2);
      
      const perk3 = mockPerks[2]; // Perk 3 with level 3
      expect(perkCost(perk3)).toBe(3);
    });

    it('should prefer the cost field from the rules data over level', () => {
      expect(perkCost({ ...mockPerks[0], cost: 5, level: 1 })).toBe(5);
    });

    it('should treat an explicit cost of 0 as free', () => {
      expect(perkCost({ ...mockPerks[0], cost: 0, level: 3 })).toBe(0);
    });

    it('should return 0 when cost and level are both missing', () => {
      expect(perkCost({ ...mockPerks[0], cost: undefined, level: undefined })).toBe(0);
      expect(perkCost(undefined)).toBe(0);
    });
  });
});