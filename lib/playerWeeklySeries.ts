import { calculatePoints, fantasyPointsBreakdown, type FantasyStatLine } from "@/lib/fantasyPoints";

export type PlayerHistoryWeek = {
  week: number;
  runs: number;
  fours?: number;
  sixes?: number;
  wickets: number;
  maidens?: number;
  catches: number;
  wkCatches: number;
  stumpings: number;
  runOuts: number;
  points?: number;
  didNotBat?: boolean;
  didNotPlay?: boolean;
  notOut?: boolean;
};

export type PlayerForChart = {
  id: number;
  name: string;
  history: PlayerHistoryWeek[];
} & FantasyStatLine;

export type CompareMetric = "points" | "cumulative" | "runs" | "wickets" | "batting" | "bowling";

export const COMPARE_METRIC_LABEL: Record<CompareMetric, string> = {
  points: "Fantasy points (per GW)",
  cumulative: "Cumulative fantasy points",
  runs: "Runs (per GW)",
  wickets: "Wickets (per GW)",
  batting: "Batting fantasy (per GW)",
  bowling: "Bowling fantasy (per GW)",
};

function hasLiveGameweekStats(p: PlayerForChart): boolean {
  if (Boolean(p.didNotPlay)) return false;
  return (
    Boolean(p.didNotBat) ||
    (p.runs ?? 0) > 0 ||
    (p.fours ?? 0) > 0 ||
    (p.sixes ?? 0) > 0 ||
    (p.wickets ?? 0) > 0 ||
    (p.maidens ?? 0) > 0 ||
    (p.catches ?? 0) > 0 ||
    (p.wkCatches ?? 0) > 0 ||
    (p.stumpings ?? 0) > 0 ||
    (p.runOuts ?? 0) > 0
  );
}

function liveWeekFromPlayer(p: PlayerForChart, week: number): PlayerHistoryWeek {
  const line: FantasyStatLine = {
    runs: p.runs ?? 0,
    fours: p.fours ?? 0,
    sixes: p.sixes ?? 0,
    wickets: p.wickets ?? 0,
    maidens: p.maidens ?? 0,
    catches: p.catches ?? 0,
    wkCatches: p.wkCatches ?? 0,
    stumpings: p.stumpings ?? 0,
    runOuts: p.runOuts ?? 0,
    didNotBat: p.didNotBat,
    didNotPlay: p.didNotPlay,
  };
  return { week, ...line, points: calculatePoints(line) };
}

export function weeksForPlayers(players: PlayerForChart[], currentGameweek: number): number[] {
  const weeks = new Set<number>();
  for (const p of players) {
    for (const h of p.history ?? []) {
      if (Number.isFinite(h.week)) weeks.add(h.week);
    }
    const inHistory = (p.history ?? []).some((h) => h.week === currentGameweek);
    if (!inHistory && hasLiveGameweekStats(p)) weeks.add(currentGameweek);
  }
  return [...weeks].sort((a, b) => a - b);
}

export function weekRecordForPlayer(p: PlayerForChart, week: number, currentGameweek: number): PlayerHistoryWeek | null {
  const fromHistory = (p.history ?? []).find((h) => h.week === week);
  if (fromHistory) return fromHistory;
  if (week === currentGameweek && hasLiveGameweekStats(p)) return liveWeekFromPlayer(p, week);
  return null;
}

function metricValue(rec: PlayerHistoryWeek, metric: CompareMetric): number {
  const line: FantasyStatLine = {
    runs: rec.runs,
    fours: rec.fours,
    sixes: rec.sixes,
    wickets: rec.wickets,
    maidens: rec.maidens,
    catches: rec.catches,
    wkCatches: rec.wkCatches,
    stumpings: rec.stumpings,
    runOuts: rec.runOuts,
    didNotBat: rec.didNotBat,
    didNotPlay: rec.didNotPlay,
  };
  switch (metric) {
    case "points":
      return Number.isFinite(Number(rec.points)) ? Number(rec.points) : calculatePoints(line);
    case "runs":
      return rec.didNotPlay || rec.didNotBat ? 0 : rec.runs;
    case "wickets":
      return rec.wickets;
    case "batting":
      return fantasyPointsBreakdown(line).batting;
    case "bowling":
      return fantasyPointsBreakdown(line).bowling;
    default:
      return 0;
  }
}

export type PlayerSeries = {
  playerId: number;
  name: string;
  points: { week: number; value: number }[];
};

export function buildPlayerSeries(
  p: PlayerForChart,
  weeks: number[],
  metric: CompareMetric,
  currentGameweek: number,
): PlayerSeries {
  const raw: { week: number; value: number }[] = [];
  for (const week of weeks) {
    const rec = weekRecordForPlayer(p, week, currentGameweek);
    if (!rec) continue;
    const valueMetric = metric === "cumulative" ? "points" : metric;
    raw.push({ week, value: metricValue(rec, valueMetric) });
  }
  if (metric !== "cumulative") {
    return { playerId: p.id, name: p.name, points: raw };
  }
  let sum = 0;
  const cumulative = raw.map((pt) => {
    sum += pt.value;
    return { week: pt.week, value: sum };
  });
  return { playerId: p.id, name: p.name, points: cumulative };
}
