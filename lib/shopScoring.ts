import { clampNonNegativeInt, fantasyPointsBreakdown, type FantasyStatLine } from "@/lib/fantasyPoints";
import { parseTeamFantasyShop, shopItemById, type TeamFantasyShopState } from "@/lib/fantasyShop";

export type LeadershipTeam = {
  captain: number | null;
  viceCaptain: number | null;
};

export type ShopAppliedFlags = {
  isCaptain: boolean;
  isViceCaptain: boolean;
  isLuckyDip: boolean;
  isPowerplay: boolean;
  batterBoost: boolean;
  bowlerBoost: boolean;
  captainMultiplier: number;
};

/** Deterministic pick when Lucky Dip was bought before we stored the player id. */
export function deterministicLuckyDipPlayer(
  teamUid: string,
  gameweek: number,
  playerIds: number[],
): number | null {
  const eligible = [...new Set(playerIds.filter((id) => Number.isFinite(id)))].sort((a, b) => a - b);
  if (!eligible.length) return null;
  let hash = 0;
  const seed = `${teamUid}:${gameweek}:lucky-dip`;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return eligible[hash % eligible.length] ?? null;
}

export function resolveLuckyDipPlayerId(
  shop: TeamFantasyShopState,
  squadPlayerIds: number[],
  teamUid: string,
): number | null {
  if (!shop.activeItemIds.includes("lucky-dip")) return null;
  const eligible = squadPlayerIds.filter((id) => Number.isFinite(id));
  if (!eligible.length) return null;
  const stored = shop.luckyDipPlayerId;
  if (stored != null && eligible.includes(stored)) return stored;
  return deterministicLuckyDipPlayer(teamUid, shop.activeGameweek, eligible);
}

export function hasBatterBoost(shop: TeamFantasyShopState): boolean {
  return shop.activeItemIds.includes("batter-boost");
}

export function hasBowlerBoost(shop: TeamFantasyShopState): boolean {
  return shop.activeItemIds.includes("bowler-boost");
}

/** Wickets, maidens, or a specialist bowler (role `bowl`) — batting/fielding never get this boost. */
export function playerQualifiesForBowlerBoost(
  line: FantasyStatLine | null | undefined,
  role?: string | null,
): boolean {
  if (role === "bowl") return true;
  if (!line) return false;
  return clampNonNegativeInt(line.wickets) > 0 || clampNonNegativeInt(line.maidens ?? 0) > 0;
}

/** Base points after Batter/Bowler boost (before C/VC/Lucky Dip/Powerplay). */
export function shopBoostedBasePoints(
  line: FantasyStatLine,
  shop: TeamFantasyShopState,
  role?: string | null,
): number {
  const bd = fantasyPointsBreakdown(line);
  const batting = hasBatterBoost(shop) ? bd.batting * 2 : bd.batting;
  const bowling =
    hasBowlerBoost(shop) && playerQualifiesForBowlerBoost(line, role) ? bd.bowling * 2 : bd.bowling;
  return batting + bowling + bd.fieldingOutfield + bd.keeper;
}

/**
 * Captain: Triple Captain → 3×; otherwise 2× (standard + Captain's Confidence).
 * Vice-captain: 1.5×.
 */
export function leadershipMultiplier(
  playerId: number,
  team: LeadershipTeam,
  shop: TeamFantasyShopState,
): number {
  if (team.captain === playerId) {
    if (shop.activeItemIds.includes("triple-captain")) return 3;
    return 2;
  }
  if (team.viceCaptain === playerId) return 1.5;
  return 1;
}

/** Highest boosted-base scorer gets Powerplay (always on when powerplay is active). */
export function resolvePowerplayPlayerId(
  shop: TeamFantasyShopState,
  entries: { id: number; basePoints: number; scored: boolean }[],
): number | null {
  if (!shop.activeItemIds.includes("powerplay")) return null;
  let bestId: number | null = null;
  let bestBase = -1;
  for (const row of entries) {
    if (!row.scored) continue;
    if (row.basePoints > bestBase || (row.basePoints === bestBase && bestId != null && row.id < bestId)) {
      bestBase = row.basePoints;
      bestId = row.id;
    } else if (bestId == null && row.basePoints >= 0) {
      bestBase = row.basePoints;
      bestId = row.id;
    }
  }
  return bestId;
}

export function shopExtraFreeTransfers(shop: TeamFantasyShopState): number {
  return shop.activeItemIds.includes("free-transfer") ? 1 : 0;
}

/** Wildcard Lite (this GW) or Full Wildcard (owned permanently). */
export function shopUnlimitedTransfers(shop: TeamFantasyShopState): boolean {
  if (shop.activeItemIds.includes("wildcard-lite") || shop.activeItemIds.includes("full-wildcard")) {
    return true;
  }
  // Permanent full wildcard stays in owned even if active list rolled over.
  if (shop.ownedItemIds.includes("full-wildcard")) {
    const item = shopItemById("full-wildcard");
    if (item?.permanent) return true;
  }
  return false;
}

export function effectiveFreeTransfersForShop(baseFree: number, shop: TeamFantasyShopState): number {
  if (shopUnlimitedTransfers(shop)) return 999;
  return Math.max(0, baseFree + shopExtraFreeTransfers(shop));
}

export type ShopPlayerScoreInput = {
  id: number;
  line: FantasyStatLine | null;
  scored: boolean;
  role?: string | null;
};

export type ShopPlayerScoreResult = {
  id: number;
  basePoints: number;
  appliedPoints: number;
  scored: boolean;
  isCaptain: boolean;
  isViceCaptain: boolean;
  isLuckyDip: boolean;
  isPowerplay: boolean;
  batterBoost: boolean;
  bowlerBoost: boolean;
  captainMultiplier: number;
  bowlingPoints?: number;
};

export function scoreSquadWithShop(args: {
  team: LeadershipTeam;
  shop: TeamFantasyShopState;
  squadPlayerIds: number[];
  teamUid: string;
  players: ShopPlayerScoreInput[];
}): ShopPlayerScoreResult[] {
  const { team, shop, squadPlayerIds, teamUid, players } = args;
  const luckyId = resolveLuckyDipPlayerId(shop, squadPlayerIds, teamUid);

  const withBase = players.map((p) => {
    const bowlingPts = p.line ? fantasyPointsBreakdown(p.line).bowling : 0;
    const qualifiesBowl = playerQualifiesForBowlerBoost(p.line, p.role);
    const bowlerBoostApplied = Boolean(p.scored && hasBowlerBoost(shop) && qualifiesBowl && bowlingPts > 0);
    const basePoints =
      p.scored && p.line ? Math.round(shopBoostedBasePoints(p.line, shop, p.role) * 10) / 10 : 0;
    return {
      ...p,
      basePoints,
      bowlingPts,
      bowlerBoostApplied,
    };
  });

  const powerplayId = resolvePowerplayPlayerId(
    shop,
    withBase.map((p) => ({ id: p.id, basePoints: p.basePoints, scored: p.scored })),
  );

  return withBase.map((p) => {
    const isCaptain = team.captain === p.id;
    const isViceCaptain = team.viceCaptain === p.id;
    const captainMultiplier = leadershipMultiplier(p.id, team, shop);
    const luckyMult = luckyId === p.id ? 1.5 : 1;
    const powerMult = powerplayId === p.id ? 2 : 1;
    const multiplied = p.basePoints * captainMultiplier * luckyMult * powerMult;
    // Extra bowling ×2 after C/VC/Lucky Dip/Powerplay so VC+PP+Bowl stacks as
    // (boosted base × 1.5 × 2) + (bowling × 2). Example: 148 × 3 + 130 = 574.
    const bowlBonus = p.bowlerBoostApplied ? p.bowlingPts * 2 : 0;
    const appliedPoints = Math.round((multiplied + bowlBonus) * 10) / 10;
    return {
      id: p.id,
      basePoints: p.basePoints,
      appliedPoints: p.scored ? appliedPoints : 0,
      scored: p.scored,
      isCaptain,
      isViceCaptain,
      isLuckyDip: luckyId === p.id,
      isPowerplay: powerplayId === p.id,
      batterBoost: hasBatterBoost(shop),
      bowlerBoost: p.bowlerBoostApplied,
      captainMultiplier,
      bowlingPoints: p.bowlingPts,
    };
  });
}

/** Apply shop + leadership multipliers to one player's already-known raw base (no bat/bowl split). */
export function appliedPlayerPoints(
  base: number,
  playerId: number,
  team: LeadershipTeam,
  shop: TeamFantasyShopState,
  squadPlayerIds: number[],
  teamUid: string,
  opts?: { powerplayPlayerId?: number | null },
): number {
  const captainMultiplier = leadershipMultiplier(playerId, team, shop);
  const luckyMult = resolveLuckyDipPlayerId(shop, squadPlayerIds, teamUid) === playerId ? 1.5 : 1;
  const powerMult = opts?.powerplayPlayerId === playerId ? 2 : 1;
  return Math.round(base * captainMultiplier * luckyMult * powerMult * 10) / 10;
}

export function parseShopForScoring(raw: unknown, gameweek: number): TeamFantasyShopState {
  return parseTeamFantasyShop(raw, gameweek);
}

export function isLuckyDipPlayer(
  playerId: number,
  shop: TeamFantasyShopState,
  squadPlayerIds: number[],
  teamUid: string,
): boolean {
  return resolveLuckyDipPlayerId(shop, squadPlayerIds, teamUid) === playerId;
}

export function sumAppliedShopScores(scores: { scored: boolean; appliedPoints: number }[]): number {
  return Math.round(scores.reduce((s, row) => s + (row.scored ? row.appliedPoints : 0), 0) * 10) / 10;
}
