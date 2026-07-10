import { calculatePoints, type FantasyStatLine } from "@/lib/fantasyPoints";

export type PointsTeam = {
  players: number[];
  captain: number | null;
  viceCaptain: number | null;
  cumulativePoints?: number;
  playerJoinedGameweek?: Record<string, unknown>;
};

function playerFirstGameweekOnTeam(team: PointsTeam, playerId: number): number {
  const m = team.playerJoinedGameweek;
  if (!m || typeof m !== "object") return 1;
  const raw = m[String(playerId)];
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw.trim())
        ? Number(raw.trim())
        : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function playerScoresInGameweek(team: PointsTeam, playerId: number, scoringGameweek: number): boolean {
  const joined = playerFirstGameweekOnTeam(team, playerId);
  if (joined === scoringGameweek + 1) return false;
  return joined <= scoringGameweek;
}

/** Live squad points for the current gameweek (same rules as the main leaderboard). */
export function computeWeekTeamPoints(
  team: PointsTeam,
  playerById: Map<number, FantasyStatLine>,
  scoringGameweek: number,
): number {
  let total = 0;
  for (const id of team.players) {
    if (!playerScoresInGameweek(team, id, scoringGameweek)) continue;
    const p = playerById.get(id);
    if (!p) continue;
    const base = calculatePoints(p);
    total += base * (team.captain === id ? 2 : team.viceCaptain === id ? 1.5 : 1);
  }
  return Math.round(total * 10) / 10;
}

/** Total league points earned so far — completed GWs + this week's live score. */
export function totalEarnedFantasyPoints(
  team: PointsTeam,
  playerById: Map<number, FantasyStatLine>,
  scoringGameweek: number,
): number {
  const cumulative = Number(team.cumulativePoints ?? 0);
  const week = computeWeekTeamPoints(team, playerById, scoringGameweek);
  return Math.max(0, Math.round((cumulative + week) * 10) / 10);
}

export function parsePlayerStatLine(data: Record<string, unknown>): FantasyStatLine {
  return {
    runs: Number(data.runs ?? 0),
    fours: Number(data.fours ?? 0),
    sixes: Number(data.sixes ?? 0),
    wickets: Number(data.wickets ?? 0),
    maidens: Number(data.maidens ?? 0),
    catches: Number(data.catches ?? 0),
    wkCatches: Number(data.wkCatches ?? 0),
    stumpings: Number(data.stumpings ?? 0),
    runOuts: Number(data.runOuts ?? 0),
    didNotBat: Boolean(data.didNotBat),
    didNotPlay: Boolean(data.didNotPlay),
  };
}
