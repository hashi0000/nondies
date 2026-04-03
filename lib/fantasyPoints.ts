/** Shared fantasy scoring — keep in sync with rules copy in the app. */

export function clampNonNegativeInt(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export type FantasyStatLine = {
  runs: number;
  wickets: number;
  catches: number;
  wkCatches: number;
  stumpings: number;
  runOuts: number;
};

export function calculatePoints(p: FantasyStatLine) {
  const runs = clampNonNegativeInt(p.runs);
  let runBonus = 0;
  if (runs >= 100) runBonus = 25;
  else if (runs >= 75) runBonus = 15;
  else if (runs >= 50) runBonus = 10;
  else if (runs >= 25) runBonus = 5;

  const wickets = clampNonNegativeInt(p.wickets);
  const totalCatches = clampNonNegativeInt(p.catches);
  const wkC = clampNonNegativeInt(p.wkCatches);
  const stumpings = clampNonNegativeInt(p.stumpings);
  const runOuts = clampNonNegativeInt(p.runOuts);
  const outfieldCatches = Math.max(totalCatches - wkC, 0);

  const batting = runs + runBonus;
  const bowling = wickets * 16;
  const fielding = outfieldCatches * 8;

  const keeperBonuses = wkC * 10 + stumpings * 12 + runOuts * 10;

  return batting + bowling + fielding + keeperBonuses;
}
