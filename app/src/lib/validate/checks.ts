

// app/src/lib/validate/checks.ts
import type { Team, VehicleReport } from './model';
/* ------------------------------------------------------------
   RULE B – no duplicate “unique” weapons per vehicle
   ------------------------------------------------------------ */
   export function uniqueWeaponCheck(team: Team, reports: VehicleReport[]) {
    team.vehicles.forEach((v, i) => {
      const uniques = v.weapons.filter((w) => w.unique);
      const idsSeen = new Set<string>();
  
      for (const w of uniques) {
        if (idsSeen.has(w.id)) {
          reports[i].errors.push(`Duplicate unique weapon: ${w.name}`);
        } else {
          idsSeen.add(w.id);
        }
      }
    });
  }
  
/* ------------------------------------------------------------
   RULE C – upgrade-slot limit
   ------------------------------------------------------------ */
   export function upgradeSlotCheck(team: Team, reports: VehicleReport[]) {
    team.vehicles.forEach((v, i) => {
      const max = v.class.upgradeSlots ?? 0;  // Default to 0 if undefined
      if (v.upgrades.length > max) {
        reports[i].errors.push(
          `Too many upgrades: ${v.upgrades.length}/${max} slots`
        );
      }
    });
  }

/* ------------------------------------------------------------
   RULE D – perks must be legal for the team's sponsor
   ------------------------------------------------------------ */
function perkAllowedForSponsor(
  perk: { id: string; class?: string; sponsor?: string },
  sponsor: Team['sponsor']
): boolean {
  const listedIds = sponsor.perks ?? [];
  const classes = (sponsor.perksClasses ?? [])
    .map((c) => c.toLowerCase())
    .filter((c) => c.length > 0);
  const perkSponsor = (perk.sponsor ?? '').trim().toLowerCase();

  // Sponsor-specific perks (non-empty sponsor field) belong to one team sponsor.
  if (perkSponsor) {
    return (
      perkSponsor === sponsor.id.toLowerCase() ||
      perkSponsor === sponsor.name.toLowerCase()
    );
  }

  const perkClass = (perk.class ?? '').trim().toLowerCase();
  // Class perks follow the builder: class match when the sponsor publishes classes.
  if (classes.length > 0 && perkClass) {
    return classes.includes(perkClass);
  }

  // Legacy sponsors that only list perk ids.
  if (listedIds.length > 0) {
    return listedIds.includes(perk.id);
  }

  return false;
}

export function sponsorPerkCheck(team: Team, reports: VehicleReport[]) {
  team.vehicles.forEach((v, i) => {
    for (const perk of v.perks) {
      if (!perkAllowedForSponsor(perk, team.sponsor)) {
        reports[i].errors.push(
          `Invalid perk: ${perk.name} is not available for ${team.sponsor.name}`
        );
      }
    }
  });
}

/* ------------------------------------------------------------
   aggregate runner – call every rule function here
   ------------------------------------------------------------ */
   export function runAllChecks(team: Team, reports: VehicleReport[]) {
    uniqueWeaponCheck(team, reports);
    upgradeSlotCheck(team, reports);
    sponsorPerkCheck(team, reports);
  }
  
