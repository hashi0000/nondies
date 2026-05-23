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
