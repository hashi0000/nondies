import { calculatePoints } from "@/lib/fantasyPoints";

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

function playedHistoryWeeks(history: PricingHistoryWeek[] | undefined): PricingHistoryWeek[] {
  return (history ?? []).filter((h) => !h.didNotPlay);
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
  const tierPeers = pool.filter((x) => (x.teamTier === 1 ? 1 : 2) === tier);
  const scored = tierPeers
    .map((peer) => ({ id: peer.id, formScore: formScoreForPlayer(peer) }))
    .sort((a, b) => b.formScore - a.formScore || a.id - b.id);
  const rankIndex = Math.max(
    0,
    scored.findIndex((row) => row.id === p.id),
  );
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
