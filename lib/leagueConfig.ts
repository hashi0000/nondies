/**
 * Core league numbers — imported by the game UI and the rules page.
 * Squad is 7: 2 batters, 2 bowlers, 2 all-rounders, 1 wicketkeeper.
 */
export const SQUAD_SIZE = 7;
/** Price cap; scaled from £100 at 11 players (~£9.09/slot). */
export const BUDGET = 64;

export type PlayerRole = "bat" | "ar" | "bowl" | "wk";

/** Required role counts per saved squad (must sum to SQUAD_SIZE). */
export const SQUAD_ROLES: Record<PlayerRole, number> = {
  bat: 2,
  ar: 2,
  bowl: 2,
  wk: 1,
};

export const ROLE_LABEL: Record<PlayerRole, string> = {
  bat: "Batter",
  ar: "All-rounder",
  bowl: "Bowler",
  wk: "WK",
};

// ─── Transfer policy (rules + enforced in app on save / End GW) ─────────────
/** How many player changes count as “free” each gameweek before penalties apply. */
export const FREE_TRANSFERS_PER_WEEK = 1;
/**
 * Max unused free transfers carried into the next gameweek (1 + 1 banked → 2 usable).
 */
export const MAX_BANKED_FREE_TRANSFERS = 2;
/**
 * League points deducted from the team for each transfer beyond the free allowance.
 * Change this single value when the committee settles on a number.
 */
export const POINTS_PER_EXTRA_TRANSFER = 50;
