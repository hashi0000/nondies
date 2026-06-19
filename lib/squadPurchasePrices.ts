import { POOL_PRICE_BAND } from "@/lib/dynamicPricing";
import { PRE_DYNAMIC_PRICING_SNAPSHOT_GW } from "@/lib/leagueConfig";

/** Opening listed prices at season start (matches seeded roster in the app). */
export const INITIAL_LISTED_PRICES: Readonly<Record<number, number>> = {
  1: 18,
  2: 16,
  3: 16,
  4: 16,
  5: 15,
  6: 15,
  7: 15,
  8: 14,
  9: 17,
  10: 15,
  11: 14,
  12: 14,
  13: 13,
  14: 15,
  15: 13,
  16: 13,
  17: 12,
  18: 12,
  19: 6,
  20: 6,
  21: 6,
  22: 6,
  23: 5,
  24: 5,
  25: 5,
  26: 5,
  27: 8,
  28: 6,
  29: 5,
  30: 6,
  31: 6,
  32: 6,
  33: 5,
  34: 7,
  35: 6,
};

export type PurchasePriceMap = Record<string, number>;

export type TeamPurchaseContext = {
  players: number[];
  playerPurchasePrices?: PurchasePriceMap;
  playerJoinedGameweek?: Record<string, number>;
  firstSaveGameweek?: number;
};

/** Season managers through GW4 keep opening purchase prices; later joiners use full dynamic pricing. */
export function isGrandfatheredPricingTeam(team: { firstSaveGameweek?: number }): boolean {
  const fsg = team.firstSaveGameweek;
  if (typeof fsg !== "number" || !Number.isFinite(fsg)) return true;
  return Math.floor(fsg) <= PRE_DYNAMIC_PRICING_SNAPSHOT_GW;
}

/** User-facing summary for original season squads vs dynamic pricing on changes. */
export const GRANDFATHERED_SQUAD_MESSAGE =
  "You don't have to change your squad. If you do, new picks and transfers use dynamic prices.";

/** localStorage key — bump suffix when copy or policy changes materially. */
export const PERSONAL_SPEND_CAP_NOTICE_KEY = "nondies-personal-spend-cap-v1";

export function parsePurchasePriceMap(raw: unknown): PurchasePriceMap {
  if (!raw || typeof raw !== "object") return {};
  const out: PurchasePriceMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) out[key] = Math.round(n);
  }
  return out;
}

/** True when the pick is treated as an original season squad member (GW1 / untracked). */
export function isOriginalSeasonPick(playerId: number, joinedGameweek?: Record<string, number>): boolean {
  const joined = joinedGameweek?.[String(playerId)];
  return joined == null || joined <= 1;
}

/**
 * Best-effort price for a player already in a saved squad before purchase prices were tracked.
 * Original GW1 picks use opening listed prices; later picks use listed price at migration time.
 */
export function inferLegacyPurchasePrice(
  playerId: number,
  listedPrice: number | undefined,
  joinedGameweek?: Record<string, number>,
): number {
  if (isOriginalSeasonPick(playerId, joinedGameweek)) {
    const seed = INITIAL_LISTED_PRICES[playerId];
    if (seed != null) return seed;
  }
  if (listedPrice != null && Number.isFinite(listedPrice)) return Math.round(listedPrice);
  return INITIAL_LISTED_PRICES[playerId] ?? POOL_PRICE_BAND.min;
}

export function resolveTeamPurchasePrices(
  team: TeamPurchaseContext,
  listedPriceForId: (id: number) => number | undefined,
  marketPriceForId: (id: number) => number,
): PurchasePriceMap {
  const stored = parsePurchasePriceMap(team.playerPurchasePrices);
  const result: PurchasePriceMap = {};
  for (const id of team.players) {
    const key = String(id);
    if (stored[key] != null) {
      result[key] = stored[key]!;
    } else {
      result[key] = inferLegacyPurchasePrice(id, listedPriceForId(id), team.playerJoinedGameweek);
    }
  }
  return result;
}

export function squadSpend(
  playerIds: number[],
  purchasePrices: PurchasePriceMap,
  marketPriceForId: (id: number) => number,
): number {
  return playerIds.reduce((sum, id) => {
    const key = String(id);
    const price = purchasePrices[key] ?? marketPriceForId(id);
    return sum + price;
  }, 0);
}

export function squadSpendForTeam(
  team: TeamPurchaseContext,
  listedPriceForId: (id: number) => number | undefined,
  marketPriceForId: (id: number) => number,
): number {
  if (!isGrandfatheredPricingTeam(team)) {
    return squadSpend(team.players, {}, marketPriceForId);
  }
  const prices = resolveTeamPurchasePrices(team, listedPriceForId, marketPriceForId);
  return squadSpend(team.players, prices, marketPriceForId);
}

/**
 * Original season squads draft against their saved spend (purchase prices), not the league dynamic cap.
 * Returns null when the league-wide cap applies (new teams or no saved squad yet).
 */
export function personalSpendCapForTeam(
  team: TeamPurchaseContext | null | undefined,
  listedPriceForId: (id: number) => number | undefined,
  marketPriceForId: (id: number) => number,
): number | null {
  if (!team || !isGrandfatheredPricingTeam(team) || team.players.length === 0) return null;
  return squadSpendForTeam(team, listedPriceForId, marketPriceForId);
}

/** Draft/save budget: personal saved spend for original squads, else league dynamic cap. */
export function draftBudgetForTeam(
  leagueBudget: number,
  team: TeamPurchaseContext | null | undefined,
  listedPriceForId: (id: number) => number | undefined,
  marketPriceForId: (id: number) => number,
): number {
  return personalSpendCapForTeam(team, listedPriceForId, marketPriceForId) ?? leagueBudget;
}

/** Draft spend: kept picks use stored/original price; new picks use current market price. */
export function draftPurchasePricesForSelection(
  selected: number[],
  savedTeam: TeamPurchaseContext | null | undefined,
  marketPriceForId: (id: number) => number,
  listedPriceForId: (id: number) => number | undefined,
): PurchasePriceMap {
  const map: PurchasePriceMap = {};
  const grandfathered = savedTeam ? isGrandfatheredPricingTeam(savedTeam) : false;
  const savedPrices =
    savedTeam && grandfathered
      ? resolveTeamPurchasePrices(savedTeam, listedPriceForId, marketPriceForId)
      : {};
  for (const id of selected) {
    const key = String(id);
    if (grandfathered && savedTeam?.players.includes(id) && savedPrices[key] != null) {
      map[key] = savedPrices[key]!;
    } else {
      map[key] = marketPriceForId(id);
    }
  }
  return map;
}

export function buildPurchasePricesAfterSave(args: {
  existing: TeamPurchaseContext | null;
  newPlayers: number[];
  marketPriceForId: (id: number) => number;
  listedPriceForId: (id: number) => number | undefined;
}): PurchasePriceMap {
  const { existing, newPlayers, marketPriceForId, listedPriceForId } = args;
  const prevMap: PurchasePriceMap = {
    ...parsePurchasePriceMap(existing?.playerPurchasePrices),
  };

  if (existing) {
    for (const id of existing.players) {
      const key = String(id);
      if (prevMap[key] != null) continue;
      prevMap[key] = inferLegacyPurchasePrice(id, listedPriceForId(id), existing.playerJoinedGameweek);
    }
  }

  const next: PurchasePriceMap = {};
  for (const id of newPlayers) {
    const key = String(id);
    if (existing?.players.includes(id) && prevMap[key] != null) {
      next[key] = prevMap[key]!;
    } else {
      next[key] = marketPriceForId(id);
    }
  }
  return next;
}

/** Opening listed prices for every player in a restored GW snapshot. */
export function purchasePricesForRestoredSnapshot(
  players: number[],
  playerJoinedGameweek: Record<string, number> | undefined,
  marketPriceForId: (id: number) => number,
  listedPriceForId: (id: number) => number | undefined,
): PurchasePriceMap {
  return buildPurchasePricesAfterSave({
    existing: { players, playerJoinedGameweek },
    newPlayers: players,
    marketPriceForId,
    listedPriceForId,
  });
}

export function priceForIdFromMap(
  id: number,
  purchasePrices: PurchasePriceMap,
  marketPriceForId: (id: number) => number,
): number {
  return purchasePrices[String(id)] ?? marketPriceForId(id);
}
