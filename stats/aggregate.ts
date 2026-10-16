/** Rolling window for "teams created last 30 days". */
export const STATS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type SponsorCount = {
  sponsorId: string;
  count: number;
};

export type PublicStats = {
  updatedAt: string;
  totalUsers: number;
  totalTeams: number;
  totalVehicles: number;
  teamsByRulesVersion: { v2: number; v3: number };
  teamsBySponsor: SponsorCount[];
  teamsCreatedLast30Days: number;
};

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as RecordLike;
}

/** Firestore Timestamp, ISO string, epoch millis, or Date. */
export function readTime(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const record = asRecord(value);
  if (!record) return null;
  if (typeof record.toDate === 'function') {
    const parsed = (record.toDate as () => unknown)();
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) return parsed;
  }
  const seconds = typeof record.seconds === 'number'
    ? record.seconds
    : typeof record._seconds === 'number'
      ? record._seconds
      : null;
  if (seconds === null) return null;
  const parsed = new Date(seconds * 1000);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Missing or unrecognized versions stay on Refuelled (v2), matching the builder. */
export function rulesBucket(value: unknown): 'v2' | 'v3' {
  return value === 3 || value === '3' ? 'v3' : 'v2';
}

function payloadOf(team: RecordLike): RecordLike {
  return asRecord(team.teamData) ?? asRecord(team.draft) ?? team;
}

function sponsorIdOf(team: RecordLike): string {
  const payload = payloadOf(team);
  const raw = payload.sponsorId ?? payload.sponsor ?? team.sponsorId ?? team.sponsor;
  const id = typeof raw === 'string' ? raw.trim() : '';
  return id || 'unknown';
}

function vehiclesOf(team: RecordLike): unknown[] {
  const payload = payloadOf(team);
  if (Array.isArray(payload.vehicles)) return payload.vehicles;
  if (Array.isArray(team.vehicles)) return team.vehicles;
  return [];
}

function createdAtOf(team: RecordLike): Date | null {
  return readTime(team.createdAt) ?? readTime(payloadOf(team).createdAt);
}

/**
 * Count public usage totals from team documents.
 * `totalUsers` comes from Firebase Auth, not from the team documents.
 * The result contains no user ids, team names, or vehicle lists.
 */
export function aggregateUsage(
  teams: readonly unknown[],
  totalUsers: number,
  now: Date = new Date()
): PublicStats {
  const teamsByRulesVersion = { v2: 0, v3: 0 };
  const sponsorCounts = new Map<string, number>();
  let totalVehicles = 0;
  let teamsCreatedLast30Days = 0;
  let totalTeams = 0;
  const windowStart = now.getTime() - STATS_WINDOW_MS;

  for (const entry of teams) {
    const team = asRecord(entry);
    if (!team) continue;
    totalTeams += 1;
    const payload = payloadOf(team);
    teamsByRulesVersion[rulesBucket(payload.rulesVersion ?? team.rulesVersion)] += 1;
    const sponsorId = sponsorIdOf(team);
    sponsorCounts.set(sponsorId, (sponsorCounts.get(sponsorId) ?? 0) + 1);
    totalVehicles += vehiclesOf(team).length;
    const created = createdAtOf(team);
    if (created && created.getTime() >= windowStart && created.getTime() <= now.getTime()) {
      teamsCreatedLast30Days += 1;
    }
  }

  const teamsBySponsor = [...sponsorCounts.entries()]
    .map(([sponsorId, count]) => ({ sponsorId, count }))
    .sort((a, b) => b.count - a.count || a.sponsorId.localeCompare(b.sponsorId));

  return {
    updatedAt: now.toISOString(),
    totalUsers: Number.isFinite(totalUsers) ? Math.max(0, Math.floor(totalUsers)) : 0,
    totalTeams,
    totalVehicles,
    teamsByRulesVersion,
    teamsBySponsor,
    teamsCreatedLast30Days
  };
}
