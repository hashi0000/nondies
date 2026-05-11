/** Shared fantasy scoring — keep in sync with `app/rules/page.tsx`. */

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
  let runBonus = 0;
  if (!didNotBat) {
    if (runs >= 100) runBonus = 25;
    else if (runs >= 75) runBonus = 18;
    else if (runs >= 50) runBonus = 16;
    else if (runs >= 25) runBonus = 10;
  }

  const wickets = clampNonNegativeInt(p.wickets);
  const maidens = clampNonNegativeInt(p.maidens ?? 0);
  const totalCatches = clampNonNegativeInt(p.catches);
  const wkC = clampNonNegativeInt(p.wkCatches);
  const stumpings = clampNonNegativeInt(p.stumpings);
  const runOuts = clampNonNegativeInt(p.runOuts);
  const outfieldCatches = Math.max(totalCatches - wkC, 0);

  let wicketBonus = 0;
  if (wickets >= 10) wicketBonus = 80;
  else if (wickets >= 9) wicketBonus = 68;
  else if (wickets >= 8) wicketBonus = 57;
  else if (wickets >= 7) wicketBonus = 46;
  else if (wickets >= 6) wicketBonus = 35;
  else if (wickets >= 5) wicketBonus = 25;
  else if (wickets >= 4) wicketBonus = 16;
  else if (wickets >= 3) wicketBonus = 8;

  const boundaryBonus = fours + sixes * 2;
  const batting = runs + runBonus + boundaryBonus;
  const bowling = wickets * 16 + maidens * 4 + wicketBonus;
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
