import {
  FREE_TRANSFERS_PER_WEEK,
  MAX_BANKED_FREE_TRANSFERS,
  POINTS_PER_EXTRA_TRANSFER,
  SQUAD_SIZE,
} from "./leagueConfig";

/** Max free transfers you can have available in one gameweek (weekly free + bank cap). */
export const MAX_FREE_TRANSFERS_IN_GW = FREE_TRANSFERS_PER_WEEK + MAX_BANKED_FREE_TRANSFERS;

/** Human-readable allowance, e.g. "2 per gameweek (+1 banked)". */
export function transferPolicySummary(): string {
  return `${FREE_TRANSFERS_PER_WEEK} per gameweek (+${MAX_BANKED_FREE_TRANSFERS} banked)`;
}

/** How many of the current allowance came from last week's unused free(s). */
export function bankedFreeTransfersInAllowance(allowance: number): number {
  return Math.max(0, Math.min(allowance - FREE_TRANSFERS_PER_WEEK, MAX_BANKED_FREE_TRANSFERS));
}

/** Free allowance at GW start — never below the current weekly free (policy bumps apply immediately). */
export function resolveFreeTransfersAtGwStart(stored: number | undefined | null): number {
  if (typeof stored === "number" && Number.isFinite(stored)) {
    return Math.max(
      FREE_TRANSFERS_PER_WEEK,
      Math.min(Math.floor(stored), MAX_FREE_TRANSFERS_IN_GW),
    );
  }
  return MAX_FREE_TRANSFERS_IN_GW;
}

/**
 * Count of players swapped out vs `baseline` (same as players in when squad sizes match).
 * Captain / VC / keeper-only changes do not count.
 */
export function countOutgoingPlayerChanges(baselineIds: number[] | undefined, nextIds: number[]): number {
  if (!baselineIds?.length || baselineIds.length !== SQUAD_SIZE || nextIds.length !== SQUAD_SIZE) return 0;
  const next = new Set(nextIds);
  let out = 0;
  for (const id of baselineIds) {
    if (!next.has(id)) out += 1;
  }
  return out;
}

export function transferExtrasAgainstFree(transferCount: number, freeAllowance: number): number {
  return Math.max(0, transferCount - Math.max(0, freeAllowance));
}

export function penaltyPointsForExtras(extras: number): number {
  return extras * POINTS_PER_EXTRA_TRANSFER;
}

/** Free allowance for the next gameweek after rollover — at most +1 banked from unused frees. */
export function freeTransfersAfterRollover(unusedFreesFromPriorGw: number): number {
  const banked = Math.min(Math.max(0, unusedFreesFromPriorGw), MAX_BANKED_FREE_TRANSFERS);
  return FREE_TRANSFERS_PER_WEEK + banked;
}

/** League-wide amnesty: unlimited player changes for one gameweek (stored on gameState/current). */
export function isFreeSquadRebuildGameweek(
  currentGameweek: number,
  freeSquadRebuildGameweek?: number | null,
): boolean {
  return (
    typeof freeSquadRebuildGameweek === "number" &&
    Number.isFinite(freeSquadRebuildGameweek) &&
    Math.floor(freeSquadRebuildGameweek) === currentGameweek
  );
}

export function pricingAmnestyPavilionMessage(gameweek: number, lineupLockSummary: string): string {
  return (
    `📢 GW${gameweek} — pricing update\n\n` +
    `You don't have to change your squad — your original picks keep their opening price. ` +
    `If you do rebuild in Draft until ${lineupLockSummary}, new picks use dynamic prices and there are no transfer penalties.`
  );
}

export function personalSpendCapPavilionMessage(spendCapExample?: string): string {
  const capLine = spendCapExample
    ? `Your personal cap is your saved squad spend (e.g. ${spendCapExample}). `
    : `Your personal cap is your saved squad spend at opening prices. `;
  return (
    `📢 Transfer update — personal spend cap\n\n` +
    `Original season squads: you don't have to change your team. ` +
    capLine +
    `Swap within that envelope — new picks use dynamic prices, kept players keep their opening price. New teams still use the league cap.`
  );
}
