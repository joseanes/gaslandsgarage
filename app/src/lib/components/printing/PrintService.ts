// PrintService.ts - Comprehensive printing functionality
import type { Draft } from '$lib/validate/model';
import { draftToDataURL } from '$lib/draft/qr';
import { teamHasVehicles } from '$lib/print/canPrintTeam';
import { revokePrintPhotosWhenClosed, vehiclePhotoSectionHtml, waitForPrintImages } from '$lib/photos/printPhotos';

/** Team draft plus the extra fields the print window already receives. */
interface PrintDraft extends Omit<Draft, 'sponsor' | 'vehicles'> {
  sponsor?: Draft['sponsor'] | { id?: string; name?: string; description?: string } | null;
  vehicles: any[];
  totalCans?: number;
  sponsorName?: string;
  sponsorPerks?: any;
  qrCode?: string | null;
  showEquipmentDescriptions?: boolean;
  showPerkDescriptions?: boolean;
  showSpecialRules?: boolean;
  printStyle?: string;
}

interface PrintHtmlData {
  teamName: string;
  totalCans: number;
  maxCans: number;
  sponsorName: string;
  vehicles: any[];
  sponsor?: any;
  sponsorPerks?: any;
  qrCode?: string | null;
  showEquipmentDescriptions?: boolean;
  showPerkDescriptions?: boolean;
  showSpecialRules?: boolean;
  printStyle?: string;
  weaponAndUpgradeSpecialRules?: any[];
  rulesVersion?: 2 | 3;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function ruleKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function findVehicleRule(rules: any[] | undefined, ruleName: string) {
  if (!Array.isArray(rules)) return undefined;
  const key = ruleKey(ruleName);
  if (!key) return undefined;
  return rules.find((rule) => ruleKey(rule?.id) === key || ruleKey(rule?.ruleName) === key);
}

function editionFields(vehicle: any, rulesVersion: number | undefined) {
  if (rulesVersion !== 3) return null;
  let armour = vehicle?.stats?.armour ?? vehicle?.vehicleType?.armour ?? 0;
  const upgrades = Array.isArray(vehicle?.upgradeObjects) ? vehicle.upgradeObjects : [];
  for (const upgrade of upgrades) {
    if (upgrade && typeof upgrade.armour === 'number') armour += upgrade.armour;
  }
  const slots = vehicle?.stats?.buildSlots ?? vehicle?.vehicleType?.buildSlots ?? 0;
  return {
    armour,
    slots,
    driver: escapeHtml(vehicle?.driverSummary || 'No driver'),
    classes: escapeHtml(vehicle?.perkClassSummary || 'None')
  };
}

/** Stats the sheet should show. Roster used to ignore `stats` and print placeholder numbers. */
function resolvedPrintStats(vehicle: any) {
  const vehicleType = vehicle?.vehicleType || {};
  const stats = vehicle?.stats || {};
  const upgradeObjects = Array.isArray(vehicle?.upgradeObjects) ? vehicle.upgradeObjects : [];
  let handling = stats.handling ?? vehicleType.handling ?? vehicle?.handling ?? 4;
  let gear = stats.gear ?? vehicleType.maxGear ?? vehicle?.maxGear ?? 6;
  let hull = stats.hull ?? vehicleType.maxHull ?? vehicle?.hull ?? 4;
  let crew = stats.crew ?? vehicleType.crew ?? vehicle?.crew ?? 1;
  const hullAlreadyIncludesUpgrades = stats.hull != null;

  for (const upgrade of upgradeObjects) {
    if (!upgrade) continue;
    if (upgrade.handling) handling += upgrade.handling;
    else if (upgrade.handlingModifier) handling += upgrade.handlingModifier;
    if (upgrade.gear) gear += upgrade.gear;
    else if (upgrade.gearModifier) gear += upgrade.gearModifier;
    if (upgrade.crew) crew += upgrade.crew;
    else if (upgrade.crewModifier) crew += upgrade.crewModifier;
    if (!hullAlreadyIncludesUpgrades && upgrade.hull) hull += upgrade.hull;
  }

  const weightSource = stats.weight ?? vehicleType.weight ?? vehicle?.weight;
  return {
    handling,
    gear,
    hull,
    crew,
    weight: weightSource == null ? 'Middleweight' : getWeightText(weightSource)
  };
}

function editionSponsorNote(rulesVersion: number | undefined, sponsor: any): string {
  if (rulesVersion !== 3 || !sponsor || typeof sponsor !== 'object') return '';
  const requirement = sponsor.requirement ? `<div>Requirement: ${sponsor.requirement}</div>` : '';
  const perk = sponsor.perkName ? `<div>${sponsor.perkName}: ${sponsor.perkText || ''}</div>` : '';
  return requirement + perk;
}

function printSponsorId(sponsor: PrintDraft['sponsor']): string {
  if (typeof sponsor === 'string') return sponsor;
  if (sponsor && sponsor.id) return sponsor.id;
  return 'no_sponsor';
}

/**
 * Checks if rules acknowledgment is required before printing
 */
export function checkRulesAcknowledgment(
  actionType: string,
  hasRules: boolean,
  showRulesModal: (action: string) => void
): boolean {
  // If user has acknowledged rules, proceed
  if (hasRules) {
    return true;
  }
  
  // Otherwise, show rules acknowledgment modal
  showRulesModal(actionType);
  return false;
}

/**
 * Calculate total team cost from vehicles data
 */
function calculateTotalCost(vehicles: any[]): number {
  if (!vehicles || !Array.isArray(vehicles)) return 0;
  
  let totalCost = 0;
  
  vehicles.forEach(vehicle => {
    if (!vehicle) return;
    
    // Add vehicle base cost
    if (vehicle.vehicleObj && vehicle.vehicleObj.baseCost) {
      totalCost += vehicle.vehicleObj.baseCost;
    }
    
    // Add weapon costs
    if (vehicle.weaponObjects && Array.isArray(vehicle.weaponObjects)) {
      vehicle.weaponObjects.forEach((weapon: any) => {
        if (weapon && weapon.cost) {
          totalCost += weapon.cost;
        }
      });
    }
    
    // Add upgrade costs
    if (vehicle.upgradeObjects && Array.isArray(vehicle.upgradeObjects)) {
      vehicle.upgradeObjects.forEach((upgrade: any) => {
        if (upgrade && upgrade.cost) {
          totalCost += upgrade.cost;
        }
      });
    }
    
    // Add perk costs
    if (vehicle.perkObjects && Array.isArray(vehicle.perkObjects)) {
      vehicle.perkObjects.forEach((perk: any) => {
        if (perk && perk.cost) {
          totalCost += perk.cost;
        }
      });
    }
  });
  
  return totalCost;
}

/**
 * Generates a printable HTML string from the data
 */
export function generatePrintableHtml(data: PrintHtmlData): string {
  const {
    teamName,
    totalCans,
    maxCans,
    sponsorName,
    vehicles,
    sponsor,
    sponsorPerks,
    qrCode,
    showEquipmentDescriptions = true,
    showPerkDescriptions = true,
    showSpecialRules = true,
    printStyle = 'classic',
    rulesVersion
  } = data;
  
  // Calculate actual total cost if the passed totalCans is 0 or invalid
  const actualTotalCans = totalCans || calculateTotalCost(vehicles);
  
  // Check if vehicles exist and are valid
  const hasValidVehicles = vehicles && 
    Array.isArray(vehicles) && 
    vehicles.length > 0 &&
    vehicles.some(v => v && typeof v === 'object');
    
  if (!hasValidVehicles) {
    console.error("[PrintService] No valid vehicles data in generatePrintableHtml:", data);
  }
  
  console.log("[PrintService] Generating HTML for vehicles with style:", printStyle, vehicles);
  
  // Ensure printStyle is a string and handle various dashboard naming conventions
  const style = String(printStyle || 'classic').toLowerCase().trim();
  
  // Check which print style to use
  console.log("[PrintService] Using print style:", style);
  
  // Check for Dashboard style with various naming conventions
  if (style === 'dashboard_v2' || style === 'dashboard' || style.includes('dashboard')) {
    console.log("[PrintService] Generating dashboard-style HTML");
    return generateDashboardHtml(data);
  }
  
  // Check for Roster style (simple table format)
  if (style === 'roster' || style.includes('roster')) {
    console.log("[PrintService] Generating roster-style HTML");
    return generateRosterHtml(data);
  }
  
  console.log("[PrintService] Generating classic-style HTML");
  
  // Continue with Classic style
  
  // Generate vehicle cards HTML
  let vehicleCardsHtml = '';
  if (vehicles && Array.isArray(vehicles)) {
    vehicles.forEach((vehicle, index) => {
      console.log(`[PrintService] Processing vehicle ${index}:`, vehicle);
      vehicleCardsHtml += generateVehicleCardHtml(vehicle, rulesVersion);
    });
  } else {
    vehicleCardsHtml = '<div class="vehicle-card">No vehicles found</div>';
  }
  
  // Generate sponsor perks HTML
  let sponsorPerksHtml = '';
  if (sponsorPerks && sponsor) {
    // First show the sponsor's perks classes
    const perksClasses = sponsorPerks.perksClasses || [];
    if (perksClasses.length > 0) {
      sponsorPerksHtml += `
      <div class="sponsor-perks-section">
        <h3>Available Perk Classes</h3>
        <p>${perksClasses.join(', ')}</p>
      </div>`;
    }

    // Then show the class perks
    const classPerksList = sponsorPerks.classPerksList || [];
    // Filter perkClasses to only show those purchased by vehicles
    const purchasedPerkClasses = new Set();
    if (vehicles && Array.isArray(vehicles)) {
      vehicles.forEach(vehicle => {
        // First try perkObjects (enhanced format)
        if (vehicle.perkObjects && Array.isArray(vehicle.perkObjects)) {
          vehicle.perkObjects.forEach((perk: any) => {
            // Try id, or if not available, try name
            if (perk) {
              if (perk.id) {
                purchasedPerkClasses.add(perk.id);
              } else if (perk.name) {
                purchasedPerkClasses.add(perk.name);
              }
            }
          });
        }
        // Fallback to perks array if perkObjects not available
        else if (vehicle.perks && Array.isArray(vehicle.perks)) {
          vehicle.perks.forEach((perk: any) => {
            if (typeof perk === 'string') {
              purchasedPerkClasses.add(perk);
            } else if (perk && perk.id) {
              purchasedPerkClasses.add(perk.id);
            } else if (perk && perk.name) {
              purchasedPerkClasses.add(perk.name);
            }
          });
        }
      });
    }

    // Filter to only show purchased perks
    const filteredClassPerksList = classPerksList.filter((perk: any) => {
      if (perk) {
        // Try to match by id
        if (perk.id && purchasedPerkClasses.has(perk.id)) {
          return true;
        }
        // Try to match by name
        if (perk.name && purchasedPerkClasses.has(perk.name)) {
          return true;
        }
      }
      return false;
    });

    if (filteredClassPerksList.length > 0) {
      sponsorPerksHtml += `
      <div class="sponsor-perks-section">
        <h3>Purchased Perks</h3>
        <ul class="perks-list">`;

      filteredClassPerksList.forEach((perk: any) => {
        if (perk && perk.name) {
          sponsorPerksHtml += `
          <li>
            <div class="perk-name">${perk.name}</div>
            <div class="perk-text">${perk.text || ''}</div>
          </li>`;
        }
      });

      sponsorPerksHtml += `
        </ul>
      </div>`;
    }

    // Finally show the sponsor-specific perks
    const sponsorPerksList = sponsorPerks.sponsorPerksList || [];
    if (sponsorPerksList.length > 0) {
      sponsorPerksHtml += `
      <div class="sponsor-perks-section">
        <h3>Sponsor Perks</h3>
        <ul class="perks-list">`;

      sponsorPerksList.forEach((perk: any) => {
        if (perk && perk.name) {
          sponsorPerksHtml += `
          <li>
            <div class="perk-name">${perk.name}</div>
            <div class="perk-text">${perk.text || ''}</div>
          </li>`;
        }
      });

      sponsorPerksHtml += `
        </ul>
      </div>`;
    }
  }

  // Generate equipment descriptions HTML (weapons and upgrades)
  let equipmentDescriptionsHtml = '';
  if (showEquipmentDescriptions && vehicles && Array.isArray(vehicles)) {
    // Collect all weapons and upgrades across vehicles
    const allWeapons = new Map();
    const allUpgrades = new Map();

    vehicles.forEach(vehicle => {
      // Add weapons
      if (vehicle.weaponObjects && Array.isArray(vehicle.weaponObjects)) {
        vehicle.weaponObjects.forEach((weapon: any) => {
          if (weapon && weapon.id && weapon.name) {
            allWeapons.set(weapon.id, weapon);
          }
        });
      }

      // Add upgrades
      if (vehicle.upgradeObjects && Array.isArray(vehicle.upgradeObjects)) {
        vehicle.upgradeObjects.forEach((upgrade: any) => {
          if (upgrade && upgrade.id && upgrade.name) {
            allUpgrades.set(upgrade.id, upgrade);
          }
        });
      }
    });

    // Use weapon and upgrade special rule descriptions if available
    const specialRulesMap = new Map();
    if (data.weaponAndUpgradeSpecialRules && Array.isArray(data.weaponAndUpgradeSpecialRules)) {
      data.weaponAndUpgradeSpecialRules.forEach(rule => {
        if (rule && rule.ruleName && rule.rule) {
          // Store by both rule ID and rule name (lowercase) for better matching
          specialRulesMap.set(rule.ruleName.toLowerCase(), rule.rule);
          if (rule.id) {
            specialRulesMap.set(rule.id.toLowerCase(), rule.rule);
          }
        }
      });
    }

    // Helper function to get rule description
    const getRuleDescription = (ruleNames: string) => {
      if (!ruleNames) return '';
      
      const rulesArray = ruleNames.split(',').map(r => r.trim());
      let fullDescription = '';
      
      rulesArray.forEach(ruleName => {
        // Try to find the rule description - first by name, then by looking for exact ID match
        const lowerRuleName = ruleName.toLowerCase();
        let ruleDescription = specialRulesMap.get(lowerRuleName);
        
        // If not found by name, try to find by ID
        if (!ruleDescription) {
          // Look for any rule with an ID that matches this rule name or its prefix
          // For example, "caltrop_dropper" in the special rules should match a rule with ID "caltrop_dropper"
          const matchingRule = data.weaponAndUpgradeSpecialRules?.find(r =>
            r.id && r.id.toLowerCase() === lowerRuleName
          );
          if (matchingRule) {
            ruleDescription = matchingRule.rule;
          }
        }
        
        if (ruleDescription) {
          fullDescription += `<div class="rule-item">
            <div class="rule-name">${ruleName}</div>
            <div class="rule-description">${ruleDescription}</div>
          </div>`;
        } else {
          fullDescription += `<div class="rule-item">
            <div class="rule-name">${ruleName}</div>
          </div>`;
        }
      });
      
      return fullDescription;
    };

    // Generate weapons section
    if (allWeapons.size > 0) {
      equipmentDescriptionsHtml += `
      <div class="equipment-section">
        <h3>Weapons</h3>
        <ul class="equipment-list">`;

      Array.from(allWeapons.values()).forEach(weapon => {
        equipmentDescriptionsHtml += `
        <li>
          <div class="equipment-name">${weapon.name}</div>
          <div class="equipment-details">
            <span class="equipment-stat">Cost: ${weapon.cost} cans</span>
            <span class="equipment-stat">Attack Dice: ${weapon.attackDice !== '-' ? weapon.attackDice : 'N/A'}</span>
            <span class="equipment-stat">Default Facing: ${weapon.facing || 'Front'}</span>
            ${weapon.specialRules || weapon.effect ? `
            <div class="equipment-rules">
              <div class="special-rules-header">Special Rules:</div>
              ${rulesVersion === 3
                ? `<div class="rule-item"><div class="rule-name">${escapeHtml(weapon.specialRules || '')}</div><div class="rule-description">${escapeHtml(weapon.effect || '')}</div></div>`
                : getRuleDescription(weapon.specialRules)}
            </div>` : ''}
          </div>
        </li>`;
      });

      equipmentDescriptionsHtml += `
        </ul>
      </div>`;
    }

    // Generate upgrades section
    if (allUpgrades.size > 0) {
      equipmentDescriptionsHtml += `
      <div class="equipment-section">
        <h3>Upgrades</h3>
        <ul class="equipment-list">`;

      Array.from(allUpgrades.values()).forEach(upgrade => {
        equipmentDescriptionsHtml += `
        <li>
          <div class="equipment-name">${upgrade.name}</div>
          <div class="equipment-details">
            <span class="equipment-stat">Cost: ${upgrade.cost} cans</span>
            ${upgrade.specialRules || upgrade.effect ? `
            <div class="equipment-rules">
              <div class="special-rules-header">Special Rules:</div>
              ${rulesVersion === 3
                ? `<div class="rule-item"><div class="rule-name">${escapeHtml(upgrade.specialRules || '')}</div><div class="rule-description">${escapeHtml(upgrade.effect || '')}</div></div>`
                : getRuleDescription(upgrade.specialRules)}
            </div>` : ''}
          </div>
        </li>`;
      });

      equipmentDescriptionsHtml += `
        </ul>
      </div>`;
    }
  }
  
  // Generate complete HTML for Classic style
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Gaslands Team: ${escapeHtml(teamName)}</title>
    <meta charset="utf-8">
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 20px;
        color: black;
        background-color: white;
      }

      /* Print-specific page settings */
      @media print {
        @page {
          size: auto;
          margin: 10mm;
        }

        body {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
      }

      /* Header styles */
      .print-header {
        margin-bottom: 20px;
        border-bottom: 2px solid #d97706;
        padding-bottom: 10px;
      }

      h1 {
        color: #d97706;
        font-size: 24px;
        margin: 0 0 10px 0;
      }

      h2, h3 {
        color: #d97706;
        margin-top: 20px;
        margin-bottom: 10px;
      }

      .team-info {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 8px 16px;
      }

      h1, h2, h3, .vehicle-name, .sponsor-name {
        overflow-wrap: anywhere;
      }

      /* One column. A second column was clipped off the printed page. */
      .vehicle-cards {
        display: block;
        margin-bottom: 30px;
      }

      /* Individual vehicle card */
      .vehicle-card {
        border: 1px solid #888;
        border-radius: 8px;
        padding: 15px;
        margin-bottom: 16px;
        max-width: 100%;
        box-sizing: border-box;
        break-inside: auto;
        page-break-inside: auto;
      }

      .card-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 15px;
        border-bottom: 1px solid #eee;
        padding-bottom: 8px;
      }

      .vehicle-name {
        font-weight: bold;
        font-size: 1.2em;
      }

      .vehicle-type {
        display: inline-block;
        background-color: #333 !important;
        color: white !important;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 0.8em;
      }

      .vehicle-cost {
        background-color: black !important;
        color: white !important;
        padding: 2px 8px;
        border-radius: 4px;
        font-weight: bold;
        text-align: center;
      }

      /* Stats section */
      .stats-section {
        margin-bottom: 15px;
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
      }

      .stat-item {
        text-align: center;
      }

      .stat-label {
        font-size: 0.8em;
        display: block;
        margin-bottom: 2px;
      }

      .stat-value {
        font-weight: bold;
      }

      /* Hull tracker */
      .hull-track {
        margin-bottom: 15px;
      }

      .hull-boxes {
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        max-width: 100%;
      }

      .hull-box {
        width: 15px;
        height: 15px;
        border: 1px solid black;
      }

      /* Loadout sections */
      .loadout-section {
        margin-bottom: 10px;
      }

      .section-title {
        font-weight: bold;
        margin-bottom: 5px;
        border-bottom: 1px solid #eee;
      }

      ul {
        margin: 0;
        padding-left: 20px;
      }

      li {
        margin-bottom: 2px;
      }

      /* Equipment section */
      .equipment-container {
        margin-top: 30px;
        break-before: auto;
        page-break-before: auto;
        border-top: 2px solid #d97706;
        padding-top: 20px;
      }

      .equipment-section {
        margin-bottom: 20px;
      }

      .equipment-list {
        list-style-type: disc;
        padding-left: 20px;
      }

      .equipment-name {
        font-weight: bold;
      }

      .equipment-details {
        margin-top: 3px;
        margin-bottom: 8px;
        font-size: 0.9em;
      }

      .equipment-stat {
        display: inline-block;
        background-color: #f3f4f6;
        padding: 2px 6px;
        border-radius: 4px;
        margin-right: 8px;
        margin-bottom: 4px;
        font-size: 0.8em;
      }

      .equipment-rules {
        margin-top: 4px;
        font-size: 0.9em;
        color: #444;
      }
      
      .special-rules-header {
        font-weight: bold;
        margin-top: 8px;
        margin-bottom: 6px;
      }
      
      .rule-item {
        margin-bottom: 10px;
      }
      
      .rule-name {
        font-weight: bold;
        font-size: 0.9em;
      }
      
      .rule-description {
        margin-top: 2px;
        padding-left: 10px;
      }

      /* Sponsor perks section */
      .sponsor-perks-container {
        margin-top: 30px;
        break-before: auto;
        page-break-before: auto;
        border-top: 2px solid #d97706;
        padding-top: 20px;
      }

      .sponsor-perks-section {
        margin-bottom: 20px;
      }

      .perks-list {
        list-style-type: disc;
        padding-left: 20px;
      }

      .perk-name {
        font-weight: bold;
      }

      .perk-text {
        margin-top: 3px;
        margin-bottom: 8px;
        font-size: 0.9em;
      }

      /* Footer section with QR code */
      .print-footer-container {
        margin-top: 40px;
        padding-top: 20px;
        border-top: 2px solid #d97706;
        display: flex;
        justify-content: space-between;
        align-items: center;
        break-before: avoid;
        page-break-before: avoid;
        page-break-inside: auto;
      }

      /* QR code section */
      .qr-section {
        text-align: center;
      }

      .qr-code {
        max-width: 120px;
        height: auto;
        margin: 0 auto;
        display: block;
      }

      .qr-caption {
        margin-top: 6px;
        font-size: 0.9em;
        color: #666;
      }

      /* Footer */
      .print-footer {
        font-size: 0.8em;
        color: #666;
        flex-grow: 1;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <!-- Header Section -->
    <div class="print-header">
      <h1>${escapeHtml(teamName)}</h1>
      <div class="team-info">
        <div>Total: ${actualTotalCans} / ${maxCans} cans</div>
        <div>Sponsor: ${escapeHtml(sponsorName)}</div>
        ${editionSponsorNote(rulesVersion, sponsor)}
      </div>
    </div>

    <!-- Vehicle Cards Section -->
    <div class="vehicle-cards">
      ${vehicleCardsHtml}
    </div>

    <!-- Equipment Descriptions Section -->
    ${showEquipmentDescriptions && equipmentDescriptionsHtml ? `
    <div class="equipment-container">
      <h2>Equipment Descriptions</h2>
      ${equipmentDescriptionsHtml}
    </div>
    ` : ''}

    <!-- Perk Descriptions Section -->
    ${sponsorPerksHtml ? `
    <div class="sponsor-perks-container">
      <h2>Perk Descriptions</h2>
      ${sponsorPerksHtml}
    </div>
    ` : ''}
    
    <!-- Vehicle Special Rules Section -->
    ${showSpecialRules ? `
    <div class="vehicle-rules-container" style="margin-top: 30px; page-break-before: auto; border-top: 2px solid #d97706; padding-top: 20px;">
      <h2 style="color: #d97706; font-size: 24px; margin-bottom: 15px;">Vehicle Special Rules</h2>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead>
          <tr>
            <th style="width: 25%; text-align: left; border-bottom: 2px solid #d97706; padding: 10px; font-size: 16px;">Rule</th>
            <th style="text-align: left; border-bottom: 2px solid #d97706; padding: 10px; font-size: 16px;">Description</th>
          </tr>
        </thead>
        <tbody>
          ${generateVehicleSpecialRulesHtml(vehicles)}
        </tbody>
      </table>
    </div>
    ` : ''}

    <!-- Footer Section with QR Code -->
    <div class="print-footer-container">
      <div class="print-footer">
        Generated by <a href="https://www.GaslandsGarage.com" target="_blank" style="color: #d97706; text-decoration: underline;">GaslandsGarage.com</a> on ${new Date().toLocaleDateString()}
      </div>

      <div class="qr-section">
        ${qrCode ?
          `<img src="${qrCode}" class="qr-code" alt="QR Code for team" style="width:120px; height:120px; border:1px solid #000; background:#fff;">` :
          `<div style="width:120px; height:120px; border:1px solid #000; background:#fff; text-align:center; line-height:120px; font-size:10px;">
            Visit gaslandsgarage.com
          </div>`
        }
        <div class="qr-caption">Scan to load this team build</div>
      </div>
    </div>
  </body>
  </html>
  `;
}

/**
 * Generate HTML for Dashboard style printing
 */
function generateDashboardHtml(data: PrintHtmlData): string {
  const {
    teamName,
    totalCans,
    maxCans,
    sponsorName,
    vehicles,
    sponsor,
    sponsorPerks,
    qrCode,
    showEquipmentDescriptions = true,
    showPerkDescriptions = true,
    showSpecialRules = true,
    printStyle = 'classic',
    rulesVersion
  } = data;
  
  // Calculate actual total cost if the passed totalCans is 0 or invalid
  const actualTotalCans = totalCans || calculateTotalCost(vehicles);
  
  // Get sponsor description if available
  let sponsorDescription = '';
  if (sponsor && sponsor.description) {
    sponsorDescription = sponsor.description;
  } else if (sponsorPerks && sponsorPerks.perksClasses) {
    sponsorDescription = sponsorPerks.perksClasses.join(', ');
  }
  
  // Generate vehicle dashboards HTML
  let vehicleDashboardsHtml = '';
  
  if (vehicles && Array.isArray(vehicles)) {
    vehicles.forEach((vehicle) => {
      vehicleDashboardsHtml += generateVehicleDashboardHtml(vehicle, sponsorName, rulesVersion);
    });
  } else {
    vehicleDashboardsHtml = '<div class="dashboard-card">No vehicles found</div>';
  }
  
  // Inspect what's in the data for debugging
  console.log("[PrintService] Dashboard data:", {
    teamName,
    sponsorName,
    vehiclesLength: vehicles?.length,
    hasQrCode: Boolean(qrCode),
    sponsorPerks: Boolean(sponsorPerks)
  });

  // Generate complete HTML for Dashboard style
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Gaslands Dashboard: ${escapeHtml(teamName)}</title>
    <meta charset="utf-8">
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 10px;
        color: black;
        background-color: white;
        line-height: 1.2;
      }

      /* Print-specific page settings */
      @media print {
        @page {
          size: auto;
          margin: 5mm;
        }

        body {
          padding: 0;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        
        .page-break {
          page-break-after: auto;
          break-after: auto;
        }
        
        .print-buttons {
          display: none;
        }
      }
      
      /* Print Control Buttons */
      .print-buttons {
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 1000;
        display: flex;
        gap: 10px;
      }
      
      .print-button {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        font-weight: bold;
        cursor: pointer;
        font-size: 14px;
      }
      
      .print-button-print {
        background-color: #2563eb;
        color: white;
      }
      
      .print-button-settings {
        background-color: #047857;
        color: white;
      }
      
      .print-button-close {
        background-color: #d97706;
        color: white;
      }
      
      /* Dashboard-specific styles */
      .sponsor-header {
        border: 1px solid black;
        margin-bottom: 15px;
        padding: 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        page-break-inside: avoid;
      }
      
      .sponsor-name {
        font-size: 24px;
        font-weight: bold;
      }
      
      .sponsor-description {
        font-size: 16px;
        font-style: italic;
      }
      
      /* Dashboard Vehicle Card */
      .dashboard-card {
        border: 1px solid black;
        margin-bottom: 15px;
        max-width: 100%;
        box-sizing: border-box;
        break-inside: auto;
        page-break-inside: auto;
      }
      
      .vehicle-header {
        font-size: 28px;
        font-weight: bold;
        padding: 10px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        overflow-wrap: anywhere;
      }
      
      .vehicle-subheader {
        font-size: 16px;
        font-weight: normal;
      }
      
      .vehicle-type-perks {
        font-size: 18px;
        font-weight: bold;
        margin-top: 5px;
        margin-bottom: 10px;
      }
      
      .dashboard-stats {
        display: flex;
        justify-content: space-between;
        align-items: stretch;
        margin-top: 5px;
      }
      
      .stat-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        border: 1px solid black;
        padding: 5px;
        width: 80px;
        height: 80px;
      }
      
      .stat-box-label {
        font-size: 16px;
        font-weight: bold;
      }
      
      .stat-box-value {
        font-size: 36px;
        font-weight: bold;
      }
      
      .hull-track {
        margin: 10px 0;
      }
      
      .hull-label {
        font-weight: bold;
        margin-bottom: 5px;
      }
      
      .hull-boxes {
        display: flex;
        gap: 3px;
        flex-wrap: wrap;
      }
      
      .hull-box {
        width: 20px;
        height: 20px;
        border: 1px solid black;
      }
      
      .dashboard-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
      }
      
      .dashboard-table th, .dashboard-table td {
        border: 1px solid black;
        padding: 5px;
        text-align: left;
      }
      
      .dashboard-table th {
        background-color: #f0f0f0;
        font-weight: bold;
      }
      
      .dashboard-table td {
        vertical-align: top;
      }
      
      .stat-row {
        display: flex;
        justify-content: space-between;
        margin-top: 10px;
      }
      
      .stat-item {
        font-size: 16px;
        font-weight: bold;
      }
      
      .stat-item span {
        font-size: 24px;
        margin-left: 5px;
      }
      
      .upgrades-section, .perks-section {
        margin-top: 15px;
        padding: 0 10px 10px 10px;
      }
      
      .section-label {
        font-weight: bold;
        font-size: 16px;
        margin-bottom: 5px;
      }
      
      .perks-table {
        width: 100%;
        border-collapse: collapse;
      }
      
      .perks-table th, .perks-table td {
        border: 1px solid black;
        padding: 5px;
        text-align: left;
      }
      
      .ammo-box {
        width: 20px;
        height: 20px;
        border: 1px solid black;
        display: inline-block;
        margin-right: 2px;
      }
      
      /* QR Code Footer */
      .print-footer-container {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 8px;
        padding-top: 4px;
        border-top: 1px solid #ccc;
        break-before: avoid;
        page-break-before: avoid;
        page-break-inside: avoid;
      }
      
      .qr-section {
        text-align: center;
      }
      
      .qr-code {
        width: 64px;
        height: 64px;
        margin: 0 auto;
        display: block;
        border: 1px solid #000;
        background: #fff;
      }
      
      .qr-caption {
        margin-top: 6px;
        font-size: 0.9em;
        color: #666;
      }
      
      /* Footer */
      .dashboard-footer {
        text-align: center;
        margin-top: 2px;
        font-size: 10px;
        line-height: 1.2;
        color: #666;
      }
    </style>
  </head>
  <body>
    <!-- Sponsor Header -->
    <div class="sponsor-header">
      <div>
        <div class="sponsor-name">${escapeHtml(sponsorName)}</div>
        <div class="sponsor-description">${sponsorDescription}</div>
        ${editionSponsorNote(rulesVersion, sponsor)}
      </div>
      <div style="text-align: right;">
        <div class="sponsor-name">${actualTotalCans} / ${maxCans} cans</div>
        <div class="sponsor-description">Total team cost</div>
        ${qrCode
          ? `<img src="${qrCode}" alt="QR code for this team" style="width:64px; height:64px; margin-top:6px; border:1px solid #000; background:#fff;"><div class="sponsor-description">gaslandsgarage.com</div>`
          : ''}
      </div>
    </div>

    <!-- Vehicle Dashboards -->
    ${vehicleDashboardsHtml}
    
    <!-- Equipment and Perk Descriptions (if enabled) -->
    ${showEquipmentDescriptions || showPerkDescriptions ? `
    <div class="descriptions-section" style="margin-top: 30px; border-top: 1px solid #ccc; padding-top: 20px;">
      ${showEquipmentDescriptions ? `
      <div class="equipment-descriptions" style="margin-bottom: 20px;">
        <h2 style="font-size: 24px; margin-bottom: 10px; color: #333;">Equipment Descriptions</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr>
              <th style="padding: 8px; text-align: left; border-bottom: 2px solid #888; width: 25%;">Equipment</th>
              <th style="padding: 8px; text-align: left; border-bottom: 2px solid #888;">Description</th>
            </tr>
          </thead>
          <tbody>
            ${generateEquipmentDescriptionsHtml(vehicles, rulesVersion)}
          </tbody>
        </table>
      </div>
      ` : ''}
      
      ${showPerkDescriptions ? `
      <div class="perk-descriptions">
        <h2 style="font-size: 24px; margin-bottom: 10px; color: #333;">Perk Descriptions</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="padding: 8px; text-align: left; border-bottom: 2px solid #888; width: 25%;">Perk</th>
              <th style="padding: 8px; text-align: left; border-bottom: 2px solid #888;">Description</th>
            </tr>
          </thead>
          <tbody>
            ${generatePerkDescriptionsHtml(vehicles, sponsorPerks)}
          </tbody>
        </table>
      </div>
      ` : ''}
      
      ${showSpecialRules ? `
      <div class="special-rules-descriptions">
        <h2 style="font-size: 24px; margin-bottom: 10px; color: #333;">Vehicle Special Rules</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="padding: 8px; text-align: left; border-bottom: 2px solid #888; width: 25%;">Rule</th>
              <th style="padding: 8px; text-align: left; border-bottom: 2px solid #888;">Description</th>
            </tr>
          </thead>
          <tbody>
            ${generateVehicleSpecialRulesHtml(vehicles)}
          </tbody>
        </table>
      </div>
      ` : ''}
    </div>
    ` : ''}

  </body>
  </html>
  `;
}

/**
 * Generate HTML for a dashboard-style vehicle card
 */
function generateVehicleDashboardHtml(vehicle: any, sponsorName: string, rulesVersion?: number): string {
  if (!vehicle) {
    return '<div class="dashboard-card">Error: Invalid vehicle data</div>';
  }
  
  try {
    // Extract needed data with defensive coding
    const name = vehicle.name || 'Vehicle';
    const vehicleType = vehicle.vehicleType || {};
    const typeName = vehicleType.name || 'Car';
    const stats = vehicle.stats || {};
    
    // Calculate cost - use provided cost or calculate from components
    let cost = vehicle.cost || 0;
    if (!cost || cost === 0) {
      // Fallback: calculate cost from vehicle type + weapons + upgrades
      cost = (vehicleType.baseCost || 0);
      
      // Add weapon costs
      if (Array.isArray(vehicle.weaponObjects)) {
        vehicle.weaponObjects.forEach((weapon: any) => {
          if (weapon && weapon.cost) {
            cost += weapon.cost;
          }
        });
      }
      
      // Add upgrade costs
      if (Array.isArray(vehicle.upgradeObjects)) {
        vehicle.upgradeObjects.forEach((upgrade: any) => {
          if (upgrade && upgrade.cost) {
            cost += upgrade.cost;
          }
        });
      }
      
      // Add perk costs
      if (Array.isArray(vehicle.perkObjects)) {
        vehicle.perkObjects.forEach((perk: any) => {
          if (perk && perk.cost) {
            cost += perk.cost;
          }
        });
      }
    }
    
    // Get lists of weapons, upgrades, and perks
    const weaponObjects = Array.isArray(vehicle.weaponObjects) ? vehicle.weaponObjects : [];
    const upgradeObjects = Array.isArray(vehicle.upgradeObjects) ? vehicle.upgradeObjects : [];
    const perkObjects = Array.isArray(vehicle.perkObjects) ? vehicle.perkObjects : [];
    
    const printed = resolvedPrintStats(vehicle);
    const hull = printed.hull;
    const handling = printed.handling;
    const crew = printed.crew;
    const maxGear = printed.gear;
    const weight = printed.weight;
    
    // Generate hull boxes (more similar to reference image)
    let hullBoxesHtml = '';
    for (let i = 0; i < hull; i++) {
      hullBoxesHtml += '<div class="hull-box"></div>';
    }
    
    // Generate weapons table rows
    let weaponsTableHtml = '';
    if (weaponObjects.length > 0) {
      weaponObjects.forEach((weapon: any) => {
        // Get weapon details
        const weaponName = weapon.name || 'Unknown Weapon';
        const facing = weapon.facing || 'Front';
        
        // Get range directly from the weapon data
        let range = weapon.range || 'Short';
        
        // Clean up empty values
        if (typeof range === 'string' && range.trim().length === 0) {
          range = 'Short';
        }
        
        // Format attack dice
        let attackDice = weapon.attackDice || '0D6';
        // Ensure number has "D6" suffix
        if (typeof attackDice === 'number' || /^\d+$/.test(attackDice)) {
          attackDice = `${attackDice}D6`;
        }
        
        // Generate ammo boxes based on weapon special rules
        let ammoBoxes = 0;
        
        // First check if weapon has AMMO special rule
        if (weapon.specialRules && weapon.specialRules.includes('AMMO')) {
          // Extract the ammo count from the AMMO X rule
          const ammoMatch = weapon.specialRules.match(/AMMO\s+(\d+)/i);
          if (ammoMatch && ammoMatch[1]) {
            ammoBoxes = parseInt(ammoMatch[1], 10);
          } else {
            // Default to 3 if AMMO is present but count can't be determined
            ammoBoxes = 3;
          }
        } 
        // Fallback to determining ammo count based on weapon type for compatibility
        else if (
          !weaponName.includes('Machine Gun') && // Explicitly exclude Machine Guns from having ammo boxes
          (
            weaponName.includes('Napalm') ||
            weaponName.includes('Flamethrower') ||
            weaponName.includes('Rockets') || 
            weaponName.includes('Missile') || 
            weaponName.includes('Oil') || 
            weaponName.includes('Slick') ||
            weaponName.includes('Dropper') ||
            weaponName.includes('Mine') || 
            weaponName.includes('Bomb') || 
            weaponName.includes('Smoke') ||
            weaponName.includes('Glue') ||
            weaponName.includes('Caltrop')
          )
        ) {
          ammoBoxes = 3;
        }
        
        let ammoBoxesHtml = '';
        if (ammoBoxes > 0) {
          for (let i = 0; i < ammoBoxes; i++) {
            ammoBoxesHtml += '<div class="ammo-box"></div>';
          }
        } else {
          ammoBoxesHtml = '&mdash;';
        }
        
        // Get special rules
        const specialRules = weapon.specialRules || '';
        
        // Add row to table (matching reference image layout)
        weaponsTableHtml += `
        <tr>
          <td>${weaponName}</td>
          <td>${facing}</td>
          <td>${range}</td>
          <td>${attackDice}</td>
          <td>${ammoBoxesHtml}</td>
          <td>${specialRules}</td>
        </tr>`;
      });
    }
    
    // If no weapons, add a "No weapons" row
    if (weaponsTableHtml === '') {
      weaponsTableHtml = `
      <tr>
        <td colspan="6" style="text-align: center;">No weapons installed</td>
      </tr>`;
    }
    
    // Generate upgrades list
    let upgradesHtml = '';
    if (upgradeObjects.length > 0) {
      upgradeObjects.forEach((upgrade: any) => {
        const upgradeName = upgrade.name || 'Unknown Upgrade';
        const upgradeRules = upgrade.specialRules || '';
        
        // Just show the upgrade name, no rules in the vehicle card
        upgradesHtml += `<div style="margin-bottom: 5px;"><strong>${upgradeName}</strong></div>`;
      });
    } else {
      upgradesHtml = '<div style="text-align: center;">No upgrades installed</div>';
    }
    
    // Generate perks table with complete rules
    let perksTableHtml = '';
    if (perkObjects.length > 0) {
      perkObjects.forEach((perk: any) => {
        const perkName = perk.name || 'Unknown Perk';
        // Use text or rules, whichever is available
        const perkText = perk.text || perk.rules || 'No description available.';
        
        perksTableHtml += `
        <tr>
          <td style="font-weight: bold; width: 25%;">${perkName}</td>
          <td>${perkText}</td>
        </tr>`;
      });
    } else {
      perksTableHtml = `
      <tr>
        <td colspan="2" style="text-align: center;">No perks</td>
      </tr>`;
    }
    
    // Combine vehicle type and perks/abilities for the subheader
    const weightLabel = /^\d+$/.test(String(weight)) ? `Weight ${weight}` : weight;
    const vehicleTypePerks = [
      weightLabel,
      typeName
    ];
    
    // Add any vehicle special rules with readable names
    let specialRulesString = vehicle.specialRules || vehicleType?.specialRules;
    if (specialRulesString) {
      const rules = specialRulesString.split(',').map((rule: string) => rule.trim());
      const readableRuleNames = rules.map((ruleId: string) => {
        // Find the rule details using the id but display the readable ruleName
        const ruleDetails = findVehicleRule(vehicle.vehicleRules, ruleId);
        return ruleDetails?.ruleName || ruleId;
      });
      vehicleTypePerks.push(...readableRuleNames);
    }
    
    // Add any team-wide perks like "Thumpermonkey" or "Dynamo"
    if (perkObjects.length > 0) {
      const teamwidePerkNames = perkObjects.map((p: any) => p.name || '').filter(Boolean);
      if (teamwidePerkNames.length > 0) {
        vehicleTypePerks.push(...teamwidePerkNames);
      }
    }
    
    // Return complete dashboard HTML
    return `
    <div class="dashboard-card">
      <div class="vehicle-header">
        <div>
          <div>${escapeHtml(name)}</div>
          <div class="vehicle-type-perks">${vehicleTypePerks.join(', ')}</div>
        </div>
        <div>
          <strong>${cost} cans</strong>
        </div>
      </div>
      
      <div style="padding: 0 10px;">
        <div class="hull-track">
          <div class="hull-label">Hull</div>
          <div class="hull-boxes">${hullBoxesHtml}</div>
        </div>
        
        <div class="dashboard-stats">
          <div class="stat-row" style="flex: 1; margin-right: 20px;">
            <div class="stat-item">Handling <span>${handling}</span></div>
            <div class="stat-item" style="margin-right: 20px;">Crew <span>${crew}</span></div>
          </div>
          
          <div style="display: flex; gap: 15px;">
            <div class="stat-box">
              <div class="stat-box-label">Max Gear</div>
              <div class="stat-box-value">${maxGear}</div>
            </div>
            
            <div class="stat-box">
              <div class="stat-box-label">Hazards</div>
              <div class="stat-box-value"></div>
            </div>
          </div>
        </div>
        ${(() => {
          const edition = editionFields(vehicle, rulesVersion);
          if (!edition) return '';
          return `<div class="stat-row"><div class="stat-item">Armour <span>${edition.armour}</span></div><div class="stat-item">Build slots <span>${edition.slots}</span></div><div class="stat-item">Driver <span>${edition.driver}</span></div><div class="stat-item">Perk classes <span>${edition.classes}</span></div></div>`;
        })()}
      </div>
      
      <table class="dashboard-table">
        <thead>
          <tr>
            <th>Weapon</th>
            <th>Facing</th>
            <th>Range</th>
            <th>Attack</th>
            <th>Ammo</th>
            <th>Rules</th>
          </tr>
        </thead>
        <tbody>
          ${weaponsTableHtml}
        </tbody>
      </table>
      
      <div class="upgrades-section">
        <div class="section-label">Upgrades:</div>
        ${upgradesHtml}
      </div>
      
      <table class="perks-table">
        <thead>
          <tr>
            <th>Perk</th>
            <th>Rules</th>
          </tr>
        </thead>
        <tbody>
          ${perksTableHtml}
        </tbody>
      </table>
      ${vehiclePhotoSectionHtml(vehicle)}
    </div>
    `;
  } catch (error) {
    console.error("[PrintService] Error generating dashboard HTML:", error);
    return `<div class="dashboard-card">Error generating dashboard: ${error instanceof Error ? error.message : String(error)}</div>`;
  }
}

/**
 * Generate HTML for a vehicle card
 */
function generateVehicleCardHtml(vehicle: any, rulesVersion?: number): string {
  console.log("[PrintService] Generating HTML for vehicle:", vehicle);
  
  // Check if vehicle data is valid
  if (!vehicle) {
    console.error("[PrintService] Invalid vehicle data:", vehicle);
    return '<div class="vehicle-card">Error: Invalid vehicle data</div>';
  }
  
  try {
    // Extract needed data with defensive coding
    const id = vehicle.id || 'v-' + Math.random().toString(36).substring(2, 9);
    const name = vehicle.name || 'Vehicle';
    const type = vehicle.type || 'car';
    const vehicleType = vehicle.vehicleType || {};
    const stats = vehicle.stats || {};
    const cost = vehicle.cost || 0;
    
    // Use either weaponObjects (new enhanced format) or fall back to weapons array
    const weaponObjects = Array.isArray(vehicle.weaponObjects) ? vehicle.weaponObjects : [];
    const upgradeObjects = Array.isArray(vehicle.upgradeObjects) ? vehicle.upgradeObjects : [];
    const perkObjects = Array.isArray(vehicle.perkObjects) ? vehicle.perkObjects : [];
    
    const printed = resolvedPrintStats(vehicle);
    const hull = printed.hull;
    const handling = printed.handling;
    const gear = printed.gear;
    const crew = printed.crew;
    const weight = printed.weight;

    // Generate hull boxes HTML
    let hullBoxesHtml = '';
    for (let i = 0; i < hull; i++) {
      hullBoxesHtml += '<div class="hull-box"></div>';
    }
    
    // Generate weapons HTML using weaponObjects if available
    let weaponsHtml = '';
    if (weaponObjects.length > 0) {
      weaponsHtml = '<div class="loadout-section"><div class="section-title">Weapons</div><ul>';
      
      weaponObjects.forEach((weapon: any) => {
        const weaponName = weapon.name || 'Unknown Weapon';
        const facing = weapon.facing || 'front';
        const attackDice = weapon.attackDice || '-';
        
        weaponsHtml += `<li>${weaponName} (${facing}) ${attackDice !== '-' ? attackDice + 'D' : ''}</li>`;
      });
      
      weaponsHtml += '</ul></div>';
    } else if (Array.isArray(vehicle.weapons) && vehicle.weapons.length > 0) {
      // Fallback to the old weapons array if weaponObjects not available
      weaponsHtml = '<div class="loadout-section"><div class="section-title">Weapons</div><ul>';
      
      vehicle.weapons.forEach((weapon: any) => {
        let weaponName = '';
        
        if (typeof weapon === 'string') {
          weaponName = weapon;
        } else if (weapon && typeof weapon === 'object') {
          weaponName = weapon.name || 'Unknown Weapon';
        } else {
          weaponName = 'Unknown Weapon';
        }
        
        weaponsHtml += `<li>${weaponName}</li>`;
      });
      
      weaponsHtml += '</ul></div>';
    }
    
    // Generate upgrades HTML using upgradeObjects if available
    let upgradesHtml = '';
    if (upgradeObjects.length > 0) {
      upgradesHtml = '<div class="loadout-section"><div class="section-title">Upgrades</div><ul>';
      
      upgradeObjects.forEach((upgrade: any) => {
        const upgradeName = upgrade.name || 'Unknown Upgrade';
        upgradesHtml += `<li>${upgradeName}</li>`;
      });
      
      upgradesHtml += '</ul></div>';
    } else if (Array.isArray(vehicle.upgrades) && vehicle.upgrades.length > 0) {
      // Fallback to the old upgrades array if upgradeObjects not available
      upgradesHtml = '<div class="loadout-section"><div class="section-title">Upgrades</div><ul>';
      
      vehicle.upgrades.forEach((upgrade: any) => {
        let upgradeName = '';
        
        if (typeof upgrade === 'string') {
          upgradeName = upgrade;
        } else if (upgrade && typeof upgrade === 'object') {
          upgradeName = upgrade.name || 'Unknown Upgrade';
        } else {
          upgradeName = 'Unknown Upgrade';
        }
        
        upgradesHtml += `<li>${upgradeName}</li>`;
      });
      
      upgradesHtml += '</ul></div>';
    }
    
    // Generate perks HTML using perkObjects if available
    let perksHtml = '';
    if (perkObjects.length > 0) {
      perksHtml = '<div class="loadout-section"><div class="section-title">Perks</div><ul>';
      
      perkObjects.forEach((perk: any) => {
        const perkName = perk.name || 'Unknown Perk';
        const level = perk.level || 1;
        perksHtml += `<li>${perkName} ${level > 1 ? `(Level ${level})` : ''}</li>`;
      });
      
      perksHtml += '</ul></div>';
    } else if (Array.isArray(vehicle.perks) && vehicle.perks.length > 0) {
      // Fallback to the old perks array if perkObjects not available
      perksHtml = '<div class="loadout-section"><div class="section-title">Perks</div><ul>';
      
      vehicle.perks.forEach((perk: any) => {
        let perkName = '';
        
        if (typeof perk === 'string') {
          perkName = perk;
        } else if (perk && typeof perk === 'object') {
          perkName = perk.name || 'Unknown Perk';
        } else {
          perkName = 'Unknown Perk';
        }
        
        perksHtml += `<li>${perkName}</li>`;
      });
      
      perksHtml += '</ul></div>';
    }
    
    // Handle vehicle type display
    let vehicleTypeName = 'Car';
    
    if (vehicleType && typeof vehicleType === 'object' && vehicleType.name) {
      vehicleTypeName = vehicleType.name;
    } else if (typeof type === 'string') {
      vehicleTypeName = type.charAt(0).toUpperCase() + type.slice(1);
    }
    
    // Return complete vehicle card HTML
    return `
    <div class="vehicle-card">
      <div class="card-header">
        <div>
          <div class="vehicle-name">${escapeHtml(name)}</div>
          <div class="vehicle-type">${vehicleTypeName}</div>
          ${(() => {
            const edition = editionFields(vehicle, rulesVersion);
            if (!edition) return '';
            return `<div class="vehicle-type">Driver: ${edition.driver}</div><div class="vehicle-type">Perk classes: ${edition.classes}</div>`;
          })()}
        </div>
        <div class="vehicle-cost">${cost} cans</div>
      </div>
      
      <div class="hull-track">
        <div class="stat-label">Hull</div>
        <div class="hull-boxes">${hullBoxesHtml}</div>
      </div>
      
      <div class="stats-section">
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-label">Handling</span>
            <span class="stat-value">${handling}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Gear</span>
            <span class="stat-value">${gear}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Crew</span>
            <span class="stat-value">${crew}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Weight</span>
            <span class="stat-value">${weight}</span>
          </div>
          ${(() => {
            const edition = editionFields(vehicle, rulesVersion);
            if (!edition) return '';
            return `<div class="stat-item"><span class="stat-label">Armour</span><span class="stat-value">${edition.armour}</span></div><div class="stat-item"><span class="stat-label">Build slots</span><span class="stat-value">${edition.slots}</span></div>`;
          })()}
        </div>
      </div>
      
      ${weaponsHtml}
      ${upgradesHtml}
      ${perksHtml}
      ${vehiclePhotoSectionHtml(vehicle)}
    </div>
    `;
  } catch (error) {
    console.error("[PrintService] Error generating vehicle card HTML:", error);
    return `<div class="vehicle-card">Error generating vehicle card: ${error instanceof Error ? error.message : String(error)}</div>`;
  }
}

/**
 * Convert weight number to text
 */
function getWeightText(weight: number | string): string {
  // Version 2 stores a class name. Version 3 stores the weight number, and that number is the stat.
  if (typeof weight === 'string') return weight;
  if (typeof weight === 'number' && Number.isFinite(weight)) return String(weight);
  return 'Middleweight';
}

/**
 * Generate HTML for equipment descriptions table
 */
function generateEquipmentDescriptionsHtml(vehicles: any[], rulesVersion?: number): string {
  if (!vehicles || !Array.isArray(vehicles) || vehicles.length === 0) {
    return '<tr><td colspan="2">No equipment found</td></tr>';
  }
  
  // Collect all unique weapons and upgrades
  const weaponMap = new Map();
  const upgradeMap = new Map();
  
  vehicles.forEach(vehicle => {
    // Process weapons
    if (vehicle.weaponObjects && Array.isArray(vehicle.weaponObjects)) {
      vehicle.weaponObjects.forEach((weapon: any) => {
        if (weapon && weapon.name && !weaponMap.has(weapon.name)) {
          weaponMap.set(weapon.name, {
            name: weapon.name,
            specialRules: weapon.specialRules || '',
            cost: weapon.cost || 0,
            id: weapon.id || ''
          });
        }
      });
    }
    
    // Process upgrades
    if (vehicle.upgradeObjects && Array.isArray(vehicle.upgradeObjects)) {
      vehicle.upgradeObjects.forEach((upgrade: any) => {
        if (upgrade && upgrade.name && !upgradeMap.has(upgrade.name)) {
          upgradeMap.set(upgrade.name, {
            name: upgrade.name,
            specialRules: upgrade.specialRules || '',
            cost: upgrade.cost || 0,
            id: upgrade.id || ''
          });
        }
      });
    }
  });
  
  // Get access to special rule descriptions if available
  const specialRulesMap = new Map();
  if (vehicles[0]?.draft?.weaponAndUpgradeSpecialRules && Array.isArray(vehicles[0].draft.weaponAndUpgradeSpecialRules)) {
    vehicles[0].draft.weaponAndUpgradeSpecialRules.forEach((rule: any) => {
      if (rule && rule.ruleName && rule.rule) {
        // Store by both rule ID and rule name (lowercase) for better matching
        specialRulesMap.set(rule.ruleName.toLowerCase(), rule.rule);
        if (rule.id) {
          specialRulesMap.set(rule.id.toLowerCase(), rule.rule);
        }
      }
    });
  }
  
  // Helper function to get full rule descriptions from weaponAndUpgradeSpecialRules
  const getRuleDescription = (ruleNames: string, weaponId?: string, upgradeName?: string) => {
    if (!ruleNames) return 'No special rules';
    
    const rulesArray = ruleNames.split(',').map(r => r.trim());
    let fullDescription = '<div style="margin-top: 8px;">';
    
    // Always show the full rules text for each special rule
    rulesArray.forEach(ruleName => {
      // Try to find the rule description - first by name, then by looking for exact ID match
      const lowerRuleName = ruleName.toLowerCase();
      let ruleDescription = specialRulesMap.get(lowerRuleName);
      
      // If not found by name, try to find by ID
      if (!ruleDescription) {
        // Look for any rule with an ID that matches this rule name
        const matchingRule = vehicles[0]?.draft?.weaponAndUpgradeSpecialRules?.find((r: any) =>
          r.id && r.id.toLowerCase() === lowerRuleName
        );
        if (matchingRule) {
          ruleDescription = matchingRule.rule;
        }
      }
      
      if (ruleDescription) {
        fullDescription += `<div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dotted #ccc;">
          <div style="font-weight: bold; margin-bottom: 3px; color: #444;">${ruleName}</div>
          <div>${ruleDescription}</div>
        </div>`;
      } else {
        fullDescription += `<div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dotted #ccc;">
          <div style="font-weight: bold; color: #444;">${ruleName}</div>
          <div>Special rule description not available.</div>
        </div>`;
      }
    });
    
    fullDescription += '</div>';
    return fullDescription;
  };
  
  // Create HTML rows
  let rowsHtml = '';
  
  // Add weapons
  weaponMap.forEach(weapon => {
    if (rulesVersion === 3) {
      rowsHtml += `
    <tr style="border-bottom: 1px solid #ddd;">
      <td style="padding: 8px; text-align: left; vertical-align: top; font-weight: bold;">${escapeHtml(weapon.name)} (${weapon.cost} cans)</td>
      <td style="padding: 8px; text-align: left;">${escapeHtml(weapon.specialRules || '')}${weapon.effect ? `<div>${escapeHtml(weapon.effect)}</div>` : ''}</td>
    </tr>`;
      return;
    }
    // Find matching special rule directly from weaponAndUpgradeSpecialRules if available
    let directRuleMatch = '';
    if (vehicles[0]?.draft?.weaponAndUpgradeSpecialRules) {
      // For a weapon with id like "caltrop_dropper_h-", look for rules with id "caltrop_dropper"
      // Try to find a rule that matches any prefix of the weapon ID
      const weaponParts = weapon.id.split('_');
      let matchingRule = null;
      
      for (let i = weaponParts.length; i > 0; i--) {
        const partialId = weaponParts.slice(0, i).join('_');
        const match = vehicles[0].draft.weaponAndUpgradeSpecialRules.find((rule: any) => rule.id === partialId);
        if (match) {
          matchingRule = match;
          break;
        }
      }
      
      // If no direct ID match, try looking for a rule with matching ruleName
      if (!matchingRule && weapon.specialRules) {
        const rulesArray = weapon.specialRules.split(',').map((r: string) => r.trim());
        for (const ruleName of rulesArray) {
          const match = vehicles[0].draft.weaponAndUpgradeSpecialRules.find(
            (rule: any) => rule.ruleName.toLowerCase() === ruleName.toLowerCase()
          );
          if (match) {
            matchingRule = match;
            break;
          }
        }
      }
      if (matchingRule && matchingRule.rule) {
        directRuleMatch = matchingRule.rule;
      }
    }
    
    rowsHtml += `
    <tr style="border-bottom: 1px solid #ddd;">
      <td style="padding: 8px; text-align: left; vertical-align: top; font-weight: bold;">${weapon.name} (${weapon.cost} cans)</td>
      <td style="padding: 8px; text-align: left;">
        ${directRuleMatch ? 
          `<div style="margin-bottom: 10px;">${directRuleMatch}</div>` : 
          (weapon.specialRules ? getRuleDescription(weapon.specialRules, weapon.id) : 'No special rules')
        }
      </td>
    </tr>`;
  });
  
  // Add upgrades
  upgradeMap.forEach(upgrade => {
    if (rulesVersion === 3) {
      rowsHtml += `
    <tr style="border-bottom: 1px solid #ddd;">
      <td style="padding: 8px; text-align: left; vertical-align: top; font-weight: bold;">${escapeHtml(upgrade.name)} (${upgrade.cost} cans)</td>
      <td style="padding: 8px; text-align: left;">${escapeHtml(upgrade.specialRules || '')}${upgrade.effect ? `<div>${escapeHtml(upgrade.effect)}</div>` : ''}</td>
    </tr>`;
      return;
    }
    // Find matching special rule directly from weaponAndUpgradeSpecialRules if available
    let directRuleMatch = '';
    if (vehicles[0]?.draft?.weaponAndUpgradeSpecialRules) {
      // Try to find a rule that matches the upgrade ID directly
      let matchingRule = vehicles[0].draft.weaponAndUpgradeSpecialRules.find(
        (rule: any) => rule.id === upgrade.id
      );
      
      // If no direct ID match, try looking for a rule with matching ruleName from specialRules
      if (!matchingRule && upgrade.specialRules) {
        const rulesArray = upgrade.specialRules.split(',').map((r: string) => r.trim());
        for (const ruleName of rulesArray) {
          const match = vehicles[0].draft.weaponAndUpgradeSpecialRules.find(
            (rule: any) => rule.ruleName.toLowerCase() === ruleName.toLowerCase()
          );
          if (match) {
            matchingRule = match;
            break;
          }
        }
      }
      if (matchingRule && matchingRule.rule) {
        directRuleMatch = matchingRule.rule;
      }
    }
    
    rowsHtml += `
    <tr style="border-bottom: 1px solid #ddd;">
      <td style="padding: 8px; text-align: left; vertical-align: top; font-weight: bold;">${upgrade.name} (${upgrade.cost} cans)</td>
      <td style="padding: 8px; text-align: left;">
        ${directRuleMatch ? 
          `<div style="margin-bottom: 10px;">${directRuleMatch}</div>` : 
          (upgrade.specialRules ? getRuleDescription(upgrade.specialRules, undefined, upgrade.name) : 'No special rules')
        }
      </td>
    </tr>`;
  });
  
  return rowsHtml || '<tr><td colspan="2">No equipment descriptions available</td></tr>';
}

/**
 * Generate HTML for perk descriptions table
 */
function generatePerkDescriptionsHtml(vehicles: any[], sponsorPerks: any): string {
  if ((!vehicles || !Array.isArray(vehicles) || vehicles.length === 0) && (!sponsorPerks)) {
    return '<tr><td colspan="2">No perks found</td></tr>';
  }
  
  // Collect all unique perks
  const perkMap = new Map();
  
  // Process vehicle perks - these are explicitly purchased
  vehicles.forEach(vehicle => {
    if (vehicle.perkObjects && Array.isArray(vehicle.perkObjects)) {
      vehicle.perkObjects.forEach((perk: any) => {
        if (perk && perk.name && !perkMap.has(perk.name)) {
          perkMap.set(perk.name, {
            name: perk.name,
            text: perk.text || '',
            level: perk.level || 1,
            type: 'vehicle' // These are vehicle-specific perks
          });
        }
      });
    }
  });
  
  // Process sponsor perks if available
  if (sponsorPerks) {
    // Build a set of all purchased perk IDs and names
    const purchasedPerkClasses = new Set();
    vehicles.forEach(vehicle => {
      // First try perkObjects (enhanced format)
      if (vehicle.perkObjects && Array.isArray(vehicle.perkObjects)) {
        vehicle.perkObjects.forEach((perk: any) => {
          // Try id, or if not available, try name
          if (perk) {
            if (perk.id) {
              purchasedPerkClasses.add(perk.id);
            } else if (perk.name) {
              purchasedPerkClasses.add(perk.name);
            }
          }
        });
      }
      // Fallback to perks array if perkObjects not available
      else if (vehicle.perks && Array.isArray(vehicle.perks)) {
        vehicle.perks.forEach((perk: any) => {
          if (typeof perk === 'string') {
            purchasedPerkClasses.add(perk);
          } else if (perk && perk.id) {
            purchasedPerkClasses.add(perk.id);
          } else if (perk && perk.name) {
            purchasedPerkClasses.add(perk.name);
          }
        });
      }
    });
    
    // Only include class perks that have been purchased
    if (sponsorPerks.classPerksList && Array.isArray(sponsorPerks.classPerksList)) {
      sponsorPerks.classPerksList.forEach((perk: any) => {
        // Only include if it's been purchased
        if (perk && perk.name && !perkMap.has(perk.name) && 
            (purchasedPerkClasses.has(perk.id) || purchasedPerkClasses.has(perk.name))) {
          perkMap.set(perk.name, {
            name: perk.name,
            text: perk.text || '',
            level: perk.level || 1,
            type: 'purchased' // Mark as purchased perk
          });
        }
      });
    }
    
    // Always include sponsor-specific perks
    if (sponsorPerks.sponsorPerksList && Array.isArray(sponsorPerks.sponsorPerksList)) {
      sponsorPerks.sponsorPerksList.forEach((perk: any) => {
        if (perk && perk.name && !perkMap.has(perk.name)) {
          perkMap.set(perk.name, {
            name: perk.name,
            text: perk.text || '',
            level: perk.level || 1,
            type: 'sponsor' // Mark as sponsor perk
          });
        }
      });
    }
  }
  
  // Create HTML rows - separate into sponsor perks and purchased perks
  let sponsorPerksHtml = '';
  let purchasedPerksHtml = '';
  let otherPerksHtml = '';  // For any perks that don't have a type
  
  perkMap.forEach(perk => {
    const levelText = perk.level > 1 ? ` (Level ${perk.level})` : '';
    const perkRow = `
    <tr style="border-bottom: 1px solid #ddd;">
      <td style="padding: 8px; text-align: left; vertical-align: top; font-weight: bold;">${perk.name}${levelText}</td>
      <td style="padding: 8px; text-align: left;">${perk.text || 'No description available'}</td>
    </tr>`;
    
    if (perk.type === 'sponsor') {
      sponsorPerksHtml += perkRow;
    } else if (perk.type === 'purchased') {
      purchasedPerksHtml += perkRow;
    } else {
      // Vehicle-specific perks or untyped perks
      otherPerksHtml += perkRow;
    }
  });
  
  // Combine sections with headers
  let rowsHtml = '';
  
  // Add sponsor perks section if any exist
  if (sponsorPerksHtml) {
    rowsHtml += `
    <tr>
      <td colspan="2" style="padding: 12px 8px; text-align: left; font-weight: bold; background-color: #f3f3f3; border-bottom: 2px solid #ddd; font-size: 1.1em;">
        Sponsor Perks
      </td>
    </tr>
    ${sponsorPerksHtml}`;
  }
  
  // Add purchased perks section if any exist
  if (purchasedPerksHtml) {
    rowsHtml += `
    ${rowsHtml ? '<tr><td colspan="2" style="height: 20px;"></td></tr>' : ''}
    <tr>
      <td colspan="2" style="padding: 12px 8px; text-align: left; font-weight: bold; background-color: #f3f3f3; border-bottom: 2px solid #ddd; font-size: 1.1em;">
        Purchased Perks
      </td>
    </tr>
    ${purchasedPerksHtml}`;
  }
  
  // Add other perks section if any exist
  if (otherPerksHtml) {
    rowsHtml += `
    ${rowsHtml ? '<tr><td colspan="2" style="height: 20px;"></td></tr>' : ''}
    <tr>
      <td colspan="2" style="padding: 12px 8px; text-align: left; font-weight: bold; background-color: #f3f3f3; border-bottom: 2px solid #ddd; font-size: 1.1em;">
        Purchased Perks
      </td>
    </tr>
    ${otherPerksHtml}`;
  }
  
  return rowsHtml || '<tr><td colspan="2">No perk descriptions available</td></tr>';
}

/**
 * Generate HTML table rows for vehicle special rules descriptions
 */
function generateVehicleSpecialRulesHtml(vehicles: any[]): string {
  if (!vehicles || !Array.isArray(vehicles) || vehicles.length === 0) {
    return '<tr><td colspan="2">No special rules found</td></tr>';
  }
  
  // Collect all unique special rules
  const specialRulesMap = new Map();
  
  vehicles.forEach(vehicle => {
    // Get special rules from either the vehicle directly or the vehicle type
    const specialRulesString = vehicle.specialRules || vehicle.vehicleType?.specialRules;
    
    if (specialRulesString) {
      // Split the comma-separated rules
      const rulesArray = specialRulesString.split(',').map((rule: string) => rule.trim());
      
      rulesArray.forEach((ruleName: string) => {
        if (!specialRulesMap.has(ruleName)) {
          // Find rule description if it exists
          let ruleDescription = '';
          const ruleDetails = findVehicleRule(vehicle.vehicleRules, ruleName);
          if (ruleDetails && ruleDetails.rule) {
            ruleDescription = ruleDetails.rule;
          }
          
          // Use the readable ruleName for display, but keep the original name for matching
          const displayName = ruleDetails?.ruleName || ruleName;
          
          specialRulesMap.set(ruleName, {
            name: displayName,
            description: ruleDescription
          });
        }
      });
    }
  });
  
  if (specialRulesMap.size === 0) {
    return '<tr><td colspan="2">No special rules found</td></tr>';
  }
  
  // Convert map to array and sort by rule name
  const specialRulesArray = Array.from(specialRulesMap.values())
    .sort((a, b) => a.name.localeCompare(b.name));
  
  // Generate HTML for each rule
  let rulesHtml = '';
  specialRulesArray.forEach(rule => {
    rulesHtml += `
    <tr style="border-bottom: 1px solid #ddd;">
      <td style="padding: 8px; text-align: left; vertical-align: top; font-weight: bold;">${rule.name}</td>
      <td style="padding: 8px; text-align: left;">${rule.description && rule.description.includes('<p>') ? rule.description : `<p>${rule.description}</p>`}</td>
    </tr>`;
  });
  
  return rulesHtml || '<tr><td colspan="2">No special rules available</td></tr>';
}

/**
 * Generate HTML for roster perks section - only purchased and sponsor perks
 */
function generateRosterPerksHtml(vehicles: any[], sponsorPerks: any): string {
  const perkMap = new Map();
  
  // Collect purchased perks from all vehicles
  if (vehicles && Array.isArray(vehicles)) {
    vehicles.forEach(vehicle => {
      if (vehicle.perkObjects && Array.isArray(vehicle.perkObjects)) {
        vehicle.perkObjects.forEach((perk: any) => {
          if (perk && perk.name && !perkMap.has(perk.name)) {
            perkMap.set(perk.name, {
              name: perk.name,
              text: perk.text || 'No description available',
              type: 'purchased'
            });
          }
        });
      }
    });
  }
  
  // Add sponsor-specific perks
  let sponsorPerksCount = 0;
  if (sponsorPerks && sponsorPerks.sponsorPerksList && Array.isArray(sponsorPerks.sponsorPerksList)) {
    sponsorPerks.sponsorPerksList.forEach((perk: any) => {
      if (perk && perk.name && !perkMap.has(perk.name)) {
        perkMap.set(perk.name, {
          name: perk.name,
          text: perk.text || 'No description available',
          type: 'sponsor'
        });
        sponsorPerksCount++;
      }
    });
  }
  
  // If no perks to show, return empty string
  if (perkMap.size === 0) {
    return '';
  }
  
  // Generate HTML
  let html = `
  <div class="sponsor-perks-section" style="margin-top: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 5px; background-color: #f9f9f9;">
    <h3 style="margin: 0 0 10px 0; font-size: 14pt; color: #333;">Team Perks</h3>`;
  
  // Show sponsor perks first
  if (sponsorPerksCount > 0) {
    html += `
    <div style="margin-bottom: 15px;">
      <h4 style="margin: 0 0 8px 0; font-size: 11pt; color: #666;">Sponsor Perks (Automatic)</h4>`;
    
    perkMap.forEach(perk => {
      if (perk.type === 'sponsor') {
        html += `
        <div style="margin-bottom: 8px; padding: 8px; background-color: #fff; border-radius: 3px; border-left: 3px solid #d97706;">
          <div style="font-weight: bold; font-size: 10pt; color: #333;">${perk.name}</div>
          <div style="font-size: 9pt; color: #666; margin-top: 2px;">${perk.text}</div>
        </div>`;
      }
    });
    
    html += `</div>`;
  }
  
  // Show purchased perks
  const purchasedPerks = Array.from(perkMap.values()).filter(perk => perk.type === 'purchased');
  if (purchasedPerks.length > 0) {
    html += `
    <div>
      <h4 style="margin: 0 0 8px 0; font-size: 11pt; color: #666;">Purchased Perks</h4>`;
    
    purchasedPerks.forEach(perk => {
      html += `
      <div style="margin-bottom: 8px; padding: 8px; background-color: #fff; border-radius: 3px; border-left: 3px solid #10b981;">
        <div style="font-weight: bold; font-size: 10pt; color: #333;">${perk.name}</div>
        <div style="font-size: 9pt; color: #666; margin-top: 2px;">${perk.text}</div>
      </div>`;
    });
    
    html += `</div>`;
  }
  
  html += `</div>`;
  
  return html;
}

/**
 * Generate HTML for Roster style printing - simple table format
 */
function generateRosterHtml(data: PrintHtmlData): string {
  const {
    teamName,
    totalCans,
    maxCans,
    sponsorName,
    vehicles,
    sponsor,
    sponsorPerks,
    qrCode,
    showEquipmentDescriptions = true,
    showPerkDescriptions = true,
    showSpecialRules = true,
    rulesVersion
  } = data;
  
  // Calculate actual total cost if the passed totalCans is 0 or invalid
  const actualTotalCans = totalCans || calculateTotalCost(vehicles);
  
  // Helper function to safely get weapon, upgrade and perk names
  const getNameFromItem = (item: any): string => {
    if (!item) return 'Unknown';
    return item.name || item.id || 'Unknown';
  };
  
  // Generate HTML for roster style - clean, compact layout
  let vehiclesHtml = '';
  
  // Create vehicle sections
  if (vehicles && Array.isArray(vehicles)) {
    vehicles.forEach((vehicle) => {
      const {
        type = 'Car',
        name = 'Vehicle',
        cost = 0,
        vehicleRules = [],
        vehicleType = null,
        weaponObjects = [],
        upgradeObjects = [],
        perkObjects = []
      } = vehicle;
      const printed = resolvedPrintStats(vehicle);
      const handling = printed.handling;
      const maxGear = printed.gear;
      const crew = printed.crew;
      const hull = printed.hull;
      const weight = printed.weight;
      
      // Get the display name for the vehicle type
      const vehicleTypeName = vehicleType?.name || type;
      
      // Start vehicle section
      vehiclesHtml += `
      <div class="vehicle-section">
        <div class="vehicle-header">
          <h3><span class="vehicle-title">${escapeHtml(name)}</span> <span class="vehicle-type">${escapeHtml(vehicleTypeName)}</span> <span class="vehicle-cost">${cost} cans</span></h3>
        </div>
        
        <div class="stats-row">
          <div class="stat"><span class="stat-label">Handling</span> ${handling}</div>
          <div class="stat"><span class="stat-label">Max Gear</span> ${maxGear}</div>
          <div class="stat"><span class="stat-label">Crew</span> ${crew}</div>
          <div class="stat"><span class="stat-label">Hull</span> ${hull}</div>
          <div class="stat"><span class="stat-label">Weight</span> ${weight}</div>
          ${(() => {
            const edition = editionFields(vehicle, rulesVersion);
            if (!edition) return '';
            return `<div class="stat"><span class="stat-label">Armour</span> ${edition.armour}</div><div class="stat"><span class="stat-label">Build slots</span> ${edition.slots}</div><div class="stat"><span class="stat-label">Driver</span> ${edition.driver}</div><div class="stat"><span class="stat-label">Perk classes</span> ${edition.classes}</div>`;
          })()}
        </div>`;
        
      // Add Vehicle Rules if available (only rules specific to this vehicle type)
      if (showSpecialRules) {
        let rulesText = '';
        let rulesList = [];
        
        // Get vehicle-specific special rules only
        if (vehicle.vehicleType && vehicle.vehicleType.specialRules && typeof vehicle.vehicleType.specialRules === 'string' && vehicle.vehicleType.specialRules.trim()) {
          rulesText = vehicle.vehicleType.specialRules.trim();
        } else if (vehicle.specialRules && typeof vehicle.specialRules === 'string' && vehicle.specialRules.trim()) {
          rulesText = vehicle.specialRules.trim();
        }
        
        // Parse the rules and look up their human-readable names
        if (rulesText && vehicle.vehicleRules && Array.isArray(vehicle.vehicleRules)) {
          const ruleIds = rulesText.split(',').map((r: string) => r.trim());
          for (const ruleId of ruleIds) {
            const ruleDetails = findVehicleRule(vehicle.vehicleRules, ruleId);
            if (ruleDetails && ruleDetails.ruleName) {
              rulesList.push(ruleDetails.ruleName);
            } else {
              rulesList.push(ruleId);
            }
          }
        } else if (rulesText) {
          // Fallback to displaying the raw text if vehicleRules not available
          rulesList = [rulesText];
        }
        
        // Only add the rules section if this vehicle type has specific rules
        if (rulesList.length > 0) {
          vehiclesHtml += `<div class="rules-section">`;
          vehiclesHtml += `<div class="vehicle-rules">Vehicle Rules: ${rulesList.join(', ')}</div>`;
          vehiclesHtml += `</div>`;
        }
      }
      
      // WEAPONS SECTION
      if (weaponObjects && weaponObjects.length > 0) {
        vehiclesHtml += `
        <div class="equipment-section">
          <h4>Weapons</h4>
          <ul class="equipment-list">`;
        
        weaponObjects.forEach((weapon: any) => {
          if (weapon) {
            const facing = weapon.facing
              || (vehicle.weaponFacings && vehicle.weaponFacings[weapon.id])
              || 'front';
            
            vehiclesHtml += `<li>
              <span class="equipment-name">${weapon.name || 'Unknown'}</span>
              <span class="equipment-details">`;
            
            // Build details
            const details = [`Facing: ${facing}`];
            if (weapon.attackDice && weapon.attackDice !== '-') details.push(`Attack: ${weapon.attackDice}`);
            if (weapon.range && weapon.range !== '-') details.push(`Range: ${weapon.range}`);
            if (weapon.cost) details.push(`${weapon.cost} cans`);
            
            vehiclesHtml += details.join(' | ');
            vehiclesHtml += `</span>`;
            
            // Add special rules if they exist and are enabled
            if (weapon.specialRules && showEquipmentDescriptions) {
              vehiclesHtml += `<div class="special-rules">
                <span class="rules-label">Special:</span> ${weapon.specialRules}
              </div>`;
            }
            
            vehiclesHtml += `</li>`;
          }
        });
        
        vehiclesHtml += `</ul>
        </div>`;
      }
      
      // UPGRADES SECTION
      if (upgradeObjects && upgradeObjects.length > 0) {
        vehiclesHtml += `
        <div class="equipment-section">
          <h4>Upgrades</h4>
          <ul class="equipment-list">`;
        
        upgradeObjects.forEach((upgrade: any) => {
          if (upgrade) {
            vehiclesHtml += `<li>
              <span class="equipment-name">${upgrade.name || 'Unknown Upgrade'}</span>`;
            
            // Add cost if available
            if (upgrade.cost) {
              vehiclesHtml += `<span class="equipment-details">${upgrade.cost} cans</span>`;
            }
            
            // Add special rules if they exist and are enabled
            if (upgrade.specialRules && showEquipmentDescriptions) {
              vehiclesHtml += `<div class="special-rules">
                <span class="rules-label">Special:</span> ${upgrade.specialRules}
              </div>`;
            }
            
            vehiclesHtml += `</li>`;
          }
        });
        
        vehiclesHtml += `</ul>
        </div>`;
      }
      
      // PERKS SECTION
      if (perkObjects && perkObjects.length > 0) {
        vehiclesHtml += `
        <div class="equipment-section">
          <h4>Perks</h4>
          <ul class="equipment-list">`;
        
        perkObjects.forEach((perk: any) => {
          if (perk) {
            vehiclesHtml += `<li>
              <span class="equipment-name">${perk.name || 'Unknown Perk'}</span>`;
            
            // Add descriptions if enabled
            if (perk.text && showPerkDescriptions) {
              vehiclesHtml += `<div class="perk-description">${perk.text}</div>`;
            }
            
            vehiclesHtml += `</li>`;
          }
        });
        
        vehiclesHtml += `</ul>
        </div>`;
      }
      
      vehiclesHtml += vehiclePhotoSectionHtml(vehicle);
      // Close vehicle section. Vehicles share a page until one no longer fits.
      vehiclesHtml += `</div>`;
    });
  } else {
    vehiclesHtml = '<p>No vehicles found</p>';
  }
  
  // Generate the final HTML with clean styling
  return `<!DOCTYPE html>
  <html>
  <head>
    <title>${escapeHtml(teamName)} - Gaslands Roster</title>
    <meta charset="utf-8">
    <style>
      body {
        font-family: Arial, sans-serif;
        font-size: 11pt;
        line-height: 1.3;
        color: #000;
        background: #fff;
        margin: 0;
        padding: 10px;
      }
      
      /* Print settings */
      @media print {
        @page {
          size: auto;
          margin: 15mm 10mm;
        }
        
        body {
          margin: 0;
          padding: 10px;
        }
        
        .page-break {
          page-break-after: always;
          height: 0;
          display: block;
        }
        
        button {
          display: none !important;
        }
      }
      
      /* Header styles */
      .team-header {
        margin-bottom: 15px;
        padding-bottom: 5px;
        border-bottom: 1px solid #444;
      }
      
      h1 {
        font-size: 18pt;
        margin: 0 0 3px 0;
        color: #000;
      }
      
      .team-info {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 6px 16px;
        font-size: 10pt;
      }
      
      /* Vehicle section */
      .vehicle-section {
        margin-bottom: 20px;
        padding-bottom: 15px;
        border-bottom: 1px solid #ccc;
      }
      
      .vehicle-header {
        border-bottom: 1px solid #ddd;
        margin-bottom: 8px;
        padding-bottom: 4px;
      }
      
      .vehicle-header h3 {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 6px 10px;
        font-size: 14pt;
        margin: 0;
        font-weight: 600;
        overflow-wrap: anywhere;
      }

      .vehicle-title {
        overflow-wrap: anywhere;
      }
      
      .vehicle-type {
        font-weight: normal;
        font-style: italic;
        color: #444;
        margin-left: 5px;
      }
      
      .vehicle-cost {
        margin-left: auto;
        font-weight: bold;
        white-space: nowrap;
      }
      
      /* Stats section */
      .stats-row {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        margin-bottom: 12px;
        padding: 5px;
        background-color: #f8f8f8;
        border-radius: 3px;
      }
      
      .stat {
        text-align: center;
        flex: 1;
        min-width: 60px;
        font-size: 14pt;
        font-weight: bold;
      }
      
      .stat-label {
        display: block;
        font-size: 8pt;
        text-transform: uppercase;
        font-weight: normal;
        color: #666;
      }
      
      .rules-section {
        margin-bottom: 12px;
        font-size: 9pt;
      }
      
      .vehicle-rules {
        margin-bottom: 5px;
        font-style: italic;
      }
      
      /* Equipment sections */
      .equipment-section {
        margin-bottom: 15px;
      }
      
      .equipment-section h4 {
        font-size: 11pt;
        margin: 8px 0 4px 0;
        padding-bottom: 2px;
        border-bottom: 1px dotted #ccc;
      }
      
      .equipment-list {
        margin: 0;
        padding: 0 0 0 20px;
        list-style-type: square;
      }
      
      .equipment-list li {
        margin-bottom: 5px;
      }
      
      .equipment-name {
        font-weight: bold;
      }
      
      .equipment-details {
        font-size: 9pt;
        color: #444;
      }
      
      .special-rules {
        font-size: 8pt;
        margin-top: 2px;
        margin-left: 12px;
        color: #555;
        line-height: 1.2;
      }
      
      .rules-label {
        font-weight: bold;
        color: #333;
      }
      
      .perk-description {
        font-size: 8pt;
        margin-top: 2px;
        margin-left: 12px;
        font-style: italic;
        line-height: 1.2;
      }
      
      /* QR code and footer */
      .qr-section {
        text-align: center;
        margin-top: 20px;
        border-top: 1px solid #ddd;
        padding-top: 10px;
      }
      
      .qr-code {
        max-width: 100px;
        height: auto;
      }
      
      .qr-caption {
        font-size: 8pt;
        margin-top: 4px;
        color: #666;
      }
      
      .roster-footer {
        margin-top: 15px;
        text-align: center;
        font-size: 8pt;
        color: #888;
      }
    </style>
  </head>
  <body>
    <div class="team-header">
      <h1>${escapeHtml(teamName)}</h1>
      <div class="team-info">
        <div>Sponsor: ${escapeHtml(sponsorName)}</div>
        ${editionSponsorNote(rulesVersion, sponsor)}
        <div>Team Cost: ${actualTotalCans} / ${maxCans} cans</div>
      </div>
    </div>
    
    <div class="roster-content">
      ${vehiclesHtml}
    </div>
    
    <!-- Team Perks Section for Roster Style -->
    ${generateRosterPerksHtml(vehicles, sponsorPerks)}
    
    <div class="qr-section">
      ${qrCode ?
        `<img src="${qrCode}" class="qr-code" alt="QR Code for team">
        <div class="qr-caption">Scan to load this team</div>` :
        ''
      }
      <div class="roster-footer">
        Generated by Gaslands Garage on ${new Date().toLocaleDateString()}
      </div>
    </div>
  </body>
  </html>`;
}

/**
 * Print team in Dashboard style - separate function for clarity
 */
export async function printTeamDashboard(draft: PrintDraft): Promise<void> {
  // Validate draft before proceeding
  if (!draft) {
    console.error("[PrintService] Draft is null or undefined in dashboard print");
    alert("Unable to print: Missing team data");
    return;
  }
  
  if (!teamHasVehicles(draft)) {
    console.error("[PrintService] No vehicles in draft for dashboard print");
    return;
  }
  
  console.log("[PrintService] printTeamDashboard called with", draft.vehicles.length, "vehicles");
  
  // Add weaponAndUpgradeSpecialRules to vehicles for access in generateEquipmentDescriptionsHtml
  if (draft.rulesVersion !== 3) {
    draft.vehicles.forEach(vehicle => {
      vehicle.draft = { weaponAndUpgradeSpecialRules: draft.weaponAndUpgradeSpecialRules };
    });
  }
  console.log("[PrintService] printTeamDashboard called");
  console.log("[PrintService] Draft structure:", Object.keys(draft));
  
  try {
    // Log details of draft for debugging
    console.log("[PrintService] Draft details:", {
      teamName: draft.teamName,
      sponsorName: draft.sponsorName,
      hasVehicles: Boolean(draft.vehicles),
      isVehiclesArray: Array.isArray(draft.vehicles),
      vehiclesLength: draft.vehicles?.length,
      firstVehicle: draft.vehicles?.[0] ? Object.keys(draft.vehicles[0]) : null,
      printStyle: draft.printStyle,
      showEquipmentDescriptions: draft.showEquipmentDescriptions,
      showPerkDescriptions: draft.showPerkDescriptions,
      showSpecialRules: draft.showSpecialRules
    });
    
    // Basic validation
    if (!teamHasVehicles(draft)) {
      return;
    }
    
    // Collect data for printing
    const printData: PrintHtmlData = {
      teamName: draft.teamName || 'Gaslands Team',
      totalCans: draft.totalCans || 0,
      maxCans: draft.maxCans || 50,
      sponsorName: draft.sponsorName || 'No Sponsor',
      sponsor: draft.sponsor || null,
      sponsorPerks: draft.showPerkDescriptions ? (draft.sponsorPerks || null) : null,
      vehicles: draft.vehicles,
      qrCode: draft.qrCode,
      showEquipmentDescriptions: draft.showEquipmentDescriptions ?? true,
      showPerkDescriptions: draft.showPerkDescriptions ?? true,
      showSpecialRules: draft.showSpecialRules ?? true,
      printStyle: 'dashboard', // Force dashboard style
      rulesVersion: draft.rulesVersion
    };
    
    // Generate dashboard HTML
    console.log("[PrintService] Generating dashboard HTML with data:", {
      teamName: printData.teamName,
      sponsorName: printData.sponsorName,
      vehicleCount: printData.vehicles.length,
      showEquipmentDescriptions: printData.showEquipmentDescriptions,
      showPerkDescriptions: printData.showPerkDescriptions,
      showSpecialRules: printData.showSpecialRules,
      vehicleRulesAvailable: printData.vehicles[0]?.vehicleRules ? true : false,
      firstVehicleId: printData.vehicles[0]?.id || 'none'
    });
    
    // Call the generateDashboardHtml function to create the full dashboard HTML
    const dashboardHtml = generateDashboardHtml(printData);
    
    // Open and populate print window
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      alert('Please allow popups to print your team');
      return;
    }
    
    // Write simplified HTML
    printWindow.document.write(dashboardHtml);
    
    // Add CSS to hide buttons when printing
    const printMediaStyle = printWindow.document.createElement('style');
    printMediaStyle.textContent = `
      @media print {
        button {
          display: none !important;
        }
      }
    `;
    printWindow.document.head.appendChild(printMediaStyle);
    
    printWindow.document.close();
    
    // Add unified print buttons
    addPrintButtons(printWindow);
    
    // No longer auto-printing
    setTimeout(() => {
      try {
        // Just make sure the content is fully loaded
        console.log("[PrintService] Dashboard print window ready for user interaction");
      } catch (printError) {
        console.error("[PrintService] Error during dashboard window preparation:", printError);
        alert('Error preparing the print view. Please try again.');
      }
    }, 1000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[PrintService] Error in printTeamDashboard:", error);
    console.error("[PrintService] Dashboard error details:", {
      message,
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      typeof_draft: typeof draft,
      draft_keys: draft ? Object.keys(draft) : null,
      vehicles_length: draft?.vehicles?.length
    });
    
    // Provide more specific error messages based on the type of error
    if (message.includes("qrCode")) {
      alert('There was an error generating the QR code. Try again or print without QR codes.');
    } else if (message.includes("vehicle")) {
      alert('There was an error processing vehicle data. Please check your team and try again.');
    } else {
      alert('There was an error preparing for printing. Please try again with a different print style.');
    }
  }
}

/**
 * Main print function that generates and opens printable content in a new window
 */
export async function printTeam(printStyle: string, draft: PrintDraft): Promise<void> {
  // Validate draft before proceeding
  if (!draft) {
    console.error("[PrintService] Draft is null or undefined");
    alert("Unable to print: Missing team data");
    return;
  }
  
  if (!teamHasVehicles(draft)) {
    console.error("[PrintService] No vehicles in draft");
    return;
  }
  
  console.log("[PrintService] Preparing to print team with style:", printStyle, "and", draft.vehicles.length, "vehicles");
  
  // Check if we should use the dashboard style - handle various naming variations
  const actualPrintStyle = String(printStyle || draft.printStyle || 'classic').toLowerCase().trim();
  
  if (actualPrintStyle === 'dashboard' || actualPrintStyle === 'dashboard_v2' || actualPrintStyle.includes('dashboard')) {
    console.log("[PrintService] Redirecting to dashboard print style from:", { printStyle, draftPrintStyle: draft.printStyle });
    // Make sure printStyle is set in the draft
    draft.printStyle = 'dashboard';
    return printTeamDashboard(draft);
  }
  
  // Check for roster style
  if (actualPrintStyle === 'roster' || actualPrintStyle.includes('roster')) {
    console.log("[PrintService] Using roster print style");
    // Continue with the regular printTeam function but use the roster style
    draft.printStyle = 'roster';
  } else {
    // Continue with classic style
    console.log("[PrintService] Using classic print style");
    draft.printStyle = 'classic';
  }
  
  console.log("[PrintService] printTeam called with style parameter:", printStyle);

  try {
    // Dump the draft data to console to debug vehicle data
    console.log("[PrintService] Print data:", JSON.stringify(draft, null, 2));

    // Generate QR code
    let qrCode = null;
    try {
      // If the draft already has a QR code, use it
      if (draft.qrCode && typeof draft.qrCode === 'string' && draft.qrCode.startsWith('data:image/')) {
        console.log("[PrintService] Using provided QR code from draft");
        qrCode = draft.qrCode;
      } else {
        // Generate a new QR code
        console.log("[PrintService] Generating new QR code for draft with vehicles:", draft.vehicles.length);

        // Create a simplified version of the draft to encode with null checks
        const simpleDraft = {
          sponsor: printSponsorId(draft.sponsor),
          teamName: draft.teamName || 'Gaslands Team',
          vehicles: draft.vehicles.map(v => ({
            id: v.id,
            type: v.type,
            name: v.name || 'Vehicle',
            weapons: v.weapons || [],
            upgrades: v.upgrades || [],
            perks: v.perks || [],
            weaponFacings: v.weaponFacings || {}
          }))
        };

        // Generate the QR code using the simplified draft
        qrCode = await draftToDataURL(simpleDraft);
        console.log("[PrintService] QR code generated, length:", qrCode?.length || 0);
      }

      // Final validation
      if (!qrCode || typeof qrCode !== 'string' || !qrCode.startsWith('data:image/')) {
        console.error("[PrintService] Invalid QR code generated:", qrCode?.substring(0, 30));
        qrCode = null;
      }
    } catch (qrError) {
      console.error("[PrintService] Error generating QR code:", qrError);
      qrCode = null;
    }

    // Check if vehicles array exists and contains at least one valid vehicle
    const hasValidVehicles = draft.vehicles && 
      Array.isArray(draft.vehicles) && 
      draft.vehicles.length > 0 &&
      draft.vehicles.some(v => v && typeof v === 'object');
      
    if (!hasValidVehicles) {
      console.error("[PrintService] No valid vehicles found in draft data", draft.vehicles);
      return;
    }

    // Determine if we should include equipment and perk descriptions
    const showEquipmentDescriptions = draft.showEquipmentDescriptions !== undefined ?
      draft.showEquipmentDescriptions : true;

    const showPerkDescriptions = draft.showPerkDescriptions !== undefined ?
      draft.showPerkDescriptions : true;

    console.log("[PrintService] Print options:", {
      showEquipmentDescriptions,
      showPerkDescriptions,
      printStyle
    });

    // Collect data for printing
    const printData = {
      teamName: draft.teamName || 'Gaslands Team',
      totalCans: draft.totalCans || 0,
      maxCans: draft.maxCans || 50,
      sponsorName: draft.sponsorName || 'No Sponsor',
      sponsor: draft.sponsor || null,
      // Always include sponsorPerks data, but control visibility in the templates
      sponsorPerks: draft.sponsorPerks || null,
      vehicles: draft.vehicles,
      qrCode: qrCode,
      showEquipmentDescriptions: showEquipmentDescriptions,
      showPerkDescriptions: showPerkDescriptions,
      showSpecialRules: draft.showSpecialRules ?? true,
      weaponAndUpgradeSpecialRules: draft.weaponAndUpgradeSpecialRules || [],
      printStyle,
      rulesVersion: draft.rulesVersion
    };
    console.log("[PrintService] Using print style for HTML generation:", printStyle);
    console.log("[PrintService] Print data settings:", {
      showEquipmentDescriptions: printData.showEquipmentDescriptions,
      showPerkDescriptions: printData.showPerkDescriptions,
      showSpecialRules: printData.showSpecialRules,
      vehicleRulesAvailable: printData.vehicles[0]?.vehicleRules ? true : false,
      firstVehicleId: printData.vehicles[0]?.id || 'none'
    });
    
    // Generate printable HTML
    const printHtml = generatePrintableHtml(printData);
    
    // Log the HTML for debugging
    console.log("[PrintService] Generated HTML length:", printHtml.length);
    console.log("[PrintService] Generated HTML contains dashboard:", printHtml.includes("dashboard-card"));
    
    // Open a new window for printing
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    
    if (!printWindow) {
      console.error("[PrintService] Failed to open print window");
      alert('Please allow popups to print your team');
      return;
    }
    
    // Write HTML to print window
    printWindow.document.write(printHtml);
    
    // Add CSS to hide buttons when printing
    const printMediaStyle = printWindow.document.createElement('style');
    printMediaStyle.textContent = `
      @media print {
        button {
          display: none !important;
        }
      }
    `;
    printWindow.document.head.appendChild(printMediaStyle);
    
    printWindow.document.close();
    
    // Debug the new window
    console.log("[PrintService] Created print window with document length:", 
      printWindow.document.documentElement.innerHTML.length);
    
    // Check for vehicle cards in the new window
    const vehicleCards = printWindow.document.querySelectorAll('.vehicle-card');
    console.log("[PrintService] Vehicle cards in print window:", vehicleCards.length);
    
    // Print after a delay to ensure content is loaded
    setTimeout(() => {
      try {
        // Double check vehicle cards are present
        const vehicleCardsCheck = printWindow.document.querySelectorAll('.vehicle-card');
        console.log("[PrintService] Vehicle cards before printing:", vehicleCardsCheck.length);
        
        // Add unified print buttons (Print, Change Print Settings, Close Window)
        addPrintButtons(printWindow);
        
        // We no longer automatically open the print dialog
        // The user can use the Print button if they want to print
        
        // We no longer automatically close the window
        // User must close it manually with the close button
      } catch (printError) {
        console.error("[PrintService] Error during printing:", printError);
        alert('Error during printing. Please try again.');
      }
    }, 1000); // Increased timeout for content loading
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[PrintService] Error in printTeam:", error);
    console.error("[PrintService] Error details:", {
      message,
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      typeof_draft: typeof draft,
      draft_keys: draft ? Object.keys(draft) : null,
      vehicles_length: draft?.vehicles?.length
    });
    
    // Provide more specific error messages based on the type of error
    if (message.includes("qrCode")) {
      alert('There was an error generating the QR code. You can still print, but without a QR code.');
      // Don't automatically print, let the user use the print button
    } else if (message.includes("vehicle")) {
      alert('There was an error processing vehicle data. Please check your team and try again.');
    } else {
      alert('There was an error preparing for printing. Please try again or try a different print style.');
    }
  }
}

/**
 * Add standard print buttons to any print window - unified across all print styles
 * Order: Print (blue), Change Print Settings (green), Close Window (orange)
 */
function addPrintButtons(printWindow: Window): void {
  // Create Print button (blue, leftmost)
  const printButton = printWindow.document.createElement('button');
  printButton.innerHTML = 'Print';
  printButton.style.position = 'fixed';
  printButton.style.top = '10px';
  printButton.style.right = '340px'; // Leftmost
  printButton.style.padding = '8px 16px';
  printButton.style.backgroundColor = '#2563eb'; // Blue
  printButton.style.color = 'white';
  printButton.style.border = 'none';
  printButton.style.borderRadius = '4px';
  printButton.style.cursor = 'pointer';
  printButton.style.zIndex = '1000';
  printButton.style.fontWeight = 'bold';
  printButton.addEventListener('click', function() {
    printWindow.print();
  });
  
  // Create Change Print Settings button (green, middle)
  const settingsButton = printWindow.document.createElement('button');
  settingsButton.innerHTML = 'Change Print Settings';
  settingsButton.style.position = 'fixed';
  settingsButton.style.top = '10px';
  settingsButton.style.right = '150px'; // Middle
  settingsButton.style.padding = '8px 16px';
  settingsButton.style.backgroundColor = '#047857'; // Green
  settingsButton.style.color = 'white';
  settingsButton.style.border = 'none';
  settingsButton.style.borderRadius = '4px';
  settingsButton.style.cursor = 'pointer';
  settingsButton.style.zIndex = '1000';
  settingsButton.style.fontWeight = 'bold';
  settingsButton.addEventListener('click', function() {
    try {
      const timestamp = new Date().getTime();
      localStorage.setItem('openPrintSettings', timestamp.toString());
      if (window.opener && typeof window.opener.openSettings === 'function') {
        window.opener.openSettings('print');
      }
    } catch (err) {
      console.error("Error setting localStorage:", err);
    }
    printWindow.close();
  });
  
  // Create Close Window button (orange, rightmost)
  const closeButton = printWindow.document.createElement('button');
  closeButton.innerHTML = 'Close Window';
  closeButton.style.position = 'fixed';
  closeButton.style.top = '10px';
  closeButton.style.right = '10px'; // Rightmost
  closeButton.style.padding = '8px 16px';
  closeButton.style.backgroundColor = '#d97706'; // Orange
  closeButton.style.color = 'white';
  closeButton.style.border = 'none';
  closeButton.style.borderRadius = '4px';
  closeButton.style.cursor = 'pointer';
  closeButton.style.zIndex = '1000';
  closeButton.style.fontWeight = 'bold';
  closeButton.addEventListener('click', function() {
    printWindow.close();
  });
  
  // Add buttons to document in order
  printWindow.document.body.insertBefore(printButton, printWindow.document.body.firstChild);
  printWindow.document.body.insertBefore(settingsButton, printWindow.document.body.firstChild);
  printWindow.document.body.insertBefore(closeButton, printWindow.document.body.firstChild);
}

/**
 * Print the same sheet as the other styles, with each vehicle's photos.
 * The window is opened by the click handler before the photos are fetched.
 * Photos are object URLs from bytes loaded with the signed-in account.
 * releasePhotos revokes those URLs when the print window closes.
 * Photo captions and addresses are escaped. The document is a blob URL, and
 * window.opener is cleared before any other script runs.
 */
export async function printTeamWithPhotos(
  printStyle: string,
  draft: PrintDraft,
  printWindow: Window,
  releasePhotos?: () => void
): Promise<void> {
  const release = () => releasePhotos?.();
  if (!draft || !teamHasVehicles(draft)) {
    printWindow.close();
    release();
    return;
  }
  const style = String(printStyle || draft.printStyle || 'classic');
  const html = generatePrintableHtml({
    teamName: draft.teamName || 'Gaslands Team',
    totalCans: draft.totalCans || 0,
    maxCans: draft.maxCans || 50,
    sponsorName: draft.sponsorName || 'No Sponsor',
    sponsor: draft.sponsor ?? null,
    sponsorPerks: draft.sponsorPerks ?? null,
    vehicles: draft.vehicles,
    qrCode: draft.qrCode,
    showEquipmentDescriptions: draft.showEquipmentDescriptions !== false,
    showPerkDescriptions: draft.showPerkDescriptions !== false,
    showSpecialRules: draft.showSpecialRules ?? true,
    weaponAndUpgradeSpecialRules: draft.weaponAndUpgradeSpecialRules || [],
    printStyle: style,
    rulesVersion: draft.rulesVersion
  });
  const payload = html.includes('<head>')
    ? html.replace('<head>', '<head><script>window.opener=null;</script>')
    : html;
  const url = URL.createObjectURL(new Blob([payload], { type: 'text/html' }));
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 8000);
    printWindow.addEventListener(
      'load',
      () => {
        window.clearTimeout(timer);
        revokePrintPhotosWhenClosed(printWindow, release);
        resolve();
      },
      { once: true }
    );
    printWindow.location.replace(url);
  });
  if (printWindow.closed) {
    release();
    return;
  }
  await waitForPrintImages(printWindow.document);
  const printMediaStyle = printWindow.document.createElement('style');
  printMediaStyle.textContent = '@media print { button { display: none !important; } }';
  printWindow.document.head?.appendChild(printMediaStyle);
  addPrintButtons(printWindow);
}

/**
 * Wrapper function for printing with rules check
 */
export function printWithRulesCheck(
  printStyle: string,
  draft: PrintDraft,
  hasRules: boolean,
  showRulesModal: (action: string) => void
): void {
  if (checkRulesAcknowledgment('printTeam', hasRules, showRulesModal)) {
    printTeam(printStyle, draft);
  }
}