/**
 * Script to validate build slots calculation in Gaslands Garage
 * 
 * This script compares the current calculateUsedBuildSlots implementation with the
 * expected behavior according to game rules. It tests various vehicle configurations
 * to ensure the slot usage calculation is accurate.
 */

const vehicleTestCases = [
    {
        name: "Empty Car",
        vehicle: { type: "car", weapons: [], upgrades: [], perks: [] },
        expectedSlots: 0
    },
    {
        name: "Car with Machine Gun (1 slot)",
        vehicle: { type: "car", weapons: ["machine_gun_123"], upgrades: [], perks: [] },
        expectedSlots: 1
    },
    {
        name: "Car with Handgun (free)",
        vehicle: { type: "car", weapons: ["handgun_123"], upgrades: [], perks: [] },
        expectedSlots: 0
    },
    {
        name: "Buggy with multiple weapons",
        vehicle: { type: "buggy", weapons: ["machine_gun_123", "shotgun_456", "handgun_789"], upgrades: [], perks: [] },
        expectedSlots: 2  // 1 for MG + 1 for shotgun + 0 for handgun
    },
    {
        name: "War Rig with Armor upgrade (1 slot)",
        vehicle: { type: "war_rig", weapons: [], upgrades: ["armor"], perks: [] },
        expectedSlots: 1
    },
    {
        name: "Performance Car with mixed upgrades and weapons",
        vehicle: { 
            type: "performance_car", 
            weapons: ["machine_gun_123", "flamethrower_456"],
            upgrades: ["armor", "nitro"],
            perks: []
        },
        expectedSlots: 4  // 1 for MG + 2 for flamethrower + 1 for armor + 1 for nitro
    }
];

// Mock weapons and upgrades data for testing
const weapons = [
    { id: "machine_gun", buildSlots: 1 },
    { id: "shotgun", buildSlots: 1 },
    { id: "handgun", buildSlots: 0 },  // Free
    { id: "flamethrower", buildSlots: 2 }
];

const upgrades = [
    { id: "armor", buildSlots: 1 },
    { id: "ram", buildSlots: 1 },
    { id: "nitro", buildSlots: 1 },
    { id: "grenades", buildSlots: 0 }  // Free
];

/**
 * Calculate used build slots for a vehicle
 * This should be kept in sync with the implementation in the app
 * @param {{ weapons: string[], upgrades: string[] }} vehicle
 */
function calculateUsedBuildSlots(vehicle) {
    let totalSlots = 0;
    
    // Calculate slots used by weapons
    for (const weaponInstanceId of vehicle.weapons) {
        const baseWeaponId = weaponInstanceId.split('_')[0];
        const weaponObj = weapons.find(w => w.id === baseWeaponId);
        if (weaponObj) {
            // Special case: Some weapons don't use build slots in Gaslands Refueled
            if (['handgun', 'molotov', 'grenades', 'ram', 'oil_slick', 'smokescreen'].includes(baseWeaponId)) {
                // These weapons don't consume build slots
                continue;
            }
            totalSlots += weaponObj.buildSlots || 1;
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
            totalSlots += upgradeObj.buildSlots || 1;
        }
    }
    
    return totalSlots;
}

// Run tests
function runTests() {
    console.log("Running build slots validation tests...");
    console.log("=========================================");
    
    let passedTests = 0;
    let failedTests = 0;
    
    for (const testCase of vehicleTestCases) {
        const calculated = calculateUsedBuildSlots(testCase.vehicle);
        const expected = testCase.expectedSlots;
        const passed = calculated === expected;
        
        console.log(`Test: ${testCase.name}`);
        console.log(`  Calculated: ${calculated}, Expected: ${expected}`);
        console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
        console.log("-----------------------------------------");
        
        if (passed) {
            passedTests++;
        } else {
            failedTests++;
        }
    }
    
    console.log("Test Summary:");
    console.log(`  Passed: ${passedTests}`);
    console.log(`  Failed: ${failedTests}`);
    console.log(`  Total: ${vehicleTestCases.length}`);
    
    return failedTests === 0;
}

// Run the validation
const success = runTests();
process.exit(success ? 0 : 1);