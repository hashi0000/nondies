/** Shared fantasy scoring — keep in sync with `app/rules/page.tsx`. */

/** Highest applicable run milestone only (not stacked). */
export const RUN_MILESTONE_BONUS = {
  at25: 15,
  at50: 26,
  at75: 32,
  at100: 42,
} as const;

export const POINTS_PER_WICKET = 15;
export const POINTS_PER_MAIDEN = 4;

/** Highest applicable wicket haul only (not stacked). Tuned with run milestones so a “great” week with bat or ball is ~90–100 pts. */
export const WICKET_HAUL_BONUS = {
  at3: 8,
  at4: 22,
  at5: 30,
  at6: 36,
  at7: 42,
  at8: 48,
  at9: 54,
  at10: 60,
} as const;

function runMilestoneBonus(runs: number): number {
  if (runs >= 100) return RUN_MILESTONE_BONUS.at100;
  if (runs >= 75) return RUN_MILESTONE_BONUS.at75;
  if (runs >= 50) return RUN_MILESTONE_BONUS.at50;
  if (runs >= 25) return RUN_MILESTONE_BONUS.at25;
  return 0;
}

function wicketHaulBonus(wickets: number): number {
  if (wickets >= 10) return WICKET_HAUL_BONUS.at10;
  if (wickets >= 9) return WICKET_HAUL_BONUS.at9;
  if (wickets >= 8) return WICKET_HAUL_BONUS.at8;
  if (wickets >= 7) return WICKET_HAUL_BONUS.at7;
  if (wickets >= 6) return WICKET_HAUL_BONUS.at6;
  if (wickets >= 5) return WICKET_HAUL_BONUS.at5;
  if (wickets >= 4) return WICKET_HAUL_BONUS.at4;
  if (wickets >= 3) return WICKET_HAUL_BONUS.at3;
  return 0;
}

export function clampNonNegativeInt(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export type FantasyStatLine = {
  runs: number;
  fours?: number;
  sixes?: number;
  wickets: number;
  maidens?: number;
  catches: number;
  wkCatches: number;
  stumpings: number;
  runOuts: number;
  /** Did not bat — no batting points from runs/4s/6s/milestones; bowling & fielding still count. */
  didNotBat?: boolean;
};

/** Fantasy points for the current stat line (one gameweek row). Bat + bowl + fld sums to `total`. */
export type FantasyPointsBreakdown = {
  batting: number;
  bowling: number;
  /** Outfield catches × 8 only (WK catches excluded — see `keeper`). */
  fieldingOutfield: number;
  /** WK catches, stumpings and run-out involvement (scoring rules bonuses). */
  keeper: number;
  total: number;
};

export function fantasyPointsBreakdown(p: FantasyStatLine): FantasyPointsBreakdown {
  const didNotBat = Boolean(p.didNotBat);
  const runs = didNotBat ? 0 : clampNonNegativeInt(p.runs);
  const fours = didNotBat ? 0 : clampNonNegativeInt(p.fours ?? 0);
  const sixes = didNotBat ? 0 : clampNonNegativeInt(p.sixes ?? 0);
  const runBonus = didNotBat ? 0 : runMilestoneBonus(runs);

  const wickets = clampNonNegativeInt(p.wickets);
  const maidens = clampNonNegativeInt(p.maidens ?? 0);
  const totalCatches = clampNonNegativeInt(p.catches);
  const wkC = clampNonNegativeInt(p.wkCatches);
  const stumpings = clampNonNegativeInt(p.stumpings);
  const runOuts = clampNonNegativeInt(p.runOuts);
  const outfieldCatches = Math.max(totalCatches - wkC, 0);

  const boundaryBonus = fours + sixes * 2;
  const batting = runs + runBonus + boundaryBonus;
  const bowling = wickets * POINTS_PER_WICKET + maidens * POINTS_PER_MAIDEN + wicketHaulBonus(wickets);
  const fieldingOutfield = outfieldCatches * 8;
  const keeper = wkC * 10 + stumpings * 12 + runOuts * 10;

  return {
    batting,
    bowling,
    fieldingOutfield,
    keeper,
    total: batting + bowling + fieldingOutfield + keeper,
  };
}

export function calculatePoints(p: FantasyStatLine) {
  return fantasyPointsBreakdown(p).total;
}
