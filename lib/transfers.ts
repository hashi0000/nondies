import {
  FREE_TRANSFERS_PER_WEEK,
  MAX_BANKED_FREE_TRANSFERS,
  POINTS_PER_EXTRA_TRANSFER,
  SQUAD_SIZE,
} from "./leagueConfig";

/** Max free transfers you can have available in one gameweek (weekly free + bank cap). */
export const MAX_FREE_TRANSFERS_IN_GW = FREE_TRANSFERS_PER_WEEK + MAX_BANKED_FREE_TRANSFERS;

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

/** Free allowance for the next gameweek after rollover. */
export function freeTransfersAfterRollover(unusedFreesFromPriorGw: number): number {
  const unused = Math.max(0, unusedFreesFromPriorGw);
  return Math.min(unused + FREE_TRANSFERS_PER_WEEK, MAX_FREE_TRANSFERS_IN_GW);
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
    `📢 GW${gameweek} — free squad rebuild (new pricing)\n\n` +
    `Player prices and the squad cap have changed. Rebuild your 7 in Draft until ${lineupLockSummary} with ` +
    `no transfer penalties. Fix any over-budget squad before saving.`
  );
}
