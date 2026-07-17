import type { GwTeamSnapshot } from "@/lib/gwTeams";

export type TeamPointsBackupKind = "live-stats-save" | "end-gw" | "manual";

export type TeamPointsBackupRow = {
  uid: string;
  name: string;
  ownerName?: string;
  weekPoints: number;
  cumulativePoints: number;
  /** cumulative + this week's live/ended week points */
  total: number;
  players: number[];
  captain: number | null;
  viceCaptain: number | null;
  keeper: number | null;
};

export type TeamPointsBackupDoc = {
  id?: string;
  gameweek: number;
  kind: TeamPointsBackupKind;
  createdAt?: unknown;
  createdBy?: string | null;
  label?: string;
  teams: TeamPointsBackupRow[];
};

/** Per completed GW on `teams/{uid}.seasonPointsByGw` — permanent season ledger. */
export type SeasonGwPointsEntry = {
  weekPoints: number;
  cumulativeBefore: number;
  cumulativeAfter: number;
  endedAt?: string;
};

export type PointsAuditEntry = {
  at: string;
  gameweek: number;
  cumulativePoints: number;
  weekPoints?: number;
  total?: number;
  source: string;
};

export const MAX_POINTS_AUDIT = 40;

export function buildTeamPointsBackupRow(args: {
  uid: string;
  name: string;
  ownerName?: string;
  players: number[];
  captain: number | null;
  viceCaptain: number | null;
  keeper: number | null;
  weekPoints: number;
  cumulativePoints: number;
}): TeamPointsBackupRow {
  const weekPoints = Math.round(args.weekPoints * 10) / 10;
  const cumulativePoints = Math.round(args.cumulativePoints * 10) / 10;
  return {
    uid: args.uid,
    name: args.name,
    ownerName: args.ownerName,
    weekPoints,
    cumulativePoints,
    total: Math.round((cumulativePoints + weekPoints) * 10) / 10,
    players: [...args.players],
    captain: args.captain,
    viceCaptain: args.viceCaptain,
    keeper: args.keeper,
  };
}

export function seasonPointsByGwFromEnd(
  existing: Record<string, SeasonGwPointsEntry> | undefined,
  gameweek: number,
  snap: Pick<GwTeamSnapshot, "weekPoints" | "cumulativePointsBefore" | "cumulativePointsAfter">,
): Record<string, SeasonGwPointsEntry> {
  return {
    ...(existing ?? {}),
    [String(gameweek)]: {
      weekPoints: Math.round(snap.weekPoints * 10) / 10,
      cumulativeBefore: Math.round(snap.cumulativePointsBefore * 10) / 10,
      cumulativeAfter: Math.round(snap.cumulativePointsAfter * 10) / 10,
      endedAt: new Date().toISOString(),
    },
  };
}

export function appendPointsAudit(
  existing: PointsAuditEntry[] | undefined,
  entry: PointsAuditEntry,
): PointsAuditEntry[] {
  return [entry, ...(existing ?? [])].slice(0, MAX_POINTS_AUDIT);
}

export function parseSeasonPointsByGw(raw: unknown): Record<string, SeasonGwPointsEntry> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, SeasonGwPointsEntry> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const row = v as Record<string, unknown>;
    out[k] = {
      weekPoints: Number(row.weekPoints ?? 0),
      cumulativeBefore: Number(row.cumulativeBefore ?? 0),
      cumulativeAfter: Number(row.cumulativeAfter ?? 0),
      endedAt: typeof row.endedAt === "string" ? row.endedAt : undefined,
    };
  }
  return out;
}

export function parsePointsAudit(raw: unknown): PointsAuditEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: PointsAuditEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    out.push({
      at: String(o.at ?? ""),
      gameweek: Number(o.gameweek ?? 0),
      cumulativePoints: Number(o.cumulativePoints ?? 0),
      weekPoints: o.weekPoints != null ? Number(o.weekPoints) : undefined,
      total: o.total != null ? Number(o.total) : undefined,
      source: String(o.source ?? "unknown"),
    });
  }
  return out;
}

export function parseTeamPointsBackupDoc(
  id: string,
  raw: Record<string, unknown>,
): TeamPointsBackupDoc | null {
  const gameweek = Number(raw.gameweek);
  if (!Number.isFinite(gameweek) || gameweek < 1) return null;
  const kind = raw.kind;
  if (kind !== "live-stats-save" && kind !== "end-gw" && kind !== "manual") return null;
  const teamsRaw = Array.isArray(raw.teams) ? raw.teams : [];
  const teams: TeamPointsBackupRow[] = [];
  for (const t of teamsRaw) {
    if (!t || typeof t !== "object") continue;
    const row = t as Record<string, unknown>;
    const uid = String(row.uid ?? "").trim();
    if (!uid) continue;
    const weekPoints = Number(row.weekPoints ?? 0);
    const cumulativePoints = Number(row.cumulativePoints ?? 0);
    teams.push({
      uid,
      name: String(row.name ?? "Team"),
      ownerName: typeof row.ownerName === "string" ? row.ownerName : undefined,
      weekPoints,
      cumulativePoints,
      total: Number(row.total ?? cumulativePoints + weekPoints),
      players: Array.isArray(row.players)
        ? row.players.map((x) => Number(x)).filter((n) => Number.isFinite(n))
        : [],
      captain: row.captain != null && Number.isFinite(Number(row.captain)) ? Number(row.captain) : null,
      viceCaptain:
        row.viceCaptain != null && Number.isFinite(Number(row.viceCaptain)) ? Number(row.viceCaptain) : null,
      keeper: row.keeper != null && Number.isFinite(Number(row.keeper)) ? Number(row.keeper) : null,
    });
  }
  return {
    id,
    gameweek,
    kind,
    createdAt: raw.createdAt,
    createdBy: typeof raw.createdBy === "string" ? raw.createdBy : null,
    label: typeof raw.label === "string" ? raw.label : undefined,
    teams,
  };
}
