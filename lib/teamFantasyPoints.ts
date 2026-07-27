import { calculatePoints, type FantasyStatLine } from "@/lib/fantasyPoints";
import { parseShopForScoring, scoreSquadWithShop, sumAppliedShopScores } from "@/lib/shopScoring";

export type PointsTeam = {
  uid?: string;
  players: number[];
  captain: number | null;
  viceCaptain: number | null;
  cumulativePoints?: number;
  playerJoinedGameweek?: Record<string, unknown>;
  fantasyShop?: unknown;
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
  const shop = parseShopForScoring(team.fantasyShop, scoringGameweek);
  const teamUid = team.uid ?? "";
  const scores = scoreSquadWithShop({
    team,
    shop,
    squadPlayerIds: team.players,
    teamUid,
    players: team.players.map((id) => {
      const scored = playerScoresInGameweek(team, id, scoringGameweek);
      return { id, line: scored ? (playerById.get(id) ?? null) : null, scored };
    }),
  });
  return sumAppliedShopScores(scores);
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
