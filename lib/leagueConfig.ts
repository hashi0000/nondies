/**
 * Core league numbers — imported by the game UI and the rules page.
 * Squad is 7: 2 batters, 2 bowlers, 2 all-rounders, 1 wicketkeeper.
 */
export const SQUAD_SIZE = 7;
/**
 * Legacy fixed cap (season start). Live draft uses {@link computeDynamicBudget} in `lib/dynamicPricing.ts`.
 */
export const BUDGET = 64;
export const BUDGET_BASE = BUDGET;

/** £ above the cheapest legal 2-2-2-1 — generous room so a mixed squad (not all floor picks) still fits. */
export const DYNAMIC_BUDGET_HEADROOM = 32;
/** Floor on the cap even when the market is cheap — avoids tight squads mid-season. */
export const DYNAMIC_BUDGET_MIN = 75;
export const DYNAMIC_BUDGET_MAX = 100;

/** Squads are rolled back to this completed GW if changed after dynamic pricing went live. */
export const PRE_DYNAMIC_PRICING_SNAPSHOT_GW = 4;

/** Recommended 2-2-2-1 — wrong shape does not block save or scoring (provisional). */
export const PROVISIONAL_SQUAD_SHAPE = true;

/** Lineup lock in the user’s browser local time (`Date.getDay()` scale: 0 Sun … 6 Sat). */
export const LINEUP_LOCK_WEEKDAY = 6;
export const LINEUP_LOCK_HOUR = 0;
export const LINEUP_LOCK_MINUTE = 0;

const LINEUP_LOCK_DAY_NAME = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Human-readable for rules/UI, e.g. "Saturday 10:30". */
export const LINEUP_LOCK_SUMMARY = `${LINEUP_LOCK_DAY_NAME[LINEUP_LOCK_WEEKDAY]} ${LINEUP_LOCK_HOUR}:${String(LINEUP_LOCK_MINUTE).padStart(2, "0")}`;

/** Short label for compact UI, e.g. "Sat 10:30". */
export const LINEUP_LOCK_SUMMARY_SHORT = `${LINEUP_LOCK_DAY_NAME[LINEUP_LOCK_WEEKDAY].slice(0, 3)} ${LINEUP_LOCK_HOUR}:${String(LINEUP_LOCK_MINUTE).padStart(2, "0")}`;

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
export const FREE_TRANSFERS_PER_WEEK = 2;
/**
 * Max unused free transfers banked on top of the weekly allowance (2 + 2 banked → 4 usable in one GW).
 */
export const MAX_BANKED_FREE_TRANSFERS = 2;
/**
 * League points deducted from the team for each transfer beyond the free allowance.
 * Change this single value when the committee settles on a number.
 */
export const POINTS_PER_EXTRA_TRANSFER = 50;
