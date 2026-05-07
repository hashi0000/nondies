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
};

export function calculatePoints(p: FantasyStatLine) {
  const runs = clampNonNegativeInt(p.runs);
  const fours = clampNonNegativeInt(p.fours ?? 0);
  const sixes = clampNonNegativeInt(p.sixes ?? 0);
  let runBonus = 0;
  if (runs >= 100) runBonus = 25;
  else if (runs >= 75) runBonus = 18;
  else if (runs >= 50) runBonus = 16;
  else if (runs >= 25) runBonus = 10;

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
  const fielding = outfieldCatches * 8;

  const keeperBonuses = wkC * 10 + stumpings * 12 + runOuts * 10;

  return batting + bowling + fielding + keeperBonuses;
}
