import {
  collection,
  getDocs,
  writeBatch,
  type Firestore,
} from "firebase/firestore";

/** One manager's locked squad for a completed gameweek. */
export type GwTeamSnapshot = {
  uid: string;
  name: string;
  ownerName?: string;
  players: number[];
  captain: number | null;
  viceCaptain: number | null;
  keeper: number | null;
  weekPoints: number;
  cumulativePointsBefore: number;
  cumulativePointsAfter: number;
  transferBaselinePlayers: number[];
  freeTransfersAtGwStart: number;
  transferPenaltyPointsApplied?: number;
  playerJoinedGameweek?: Record<string, number>;
};

export type GwTeamsDoc = {
  gameweek: number;
  endedAt?: unknown;
  endedBy?: string | null;
  teams: GwTeamSnapshot[];
};

export type SavedTeamLike = {
  uid: string;
  name: string;
  ownerName?: string;
  players: number[];
  captain: number | null;
  viceCaptain: number | null;
  keeper: number | null;
  cumulativePoints?: number;
  transferBaselinePlayers?: number[];
  freeTransfersAtGwStart?: number;
  transferPenaltyPointsApplied?: number;
  playerJoinedGameweek?: Record<string, number>;
};

export function gwSnapshotToSavedTeam(s: GwTeamSnapshot): SavedTeamLike {
  return {
    uid: s.uid,
    name: s.name,
    ownerName: s.ownerName,
    players: [...s.players],
    captain: s.captain,
    viceCaptain: s.viceCaptain,
    keeper: s.keeper,
    cumulativePoints: s.cumulativePointsAfter,
    transferBaselinePlayers: [...s.transferBaselinePlayers],
    freeTransfersAtGwStart: s.freeTransfersAtGwStart,
    transferPenaltyPointsApplied: s.transferPenaltyPointsApplied ?? 0,
    playerJoinedGameweek: s.playerJoinedGameweek ? { ...s.playerJoinedGameweek } : {},
  };
}

/** Overall ladder rank (1 = highest total) at end of a completed gameweek. */
export function cumulativeRanksByUid(doc: GwTeamsDoc): Map<string, number> {
  const sorted = [...doc.teams].sort(
    (a, b) =>
      b.cumulativePointsAfter - a.cumulativePointsAfter ||
      b.weekPoints - a.weekPoints ||
      a.name.localeCompare(b.name),
  );
  const ranks = new Map<string, number>();
  sorted.forEach((t, i) => ranks.set(t.uid, i + 1));
  return ranks;
}

/** Highest GW score in a completed gameweek snapshot. */
export function teamOfTheWeekFromDoc(doc: GwTeamsDoc): GwTeamSnapshot | null {
  if (!doc.teams.length) return null;
  return [...doc.teams].sort(
    (a, b) => b.weekPoints - a.weekPoints || b.cumulativePointsAfter - a.cumulativePointsAfter || a.name.localeCompare(b.name),
  )[0];
}

export type RankMovement = {
  overallRank: number;
  previousRank: number | null;
  /** Positive = moved up the ladder (lower rank number). */
  delta: number | null;
};

export function rankMovement(
  currentRanks: Map<string, number>,
  previousRanks: Map<string, number> | null,
  uid: string,
): RankMovement {
  const overallRank = currentRanks.get(uid) ?? 0;
  if (!previousRanks) return { overallRank, previousRank: null, delta: null };
  const previousRank = previousRanks.get(uid);
  if (previousRank == null) return { overallRank, previousRank: null, delta: null };
  return { overallRank, previousRank, delta: previousRank - overallRank };
}

type SquadShape = {
  players: number[];
  captain: number | null;
  viceCaptain: number | null;
  keeper: number | null;
};

function squadShapeKey(s: SquadShape): string {
  const ids = [...s.players].sort((a, b) => a - b);
  return `${ids.join(",")}|${s.captain ?? ""}|${s.viceCaptain ?? ""}|${s.keeper ?? ""}`;
}

/** True when live squad matches a locked gameweek snapshot (players + C/VC/WK). */
export function squadMatchesGwSnapshot(live: SquadShape, snap: SquadShape): boolean {
  return squadShapeKey(live) === squadShapeKey(snap);
}

export function firestoreTeamFieldsFromGwSnapshot(
  ts: GwTeamSnapshot,
  playerPurchasePrices?: Record<string, number>,
): Record<string, unknown> {
  return {
    name: ts.name,
    ownerName: ts.ownerName ?? null,
    players: [...ts.players],
    captain: ts.captain,
    viceCaptain: ts.viceCaptain,
    keeper: ts.keeper,
    transferBaselinePlayers: [...ts.transferBaselinePlayers],
    freeTransfersAtGwStart: ts.freeTransfersAtGwStart,
    transferPenaltyPointsApplied: ts.transferPenaltyPointsApplied ?? 0,
    playerJoinedGameweek: ts.playerJoinedGameweek ?? {},
    ...(playerPurchasePrices ? { playerPurchasePrices } : {}),
  };
}

export function parseGwTeamsDoc(raw: Record<string, unknown>): GwTeamsDoc | null {
  const gameweek = Number(raw.gameweek);
  if (!Number.isFinite(gameweek) || gameweek < 1) return null;
  const teamsRaw = Array.isArray(raw.teams) ? raw.teams : [];
  const teams: GwTeamSnapshot[] = [];
  for (const t of teamsRaw) {
    if (!t || typeof t !== "object") continue;
    const row = t as Record<string, unknown>;
    const uid = String(row.uid ?? "").trim();
    if (!uid) continue;
    const players = Array.isArray(row.players)
      ? row.players.map((x) => Number(x)).filter((n) => Number.isFinite(n))
      : [];
    teams.push({
      uid,
      name: String(row.name ?? "Team"),
      ownerName: typeof row.ownerName === "string" ? row.ownerName : undefined,
      players,
      captain: row.captain != null && Number.isFinite(Number(row.captain)) ? Number(row.captain) : null,
      viceCaptain:
        row.viceCaptain != null && Number.isFinite(Number(row.viceCaptain)) ? Number(row.viceCaptain) : null,
      keeper: row.keeper != null && Number.isFinite(Number(row.keeper)) ? Number(row.keeper) : null,
      weekPoints: Number(row.weekPoints ?? 0),
      cumulativePointsBefore: Number(row.cumulativePointsBefore ?? 0),
      cumulativePointsAfter: Number(row.cumulativePointsAfter ?? 0),
      transferBaselinePlayers: Array.isArray(row.transferBaselinePlayers)
        ? row.transferBaselinePlayers.map((x) => Number(x)).filter((n) => Number.isFinite(n))
        : players,
      freeTransfersAtGwStart: Number(row.freeTransfersAtGwStart ?? 1),
      transferPenaltyPointsApplied: Number(row.transferPenaltyPointsApplied ?? 0),
      playerJoinedGameweek:
        row.playerJoinedGameweek && typeof row.playerJoinedGameweek === "object"
          ? (row.playerJoinedGameweek as Record<string, number>)
          : undefined,
    });
  }
  return {
    gameweek,
    endedAt: raw.endedAt,
    endedBy: typeof raw.endedBy === "string" ? raw.endedBy : null,
    teams,
  };
}

export async function deleteAllGwTeamsDocs(db: Firestore) {
  const snap = await getDocs(collection(db, "gwTeams"));
  const writeLimit = 450;
  let batch = writeBatch(db);
  let ops = 0;
  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  };
  for (const d of snap.docs) {
    batch.delete(d.ref);
    ops += 1;
    if (ops >= writeLimit) await flush();
  }
  await flush();
}
