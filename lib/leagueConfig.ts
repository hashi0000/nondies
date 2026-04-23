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
