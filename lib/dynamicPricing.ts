import { calculatePoints } from "@/lib/fantasyPoints";
import {
  BUDGET_BASE,
  DYNAMIC_BUDGET_HEADROOM,
  DYNAMIC_BUDGET_MAX,
  DYNAMIC_BUDGET_MIN,
  SQUAD_ROLES,
  type PlayerRole,
} from "@/lib/leagueConfig";

/** Price bands per squad tier (1st / 2nd XI). */
export const PRICE_BAND: Record<1 | 2, { min: number; max: number }> = {
  1: { min: 12, max: 20 },
  2: { min: 5, max: 10 },
};

/** Max £ rise/fall from base driven by form rank within tier. */
export const MAX_FORM_PRICE_DELTA = 3;

const RECENT_FORM_WEEKS = 3;

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
  basePrice: number;
  effectivePrice: number;
  priceDelta: number;
  formScore: number;
};

function clampPrice(n: number, tier: 1 | 2): number {
  const band = PRICE_BAND[tier];
  return Math.max(band.min, Math.min(band.max, Math.round(n)));
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

/** Season total + weighted recent gameweeks (higher = hotter form). Did-not-play weeks are ignored. */
export function formScoreForPlayer(p: PlayerForPricing): number {
  const played = playedHistoryWeeks(p.history);
  let season = 0;
  for (const h of played) {
    season += weekPoints(h);
  }
  const recent = [...played].sort((a, b) => b.week - a.week).slice(0, RECENT_FORM_WEEKS);
  const recentAvg = recent.length
    ? recent.reduce((s, h) => s + weekPoints(h), 0) / recent.length
    : 0;
  return Math.round((season + recentAvg * 2) * 10) / 10;
}

function adjustmentFromFormRank(rankIndex: number, poolSize: number): number {
  if (poolSize <= 1) return 0;
  const pct = rankIndex / (poolSize - 1);
  if (pct <= 0.15) return MAX_FORM_PRICE_DELTA;
  if (pct <= 0.35) return 2;
  if (pct <= 0.65) return 1;
  if (pct <= 0.85) return 0;
  if (pct <= 0.95) return -1;
  return -2;
}

export function computePlayerPricing(p: PlayerForPricing, pool: PlayerForPricing[]): PlayerPricing {
  const tier = p.teamTier === 1 ? 1 : 2;
  const basePrice = Math.max(1, Math.round(Number(p.price) || 1));
  if (Boolean(p.didNotPlay) || !hasPlayedFormWeeks(p)) {
    return { basePrice, effectivePrice: basePrice, priceDelta: 0, formScore: 0 };
  }
  const tierPeers = pool.filter(
    (x) => (x.teamTier === 1 ? 1 : 2) === tier && hasPlayedFormWeeks(x) && !x.didNotPlay,
  );
  if (tierPeers.length === 0) {
    return { basePrice, effectivePrice: basePrice, priceDelta: 0, formScore: formScoreForPlayer(p) };
  }
  const scored = tierPeers
    .map((peer) => ({ id: peer.id, formScore: formScoreForPlayer(peer) }))
    .sort((a, b) => b.formScore - a.formScore || a.id - b.id);
  const rankIndex = scored.findIndex((row) => row.id === p.id);
  if (rankIndex < 0) {
    return { basePrice, effectivePrice: basePrice, priceDelta: 0, formScore: formScoreForPlayer(p) };
  }
  const delta = adjustmentFromFormRank(rankIndex, scored.length);
  const effectivePrice = clampPrice(basePrice + delta, tier);
  return {
    basePrice,
    effectivePrice,
    priceDelta: effectivePrice - basePrice,
    formScore: formScoreForPlayer(p),
  };
}

export function computeDynamicPricingMap(players: PlayerForPricing[]): Map<number, PlayerPricing> {
  const map = new Map<number, PlayerPricing>();
  for (const p of players) {
    map.set(p.id, computePlayerPricing(p, players));
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
 * Squad cap tracks the market: cheapest legal squad + fixed headroom (clamped).
 * Still blocks all–1st-XI stacks; rises when form pushes prices up.
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
