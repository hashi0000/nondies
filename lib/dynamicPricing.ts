import { calculatePoints } from "@/lib/fantasyPoints";
import {
  BUDGET_BASE,
  DYNAMIC_BUDGET_HEADROOM,
  DYNAMIC_BUDGET_MAX,
  DYNAMIC_BUDGET_MIN,
  SQUAD_ROLES,
  type PlayerRole,
} from "@/lib/leagueConfig";

/** Draft price range for the whole pool (1st / 2nd XI labels stay for filters only). */
export const POOL_PRICE_BAND = { min: 5, max: 20 } as const;

/** Legacy tier bands — starting listed prices only; live draft uses {@link POOL_PRICE_BAND}. */
export const PRICE_BAND: Record<1 | 2, { min: number; max: number }> = {
  1: { min: 12, max: 20 },
  2: { min: 5, max: 10 },
};

/** Max gap between listed price and performance target shown in Draft (before End GW). */
export const MAX_FORM_PRICE_DELTA = POOL_PRICE_BAND.max - POOL_PRICE_BAND.min;

const RECENT_FORM_WEEKS = 3;
const SEASON_PPG_WEIGHT = 0.6;
const RECENT_PPG_WEIGHT = 0.4;

export type PricingHistoryWeek = {
  week: number;
  points?: number;
  runs?: number;
  fours?: number;
  sixes?: number;
  wickets?: number;
  maidens?: number;
  catches?: number;
  wkCatches?: number;
  stumpings?: number;
  runOuts?: number;
  didNotBat?: boolean;
  didNotPlay?: boolean;
  notOut?: boolean;
};

export type PlayerForPricing = {
  id: number;
  teamTier: 1 | 2;
  price: number;
  history?: PricingHistoryWeek[];
  runs?: number;
  fours?: number;
  sixes?: number;
  wickets?: number;
  maidens?: number;
  catches?: number;
  wkCatches?: number;
  stumpings?: number;
  runOuts?: number;
  didNotBat?: boolean;
  didNotPlay?: boolean;
  notOut?: boolean;
};

export type PlayerPricing = {
  /** Listed price in Firestore (updates when a gameweek ends). */
  basePrice: number;
  /** Performance-based draft price for this week. */
  effectivePrice: number;
  priceDelta: number;
  /** Weighted pts-per-game value score used for ranking. */
  formScore: number;
  /** Rank in pool by value (1 = hottest). Omitted when not in the priced pool. */
  valueRank?: number;
  pricedPoolSize?: number;
};

function clampPoolPrice(n: number): number {
  return Math.max(POOL_PRICE_BAND.min, Math.min(POOL_PRICE_BAND.max, Math.round(n)));
}

function weekPoints(rec: PricingHistoryWeek): number {
  if (rec.didNotPlay) return 0;
  const n = Number(rec.points);
  if (Number.isFinite(n)) return n;
  return calculatePoints({
    runs: rec.runs ?? 0,
    fours: rec.fours,
    sixes: rec.sixes,
    wickets: rec.wickets ?? 0,
    maidens: rec.maidens,
    catches: rec.catches ?? 0,
    wkCatches: rec.wkCatches ?? 0,
    stumpings: rec.stumpings ?? 0,
    runOuts: rec.runOuts ?? 0,
    didNotBat: rec.didNotBat,
  });
}

export function playedHistoryWeeks(history: PricingHistoryWeek[] | undefined): PricingHistoryWeek[] {
  return (history ?? []).filter((h) => !h.didNotPlay);
}

export function hasPlayedFormWeeks(p: PlayerForPricing): boolean {
  return playedHistoryWeeks(p.history).length > 0;
}

export function statLineAllZero(
  line: Pick<
    PricingHistoryWeek,
    "runs" | "fours" | "sixes" | "wickets" | "maidens" | "catches" | "wkCatches" | "stumpings" | "runOuts"
  >,
): boolean {
  return (
    (Number(line.runs) || 0) === 0 &&
    (Number(line.fours) || 0) === 0 &&
    (Number(line.sixes) || 0) === 0 &&
    (Number(line.wickets) || 0) === 0 &&
    (Number(line.maidens) || 0) === 0 &&
    (Number(line.catches) || 0) === 0 &&
    (Number(line.wkCatches) || 0) === 0 &&
    (Number(line.stumpings) || 0) === 0 &&
    (Number(line.runOuts) || 0) === 0
  );
}

/** All-zero week with no sign they batted — treat as did not play for form/pricing. */
export function historyWeekLooksLikeDidNotPlay(h: PricingHistoryWeek): boolean {
  if (h.didNotPlay) return true;
  if (Boolean(h.notOut)) return false;
  if (h.didNotBat === false) return false;
  return statLineAllZero(h);
}

export function liveRowLooksLikeDidNotPlay(p: PlayerForPricing): boolean {
  if (p.didNotPlay) return true;
  if (Boolean(p.notOut)) return false;
  if (p.didNotBat === false) return false;
  return statLineAllZero(p);
}

export function repairHistoryDidNotPlayWeeks<T extends PricingHistoryWeek>(history: T[] | undefined): T[] {
  return (history ?? []).map((h) => {
    if (!historyWeekLooksLikeDidNotPlay(h)) return h;
    return { ...h, didNotPlay: true, didNotBat: false, notOut: false, points: 0 };
  });
}

export function repairPlayerDidNotPlayHistory<T extends PlayerForPricing>(p: T): T {
  const history = repairHistoryDidNotPlayWeeks(p.history);
  if (!liveRowLooksLikeDidNotPlay(p)) {
    return { ...p, history };
  }
  return {
    ...p,
    history,
    didNotPlay: true,
    didNotBat: false,
    notOut: false,
    runs: 0,
    fours: 0,
    sixes: 0,
    wickets: 0,
    maidens: 0,
    catches: 0,
    wkCatches: 0,
    stumpings: 0,
    runOuts: 0,
  };
}

/** One-time bulk fix: every past GW row that looks like non-participation → didNotPlay. */
export function repairAllPlayersDidNotPlayHistory<T extends PlayerForPricing>(players: T[]): T[] {
  return players.map(repairPlayerDidNotPlayHistory);
}

export function countDidNotPlayHistoryRepairs(before: PlayerForPricing[], after: PlayerForPricing[]): number {
  let n = 0;
  for (let i = 0; i < before.length; i++) {
    const a = before[i];
    const b = after[i];
    if (!a || !b || a.id !== b.id) continue;
    const bh = b.history ?? [];
    const ah = a.history ?? [];
    for (let w = 0; w < bh.length; w++) {
      if (!bh[w]?.didNotPlay) continue;
      if (!ah[w]?.didNotPlay) n += 1;
    }
    if (b.didNotPlay && !a.didNotPlay) n += 1;
  }
  return n;
}

/** Weighted pts-per-game: 60% season average + 40% last 3 played weeks. DNP weeks ignored. */
export function formScoreForPlayer(p: PlayerForPricing): number {
  const played = playedHistoryWeeks(p.history);
  if (played.length === 0) return 0;
  const seasonPts = played.reduce((s, h) => s + weekPoints(h), 0);
  const seasonPpg = seasonPts / played.length;
  const recent = [...played].sort((a, b) => b.week - a.week).slice(0, RECENT_FORM_WEEKS);
  const recentPpg = recent.length
    ? recent.reduce((s, h) => s + weekPoints(h), 0) / recent.length
    : seasonPpg;
  return Math.round((seasonPpg * SEASON_PPG_WEIGHT + recentPpg * RECENT_PPG_WEIGHT) * 10) / 10;
}

/** Map rank (0 = best) to a draft price on the £5–£20 ladder (most players cluster around £11). */
export function targetPriceFromValueRank(rankIndex: number, poolSize: number): number {
  if (poolSize <= 0) return POOL_PRICE_BAND.min;
  if (poolSize === 1) return POOL_PRICE_BAND.max;
  const pct = rankIndex / (poolSize - 1);
  const mid = 11;
  const spreadTop = POOL_PRICE_BAND.max - mid;
  const spreadBot = mid - POOL_PRICE_BAND.min;
  if (pct <= 0.5) {
    const t = 1 - pct / 0.5;
    return clampPoolPrice(mid + spreadTop * t * t);
  }
  const t = (pct - 0.5) / 0.5;
  return clampPoolPrice(mid - spreadBot * t * t);
}

function pricingEligible(p: PlayerForPricing): boolean {
  return hasPlayedFormWeeks(p);
}

export function computePlayerPricing(
  p: PlayerForPricing,
  pool: PlayerForPricing[],
  rankedPool?: { id: number; formScore: number }[],
): PlayerPricing {
  const basePrice = clampPoolPrice(Math.max(1, Math.round(Number(p.price) || 1)));
  if (!pricingEligible(p)) {
    return { basePrice, effectivePrice: basePrice, priceDelta: 0, formScore: 0 };
  }
  const scored =
    rankedPool ??
    pool
      .filter(pricingEligible)
      .map((peer) => ({ id: peer.id, formScore: formScoreForPlayer(peer) }))
      .sort((a, b) => b.formScore - a.formScore || a.id - b.id);
  const rankIndex = scored.findIndex((row) => row.id === p.id);
  if (rankIndex < 0) {
    return { basePrice, effectivePrice: basePrice, priceDelta: 0, formScore: formScoreForPlayer(p) };
  }
  const effectivePrice = targetPriceFromValueRank(rankIndex, scored.length);
  return {
    basePrice,
    effectivePrice,
    priceDelta: effectivePrice - basePrice,
    formScore: formScoreForPlayer(p),
    valueRank: rankIndex + 1,
    pricedPoolSize: scored.length,
  };
}

export function computeDynamicPricingMap(players: PlayerForPricing[]): Map<number, PlayerPricing> {
  const scored = players
    .filter(pricingEligible)
    .map((peer) => ({ id: peer.id, formScore: formScoreForPlayer(peer) }))
    .sort((a, b) => b.formScore - a.formScore || a.id - b.id);
  const map = new Map<number, PlayerPricing>();
  for (const p of players) {
    map.set(p.id, computePlayerPricing(p, players, scored));
  }
  return map;
}

export function withEffectivePrices<T extends PlayerForPricing>(
  players: T[],
  pricingMap?: Map<number, PlayerPricing>,
): (T & { basePrice: number; priceDelta: number; formScore: number })[] {
  const map = pricingMap ?? computeDynamicPricingMap(players);
  return players.map((p) => {
    const pr = map.get(p.id);
    if (!pr) return { ...p, basePrice: p.price, priceDelta: 0, formScore: 0, price: p.price };
    return { ...p, ...pr, price: pr.effectivePrice };
  });
}

export type SquadBudgetStatus = {
  spend: number;
  overBudget: boolean;
  overBy: number;
};

export function squadBudgetStatus(
  playerIds: number[],
  budget: number,
  priceForId: (id: number) => number | undefined,
): SquadBudgetStatus {
  const spend = playerIds.reduce((s, id) => s + (priceForId(id) ?? 0), 0);
  const overBy = Math.max(0, spend - budget);
  return { spend, overBudget: overBy > 0, overBy };
}

export type PlayerForBudget = PlayerForPricing & {
  role: PlayerRole;
  available?: boolean;
};

/** Cheapest spend for a legal 2-2-2-1 squad at current prices (available players only). */
export function computeMinValidSquadCost(
  players: PlayerForBudget[],
  priceFor: (p: PlayerForBudget) => number,
): number | null {
  const pool = players.filter((p) => p.available !== false);
  const byRole: Record<PlayerRole, number[]> = { bat: [], ar: [], bowl: [], wk: [] };
  for (const p of pool) {
    byRole[p.role].push(priceFor(p));
  }
  for (const role of Object.keys(byRole) as PlayerRole[]) {
    byRole[role].sort((a, b) => a - b);
    if (byRole[role].length < SQUAD_ROLES[role]) return null;
  }
  let cost = 0;
  for (const role of Object.keys(SQUAD_ROLES) as PlayerRole[]) {
    const n = SQUAD_ROLES[role];
    for (let i = 0; i < n; i++) cost += byRole[role][i]!;
  }
  return cost;
}

export type DynamicBudgetResult = {
  budget: number;
  floorCost: number | null;
  headroom: number;
};

/**
 * Squad cap tracks the market: cheapest legal 2-2-2-1 + headroom (clamped).
 */
export function computeDynamicBudget(
  players: PlayerForBudget[],
  pricingMap?: Map<number, PlayerPricing>,
): DynamicBudgetResult {
  const priceFor = (p: PlayerForBudget) => pricingMap?.get(p.id)?.effectivePrice ?? p.price;
  const floorCost = computeMinValidSquadCost(players, priceFor);
  const headroom = DYNAMIC_BUDGET_HEADROOM;
  if (floorCost == null) {
    return { budget: BUDGET_BASE, floorCost: null, headroom };
  }
  const raw = floorCost + headroom;
  const budget = Math.max(DYNAMIC_BUDGET_MIN, Math.min(DYNAMIC_BUDGET_MAX, Math.round(raw)));
  return { budget, floorCost, headroom };
}
