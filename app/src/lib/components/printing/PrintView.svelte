<!-- PrintView.svelte - Contains the print view HTML that gets displayed when printing -->
<script lang="ts">
  import type { Sponsor, Vehicle, Weapon, Upgrade, Perk } from '$lib/rules/types';
  import type { Validation } from '$lib/validate/model';

  interface PrintVehicle {
    id: string;
    type: string;
    name: string;
    weapons: string[];
    weaponFacings?: Record<string, string>;
    upgrades: string[];
    perks: string[];
  }
  
  // Props
  export let teamName: string = '';
  export let totalCans: number = 0;
  export let maxCans: number = 50;
  export let vehicles: PrintVehicle[] = [];
  export let vehicleTypes: Vehicle[] = [];
  export let weapons: Weapon[] = [];
  export let upgrades: Upgrade[] = [];
  export let perks: Perk[] = [];
  export let validation: Validation;
  export let enableSponsorships: boolean = false;
  export let currentSponsor: Sponsor | undefined = undefined;
  export let classPerksList: Perk[] = [];
  export let sponsorPerksList: Perk[] = [];

  function definedItems<T>(items: (T | undefined)[]): T[] {
    return items.filter((item): item is T => item != null);
  }
  
  // Function to calculate max hull for a vehicle (with upgrades)
  function calculateMaxHull(vehicle: PrintVehicle): number {
    const baseType = vehicleTypes.find(vt => vt.id === vehicle.type);
    if (!baseType) return 0;
    
    let hull = baseType.maxHull || 4;
    
    // Add hull from upgrades
    if (vehicle.upgrades && vehicle.upgrades.length > 0) {
      vehicle.upgrades.forEach(upgradeId => {
        const upgrade = upgrades.find(u => u.id === upgradeId);
        if (upgrade && upgrade.hull) {
          hull += upgrade.hull;
        }
      });
    }
    
    return hull;
  }
</script>

<!-- Print-only view with vehicle cards -->
<div style="padding: 20px; background-color: white; color: black;">
  <div class="sponsor-print-header">
    <h1>Gaslands: {teamName}</h1>
    <p>
      Total: {totalCans}/{maxCans} cans
      {#if enableSponsorships && currentSponsor}
        | Sponsor: {currentSponsor?.name || ''}
        {#if classPerksList.length > 0}
          | Perks: {classPerksList.map(p => p.name).join(', ')}
        {/if}
        {#if sponsorPerksList.length > 0}
          | Sponsor Perks: {sponsorPerksList.map(p => p.name).join(', ')}
        {/if}
      {/if}
    </p>
  </div>
  
  <div class="print-card-grid">
    {#each vehicles as v}
      <div class="vehicle-card-print" style="border-color: {vehicleTypes.find(vt => vt.id === v.type)?.color || '#f59e0b'};">
        <!-- Vehicle Card Header with Type & Cost -->
        <div class="card-header">
          <div class="card-title">
            <div class="card-name">{v.name}</div>
            <div class="vehicle-type-badge" style="background-color: {vehicleTypes.find(vt => vt.id === v.type)?.color || '#f59e0b'};">
              {vehicleTypes.find(vt => vt.id === v.type)?.name || 'Unknown'}
            </div>
          </div>
          <div class="card-cost">
            <div>Cost</div>
            <div class="cost-value">{validation.vehicleReports.find(r => r.vehicleId === v.id)?.cans || '?'}</div>
            <div>cans</div>
          </div>
        </div>
        
        <!-- Stats Grid: A more structured layout -->
        <div class="stats-grid">
          <div class="stat-block">
            <div class="stat-label">Hull</div>
            <div class="hull-tracker">
              {#if calculateMaxHull(v) > (vehicleTypes.find(vt => vt.id === v.type)?.maxHull || 0)}
                <span class="text-green-500 text-xs font-bold mr-1">(+{calculateMaxHull(v) - (vehicleTypes.find(vt => vt.id === v.type)?.maxHull || 0)})</span>
              {/if}
              {#each Array(Math.min(10, calculateMaxHull(v))) as _, i}
                <span class="hull-box"></span>
              {/each}
            </div>
          </div>
          
          <div class="stats-row">
            <div class="stat-block">
              <div class="stat-label">Handling</div>
              <div class="stat-value">{vehicleTypes.find(vt => vt.id === v.type)?.handling || 4}</div>
            </div>
            
            <div class="stat-block">
              <div class="stat-label">Gear</div>
              <div class="stat-value">{vehicleTypes.find(vt => vt.id === v.type)?.maxGear || 6}</div>
            </div>
            
            <div class="stat-block">
              <div class="stat-label">Crew</div>
              <div class="stat-value">{vehicleTypes.find(vt => vt.id === v.type)?.crew || 1}</div>
            </div>
            
            <div class="stat-block">
              <div class="stat-label">Weight</div>
              <div class="stat-value">
                {vehicleTypes.find(vt => vt.id === v.type)?.weight === 1 ? 'Light' : 
                vehicleTypes.find(vt => vt.id === v.type)?.weight === 2 ? 'Medium' : 
                vehicleTypes.find(vt => vt.id === v.type)?.weight === 3 ? 'Heavy' : 'Massive'}
              </div>
            </div>
          </div>
        </div>
        
        <!-- Weapons & Upgrades in a clearer format -->
        <div class="loadout">
          {#if v.weapons.length > 0}
            <div class="loadout-section">
              <div class="section-header">Weapons</div>
              <table class="loadout-table">
                <tbody>
                  {#each v.weapons as weaponId}
                    {@const baseWeaponId = weaponId.includes('_') ? weaponId.split('_').slice(0, -1).join('_') : weaponId}
                    {@const weaponObj = weapons.find(w => w.id === baseWeaponId)}
                    {@const facing = v.weaponFacings?.[weaponId] || weaponObj?.facing || 'front'}
                    <tr>
                      <td class="item-name">{weaponObj?.name || weaponId}</td>
                      <td class="item-facing">{facing}</td>
                      <td class="item-range">{weaponObj?.range || 'Short'}</td>
                      <td class="item-attack">{weaponObj?.attackDice || '-'}{weaponObj?.attackDice ? 'D' : ''}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
          
          {#if v.upgrades.length > 0}
            <div class="loadout-section">
              <div class="section-header">Upgrades</div>
              <ul class="upgrade-list">
                {#each v.upgrades as upgradeId}
                  <li>{upgrades.find(u => u.id === upgradeId)?.name || upgradeId}</li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
        
        <!-- Perks at bottom -->
        {#if v.perks.length > 0}
          <div class="card-footer">
            <span class="perk-label">Perks:</span> {v.perks.map(id => perks.find(p => p.id === id)?.name || "").join(' • ')}
          </div>
        {/if}
      </div>
    {/each}
  </div>
  
  <!-- QR code area (made visible during printing) -->
  <div class="qr-code-container">
    <div class="qr-code-placeholder print-hide">Scan QR Code to load this team</div>
    <img id="print-qr-code" class="qr-code-image" alt="QR Code for team" />
    <div class="qr-code-caption">Scan to load team</div>
  </div>
  
  <!-- Perk details section -->
  <div id="perk-details-print">
    <h2>Weapons & Upgrades Details</h2>
    <div class="details-grid">
      {#if vehicles.some(v => v.weapons.length > 0)}
        <div class="details-section">
          <h3>Weapons</h3>
          <div class="details-content">
            {#each definedItems(Array.from(new Set(vehicles.flatMap(v => v.weapons))).map(id => {
              const baseWeaponId = id.includes('_') ? id.split('_').slice(0, -1).join('_') : id;
              return weapons.find(w => w.id === baseWeaponId);
            })) as weapon}
              <div class="detail-item">
                <strong>{weapon.name}:</strong> {weapon.specialRules}
              </div>
            {/each}
          </div>
        </div>
      {/if}
      
      {#if vehicles.some(v => v.upgrades.length > 0)}
        <div class="details-section">
          <h3>Upgrades</h3>
          <div class="details-content">
            {#each definedItems(Array.from(new Set(vehicles.flatMap(v => v.upgrades))).map(id => upgrades.find(u => u.id === id))) as upgrade}
              <div class="detail-item">
                <strong>{upgrade.name}:</strong> {upgrade.specialRules}
              </div>
            {/each}
          </div>
        </div>
      {/if}
      
      {#if vehicles.some(v => v.perks.length > 0)}
        <div class="details-section">
          <h3>Perks</h3>
          <div class="details-content">
            {#each definedItems(Array.from(new Set(vehicles.flatMap(v => v.perks))).map(id => perks.find(p => p.id === id))) as perk}
              <div class="detail-item">
                <strong>{perk.name}:</strong> {perk.text}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>