import { INITIAL_LISTED_PRICES } from "@/lib/squadPurchasePrices";

export type PlayerPriceHistoryWeek = {
  week: number;
  /** Listed price in Firestore during this gameweek. */
  listed: number;
  /** Dynamic draft price during this gameweek. */
  draft: number;
};

export type PlayerForPriceHistory = {
  id: number;
  name: string;
  price: number;
  history?: { week: number }[];
  priceHistory?: PlayerPriceHistoryWeek[];
};

export type PriceCompareMetric = "draftPrice" | "listedPrice";

export const PRICE_COMPARE_METRIC_LABEL: Record<PriceCompareMetric, string> = {
  draftPrice: "Draft price (£)",
  listedPrice: "Listed price (£)",
};

export function parsePriceHistory(raw: unknown): PlayerPriceHistoryWeek[] {
  if (!Array.isArray(raw)) return [];
  const out: PlayerPriceHistoryWeek[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const week = Number(r.week);
    const listed = Number(r.listed ?? r.listedPrice);
    const draft = Number(r.draft ?? r.draftPrice ?? r.effective);
    if (!Number.isFinite(week) || week < 1) continue;
    if (!Number.isFinite(listed) || !Number.isFinite(draft)) continue;
    out.push({ week: Math.floor(week), listed: Math.round(listed), draft: Math.round(draft) });
  }
  out.sort((a, b) => a.week - b.week);
  return out;
}

export function appendPriceHistoryWeek(
  existing: PlayerPriceHistoryWeek[] | undefined,
  week: number,
  listed: number,
  draft: number,
): PlayerPriceHistoryWeek[] {
  const next = (existing ?? []).filter((h) => h.week !== week);
  next.push({
    week: Math.floor(week),
    listed: Math.round(listed),
    draft: Math.round(draft),
  });
  next.sort((a, b) => a.week - b.week);
  return next;
}

/** GW1 opening snapshot when we have stats but no stored prices yet. */
export function effectivePriceHistory(player: PlayerForPriceHistory): PlayerPriceHistoryWeek[] {
  const stored = parsePriceHistory(player.priceHistory);
  if (stored.some((h) => h.week === 1)) return stored;
  const playedGw1 = (player.history ?? []).some((h) => h.week === 1);
  if (!playedGw1) return stored;
  const opening = INITIAL_LISTED_PRICES[player.id];
  if (opening == null) return stored;
  return [{ week: 1, listed: opening, draft: opening }, ...stored].sort((a, b) => a.week - b.week);
}

export function weeksForPriceHistory(
  players: PlayerForPriceHistory[],
  currentGameweek: number,
): number[] {
  const weeks = new Set<number>();
  for (const p of players) {
    for (const h of effectivePriceHistory(p)) {
      weeks.add(h.week);
    }
    if (currentGameweek >= 1) weeks.add(currentGameweek);
  }
  return [...weeks].sort((a, b) => a - b);
}

export type PlayerPriceSeries = {
  playerId: number;
  name: string;
  points: { week: number; value: number }[];
};

export function buildPlayerPriceSeries(
  p: PlayerForPriceHistory,
  weeks: number[],
  metric: PriceCompareMetric,
  currentGameweek: number,
  liveDraftPrice: number,
  liveListedPrice: number,
): PlayerPriceSeries {
  const history = effectivePriceHistory(p);
  const points: { week: number; value: number }[] = [];
  for (const week of weeks) {
    if (week === currentGameweek) {
      points.push({
        week,
        value: metric === "draftPrice" ? liveDraftPrice : liveListedPrice,
      });
      continue;
    }
    const rec = history.find((h) => h.week === week);
    if (!rec) continue;
    points.push({
      week,
      value: metric === "draftPrice" ? rec.draft : rec.listed,
    });
  }
  return { playerId: p.id, name: p.name, points };
}

export function isPriceCompareMetric(metric: string): metric is PriceCompareMetric {
  return metric === "draftPrice" || metric === "listedPrice";
}
