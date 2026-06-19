"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronUp,
  LogOut,
  Lock,
  Plus,
  Save,
  Search,
  Settings,
  Shield,
  Star,
  Trash2,
  Trophy,
  Download,
  ArrowUpDown,
  AlertTriangle,
  MessageSquare,
  Users,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  deleteDoc,
  deleteField,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { auth, db, firebaseProjectId } from "@/lib/firebase";
import { PlayerCompareCharts } from "@/components/PlayerCompareCharts";
import { calculatePoints, clampNonNegativeInt, fantasyPointsBreakdown } from "@/lib/fantasyPoints";
import {
  FREE_TRANSFERS_PER_WEEK,
  LINEUP_LOCK_HOUR,
  LINEUP_LOCK_MINUTE,
  LINEUP_LOCK_SUMMARY,
  LINEUP_LOCK_WEEKDAY,
  MAX_BANKED_FREE_TRANSFERS,
  POINTS_PER_EXTRA_TRANSFER,
  PRE_DYNAMIC_PRICING_SNAPSHOT_GW,
  PROVISIONAL_SQUAD_SHAPE,
  type PlayerRole,
  ROLE_LABEL,
  SQUAD_ROLES,
  SQUAD_SIZE,
} from "@/lib/leagueConfig";
import {
  countOutgoingPlayerChanges,
  freeTransfersAfterRollover,
  isFreeSquadRebuildGameweek,
  MAX_FREE_TRANSFERS_IN_GW,
  penaltyPointsForExtras,
  pricingAmnestyPavilionMessage,
  resolveFreeTransfersAtGwStart,
  transferExtrasAgainstFree,
} from "@/lib/transfers";
import { normalizePlayCricketName } from "@/lib/playCricket/names";
import {
  cumulativeRanksByUid,
  deleteAllGwTeamsDocs,
  firestoreTeamFieldsFromGwSnapshot,
  gwSnapshotToSavedTeam,
  parseGwTeamsDoc,
  rankMovement,
  squadMatchesGwSnapshot,
  type GwTeamSnapshot,
  type GwTeamsDoc,
} from "@/lib/gwTeams";
import {
  computeDynamicBudget,
  computeDynamicPricingMap,
  countDidNotPlayHistoryRepairs,
  POOL_PRICE_BAND,
  repairAllPlayersDidNotPlayHistory,
  repairHistoryDidNotPlayWeeks,
  withEffectivePrices,
} from "@/lib/dynamicPricing";
import {
  buildPurchasePricesAfterSave,
  draftPurchasePricesForSelection,
  priceForIdFromMap,
  isGrandfatheredPricingTeam,
  GRANDFATHERED_SQUAD_MESSAGE,
  PERSONAL_SPEND_CAP_NOTICE_KEY,
  draftBudgetForTeam,
  personalSpendCapForTeam,
  purchasePricesForRestoredSnapshot,
  squadSpend,
  squadSpendForTeam,
  type PurchasePriceMap,
} from "@/lib/squadPurchasePrices";

/** Dream team size — top individual scorers for the gameweek. */
const BEST_XI_SIZE = 11;

type BestXiEntry = { id: number; name: string; role: PlayerRole; points: number };

function bestXiForGameweek(playersList: Player[], gameweek: number, useLiveStats: boolean): BestXiEntry[] {
  const rows: BestXiEntry[] = [];
  for (const p of playersList) {
    const histRec = (p.history ?? []).find((h) => h.week === gameweek);
    let points = 0;
    if (histRec) {
      if (histRec.didNotPlay) continue;
      points = Number.isFinite(Number(histRec.points)) ? Number(histRec.points) : calculatePoints(histRec);
    } else if (useLiveStats) {
      if (p.didNotPlay) continue;
      points = calculatePoints(p);
    } else {
      continue;
    }
    if (points <= 0) continue;
    rows.push({ id: p.id, name: p.name, role: p.role, points: Math.round(points * 10) / 10 });
  }
  rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return rows.slice(0, BEST_XI_SIZE);
}

/** Admin: zero every player’s weekly stat row and match history (player pool docs stay). */
async function resetAllPlayerDocumentsStats() {
  const playerSnap = await getDocs(collection(db, "players"));
  const writeLimit = 450;
  let batch = writeBatch(db);
  let ops = 0;
  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  };
  for (const d of playerSnap.docs) {
    batch.update(d.ref, {
      runs: 0,
      fours: 0,
      sixes: 0,
      wickets: 0,
      maidens: 0,
      catches: 0,
      wkCatches: 0,
      stumpings: 0,
      runOuts: 0,
      didNotBat: false,
      didNotPlay: false,
      notOut: false,
      history: [],
    });
    ops += 1;
    if (ops >= writeLimit) await flush();
  }
  await flush();
}

// ─── Types ───────────────────────────────────────────────────────────────────

type WeekRecord = {
  week: number;
  runs: number;
  fours: number;
  sixes: number;
  wickets: number;
  maidens: number;
  catches: number;
  wkCatches: number;
  stumpings: number;
  runOuts: number;
  points: number;
  didNotBat?: boolean;
  /** Did not play the match — no points; excluded from form dots and dynamic pricing. */
  didNotPlay?: boolean;
  /** True when batter remained not out this gameweek. */
  notOut?: boolean;
};

function weekRecordFromPlayer(p: Player, week: number, currentGameweek: number): WeekRecord | null {
  const fromHist = (p.history ?? []).find((h) => h.week === week);
  if (fromHist) return fromHist;
  if (week !== currentGameweek) return null;
  return {
    week,
    runs: p.runs,
    fours: p.fours,
    sixes: p.sixes,
    wickets: p.wickets,
    maidens: p.maidens,
    catches: p.catches,
    wkCatches: p.wkCatches,
    stumpings: p.stumpings,
    runOuts: p.runOuts,
    points: calculatePoints(p),
    didNotBat: p.didNotBat,
    didNotPlay: p.didNotPlay,
    notOut: p.notOut,
  };
}

function weekAuditStatSummary(h: WeekRecord): string {
  const parts: string[] = [];
  if (h.runs || h.fours || h.sixes) {
    parts.push(`R ${h.runs}${h.fours ? ` · 4s ${h.fours}` : ""}${h.sixes ? ` · 6s ${h.sixes}` : ""}`);
  }
  if (h.wickets) parts.push(`W ${h.wickets}${h.maidens ? ` · M ${h.maidens}` : ""}`);
  const field = (h.catches ?? 0) + (h.wkCatches ?? 0) + (h.stumpings ?? 0) + (h.runOuts ?? 0);
  if (field) parts.push(`Fld ${field}`);
  return parts.length ? parts.join(" · ") : "all stats zero";
}

function weekAuditTooltip(h: WeekRecord): string {
  const status = h.didNotPlay ? "Did not play" : h.didNotBat ? "Did not bat (in XI)" : h.notOut ? "Batted (not out)" : "Played";
  return `GW${h.week}: ${status} — ${h.points} pts. ${weekAuditStatSummary(h)}`;
}

function weekRecordLooksLikeSuspiciousDnp(h: WeekRecord): boolean {
  if (!h.didNotPlay) return false;
  return (
    h.runs === 0 &&
    !h.fours &&
    !h.sixes &&
    !h.wickets &&
    !h.maidens &&
    !h.catches &&
    !h.wkCatches &&
    !h.stumpings &&
    !h.runOuts
  );
}

function emptyWeekRecord(week: number): WeekRecord {
  return {
    week,
    runs: 0,
    fours: 0,
    sixes: 0,
    wickets: 0,
    maidens: 0,
    catches: 0,
    wkCatches: 0,
    stumpings: 0,
    runOuts: 0,
    points: 0,
    didNotBat: false,
    didNotPlay: false,
    notOut: false,
  };
}

function weekRecordHasPlayedStat(
  h: Pick<
    WeekRecord,
    "runs" | "fours" | "sixes" | "wickets" | "maidens" | "catches" | "wkCatches" | "stumpings" | "runOuts"
  >,
): boolean {
  return (
    h.runs > 0 ||
    h.fours > 0 ||
    h.sixes > 0 ||
    h.wickets > 0 ||
    h.maidens > 0 ||
    h.catches > 0 ||
    h.wkCatches > 0 ||
    h.stumpings > 0 ||
    h.runOuts > 0
  );
}

function finalizeWeekRecord(record: WeekRecord): WeekRecord {
  const next = { ...record };
  if (weekRecordHasPlayedStat(next) && next.didNotPlay) {
    next.didNotPlay = false;
  }
  return { ...next, points: calculatePoints(next) };
}

function applyHistoryWeekDidNotPlay(record: WeekRecord, on: boolean): WeekRecord {
  if (!on) {
    return finalizeWeekRecord({ ...record, didNotPlay: false });
  }
  return finalizeWeekRecord({
    ...record,
    didNotPlay: true,
    didNotBat: false,
    notOut: false,
    runs: 0,
    fours: 0,
    sixes: 0,
    wickets: 0,
    maidens: 0,
    catches: 0,
    wkCatches: 0,
    stumpings: 0,
    runOuts: 0,
  });
}

function weekRecordToLivePlayerFields(record: WeekRecord): Partial<Player> {
  return {
    runs: record.runs,
    fours: record.fours,
    sixes: record.sixes,
    wickets: record.wickets,
    maidens: record.maidens,
    catches: record.catches,
    wkCatches: record.wkCatches,
    stumpings: record.stumpings,
    runOuts: record.runOuts,
    didNotBat: record.didNotBat,
    didNotPlay: record.didNotPlay,
    notOut: record.notOut,
  };
}

/** 1 = 1st XI (premium prices), 2 = 2nd XI (value picks). */
type TeamTier = 1 | 2;

type Player = {
  id: number;
  name: string;
  /** Bat / all-rounder / bowler / wicketkeeper — squad must be 2-2-2-1. */
  role: PlayerRole;
  /** 1 = first team, 2 = second team — used for filters and pricing bands. */
  teamTier: TeamTier;
  price: number;
  runs: number;
  fours: number;
  sixes: number;
  wickets: number;
  maidens: number;
  catches: number;
  wkCatches: number;
  stumpings: number;
  runOuts: number;
  available: boolean;
  history: WeekRecord[];
  /** Did not bat this GW — no batting fantasy from runs/4s/6s; show DNB in lists & form (bowling/fielding still score). */
  didNotBat?: boolean;
  /** Did not play this GW — no fantasy points; excluded from form & dynamic pricing (set via “who played” picker). */
  didNotPlay?: boolean;
  /** Batter remained not out in this GW. Used for batting average on player leaderboard. */
  notOut?: boolean;
  /** Listed base price in Firestore; effective draft price may differ (see dynamic pricing). */
  basePrice?: number;
  /** effectivePrice − basePrice from season + recent form within tier. */
  priceDelta?: number;
  formScore?: number;
};

type SavedTeam = {
  uid: string;
  name: string;
  ownerName?: string;
  players: number[];
  captain: number | null;
  viceCaptain: number | null;
  keeper: number | null;
  cumulativePoints?: number;
  /** Squad at start of current gameweek (for transfer counting). */
  transferBaselinePlayers?: number[];
  /** Free transfers available at GW start (before any saves this GW). */
  freeTransfersAtGwStart?: number;
  /** Points already deducted this GW from extra transfers (keeps cumulative in sync if squad is edited again). */
  transferPenaltyPointsApplied?: number;
  /**
   * First gameweek a player contributes to weekly score for this team (set when they transfer in).
   * Omitted IDs are treated as GW1 — only matters for picks after GW1 saves.
   */
  playerJoinedGameweek?: Record<string, number>;
  /** £ paid when each player joined this squad — kept on transfer out/in at current market. */
  playerPurchasePrices?: PurchasePriceMap;
  /** Gameweek when this team was first saved (mid-season joiners get unlimited edits until that GW’s lineup lock). */
  firstSaveGameweek?: number;
  createdBy?: string;
  createdAt?: unknown;
};

type SnapshotDoc = {
  id: string;
  gameweek: number;
  createdAt?: unknown;
  createdBy?: string;
  label?: string;
  players?: SnapshotPlayerRow[];
};

type SnapshotPlayerRow = {
  id: number;
  name?: string;
  runs?: number;
  fours?: number;
  sixes?: number;
  wickets?: number;
  maidens?: number;
  catches?: number;
  wkCatches?: number;
  stumpings?: number;
  runOuts?: number;
  didNotBat?: boolean;
  didNotPlay?: boolean;
  notOut?: boolean;
};

type BuilderState = {
  teamName: string;
  selected: number[];
  captain: number | null;
  viceCaptain: number | null;
  keeper: number | null;
};

type TabKey = "draft" | "leaderboard" | "players" | "admin";

type AdminStatsSortKey =
  | "name"
  | "role"
  | "teamTier"
  | "available"
  | "price"
  | "runs"
  | "fours"
  | "sixes"
  | "wickets"
  | "maidens"
  | "catches"
  | "wkCatches"
  | "stumpings"
  | "runOuts"
  | "points"
  | "season";

/** Draft pool sort column (paired with asc/desc). */
type DraftSortKey =
  | "id"
  | "name"
  | "role"
  | "teamTier"
  | "available"
  | "price"
  | "runs"
  | "fours"
  | "sixes"
  | "wickets"
  | "maidens"
  | "catches"
  | "wkCatches"
  | "stumpings"
  | "runOuts"
  | "gwPoints"
  | "seasonPts"
  | "picked"
  | "batPts"
  | "bowlPts"
  | "fieldPts"
  | "innings"
  | "notOuts"
  | "average"
  | "highScore"
  | "bestBowling"
  | "playedGws";

type LatestChatMeta = {
  createdAt: Timestamp;
  userId: string;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const APP_NAME = "Nondies Fantasy League";
const ADMIN_PIN = "1234";

/** Display labels for the squad tier (first XI vs second XI). */
const TEAM_TIER_SHORT: Record<TeamTier, string> = { 1: "1st XI", 2: "2nd XI" };

/** Admin-seeded primary position (must allow building 3 bat, 2 AR, 3 bowl, 1 WK from the pool). */
const SEED_ROLE: Record<number, PlayerRole> = {
  1: "bat", 2: "ar", 3: "bat", 4: "bowl", 5: "bat", 6: "ar", 7: "bat", 8: "bowl",
  9: "ar", 10: "bat", 11: "wk", 12: "bowl", 13: "bowl", 14: "bat", 15: "wk",
  16: "bowl", 17: "wk", 18: "bat", 19: "bat", 20: "ar", 21: "bat", 22: "bowl",
  23: "bat", 24: "bat", 25: "bowl", 26: "ar", 27: "ar", 28: "bat", 29: "wk",
  30: "bowl", 31: "ar", 32: "bowl", 33: "wk", 34: "bowl", 35: "bat",
};

/**
 * Seeded roster: ids 1–18 = 1st XI (£12–£18), ids 19–35 = 2nd XI (£5–£8).
 * Cheapest seven 1st-XI picks still exceed BUDGET, so an all–1st-XI squad is impossible within cap.
 */
const SEEDED_PLAYERS: Player[] = [
  { id: 1,  name: "Arfan Ahmed",             role: SEED_ROLE[1],  teamTier: 1, price: 18, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 2,  name: "Kamran Ahmed",            role: SEED_ROLE[2],  teamTier: 1, price: 16, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 3,  name: "Hetu Hirpara",            role: SEED_ROLE[3],  teamTier: 1, price: 16, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 4,  name: "Danial Khan",             role: SEED_ROLE[4],  teamTier: 1, price: 16, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 5,  name: "Nabeel Khan",             role: SEED_ROLE[5],  teamTier: 1, price: 15, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 6,  name: "Sayyid Hashim Ali Shah",  role: SEED_ROLE[6],  teamTier: 1, price: 15, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 7,  name: "Bharadwaj Tanikella",     role: SEED_ROLE[7],  teamTier: 1, price: 15, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 8,  name: "Sarim Zafar",             role: SEED_ROLE[8],  teamTier: 1, price: 14, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 9,  name: "Pablo Mukherjee",         role: SEED_ROLE[9],  teamTier: 1, price: 17, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 10, name: "Aizaz Khan",              role: SEED_ROLE[10], teamTier: 1, price: 15, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 11, name: "Mohammad Awais Abid",     role: SEED_ROLE[11], teamTier: 1, price: 14, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 12, name: "Sulayman Warraich",       role: SEED_ROLE[12], teamTier: 1, price: 14, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 13, name: "Hadi Ali",                role: SEED_ROLE[13], teamTier: 1, price: 13, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 14, name: "Ismaeil Saghir",          role: SEED_ROLE[14], teamTier: 1, price: 15, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 15, name: "Joseph Asplet",           role: SEED_ROLE[15], teamTier: 1, price: 13, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 16, name: "Gareth Spackman",         role: SEED_ROLE[16], teamTier: 1, price: 13, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 17, name: "Nicholas Smith",          role: SEED_ROLE[17], teamTier: 1, price: 12, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 18, name: "Ross Brown",              role: SEED_ROLE[18], teamTier: 1, price: 12, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 19, name: "William Goodfellow",      role: SEED_ROLE[19], teamTier: 2, price: 6,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 20, name: "Zain Raja",               role: SEED_ROLE[20], teamTier: 2, price: 6,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 21, name: "Nayyer Ahmed",            role: SEED_ROLE[21], teamTier: 2, price: 6,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 22, name: "Haris Malak",             role: SEED_ROLE[22], teamTier: 2, price: 6,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 23, name: "Rameez Ali",              role: SEED_ROLE[23], teamTier: 2, price: 5,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 24, name: "Ayaz Khan",               role: SEED_ROLE[24], teamTier: 2, price: 5,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 25, name: "Asif Shah",               role: SEED_ROLE[25], teamTier: 2, price: 5,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 26, name: "Adnaan Rahman",           role: SEED_ROLE[26], teamTier: 2, price: 5,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 27, name: "A Sidhu",                 role: SEED_ROLE[27], teamTier: 2, price: 8,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 28, name: "Abdullah Akhlaq",         role: SEED_ROLE[28], teamTier: 2, price: 6,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 29, name: "Alexander Dellar",        role: SEED_ROLE[29], teamTier: 2, price: 5,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 30, name: "Atif Mohammed",           role: SEED_ROLE[30], teamTier: 2, price: 6,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 31, name: "Gaurav Samuel",           role: SEED_ROLE[31], teamTier: 2, price: 6,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 32, name: "Ibraheem Mirza",          role: SEED_ROLE[32], teamTier: 2, price: 6,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 33, name: "Muhammed Anas Awais",     role: SEED_ROLE[33], teamTier: 2, price: 5,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 34, name: "Shabaaz Alam",            role: SEED_ROLE[34], teamTier: 2, price: 7,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 35, name: "Sulaiman Hussain",        role: SEED_ROLE[35], teamTier: 2, price: 6,  runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function money(n: number) {
  const v = Number(n);
  const x = Number.isFinite(v) ? Math.trunc(v) : 0;
  return `£${x}`;
}

function SquadOverBudgetBanner({
  spend,
  overBy,
  budget,
  locked,
  onOpenDraft,
}: {
  spend: number;
  overBy: number;
  budget: number;
  locked: boolean;
  onOpenDraft: () => void;
}) {
  return (
    <div className="rounded-2xl border border-amber-500/45 bg-amber-500/15 px-4 py-3.5 text-sm text-amber-100 ring-1 ring-amber-500/35">
      <div className="font-semibold text-amber-50">Your saved squad is over budget</div>
      <p className="mt-1.5 leading-relaxed text-amber-100/90">
        Dynamic pricing is live. Your squad costs <strong className="text-white">{money(spend)}</strong> at your{" "}
        <strong className="text-white">purchase prices</strong> (cap{" "}
        <strong className="text-white">{money(budget)}</strong>, <strong className="text-white">{money(overBy)}</strong> over).
        {locked
          ? ` You can edit again after ${LINEUP_LOCK_SUMMARY} — then remove or swap players and save.`
          : " Open Draft, adjust your squad, and save — you cannot save until spend is within the cap."}
      </p>
      {!locked ? (
        <button
          type="button"
          onClick={onOpenDraft}
          className="mt-3 rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white ring-1 ring-amber-500/50 hover:bg-amber-500"
        >
          Fix squad in Draft
        </button>
      ) : null}
    </div>
  );
}

function PersonalSpendCapAnnouncement({
  spendCap,
  onDismiss,
  onOpenDraft,
}: {
  spendCap: number | null;
  onDismiss: () => void;
  onOpenDraft: () => void;
}) {
  return (
    <div className="rounded-2xl border border-sky-400/45 bg-gradient-to-br from-sky-500/15 to-blue-600/10 px-4 py-4 text-sm text-sky-50 ring-1 ring-sky-400/35">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/25 ring-1 ring-sky-400/40">
          <Shield className="h-4 w-4 text-sky-100" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sky-50">Transfer update — personal spend cap</span>
            <Pill tone="blue">Original season squads</Pill>
          </div>
          <p className="mt-2 leading-relaxed text-sky-100/95">
            {GRANDFATHERED_SQUAD_MESSAGE} Original picks keep their opening price; anyone you add or swap in uses today&apos;s dynamic prices.
            {spendCap != null ? (
              <>
                {" "}
                Your transfer budget is <strong className="text-white">{money(spendCap)}</strong> — your current saved squad spend — so you can reshuffle in-form players without fighting the league cap.
              </>
            ) : (
              <>
                {" "}
                Once you have a saved squad, your transfer budget equals that squad&apos;s spend at opening prices — not the league-wide cap.
              </>
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOpenDraft}
              className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white ring-1 ring-sky-500/50 hover:bg-sky-500"
            >
              Open Draft
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-sky-100 ring-1 ring-white/15 hover:bg-white/15"
            >
              Got it
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-lg p-1.5 text-sky-200/80 hover:bg-white/10 hover:text-white"
          aria-label="Dismiss transfer update"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function GrandfatheredSquadReminder({ spendCap }: { spendCap: number }) {
  return (
    <div className="rounded-xl border border-sky-500/25 bg-sky-500/8 px-3 py-2.5 text-xs text-sky-100/90 ring-1 ring-sky-500/20">
      <strong className="font-semibold text-sky-50">Personal spend cap {money(spendCap)}</strong>
      {" — "}
      reshuffle within your saved squad spend; new picks use dynamic prices.
    </div>
  );
}

function FreeSquadRebuildBanner({
  gameweek,
  locked,
  onOpenDraft,
}: {
  gameweek: number;
  locked: boolean;
  onOpenDraft: () => void;
}) {
  return (
    <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3.5 text-sm text-emerald-100 ring-1 ring-emerald-500/30">
      <div className="font-semibold text-emerald-50">Free squad rebuild · GW{gameweek}</div>
      <p className="mt-1.5 leading-relaxed text-emerald-100/90">
        {GRANDFATHERED_SQUAD_MESSAGE} Optional: change your 7 in Draft{" "}
        {locked ? "after the next unlock" : `until ${LINEUP_LOCK_SUMMARY}`} with{" "}
        <strong className="text-white">no transfer penalties</strong>. Any player you bring in costs the current dynamic price.
      </p>
      {!locked ? (
        <button
          type="button"
          onClick={onOpenDraft}
          className="mt-3 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white ring-1 ring-emerald-500/50 hover:bg-emerald-500"
        >
          Open Draft
        </button>
      ) : null}
    </div>
  );
}

function PriceWithForm({
  price,
  basePrice,
  priceDelta,
}: {
  price: number;
  basePrice?: number;
  priceDelta?: number;
}) {
  const delta = priceDelta ?? 0;
  const base = basePrice ?? price;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="font-medium text-zinc-200">{money(price)}</span>
      {delta !== 0 && (
        <span className={`text-[11px] font-semibold ${delta > 0 ? "text-emerald-400" : "text-amber-400"}`}>
          {delta > 0 ? "+" : ""}
          {delta} form
        </span>
      )}
      {delta !== 0 && base !== price && (
        <span className="text-[10px] text-zinc-500">listed {money(base)}</span>
      )}
    </span>
  );
}

/** Firestore may omit `teamTier` on older docs — infer from seeded id band, else 2nd XI. */
function parseTeamTier(raw: unknown, playerId: number): TeamTier {
  if (raw === 2 || raw === "2") return 2;
  if (raw === 1 || raw === "1") return 1;
  return playerId >= 1 && playerId <= 18 ? 1 : 2;
}

function parsePlayerRole(raw: unknown, playerId: number): PlayerRole {
  if (raw === "bat" || raw === "ar" || raw === "bowl" || raw === "wk") return raw;
  return SEED_ROLE[playerId] ?? "bat";
}

function countRolesInSelection(ids: number[], byId: Map<number, Player>): Record<PlayerRole, number> {
  const c: Record<PlayerRole, number> = { bat: 0, ar: 0, bowl: 0, wk: 0 };
  for (const id of ids) {
    const r = byId.get(id)?.role;
    if (r) c[r] += 1;
  }
  return c;
}

/** True if adding `id` would not exceed any role cap (player not yet selected). */
function canAddPlayerForRoles(id: number, selected: number[], byId: Map<number, Player>): boolean {
  if (selected.includes(id)) return true;
  const p = byId.get(id);
  if (!p) return false;
  const c = countRolesInSelection(selected, byId);
  return c[p.role] < SQUAD_ROLES[p.role];
}

function squadCompositionOk(selected: number[], byId: Map<number, Player>): boolean {
  if (selected.length !== SQUAD_SIZE) return false;
  const c = countRolesInSelection(selected, byId);
  return (Object.keys(SQUAD_ROLES) as PlayerRole[]).every((k) => c[k] === SQUAD_ROLES[k]);
}

function formatLockTime(d: Date) {
  try {
    return d.toLocaleString(undefined, {
      weekday: "short", day: "2-digit", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return d.toString(); }
}

function formatSnapshotTime(ts: unknown) {
  if (!(ts instanceof Timestamp)) return "Unknown time";
  try {
    return ts.toDate().toLocaleString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts.toDate().toString();
  }
}

function formatLastLogin(ts: Timestamp | null | undefined, nowMs = Date.now()): string {
  if (!ts) return "Never";
  const d = ts.toDate();
  const diffMs = Math.max(0, nowMs - d.getTime());
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 28) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: d.getFullYear() !== new Date(nowMs).getFullYear() ? "numeric" : undefined,
  });
}

function snapshotStatDiffCount(curr: SnapshotPlayerRow[] | undefined, prev: SnapshotPlayerRow[] | undefined) {
  if (!Array.isArray(curr) || curr.length === 0) return 0;
  if (!Array.isArray(prev) || prev.length === 0) return curr.length;
  const prevById = new Map(prev.map((p) => [p.id, p]));
  let changed = 0;
  for (const p of curr) {
    const q = prevById.get(p.id);
    if (!q) {
      changed += 1;
      continue;
    }
    const diff =
      Boolean(p.didNotBat) !== Boolean(q.didNotBat) ||
      Boolean(p.didNotPlay) !== Boolean(q.didNotPlay) ||
      Number(p.runs ?? 0) !== Number(q.runs ?? 0) ||
      Number(p.fours ?? 0) !== Number(q.fours ?? 0) ||
      Number(p.sixes ?? 0) !== Number(q.sixes ?? 0) ||
      Number(p.wickets ?? 0) !== Number(q.wickets ?? 0) ||
      Number(p.maidens ?? 0) !== Number(q.maidens ?? 0) ||
      Number(p.catches ?? 0) !== Number(q.catches ?? 0) ||
      Number(p.wkCatches ?? 0) !== Number(q.wkCatches ?? 0) ||
      Number(p.stumpings ?? 0) !== Number(q.stumpings ?? 0) ||
      Number(p.runOuts ?? 0) !== Number(q.runOuts ?? 0) ||
      Boolean(p.notOut) !== Boolean(q.notOut);
    if (diff) changed += 1;
  }
  return changed;
}

function getThisWeeksLockDate(now = new Date()) {
  const lock = new Date(now);
  lock.setDate(lock.getDate() + (LINEUP_LOCK_WEEKDAY - lock.getDay()));
  lock.setHours(LINEUP_LOCK_HOUR, LINEUP_LOCK_MINUTE, 0, 0);
  return lock;
}

function isSelectionLocked(now = new Date()) {
  return now.getTime() >= getThisWeeksLockDate(now).getTime();
}

/** Sum of completed-gameweek fantasy points (raw player score, before C/VC on a team). */
function sumSeasonPointsFromHistory(history: WeekRecord[] | undefined) {
  let s = 0;
  for (const h of history ?? []) {
    if (h.didNotPlay) continue;
    const n = Number(h?.points);
    if (Number.isFinite(n)) s += n;
  }
  return Math.round(s * 10) / 10;
}

function seasonCricketStatsFromHistory(history: WeekRecord[] | undefined) {
  let runs = 0;
  let fours = 0;
  let sixes = 0;
  let wickets = 0;
  let maidens = 0;
  let catches = 0;
  let wkCatches = 0;
  let stumpings = 0;
  let runOuts = 0;
  let innings = 0;
  let notOuts = 0;
  let highScore = 0;
  let bestBowlingWkts = 0;
  let bestBowlingMaidens = 0;
  for (const h of history ?? []) {
    if (h.didNotPlay) continue;
    const gwRuns = Number.isFinite(Number(h?.runs)) ? Number(h.runs) : 0;
    const gwWickets = Number.isFinite(Number(h?.wickets)) ? Number(h.wickets) : 0;
    const gwMaidens = Number.isFinite(Number(h?.maidens)) ? Number(h.maidens) : 0;
    runs += Number.isFinite(Number(h?.runs)) ? Number(h.runs) : 0;
    fours += Number.isFinite(Number(h?.fours)) ? Number(h.fours) : 0;
    sixes += Number.isFinite(Number(h?.sixes)) ? Number(h.sixes) : 0;
    wickets += Number.isFinite(Number(h?.wickets)) ? Number(h.wickets) : 0;
    maidens += Number.isFinite(Number(h?.maidens)) ? Number(h.maidens) : 0;
    catches += Number.isFinite(Number(h?.catches)) ? Number(h.catches) : 0;
    wkCatches += Number.isFinite(Number(h?.wkCatches)) ? Number(h.wkCatches) : 0;
    stumpings += Number.isFinite(Number(h?.stumpings)) ? Number(h.stumpings) : 0;
    runOuts += Number.isFinite(Number(h?.runOuts)) ? Number(h.runOuts) : 0;
    const dnb = Boolean(h?.didNotBat);
    if (!dnb) {
      innings += 1;
      if (Boolean(h?.notOut)) notOuts += 1;
    }
    if (gwRuns > highScore) highScore = gwRuns;
    if (gwWickets > bestBowlingWkts || (gwWickets === bestBowlingWkts && gwMaidens > bestBowlingMaidens)) {
      bestBowlingWkts = gwWickets;
      bestBowlingMaidens = gwMaidens;
    }
  }
  const outs = Math.max(innings - notOuts, 0);
  const average = outs > 0 ? runs / outs : null;
  return {
    runs,
    fours,
    sixes,
    wickets,
    maidens,
    catches,
    wkCatches,
    stumpings,
    runOuts,
    innings,
    notOuts,
    outs,
    average,
    highScore,
    bestBowlingWkts,
    bestBowlingMaidens,
  };
}

function seasonFantasyBreakdownFromHistory(history: WeekRecord[] | undefined) {
  let batting = 0;
  let bowling = 0;
  let fielding = 0;
  for (const h of history ?? []) {
    if (h.didNotPlay) continue;
    const br = fantasyPointsBreakdown(h);
    batting += br.batting;
    bowling += br.bowling;
    fielding += br.fieldingOutfield + br.keeper;
  }
  const total = batting + bowling + fielding;
  return { batting, bowling, fielding, total };
}

/** Clone for post-save reconciliation with Firestore snapshots (avoids stale-cache overwrites). */
function clonePlayerAdminSnapshot(p: Player): Player {
  return {
    ...p,
    history: Array.isArray(p.history) ? p.history.map((h) => ({ ...h })) : [],
  };
}

function applyDidNotPlayToPlayer(p: Player, on: boolean): Player {
  if (!on) {
    return { ...p, didNotPlay: false };
  }
  return {
    ...p,
    didNotPlay: true,
    didNotBat: false,
    notOut: false,
    runs: 0,
    fours: 0,
    sixes: 0,
    wickets: 0,
    maidens: 0,
    catches: 0,
    wkCatches: 0,
    stumpings: 0,
    runOuts: 0,
    history: repairHistoryDidNotPlayWeeks(p.history),
  };
}

/** True if listener-mapped player doc matches what we just committed from the admin table. */
function firestorePlayerMatchesAdminSnapshot(fs: Player, committed: Player): boolean {
  return (
    fs.price === committed.price &&
    fs.teamTier === committed.teamTier &&
    fs.role === committed.role &&
    fs.name === committed.name &&
    fs.available === committed.available &&
    fs.runs === committed.runs &&
    fs.fours === committed.fours &&
    fs.sixes === committed.sixes &&
    fs.wickets === committed.wickets &&
    fs.maidens === committed.maidens &&
    fs.catches === committed.catches &&
    fs.wkCatches === committed.wkCatches &&
    fs.stumpings === committed.stumpings &&
    fs.runOuts === committed.runOuts &&
    Boolean(fs.didNotBat) === Boolean(committed.didNotBat) &&
    Boolean(fs.didNotPlay) === Boolean(committed.didNotPlay) &&
    Boolean(fs.notOut) === Boolean(committed.notOut) &&
    JSON.stringify(fs.history) === JSON.stringify(committed.history)
  );
}

function compareDraftPoolPlayers(
  a: Player,
  b: Player,
  key: DraftSortKey,
  dir: "asc" | "desc",
  ownership: Map<number, number>,
): number {
  const mult = dir === "desc" ? -1 : 1;
  let cmp = 0;
  switch (key) {
    case "id":
      cmp = a.id - b.id;
      break;
    case "name":
      cmp = a.name.localeCompare(b.name);
      break;
    case "role":
      cmp = a.role.localeCompare(b.role);
      break;
    case "teamTier":
      cmp = a.teamTier - b.teamTier;
      break;
    case "available":
      cmp = Number(a.available) - Number(b.available);
      break;
    case "price":
      cmp = a.price - b.price;
      break;
    case "runs":
      cmp = a.runs - b.runs;
      break;
    case "fours":
      cmp = a.fours - b.fours;
      break;
    case "sixes":
      cmp = a.sixes - b.sixes;
      break;
    case "wickets":
      cmp = a.wickets - b.wickets;
      break;
    case "maidens":
      cmp = a.maidens - b.maidens;
      break;
    case "catches":
      cmp = a.catches - b.catches;
      break;
    case "wkCatches":
      cmp = a.wkCatches - b.wkCatches;
      break;
    case "stumpings":
      cmp = a.stumpings - b.stumpings;
      break;
    case "runOuts":
      cmp = a.runOuts - b.runOuts;
      break;
    case "gwPoints":
      cmp = calculatePoints(a) - calculatePoints(b);
      break;
    case "seasonPts":
      cmp = sumSeasonPointsFromHistory(a.history) - sumSeasonPointsFromHistory(b.history);
      break;
    case "picked":
      cmp = (ownership.get(a.id) ?? 0) - (ownership.get(b.id) ?? 0);
      break;
    default:
      cmp = 0;
  }
  if (cmp !== 0) return mult * cmp;
  return a.name.localeCompare(b.name);
}

function playerFirstGameweekOnTeam(team: SavedTeam, playerId: number): number {
  const m = team.playerJoinedGameweek;
  if (!m || typeof m !== "object") return 1;
  const raw = (m as Record<string, unknown>)[String(playerId)];
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw.trim())
        ? Number(raw.trim())
        : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function playerScoringStartsGameweek(team: SavedTeam, playerId: number, scoringGameweek: number): number {
  const joined = playerFirstGameweekOnTeam(team, playerId);
  if (joined === scoringGameweek + 1) return scoringGameweek;
  return joined;
}

function playerScoresInGameweek(team: SavedTeam, playerId: number, scoringGameweek: number): boolean {
  return playerScoringStartsGameweek(team, playerId, scoringGameweek) <= scoringGameweek;
}

/**
 * First time a player appears on a saved squad (new team or transfer in).
 * GW1: they score in the opening gameweek like everyone else.
 * GW2+: they only start counting from the *next* gameweek so they can’t farm points from stats already on the board.
 */
function firstScoringGameweekForNewSigning(currentGameweek: number, now = new Date()): number {
  if (currentGameweek <= 1) return 1;
  if (!isSelectionLocked(now)) return currentGameweek;
  return currentGameweek + 1;
}

function transferPenaltiesApplyInGameweek(currentGameweek: number): boolean {
  return currentGameweek > 1;
}

/** True when saves should apply transfer limits and point hits (vs GW1 or new-joiner grace before lock). */
function transferPenaltiesApplyForTeam(
  currentGameweek: number,
  existing: SavedTeam | null,
  now: Date,
  freeSquadRebuildGameweek?: number | null,
): boolean {
  if (isFreeSquadRebuildGameweek(currentGameweek, freeSquadRebuildGameweek)) return false;
  if (!transferPenaltiesApplyInGameweek(currentGameweek)) return false;
  if (!existing) return false;
  const fsg = existing.firstSaveGameweek;
  if (typeof fsg !== "number" || !Number.isFinite(fsg)) return true;
  if (Math.floor(fsg) === currentGameweek && !isSelectionLocked(now)) return false;
  return true;
}

function squadTransferBaseline(saved: SavedTeam, penaltiesApply: boolean, gameweek: number): number[] {
  const useLastSaved =
    !penaltiesApply &&
    transferPenaltiesApplyInGameweek(gameweek) &&
    saved.players.length === SQUAD_SIZE;
  if (useLastSaved) return [...saved.players];
  if (saved.transferBaselinePlayers?.length === SQUAD_SIZE) return [...saved.transferBaselinePlayers];
  return [...saved.players];
}

function transferPlayerNameDiff(
  baseline: number[],
  selected: number[],
  playersById: Map<number, Player>,
): { outgoing: string[]; incoming: string[] } {
  const baseSet = new Set(baseline);
  const selSet = new Set(selected);
  const outgoing: string[] = [];
  const incoming: string[] = [];
  for (const id of baseline) {
    if (!selSet.has(id)) outgoing.push(playersById.get(id)?.name ?? `Player ${id}`);
  }
  for (const id of selected) {
    if (!baseSet.has(id)) incoming.push(playersById.get(id)?.name ?? `Player ${id}`);
  }
  return { outgoing, incoming };
}

/** Stable key for “did this saved squad row change?” — avoids effect churn on new `teams` array identity. */
function savedTeamHydrateWireKey(team: SavedTeam): string {
  return [
    team.uid,
    (team.players ?? []).join(","),
    team.captain ?? "",
    team.viceCaptain ?? "",
    team.keeper ?? "",
    (team.name ?? "").trim(),
  ].join("|");
}

function builderStateFromSavedTeam(team: SavedTeam, byId: Map<number, Player>): BuilderState {
  const sel = (team.players ?? []).filter((id) => byId.has(id));
  const cap = team.captain != null && sel.includes(team.captain) ? team.captain : null;
  const vc = team.viceCaptain != null && sel.includes(team.viceCaptain) ? team.viceCaptain : null;
  const wk = team.keeper != null && sel.includes(team.keeper) ? team.keeper : null;
  return {
    teamName: (team.name ?? "").trim(),
    selected: sel,
    captain: cap,
    viceCaptain: vc,
    keeper: wk,
  };
}

function buildPlayerJoinedGameweekAfterSave(
  existing: SavedTeam | null,
  newPlayers: number[],
  gameweek: number,
  now = new Date(),
): Record<string, number> {
  const next: Record<string, number> = {};
  if (!existing) {
    const j = firstScoringGameweekForNewSigning(gameweek, now);
    for (const id of newPlayers) next[String(id)] = j;
    return next;
  }
  const prevMap = existing.playerJoinedGameweek ?? {};
  const wasOnTeam = new Set(existing.players ?? []);
  for (const id of newPlayers) {
    const key = String(id);
    if (wasOnTeam.has(id)) {
      const v = prevMap[key];
      let n =
        typeof v === "number" && Number.isFinite(v)
          ? Math.floor(v)
          : typeof v === "string" && /^\d+$/.test(String(v).trim())
            ? Number(String(v).trim())
            : 1;
      if (!Number.isFinite(n) || n < 1) n = 1;
      if (n === gameweek + 1 && !isSelectionLocked(now)) n = gameweek;
      next[key] = n;
    } else {
      next[key] = firstScoringGameweekForNewSigning(gameweek, now);
    }
  }
  return next;
}

function computeWeekPoints(team: SavedTeam, byId: Map<number, Player>, scoringGameweek: number) {
  let total = 0;
  for (const id of team.players) {
    if (!playerScoresInGameweek(team, id, scoringGameweek)) continue;
    const p = byId.get(id);
    if (!p) continue;
    const base = calculatePoints(p);
    total += base * (team.captain === id ? 2 : team.viceCaptain === id ? 1.5 : 1);
  }
  return Math.round(total * 10) / 10;
}

function computeTeamTotal(team: SavedTeam, byId: Map<number, Player>, scoringGameweek: number) {
  return Math.round((computeWeekPoints(team, byId, scoringGameweek) + (team.cumulativePoints ?? 0)) * 10) / 10;
}

type SquadFieldingTotals = {
  outfieldCatches: number;
  wkCatches: number;
  stumpings: number;
  runOuts: number;
};

function squadFieldingFromStatLine(line: {
  catches: number;
  wkCatches: number;
  stumpings: number;
  runOuts: number;
}): SquadFieldingTotals {
  const wk = clampNonNegativeInt(line.wkCatches);
  const total = clampNonNegativeInt(line.catches);
  return {
    wkCatches: wk,
    outfieldCatches: Math.max(total - wk, 0),
    stumpings: clampNonNegativeInt(line.stumpings),
    runOuts: clampNonNegativeInt(line.runOuts),
  };
}

function addSquadFieldingTotals(a: SquadFieldingTotals, b: SquadFieldingTotals): SquadFieldingTotals {
  return {
    outfieldCatches: a.outfieldCatches + b.outfieldCatches,
    wkCatches: a.wkCatches + b.wkCatches,
    stumpings: a.stumpings + b.stumpings,
    runOuts: a.runOuts + b.runOuts,
  };
}

/** Sum fielding events for a squad in a gameweek (live stats or completed week from history). */
function squadFieldingSummaryForGameweek(
  team: SavedTeam,
  byId: Map<number, Player>,
  scoringGameweek: number,
  useLiveStats: boolean,
): SquadFieldingTotals {
  let acc: SquadFieldingTotals = { outfieldCatches: 0, wkCatches: 0, stumpings: 0, runOuts: 0 };
  for (const id of team.players) {
    if (!playerScoresInGameweek(team, id, scoringGameweek)) continue;
    const p = byId.get(id);
    if (!p) continue;
    if (useLiveStats) {
      acc = addSquadFieldingTotals(acc, squadFieldingFromStatLine(p));
      continue;
    }
    const rec = (p.history ?? []).find((h) => h.week === scoringGameweek);
    if (rec) acc = addSquadFieldingTotals(acc, squadFieldingFromStatLine(rec));
  }
  return acc;
}

function formatSquadFieldingSummary(t: SquadFieldingTotals): string | null {
  const parts: string[] = [];
  if (t.outfieldCatches > 0) parts.push(`${t.outfieldCatches} ct`);
  if (t.wkCatches > 0) parts.push(`${t.wkCatches} wk ct`);
  if (t.stumpings > 0) parts.push(`${t.stumpings} st`);
  if (t.runOuts > 0) parts.push(`${t.runOuts} ro`);
  return parts.length ? parts.join(" · ") : null;
}

function generateBestSquad(players: Player[]) {
  const scored = players.map((p) => ({ player: p, points: calculatePoints(p) })).sort((a, b) => b.points - a.points || a.player.price - b.player.price);
  const top = scored.slice(0, SQUAD_SIZE);
  return { entries: top, captainId: top[0]?.player.id ?? null, viceCaptainId: top[1]?.player.id ?? null };
}

function validateTeam(args: {
  teamName: string; selected: number[]; captain: number | null;
  viceCaptain: number | null; keeper: number | null; byId: Map<number, Player>;
  budget: number;
  priceForPlayerId: (id: number) => number;
  /** Original season squads — keep scoring; no forced shape/budget/C/VC/WK fixes. */
  grandfatheredRelaxed?: boolean;
}) {
  const { teamName, selected, captain, viceCaptain, keeper, byId, budget, priceForPlayerId, grandfatheredRelaxed } = args;
  const set = new Set(selected);
  const sel = selected.map((id) => byId.get(id)).filter(Boolean) as Player[];
  const spend = selected.reduce((s, id) => s + priceForPlayerId(id), 0);
  const compositionOk = squadCompositionOk(selected, byId);
  const keeperPlayer = keeper !== null ? byId.get(keeper) : undefined;
  const keeperIsWkRole = keeperPlayer?.role === "wk";
  const checks = {
    teamName: teamName.trim().length > 0,
    count: selected.length === SQUAD_SIZE,
    captain: captain !== null && set.has(captain),
    viceCaptain: viceCaptain !== null && set.has(viceCaptain),
    keeper: keeper !== null && set.has(keeper) && keeperIsWkRole,
    withinBudget: spend <= budget,
    uniqueLeadership: captain !== null && viceCaptain !== null ? captain !== viceCaptain : true,
    allAvailable: sel.every((p) => p.available),
    composition: compositionOk,
  };
  const problems: string[] = [];
  if (!checks.teamName) problems.push("Enter a team name.");
  if (!checks.count) problems.push(`Pick exactly ${SQUAD_SIZE} players.`);
  if (!checks.composition && !PROVISIONAL_SQUAD_SHAPE) {
    const c = countRolesInSelection(selected, byId);
    problems.push(
      `Squad must be ${SQUAD_ROLES.bat} batters, ${SQUAD_ROLES.ar} all-rounders, ${SQUAD_ROLES.bowl} bowlers, ${SQUAD_ROLES.wk} wicketkeeper (currently ${c.bat}/${c.ar}/${c.bowl}/${c.wk}).`,
    );
  }
  if (!checks.withinBudget) {
    problems.push(
      `Stay within budget (${money(budget)}). Squad costs ${money(spend)} at your purchase prices — swap or remove players.`,
    );
  }
  if (!checks.captain) problems.push("Select a captain (C).");
  if (!checks.viceCaptain) problems.push("Select a vice-captain (VC).");
  if (!checks.uniqueLeadership) problems.push("Captain and vice-captain must be different.");
  if (!checks.keeper) {
    problems.push(
      keeper !== null && set.has(keeper) && !keeperIsWkRole
        ? "Wicketkeeper (WK) must be a player listed as WK."
        : "Select a wicketkeeper (WK) on your WK-listed player.",
    );
  }
  if (!checks.allAvailable) problems.push("Remove unavailable players from your squad.");
  if (PROVISIONAL_SQUAD_SHAPE) {
    checks.composition = true;
  }
  if (grandfatheredRelaxed) {
    if (selected.length === 0) {
      problems.push("Pick at least one player to save.");
    } else {
      problems.length = 0;
      if (!checks.teamName) problems.push("Enter a team name.");
      checks.count = true;
      checks.composition = true;
      checks.captain = true;
      checks.viceCaptain = true;
      checks.keeper = true;
      checks.uniqueLeadership = true;
      checks.allAvailable = true;
      if (!checks.withinBudget) {
        problems.push(
          `Stay within your saved squad spend (${money(budget)}). Squad costs ${money(spend)} at your purchase prices — swap or remove players.`,
        );
      }
    }
  }
  const ok = Object.values(checks).every(Boolean);
  return { ok, checks, spend, problems };
}

type SavedTeamHealth = {
  ok: boolean;
  /** Higher = more broken; used to sort inactive / incomplete squads to the bottom. */
  severity: number;
  labels: string[];
};

type LeaderboardRow = {
  team: SavedTeam;
  weekPts: number;
  total: number;
  capName: string;
  vcName: string;
  fieldingLabel: string | null;
  health?: SavedTeamHealth;
};

function evaluateSavedTeamHealth(
  team: SavedTeam,
  byId: Map<number, Player>,
  budget: number,
): SavedTeamHealth {
  if (isGrandfatheredPricingTeam(team)) {
    if (team.players.length === 0 && (team.cumulativePoints ?? 0) === 0) {
      return { ok: false, severity: 100, labels: ["No squad saved"] };
    }
    return { ok: true, severity: 0, labels: [] };
  }

  const labels: string[] = [];
  let severity = 0;
  const n = team.players.length;

  if (n === 0) {
    return { ok: false, severity: 100, labels: ["No squad saved"] };
  }

  if (n !== SQUAD_SIZE) {
    labels.push(`${n}/${SQUAD_SIZE} players`);
    severity = Math.max(severity, 95);
  }

  if (n === SQUAD_SIZE) {
    if (!PROVISIONAL_SQUAD_SHAPE && !squadCompositionOk(team.players, byId)) {
      const c = countRolesInSelection(team.players, byId);
      labels.push(`Wrong shape ${c.bat}-${c.ar}-${c.bowl}-${c.wk}`);
      severity = Math.max(severity, 75);
    }

    const listedPriceForId = (id: number) => byId.get(id)?.basePrice ?? byId.get(id)?.price;
    const marketPriceForId = (id: number) => byId.get(id)?.price ?? 0;
    if (!isGrandfatheredPricingTeam(team)) {
      const spend = squadSpend(team.players, {}, marketPriceForId);
      const overBy = Math.max(0, spend - budget);
      if (overBy > 0) {
        labels.push(`Over budget ${money(overBy)}`);
        severity = Math.max(severity, 85);
      }
    }

    if (team.captain === null || !team.players.includes(team.captain)) {
      labels.push("No captain");
      severity = Math.max(severity, 65);
    }
    if (team.viceCaptain === null || !team.players.includes(team.viceCaptain)) {
      labels.push("No vice-captain");
      severity = Math.max(severity, 65);
    }
    const keeperPlayer = team.keeper !== null ? byId.get(team.keeper) : undefined;
    if (team.keeper === null || !team.players.includes(team.keeper) || keeperPlayer?.role !== "wk") {
      labels.push("No wicketkeeper");
      severity = Math.max(severity, 65);
    }

    const unavailableCount = team.players.filter((id) => {
      const p = byId.get(id);
      return p && !p.available;
    }).length;
    if (unavailableCount > 0) {
      labels.push(unavailableCount === 1 ? "Unavailable pick" : `${unavailableCount} unavailable`);
      severity = Math.max(severity, 55);
    }
  }

  const totalPts = team.cumulativePoints ?? 0;
  if (n < SQUAD_SIZE && totalPts === 0) {
    if (!labels.includes("No squad saved")) labels.push("Inactive");
    severity = Math.max(severity, 98);
  }

  return { ok: labels.length === 0, severity, labels };
}

function compareLeaderboardRows(a: LeaderboardRow, b: LeaderboardRow): number {
  const aNeedsFix = a.health && !a.health.ok ? 1 : 0;
  const bNeedsFix = b.health && !b.health.ok ? 1 : 0;
  if (aNeedsFix !== bNeedsFix) return aNeedsFix - bNeedsFix;
  if (aNeedsFix && a.health && b.health && a.health.severity !== b.health.severity) {
    return a.health.severity - b.health.severity;
  }
  return b.total - a.total || a.team.name.localeCompare(b.team.name);
}

// ─── UI Components ───────────────────────────────────────────────────────────

function FormDots({ history }: { history: WeekRecord[] }) {
  const recent = history.slice(-5);
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-zinc-500">Form</span>
      {Array.from({ length: 5 }).map((_, i) => {
        const offset = 5 - recent.length;
        const rec = i >= offset ? recent[i - offset] : null;
        if (!rec) return <span key={i} className="h-2.5 w-2.5 rounded-full bg-white/10" />;
        const dnp = Boolean(rec.didNotPlay);
        const dnb = Boolean(rec.didNotBat);
        const title = dnp
          ? `GW${rec.week}: Did not play`
          : dnb
            ? `GW${rec.week}: DNB${rec.points > 0 ? ` · ${rec.points} pts` : ""}`
            : `GW${rec.week}: ${rec.points} pts`;
        if (dnp) {
          return (
            <span
              key={i}
              className="h-2.5 w-2.5 rounded-full bg-zinc-600/50 ring-1 ring-zinc-500/40"
              title={title}
            />
          );
        }
        if (dnb && rec.points === 0) {
          return (
            <span
              key={i}
              className="h-2.5 w-2.5 rounded-full bg-sky-500/50 ring-1 ring-sky-400/35"
              title={title}
            />
          );
        }
        const color =
          rec.points >= 60 ? "bg-emerald-400" : rec.points >= 30 ? "bg-amber-400" : rec.points > 0 ? "bg-orange-500" : "bg-zinc-600";
        return <span key={i} className={`h-2.5 w-2.5 rounded-full ${color}`} title={title} />;
      })}
    </div>
  );
}

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "red" | "green" | "amber" | "blue" }) {
  const cls = tone === "green" ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30"
    : tone === "red" ? "bg-red-500/15 text-red-200 ring-1 ring-red-500/30"
    : tone === "amber" ? "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/30"
    : tone === "blue" ? "bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30"
    : "bg-white/5 text-zinc-200 ring-1 ring-white/10";
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${cls}`}>{children}</span>;
}

function TransferImpactPanel({
  currentGameweek,
  selectedCount,
  freeAtLock,
  preview,
  rules,
  locked,
}: {
  currentGameweek: number;
  selectedCount: number;
  freeAtLock: number | null;
  preview: ReturnType<typeof buildTransferSavePreview>;
  rules: { gw1Open: boolean; newJoinGrace: boolean; pricingAmnesty: boolean };
  locked: boolean;
}) {
  if (locked) {
    return (
      <div className="rounded-xl border border-zinc-600/40 bg-zinc-900/80 p-3 ring-1 ring-white/10">
        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Transfers locked</div>
        <p className="mt-1 text-sm text-zinc-400">Lineup is locked until the admin ends this gameweek.</p>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="rounded-xl border border-amber-500/35 bg-amber-950/20 p-3 ring-1 ring-amber-500/25">
        <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300/90">
          Transfer preview · GW{currentGameweek}
        </div>
        <p className="mt-2 text-sm text-zinc-200">
          Pick <strong className="text-white">{SQUAD_SIZE - selectedCount}</strong> more player
          {SQUAD_SIZE - selectedCount === 1 ? "" : "s"} to see how many free transfers this save will use and any point hit.
        </p>
        {freeAtLock != null ? (
          <p className="mt-2 text-xs text-zinc-400">
            Free transfers available this gameweek: <strong className="text-white">{freeAtLock}</strong>
            <span className="text-zinc-500"> (max {MAX_FREE_TRANSFERS_IN_GW} in one GW)</span>
          </p>
        ) : null}
      </div>
    );
  }

  if (preview.kind === "first") {
    return (
      <div className="rounded-xl border border-emerald-500/35 bg-emerald-950/25 p-3 ring-1 ring-emerald-500/25">
        <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-300/90">First save</div>
        <p className="mt-2 text-sm text-emerald-100/90">
          <strong className="text-white">No transfer charge.</strong> This squad becomes your starting point for GW{currentGameweek}.
        </p>
      </div>
    );
  }

  if (!preview.penaltiesApply) {
    return (
      <div className="rounded-xl border border-emerald-500/35 bg-emerald-950/25 p-3 ring-1 ring-emerald-500/25">
        <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-300/90">
          Unlimited changes · GW{currentGameweek}
        </div>
        <p className="mt-2 text-sm text-emerald-100/90">
          {rules.pricingAmnesty ? (
            <>
              Pricing update — rebuild your squad freely until <strong className="text-white">{LINEUP_LOCK_SUMMARY}</strong> with{" "}
              <strong className="text-white">no transfer penalties</strong>.
            </>
          ) : rules.gw1Open ? (
            <>Opening gameweek — change players freely until lineup lock with <strong className="text-white">no transfer penalties</strong>.</>
          ) : (
            <>New this gameweek — unlimited player changes until <strong className="text-white">{LINEUP_LOCK_SUMMARY}</strong>.</>
          )}
        </p>
      </div>
    );
  }

  const costTone =
    preview.extras > 0
      ? "border-red-500/40 bg-red-950/30 ring-red-500/30"
      : preview.T > 0
        ? "border-sky-500/35 bg-sky-950/25 ring-sky-500/20"
        : "border-emerald-500/30 bg-emerald-950/20 ring-emerald-500/20";

  return (
    <div className={["rounded-xl border p-3 ring-1", costTone].join(" ")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-sky-200/90">
          Live transfer summary · GW{currentGameweek}
        </div>
        {preview.extras > 0 ? (
          <span className="rounded-full bg-red-600/25 px-2.5 py-0.5 text-xs font-bold text-red-100 ring-1 ring-red-500/40">
            −{preview.penaltyDue} pts on save
          </span>
        ) : preview.T > 0 ? (
          <span className="rounded-full bg-emerald-600/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-100 ring-1 ring-emerald-500/35">
            No point hit
          </span>
        ) : (
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-zinc-300 ring-1 ring-white/10">
            No player swaps
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-black/25 px-3 py-2 ring-1 ring-white/10">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Player changes</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-white">{preview.T}</div>
        </div>
        <div className="rounded-lg bg-black/25 px-3 py-2 ring-1 ring-white/10">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Free transfers used</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-emerald-200">
            {preview.freeUsed} <span className="text-sm font-medium text-zinc-400">/ {preview.F}</span>
          </div>
        </div>
        <div className="rounded-lg bg-black/25 px-3 py-2 ring-1 ring-white/10">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Free left after save</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-zinc-200">{preview.freeRemaining}</div>
        </div>
        <div className="rounded-lg bg-black/25 px-3 py-2 ring-1 ring-white/10">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Extra transfers</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-amber-200">
            {preview.extras}
            {preview.extras > 0 ? (
              <span className="text-sm font-medium text-red-300"> (−{POINTS_PER_EXTRA_TRANSFER} each)</span>
            ) : null}
          </div>
        </div>
      </div>

      {(preview.outgoing.length > 0 || preview.incoming.length > 0) && (
        <div className="mt-3 grid gap-2 border-t border-white/10 pt-3 text-xs sm:grid-cols-2">
          {preview.outgoing.length > 0 ? (
            <div>
              <div className="font-semibold text-red-200/90">Out</div>
              <ul className="mt-1 space-y-0.5 text-zinc-300">
                {preview.outgoing.map((name) => (
                  <li key={`out-${name}`}>− {name}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {preview.incoming.length > 0 ? (
            <div>
              <div className="font-semibold text-emerald-200/90">In</div>
              <ul className="mt-1 space-y-0.5 text-zinc-300">
                {preview.incoming.map((name) => (
                  <li key={`in-${name}`}>+ {name}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {preview.penaltyDelta !== 0 ? (
        <p className="mt-3 border-t border-white/10 pt-2 text-xs text-zinc-400">
          vs your last save, league total moves by{" "}
          <strong className={preview.penaltyDelta > 0 ? "text-amber-200" : "text-emerald-200"}>
            {preview.penaltyDelta > 0 ? "−" : "+"}
            {Math.abs(preview.penaltyDelta)}
          </strong>{" "}
          pts from transfer hits.
        </p>
      ) : preview.extras > 0 ? (
        <p className="mt-3 border-t border-white/10 pt-2 text-xs text-amber-200/90">
          Saving will deduct <strong className="text-amber-100">−{preview.penaltyDue}</strong> from your season total.
        </p>
      ) : preview.T > 0 ? (
        <p className="mt-3 border-t border-white/10 pt-2 text-xs text-zinc-400">
          All changes fit your free allowance — captain / vice / keeper updates do not count as transfers.
        </p>
      ) : (
        <p className="mt-3 border-t border-white/10 pt-2 text-xs text-zinc-400">
          Same players as your GW baseline — you can still save to update captain, vice, or keeper.
        </p>
      )}
    </div>
  );
}

function buildTransferSavePreview(
  mySavedTeam: SavedTeam | null,
  selected: number[],
  currentGameweek: number,
  playersById: Map<number, Player>,
  now: Date,
  freeSquadRebuildGameweek?: number | null,
) {
  if (selected.length !== SQUAD_SIZE) return null;
  const penaltiesApply = transferPenaltiesApplyForTeam(
    currentGameweek,
    mySavedTeam ?? null,
    now,
    freeSquadRebuildGameweek,
  );
  if (!mySavedTeam) {
    return { kind: "first" as const, penaltiesApply };
  }
  const baseline = squadTransferBaseline(mySavedTeam, penaltiesApply, currentGameweek);
  const F =
    resolveFreeTransfersAtGwStart(mySavedTeam.freeTransfersAtGwStart);
  const T = countOutgoingPlayerChanges(baseline, selected);
  const extras = penaltiesApply ? transferExtrasAgainstFree(T, F) : 0;
  const penaltyDue = penaltiesApply ? penaltyPointsForExtras(extras) : 0;
  const penaltyDelta = penaltyDue - (mySavedTeam.transferPenaltyPointsApplied ?? 0);
  const freeUsed = penaltiesApply ? Math.min(T, F) : T;
  const freeRemaining = penaltiesApply ? Math.max(0, F - freeUsed) : F;
  const { outgoing, incoming } = transferPlayerNameDiff(baseline, selected, playersById);
  return {
    kind: "returning" as const,
    penaltiesApply,
    T,
    F,
    extras,
    penaltyDue,
    penaltyDelta,
    freeUsed,
    freeRemaining,
    outgoing,
    incoming,
  };
}

function RankMovementPill({
  overallRank,
  previousRank,
  delta,
  compareGw,
}: {
  overallRank: number;
  previousRank: number | null;
  delta: number | null;
  compareGw: number | null;
}) {
  if (!overallRank) return null;
  const rankTone = overallRank === 1 ? "font-semibold text-emerald-200" : "font-semibold text-zinc-200";
  let move: React.ReactNode = null;
  if (compareGw != null && compareGw >= 1) {
    if (delta == null || previousRank == null) {
      move = <span className="text-sky-300">NEW</span>;
    } else if (delta > 0) {
      move = <span className="text-emerald-300">↑{delta}</span>;
    } else if (delta < 0) {
      move = <span className="text-red-300">↓{Math.abs(delta)}</span>;
    } else {
      move = <span className="text-zinc-500">—</span>;
    }
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
      <span className={rankTone}>#{overallRank}</span>
      {move}
      {compareGw != null && compareGw >= 1 && previousRank != null ? (
        <span className="text-zinc-600">was #{previousRank}</span>
      ) : null}
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-zinc-950/60 ring-1 ring-white/10">{children}</div>;
}

function CardHeader({ title, subtitle, right }: { title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4 sm:p-5">
      <div className="min-w-0">
        <div className="truncate text-base font-semibold text-white">{title}</div>
        {subtitle ? <div className="mt-1 text-sm text-zinc-400">{subtitle}</div> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="p-4 sm:p-5">{children}</div>;
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button" onClick={onClick}
      className={["flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ring-1 ring-white/10",
        active ? "bg-red-600 text-white shadow-[0_10px_30px_-15px_rgba(239,68,68,0.7)]" : "bg-white/5 text-zinc-200 hover:bg-white/10"].join(" ")}
      aria-current={active ? "page" : undefined}
    >
      <span className="inline-flex items-center">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function TextField({ value, onChange, placeholder, label, type = "text", right }: {
  value: string; onChange: (v: string) => void; placeholder?: string; label?: string;
  type?: "text" | "password"; right?: React.ReactNode;
}) {
  return (
    <label className="block">
      {label ? <div className="mb-1.5 text-xs font-medium text-zinc-300">{label}</div> : null}
      <div className="relative">
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type}
          className={["w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500",
            "ring-1 ring-white/10 outline-none transition focus:ring-2 focus:ring-red-500/60", right ? "pr-10" : ""].join(" ")} />
        {right ? <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">{right}</div> : null}
      </div>
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  min = 0,
  step = 1,
  className,
  variant = "default",
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  className?: string;
  /** Higher-contrast field for dense admin tables (easier to read). */
  variant?: "default" | "field";
  disabled?: boolean;
}) {
  const n = Number.isFinite(value) ? Math.trunc(Number(value)) : 0;
  const base =
    variant === "field"
      ? "w-full min-w-0 rounded-lg border border-zinc-500/80 bg-zinc-800 py-2.5 text-base font-semibold text-white shadow-[inset_0_1px_3px_rgba(0,0,0,0.45)] outline-none focus-visible:border-red-500 focus-visible:ring-2 focus-visible:ring-red-500/50"
      : "w-full min-w-0 rounded-lg bg-white/5 px-2 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60";
  return (
    <input type="number" inputMode="numeric" value={n} min={min} step={step} disabled={disabled}
      onChange={(e) => onChange(clampNonNegativeInt(Number(e.target.value)))}
      className={[
        base,
        variant === "field" ? "px-2 tabular-nums" : "",
        disabled ? "cursor-not-allowed opacity-50" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")} />
  );
}

/** The account holder’s name from Firebase Auth (Google name, signup “Your name”, or email). */
function accountHolderName(user: User): string {
  const dn = user.displayName?.trim();
  if (dn) return dn;
  const em = user.email?.trim();
  if (em) return em;
  return "Nondies Player";
}

function ownerFieldFromFirestore(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const t = value.trim();
    return t.length ? t : undefined;
  }
  const s = String(value).trim();
  return s.length ? s : undefined;
}

/**
 * Map a teams/{id} snapshot. Spread doc data first, then set `uid` from the document id so a
 * stray `uid` field in the document cannot overwrite the real owner id (that broke owner matching).
 */
async function assertLeagueAdminFirestoreAccess(user: User): Promise<{
  hasLeagueAdminDoc: boolean;
  hasAdminClaim: boolean;
}> {
  await user.getIdToken(true);
  const leagueSnap = await getDoc(doc(db, "leagueAdmins", user.uid));
  const token = await user.getIdTokenResult();
  const hasLeagueAdminDoc = leagueSnap.exists();
  const hasAdminClaim = token.claims.admin === true;
  if (!hasLeagueAdminDoc && !hasAdminClaim) {
    throw new Error(
      `This account is not a league admin. In Firebase project "${firebaseProjectId}", create ` +
        `leagueAdmins/${user.uid} (empty doc is fine), publish firestore rules, then sign out and back in.`,
    );
  }
  return { hasLeagueAdminDoc, hasAdminClaim };
}

/** Pinpoints which collection blocks End gameweek (rules / wrong project / stale token). */
async function probeLeagueAdminWrites(user: User, otherTeamUid: string | null): Promise<string[]> {
  const lines: string[] = [];
  const access = await assertLeagueAdminFirestoreAccess(user);
  lines.push(
    `Project: ${firebaseProjectId} · UID: ${user.uid} · leagueAdmins doc: ${access.hasLeagueAdminDoc ? "yes" : "no"} · admin claim: ${access.hasAdminClaim ? "yes" : "no"}`,
  );

  const probes: { label: string; run: () => Promise<void> }[] = [
    {
      label: "gameState",
      run: async () => {
        await setDoc(doc(db, "gameState", "__admin_probe__"), { probe: true }, { merge: true });
        await deleteDoc(doc(db, "gameState", "__admin_probe__"));
      },
    },
    {
      label: "gwTeams",
      run: async () => {
        const ref = doc(db, "gwTeams", "__admin_probe__");
        await setDoc(ref, { gameweek: 0, teams: [], probe: true });
        await deleteDoc(ref);
      },
    },
    {
      label: "players",
      run: async () => {
        const ref = doc(db, "players", "__admin_probe__");
        await setDoc(ref, { name: "probe", price: 1, runs: 0, available: false, probe: true }, { merge: true });
        await deleteDoc(ref);
      },
    },
    {
      label: "teams (other user)",
      run: async () => {
        if (!otherTeamUid) throw new Error("skipped — no other saved team in league");
        await updateDoc(doc(db, "teams", otherTeamUid), { __adminProbe: true });
        await updateDoc(doc(db, "teams", otherTeamUid), { __adminProbe: deleteField() });
      },
    },
  ];

  for (const { label, run } of probes) {
    try {
      await run();
      lines.push(`${label}: OK`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      lines.push(`${label}: FAILED — ${msg}`);
    }
  }
  return lines;
}

function savedTeamFromFirestoreDoc(d: { id: string; data: () => Record<string, unknown> }): SavedTeam {
  const raw = d.data();
  const ownerName =
    ownerFieldFromFirestore(raw.ownerName) ?? ownerFieldFromFirestore(raw.owner_name);
  return { ...raw, uid: d.id, ownerName } as SavedTeam;
}

/** Leaderboard owner: always the account holder — live from Auth for your row; Firestore for everyone else. */
function resolveOwnerDisplayName(team: SavedTeam, authUser: User | null): string {
  const stored = ownerFieldFromFirestore(team.ownerName);
  if (stored) return stored;
  if (authUser && team.uid === authUser.uid) {
    return accountHolderName(authUser);
  }
  return "Unknown";
}

function AdminHistoryWeekEditorModal({
  playerName,
  week,
  isLive,
  record,
  onClose,
  onEdit,
  onToggleDidNotPlay,
}: {
  playerName: string;
  week: number;
  isLive: boolean;
  record: WeekRecord;
  onClose: () => void;
  onEdit: (patch: Partial<WeekRecord>) => void;
  onToggleDidNotPlay: (on: boolean) => void;
}) {
  const r = record;
  const dnp = Boolean(r.didNotPlay);
  const dnb = Boolean(r.didNotBat);
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[96] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-week-editor-title"
        className="flex max-h-[min(92dvh,100%)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-zinc-950 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <div id="history-week-editor-title" className="truncate text-lg font-bold text-white">
              {playerName} · GW{week}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              {isLive
                ? "Editing the live gameweek row — same as the Player stats table below."
                : "Editing a past gameweek. Click Save stats when finished to persist."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-zinc-300 ring-1 ring-white/10 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-auto px-5 py-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              <input
                type="checkbox"
                checked={dnp}
                onChange={(e) => onToggleDidNotPlay(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 text-zinc-400 focus:ring-zinc-500/50"
              />
              DNP
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sky-300/90">
              <input
                type="checkbox"
                checked={dnb}
                disabled={dnp}
                onChange={(e) => {
                  const on = e.target.checked;
                  onEdit(on ? { didNotBat: true, notOut: false, runs: 0, fours: 0, sixes: 0 } : { didNotBat: false });
                }}
                className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 text-sky-500 focus:ring-sky-500/50 disabled:opacity-40"
              />
              DNB
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-300/90">
              <input
                type="checkbox"
                checked={Boolean(r.notOut)}
                disabled={dnp || dnb}
                onChange={(e) =>
                  onEdit(e.target.checked ? { notOut: true, didNotBat: false } : { notOut: false })
                }
                className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 text-emerald-500 focus:ring-emerald-500/50 disabled:opacity-40"
              />
              NO
            </label>
            <div className="ml-auto text-sm font-bold tabular-nums text-white">{r.points} pts</div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="block sm:col-span-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Runs</div>
              <NumberInput
                variant="field"
                value={r.runs}
                disabled={dnp || dnb}
                onChange={(v) => onEdit({ runs: v, ...(v > 0 ? { didNotBat: false } : {}) })}
                className="text-center"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">4s</div>
              <NumberInput
                variant="field"
                value={r.fours}
                disabled={dnp || dnb}
                onChange={(v) => onEdit({ fours: v, ...(v > 0 ? { didNotBat: false } : {}) })}
                className="text-center"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">6s</div>
              <NumberInput
                variant="field"
                value={r.sixes}
                disabled={dnp || dnb}
                onChange={(v) => onEdit({ sixes: v, ...(v > 0 ? { didNotBat: false } : {}) })}
                className="text-center"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Wkts</div>
              <NumberInput
                variant="field"
                value={r.wickets}
                disabled={dnp}
                onChange={(v) => onEdit({ wickets: v })}
                className="text-center"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Maidens</div>
              <NumberInput
                variant="field"
                value={r.maidens}
                disabled={dnp}
                onChange={(v) => onEdit({ maidens: v })}
                className="text-center"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Catches</div>
              <NumberInput
                variant="field"
                value={r.catches}
                disabled={dnp}
                onChange={(v) => onEdit({ catches: v })}
                className="text-center"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">WK c.</div>
              <NumberInput
                variant="field"
                value={r.wkCatches}
                disabled={dnp}
                onChange={(v) => onEdit({ wkCatches: v })}
                className="text-center"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Stump.</div>
              <NumberInput
                variant="field"
                value={r.stumpings}
                disabled={dnp}
                onChange={(v) => onEdit({ stumpings: v })}
                className="text-center"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">RO</div>
              <NumberInput
                variant="field"
                value={r.runOuts}
                disabled={dnp}
                onChange={(v) => onEdit({ runOuts: v })}
                className="text-center"
              />
            </label>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white ring-1 ring-red-500/40 hover:bg-red-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminStatsSortTh({
  label,
  colKey,
  sort,
  onSort,
  className,
  compact,
  ...thProps
}: {
  label: string;
  colKey: AdminStatsSortKey;
  sort: { key: AdminStatsSortKey; dir: "asc" | "desc" };
  onSort: (k: AdminStatsSortKey) => void;
  className?: string;
  /** Narrow column — centered label (matches fixed-width stat inputs). */
  compact?: boolean;
} & React.ComponentPropsWithoutRef<"th">) {
  const active = sort.key === colKey;
  return (
    <th className={[compact ? "px-2 py-3" : "px-4 py-3", className].filter(Boolean).join(" ")} {...thProps}>
      <button
        type="button"
        onClick={() => onSort(colKey)}
        className={[
          "inline-flex max-w-full items-center gap-1.5 text-xs font-semibold text-zinc-300 hover:text-white transition",
          compact ? "w-full justify-center text-center" : "text-left",
        ].join(" ")}
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        <span className="truncate">{label}</span>
        {active ? (
          sort.dir === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-600 opacity-60" aria-hidden />
        )}
      </button>
    </th>
  );
}

function PlayersSortTh({
  label,
  colKey,
  sort,
  onSort,
  className,
  ...thProps
}: {
  label: React.ReactNode;
  colKey: DraftSortKey;
  sort: { key: DraftSortKey; dir: "asc" | "desc" };
  onSort: (k: DraftSortKey) => void;
  className?: string;
} & React.ThHTMLAttributes<HTMLTableCellElement>) {
  const active = sort.key === colKey;
  return (
    <th className={["px-4 py-3", className].filter(Boolean).join(" ")} {...thProps}>
      <button
        type="button"
        onClick={() => onSort(colKey)}
        className={["inline-flex items-center gap-1.5 text-xs font-semibold transition",
          active ? "text-white" : "text-zinc-300 hover:text-white"].join(" ")}
      >
        <span>{label}</span>
        {active ? <span>{sort.dir === "asc" ? "↑" : "↓"}</span> : <ArrowUpDown className="h-3 w-3 opacity-70" />}
      </button>
    </th>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Page() {
  const EXPECTED_PLAYERS_PER_GW = 22;
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("draft");

  // Game state — synced from Firestore
  const [players, setPlayers] = useState<Player[]>(SEEDED_PLAYERS);
  const [teams, setTeams] = useState<SavedTeam[]>([]);
  const [currentGameweek, setCurrentGameweek] = useState(1);
  const [dnpHistoryRepairDone, setDnpHistoryRepairDone] = useState(false);
  const [freeSquadRebuildGameweek, setFreeSquadRebuildGameweek] = useState<number | null>(null);
  const [pricingAmnestyBusy, setPricingAmnestyBusy] = useState(false);
  const [revertPostPricingBusy, setRevertPostPricingBusy] = useState(false);
  const [dnpRepairNote, setDnpRepairNote] = useState<string | null>(null);
  const pendingDnpHistoryRepairRef = useRef(false);
  const [fsReady, setFsReady] = useState(false);
  const [fsError, setFsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Auth
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Draft builder — in-memory (Firestore is source of truth for roster & teams)
  const [builder, setBuilder] = useState<BuilderState>({ teamName: "", selected: [], captain: null, viceCaptain: null, keeper: null });
  /** After Clear, skip auto-hydrate from Firestore until the saved squad snapshot changes. */
  const clearedSavedTeamWireKeyRef = useRef<string | null>(null);
  const [ownerNameInput, setOwnerNameInput] = useState("");
  const [ownerNameTouched, setOwnerNameTouched] = useState(false);
  const [latestChatMeta, setLatestChatMeta] = useState<LatestChatMeta | null>(null);
  const [chatLastSeenAt, setChatLastSeenAt] = useState<Timestamp | null>(null);
  const [spendCapNoticeDismissed, setSpendCapNoticeDismissed] = useState(false);
  const [spendCapNoticeReady, setSpendCapNoticeReady] = useState(false);

  // Admin
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [pin, setPin] = useState("");
  const pinInputRef = useRef<HTMLInputElement | null>(null);
  /** After saving to Firestore, skip one sync from `players` → `localPlayers` so we don't overwrite with stale snapshot data before onSnapshot updates. */
  const skipPlayerSyncRef = useRef(false);
  /**
   * After “Save stats”, onSnapshot can briefly replay pre-write cache. Until `players` matches this
   * snapshot, we do not replace `localPlayers` (prevents price / squad / role edits looking like they “reverted”).
   */
  const statsSavePendingRef = useRef<Player[] | null>(null);
  const [showBestXI, setShowBestXI] = useState(false);

  // Admin — local edits (not yet saved to Firestore)
  const [localPlayers, setLocalPlayers] = useState<Player[]>(SEEDED_PLAYERS);
  const [unsavedStats, setUnsavedStats] = useState(false);
  const [savingStats, setSavingStats] = useState(false);
  const [savedStatsFlash, setSavedStatsFlash] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotDoc[]>([]);
  const [restoringSnapshotId, setRestoringSnapshotId] = useState<string | null>(null);
  const [pcMatchId, setPcMatchId] = useState("");
  const [pcBusy, setPcBusy] = useState(false);
  const [pcNote, setPcNote] = useState<string | null>(null);
  const [adminAccessProbe, setAdminAccessProbe] = useState<string | null>(null);
  const [adminAccessProbing, setAdminAccessProbing] = useState(false);
  const [playedPickerOpen, setPlayedPickerOpen] = useState(false);
  const [playedPickerIds, setPlayedPickerIds] = useState<number[]>([]);
  const [showOnlyPlayedRows, setShowOnlyPlayedRows] = useState(false);
  const [weeklyAuditOpen, setWeeklyAuditOpen] = useState(true);
  const [weeklyAuditDnpOnly, setWeeklyAuditDnpOnly] = useState(false);
  const [weeklyAuditSuspiciousOnly, setWeeklyAuditSuspiciousOnly] = useState(false);
  const [weeklyAuditQuery, setWeeklyAuditQuery] = useState("");
  const [historyWeekEdit, setHistoryWeekEdit] = useState<{ playerId: number; week: number } | null>(null);
  const [adminStatsSort, setAdminStatsSort] = useState<{ key: AdminStatsSortKey; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });

  const toggleAdminStatsSort = React.useCallback((key: AdminStatsSortKey) => {
    setAdminStatsSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      const defaultAsc = key === "name" || key === "teamTier" || key === "role";
      return { key, dir: defaultAsc ? "asc" : "desc" };
    });
  }, []);

  // Admin — add player form
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState(5);
  const [newTeamTier, setNewTeamTier] = useState<TeamTier>(2);
  const [newPlayerRole, setNewPlayerRole] = useState<PlayerRole>("bat");

  // Save team state
  const [savingTeam, setSavingTeam] = useState(false);
  /** After Firestore has ever had a non-empty roster, empty snapshot will not re-seed (avoids “deleted players came back”). */
  const playersSeededMarkerSentRef = useRef(false);
  const emptyPlayersSeedInFlightRef = useRef(false);

  // Leaderboard: view another team's XI
  const [teamModal, setTeamModal] = useState<SavedTeam | null>(null);
  /** "live" = current squads; number = completed GW from gwTeams archive. */
  const [leaderboardGwView, setLeaderboardGwView] = useState<number | "live">("live");
  const [gwTeamsArchive, setGwTeamsArchive] = useState<GwTeamsDoc[]>([]);
  const [lastLoginByUid, setLastLoginByUid] = useState<Map<string, Timestamp>>(() => new Map());
  const lastLoginWriteMsRef = useRef(0);
  const [undoingGameweek, setUndoingGameweek] = useState(false);

  useEffect(() => {
    if (!teamModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTeamModal(null);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [teamModal]);

  // Firestore: listen to current gameweek (after auth — rules require signedIn())
  useEffect(() => {
    if (!authUser) return;
    setFsError(null);
    const gsRef = doc(db, "gameState", "current");
    const unsub = onSnapshot(gsRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setCurrentGameweek(data.currentGameweek ?? 1);
        setDnpHistoryRepairDone(Boolean(data.dnpHistoryRepairDone));
        const fsr = data.freeSquadRebuildGameweek;
        setFreeSquadRebuildGameweek(
          typeof fsr === "number" && Number.isFinite(fsr) ? Math.floor(fsr) : null,
        );
      } else {
        setCurrentGameweek(1);
        setDnpHistoryRepairDone(false);
        setFreeSquadRebuildGameweek(null);
      }
      setFsReady(true);
      setFsError(null);
    }, (err) => {
      setFsError(`gameState: ${err?.message ?? "Failed to read game state."}`);
      setFsReady(true);
    });
    return () => unsub();
  }, [authUser]);

  // Firestore: listen to players collection (single source of truth)
  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    const gsRef = doc(db, "gameState", "current");

    const unsub = onSnapshot(collection(db, "players"), (snap) => {
      const list = snap.docs
        .map((d) => {
          const data = d.data() as any;
          return {
            id: Number(d.id),
            name: String(data.name ?? ""),
            teamTier: parseTeamTier(data.teamTier, Number(d.id)),
            role: parsePlayerRole(data.role, Number(d.id)),
            price: Number(data.price ?? 0),
            runs: Number(data.runs ?? 0),
            fours: Number(data.fours ?? 0),
            sixes: Number(data.sixes ?? 0),
            wickets: Number(data.wickets ?? 0),
            maidens: Number(data.maidens ?? 0),
            catches: Number(data.catches ?? 0),
            wkCatches: Number(data.wkCatches ?? 0),
            stumpings: Number(data.stumpings ?? 0),
            runOuts: Number(data.runOuts ?? 0),
            available: Boolean(data.available ?? true),
            didNotBat: Boolean(data.didNotBat),
            didNotPlay: Boolean(data.didNotPlay),
            notOut: Boolean(data.notOut),
            history: Array.isArray(data.history) ? data.history : [],
          } satisfies Player;
        })
        .filter((p) => Number.isFinite(p.id) && p.name);

      if (list.length === 0) {
        void (async () => {
          if (cancelled || emptyPlayersSeedInFlightRef.current) return;
          try {
            const gsSnap = await getDoc(gsRef);
            if (cancelled) return;
            const leagueAlreadyHadPlayers = gsSnap.exists() && gsSnap.data()?.playersSeeded === true;
            if (leagueAlreadyHadPlayers) {
              setPlayers([]);
              setFsReady(true);
              setFsError(null);
              return;
            }
            emptyPlayersSeedInFlightRef.current = true;
            const batch = writeBatch(db);
            for (const p of SEEDED_PLAYERS) {
              batch.set(doc(db, "players", String(p.id)), {
                name: p.name,
                teamTier: p.teamTier,
                role: p.role,
                price: p.price,
                runs: p.runs,
                fours: p.fours,
                sixes: p.sixes,
                wickets: p.wickets,
                maidens: p.maidens,
                catches: p.catches,
                wkCatches: p.wkCatches,
                stumpings: p.stumpings,
                runOuts: p.runOuts,
                notOut: Boolean(p.notOut),
                available: p.available,
              });
            }
            batch.set(gsRef, { playersSeeded: true }, { merge: true });
            await batch.commit();
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            if (!cancelled) setFsError(`Could not seed players: ${msg}`);
            emptyPlayersSeedInFlightRef.current = false;
          }
        })();
        return;
      }

      emptyPlayersSeedInFlightRef.current = false;

      list.sort((a, b) => a.id - b.id);
      setPlayers(list);
      setFsReady(true);
      setFsError(null);
    }, (err) => {
      setFsError(`players: ${err?.message ?? "Failed to read players."}`);
      setFsReady(true);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [authUser]);

  // Firestore: listen to teams collection
  useEffect(() => {
    if (!authUser) return;
    const unsub = onSnapshot(
      collection(db, "teams"),
      (snap) => {
        setTeams(snap.docs.map((d) => savedTeamFromFirestoreDoc(d)));
        setFsError(null);
      },
      (err) => {
        setFsError(`teams: ${err?.message ?? "Failed to read teams."}`);
      },
    );
    return () => unsub();
  }, [authUser]);

  // Firestore: locked squad snapshots (one doc per completed gameweek)
  useEffect(() => {
    if (!authUser) return;
    const q = query(collection(db, "gwTeams"), orderBy("gameweek", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: GwTeamsDoc[] = [];
        for (const d of snap.docs) {
          const parsed = parseGwTeamsDoc(d.data() as Record<string, unknown>);
          if (parsed) list.push(parsed);
        }
        setGwTeamsArchive(list);
        setFsError(null);
      },
      (err) => {
        setFsError(`gwTeams: ${err?.message ?? "Failed to read gwTeams."}`);
      },
    );
    return () => unsub();
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    const q = query(collection(db, "chatMessages"), orderBy("createdAt", "desc"), limit(1));
    return onSnapshot(q, (snap) => {
      const d = snap.docs[0];
      if (!d) {
        setLatestChatMeta(null);
        return;
      }
      const raw = d.data() as Record<string, unknown>;
      const createdAt = raw.createdAt instanceof Timestamp ? raw.createdAt : null;
      const userId = typeof raw.userId === "string" ? raw.userId : "";
      if (!createdAt) {
        setLatestChatMeta(null);
        return;
      }
      setLatestChatMeta({ createdAt, userId });
    });
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    return onSnapshot(doc(db, "userChatState", authUser.uid), (snap) => {
      const raw = snap.data() as Record<string, unknown> | undefined;
      const ts = raw?.lastSeenAt instanceof Timestamp ? raw.lastSeenAt : null;
      setChatLastSeenAt(ts);
    });
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    const q = query(collection(db, "users"), limit(500));
    return onSnapshot(
      q,
      (snap) => {
        const next = new Map<string, Timestamp>();
        for (const d of snap.docs) {
          const raw = d.data() as Record<string, unknown>;
          const ts =
            raw.lastLoginAt instanceof Timestamp
              ? raw.lastLoginAt
              : raw.updatedAt instanceof Timestamp
                ? raw.updatedAt
                : null;
          if (ts) next.set(d.id, ts);
        }
        setLastLoginByUid(next);
      },
      (err) => {
        setFsError((prev) => prev ?? `users: ${err?.message ?? "Failed to read user activity."}`);
      },
    );
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    const nowMs = Date.now();
    if (nowMs - lastLoginWriteMsRef.current < 30 * 60_000) return;
    lastLoginWriteMsRef.current = nowMs;
    const displayName = accountHolderName(authUser);
    void setDoc(
      doc(db, "users", authUser.uid),
      {
        displayName,
        displayNameLower: displayName.toLowerCase(),
        email: authUser.email ?? null,
        lastLoginAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ).catch(() => {
      lastLoginWriteMsRef.current = 0;
    });
  }, [authUser]);

  async function runAction<T>(label: string, fn: () => Promise<T>) {
    setActionError(null);
    try {
      return await fn();
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : "Unknown error";
      setActionError(`${label} failed: ${msg}`);
      throw e;
    }
  }

  // Firebase auth — wait for initial persistence restore before sending to /login
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void auth.authStateReady().then(() => {
      if (cancelled) return;
      unsub = onAuthStateChanged(auth, (u) => {
        setAuthUser(u);
        setAuthReady(true);
        if (!u) router.replace("/login");
      });
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [router]);

  // Ensure createdBy is present; only backfill ownerName from Auth if document has none.
  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    void (async () => {
      try {
        const ref = doc(db, "teams", authUser.uid);
        const snap = await getDoc(ref);
        if (cancelled || !snap.exists()) return;
        const data = snap.data();
        const cur = ownerFieldFromFirestore(data.ownerName);
        const okBy = data.createdBy === authUser.uid;
        if (cur && okBy) return;
        await setDoc(
          ref,
          {
            ownerName: cur ?? accountHolderName(authUser),
            createdBy: authUser.uid,
          },
          { merge: true },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) setActionError(`Could not update owner name: ${msg}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  // Keep admin edit buffer in sync with Firestore unless they have unsaved edits
  useEffect(() => {
    if (unsavedStats) return;

    const pending = statsSavePendingRef.current;
    if (pending !== null) {
      const ok =
        pending.length === players.length &&
        pending.every((want) => {
          const got = players.find((x) => x.id === want.id);
          return got !== undefined && firestorePlayerMatchesAdminSnapshot(got, want);
        });
      if (!ok) return;
      statsSavePendingRef.current = null;
    }

    if (skipPlayerSyncRef.current) {
      skipPlayerSyncRef.current = false;
      return;
    }
    setLocalPlayers(players);
  }, [players, unsavedStats]);

  // Admin: listen to snapshots (admin-only)
  useEffect(() => {
    if (!adminAuthed) return;
    const q = query(collection(db, "snapshots"), orderBy("createdAt", "desc"), limit(12));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setSnapshots(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as SnapshotDoc)));
      },
      (err) => {
        // Most common cause: token lacks admin claim; sign out/in to refresh.
        setActionError(err?.message ?? "Failed to read snapshots.");
      },
    );
    return () => unsub();
  }, [adminAuthed]);

  async function logout() {
    await signOut(auth);
    router.replace("/login");
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const draftPricingMap = useMemo(() => computeDynamicPricingMap(players), [players]);
  const adminPricingMap = useMemo(
    () => computeDynamicPricingMap(unsavedStats ? localPlayers : players),
    [unsavedStats, localPlayers, players],
  );
  const draftPoolPlayers = useMemo(
    () => withEffectivePrices(players, draftPricingMap),
    [players, draftPricingMap],
  );
  const dynamicBudget = useMemo(
    () => computeDynamicBudget(draftPoolPlayers, draftPricingMap),
    [draftPoolPlayers, draftPricingMap],
  );
  const squadBudget = dynamicBudget.budget;
  const playersById = useMemo(
    () => new Map(draftPoolPlayers.map((p) => [p.id, p])),
    [draftPoolPlayers],
  );
  const marketPriceForId = useCallback(
    (id: number) => playersById.get(id)?.price ?? 0,
    [playersById],
  );
  const listedPriceForId = useCallback(
    (id: number) => playersById.get(id)?.basePrice ?? playersById.get(id)?.price,
    [playersById],
  );
  /** Same source as End GW — includes unsaved admin table so catches update the leaderboard after Save stats (and for admin preview before save). */
  const scoringPlayers = useMemo(
    () => (unsavedStats ? localPlayers : players),
    [unsavedStats, localPlayers, players],
  );
  const scoringPlayersById = useMemo(
    () => new Map(scoringPlayers.map((p) => [p.id, p])),
    [scoringPlayers],
  );
  /** Bumps on an interval so the lock flips at deadline without needing a full page reload. */
  const [lockClock, setLockClock] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setLockClock((c) => c + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const lockDate = useMemo(() => {
    void lockClock;
    return getThisWeeksLockDate(new Date());
  }, [lockClock]);
  const locked = useMemo(() => {
    void lockClock;
    return isSelectionLocked(new Date());
  }, [lockClock]);

  const lastLoginNowMs = useMemo(() => {
    void lockClock;
    return Date.now();
  }, [lockClock]);

  const draftRoleCounts = useMemo(
    () => countRolesInSelection(builder.selected, playersById),
    [builder.selected, playersById],
  );

  const ownership = useMemo(() => {
    const map = new Map<number, number>();
    for (const t of teams) for (const id of t.players) map.set(id, (map.get(id) ?? 0) + 1);
    return map;
  }, [teams]);

  const [search, setSearch] = useState("");
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  /** Draft pool: only players currently in your squad (quick remove / swap). */
  const [draftSquadOnly, setDraftSquadOnly] = useState(false);
  /** Draft pool: show all, 1st XI only, or 2nd XI only. */
  const [draftTeamFilter, setDraftTeamFilter] = useState<"all" | "1" | "2">("all");
  /** Draft pool: column + direction (available players still listed first). */
  const [draftSortKey, setDraftSortKey] = useState<DraftSortKey>("price");
  const [draftSortDir, setDraftSortDir] = useState<"asc" | "desc">("desc");
  /** Players tab table (available pool only — same as before). */
  const [playersTabSortKey, setPlayersTabSortKey] = useState<DraftSortKey>("gwPoints");
  const [playersTabSortDir, setPlayersTabSortDir] = useState<"asc" | "desc">("desc");
  const [hideInactivePlayers, setHideInactivePlayers] = useState(false);
  const togglePlayersSort = React.useCallback((key: DraftSortKey) => {
    setPlayersTabSortKey((prevKey) => {
      if (prevKey === key) {
        setPlayersTabSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setPlayersTabSortDir(key === "name" || key === "role" || key === "teamTier" ? "asc" : "desc");
      return key;
    });
  }, []);
  const playerPoints = useMemo(
    () => {
      let rows = draftPoolPlayers
        .filter((p) => p.available)
        .map((p) => {
          const season = seasonCricketStatsFromHistory(p.history);
          const seasonFantasy = seasonFantasyBreakdownFromHistory(p.history);
          const seasonPoints = sumSeasonPointsFromHistory(p.history);
          const playedGws = p.history.filter((h) => !h.didNotPlay).length;
          return {
            player: p,
            season,
            seasonFantasy,
            seasonPoints,
            playedGws,
            picked: ownership.get(p.id) ?? 0,
          };
        });
      if (hideInactivePlayers) {
        rows = rows.filter((r) => r.seasonPoints > 0 || r.playedGws > 0 || r.season.innings > 0);
      }
      const mult = playersTabSortDir === "desc" ? -1 : 1;
      rows.sort((a, b) => {
        let cmp = 0;
        switch (playersTabSortKey) {
          case "id": cmp = a.player.id - b.player.id; break;
          case "name": cmp = a.player.name.localeCompare(b.player.name); break;
          case "role": cmp = a.player.role.localeCompare(b.player.role); break;
          case "teamTier": cmp = a.player.teamTier - b.player.teamTier; break;
          case "price": cmp = a.player.price - b.player.price; break;
          case "runs": cmp = a.season.runs - b.season.runs; break;
          case "fours": cmp = a.season.fours - b.season.fours; break;
          case "sixes": cmp = a.season.sixes - b.season.sixes; break;
          case "wickets": cmp = a.season.wickets - b.season.wickets; break;
          case "maidens": cmp = a.season.maidens - b.season.maidens; break;
          case "catches": cmp = a.season.catches - b.season.catches; break;
          case "wkCatches": cmp = a.season.wkCatches - b.season.wkCatches; break;
          case "stumpings": cmp = a.season.stumpings - b.season.stumpings; break;
          case "runOuts": cmp = a.season.runOuts - b.season.runOuts; break;
          case "gwPoints": cmp = a.seasonFantasy.total - b.seasonFantasy.total; break;
          case "batPts": cmp = a.seasonFantasy.batting - b.seasonFantasy.batting; break;
          case "bowlPts": cmp = a.seasonFantasy.bowling - b.seasonFantasy.bowling; break;
          case "fieldPts": cmp = a.seasonFantasy.fielding - b.seasonFantasy.fielding; break;
          case "seasonPts": cmp = a.seasonPoints - b.seasonPoints; break;
          case "playedGws": cmp = a.playedGws - b.playedGws; break;
          case "picked": cmp = a.picked - b.picked; break;
          case "innings": cmp = a.season.innings - b.season.innings; break;
          case "notOuts": cmp = a.season.notOuts - b.season.notOuts; break;
          case "average":
            cmp = (a.season.average ?? -1) - (b.season.average ?? -1);
            break;
          case "highScore":
            cmp = a.season.highScore - b.season.highScore;
            break;
          case "bestBowling":
            cmp = a.season.bestBowlingWkts - b.season.bestBowlingWkts;
            if (cmp === 0) cmp = a.season.bestBowlingMaidens - b.season.bestBowlingMaidens;
            break;
          default: cmp = 0;
        }
        if (cmp !== 0) return mult * cmp;
        return a.player.name.localeCompare(b.player.name);
      });
      return rows;
    },
    [draftPoolPlayers, playersTabSortKey, playersTabSortDir, ownership, hideInactivePlayers],
  );

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sel = new Set(builder.selected);
    return draftPoolPlayers
      .filter((p) => (draftTeamFilter === "all" ? true : p.teamTier === Number(draftTeamFilter)))
      .filter((p) => (onlyAvailable ? p.available : true))
      .filter((p) => (!draftSquadOnly || sel.has(p.id)))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
      .sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        return compareDraftPoolPlayers(a, b, draftSortKey, draftSortDir, ownership);
      });
  }, [draftPoolPlayers, draftTeamFilter, onlyAvailable, draftSquadOnly, builder.selected, search, draftSortKey, draftSortDir, ownership]);

  const weeklyChangeFeed = useMemo(() => {
    const weekly = snapshots.filter((s) => s.gameweek === currentGameweek);
    return weekly.map((snap, idx) => {
      const prev = weekly[idx + 1];
      const changedRows = snapshotStatDiffCount(snap.players, prev?.players);
      const editedBy =
        snap.createdBy && authUser && snap.createdBy === authUser.uid
          ? "You"
          : snap.createdBy
            ? `${snap.createdBy.slice(0, 8)}...`
            : "Unknown";
      return {
        id: snap.id,
        label: snap.label ?? "snapshot",
        when: formatSnapshotTime(snap.createdAt),
        editedBy,
        changedRows,
      };
    });
  }, [snapshots, currentGameweek, authUser]);

  const adminSortedPlayers = useMemo(() => {
    const { key, dir } = adminStatsSort;
    const mult = dir === "asc" ? 1 : -1;
    return localPlayers.slice().sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "role":
          cmp = a.role.localeCompare(b.role);
          break;
        case "teamTier":
          cmp = a.teamTier - b.teamTier;
          break;
        case "available":
          cmp = Number(a.available) - Number(b.available);
          break;
        case "price":
          cmp = a.price - b.price;
          break;
        case "runs":
          cmp = a.runs - b.runs;
          break;
        case "wickets":
          cmp = a.wickets - b.wickets;
          break;
        case "maidens":
          cmp = a.maidens - b.maidens;
          break;
        case "catches":
          cmp = a.catches - b.catches;
          break;
        case "fours":
          cmp = a.fours - b.fours;
          break;
        case "sixes":
          cmp = a.sixes - b.sixes;
          break;
        case "wkCatches":
          cmp = a.wkCatches - b.wkCatches;
          break;
        case "stumpings":
          cmp = a.stumpings - b.stumpings;
          break;
        case "runOuts":
          cmp = a.runOuts - b.runOuts;
          break;
        case "points":
          cmp = calculatePoints(a) - calculatePoints(b);
          break;
        case "season":
          cmp = sumSeasonPointsFromHistory(a.history) - sumSeasonPointsFromHistory(b.history);
          break;
        default:
          cmp = 0;
      }
      if (cmp !== 0) return mult * cmp;
      return a.name.localeCompare(b.name);
    });
  }, [localPlayers, adminStatsSort]);

  const adminVisiblePlayers = useMemo(() => {
    if (!showOnlyPlayedRows) return adminSortedPlayers;
    const played = new Set(playedPickerIds);
    return adminSortedPlayers.filter((p) => played.has(p.id));
  }, [adminSortedPlayers, showOnlyPlayedRows, playedPickerIds]);

  const auditGameweeks = useMemo(() => {
    const weeks = new Set(gwTeamsArchive.map((g) => g.gameweek));
    if (currentGameweek >= 1) weeks.add(currentGameweek);
    return [...weeks].sort((a, b) => a - b);
  }, [gwTeamsArchive, currentGameweek]);

  const weeklyAuditPlayers = useMemo(() => {
    const source = unsavedStats ? localPlayers : players;
    const q = weeklyAuditQuery.trim().toLowerCase();
    let rows = [...source].sort((a, b) => a.name.localeCompare(b.name));
    if (q) rows = rows.filter((p) => p.name.toLowerCase().includes(q));
    if (weeklyAuditDnpOnly || weeklyAuditSuspiciousOnly) {
      rows = rows.filter((p) =>
        auditGameweeks.some((week) => {
          const h = weekRecordFromPlayer(p, week, currentGameweek);
          if (!h) return false;
          if (weeklyAuditSuspiciousOnly) return weekRecordLooksLikeSuspiciousDnp(h);
          return Boolean(h.didNotPlay);
        }),
      );
    }
    return rows;
  }, [
    unsavedStats,
    localPlayers,
    players,
    weeklyAuditQuery,
    weeklyAuditDnpOnly,
    weeklyAuditSuspiciousOnly,
    auditGameweeks,
    currentGameweek,
  ]);

  const historyWeekEditCtx = useMemo(() => {
    if (!historyWeekEdit) return null;
    const p = localPlayers.find((x) => x.id === historyWeekEdit.playerId);
    if (!p) return null;
    const { week } = historyWeekEdit;
    const record = weekRecordFromPlayer(p, week, currentGameweek) ?? emptyWeekRecord(week);
    return { player: p, week, record, isLive: week === currentGameweek };
  }, [historyWeekEdit, localPlayers, currentGameweek]);

  const mySavedTeam = useMemo(
    () => (authUser ? teams.find((t) => t.uid === authUser.uid) : undefined),
    [teams, authUser],
  );

  const personalSpendCap = useMemo(
    () => personalSpendCapForTeam(mySavedTeam, listedPriceForId, marketPriceForId),
    [mySavedTeam, listedPriceForId, marketPriceForId],
  );
  const draftBudget = useMemo(
    () => draftBudgetForTeam(squadBudget, mySavedTeam, listedPriceForId, marketPriceForId),
    [squadBudget, mySavedTeam, listedPriceForId, marketPriceForId],
  );
  const usesPersonalSpendCap = personalSpendCap != null;
  const showPersonalSpendCapAnnouncement =
    authUser &&
    mySavedTeam &&
    isGrandfatheredPricingTeam(mySavedTeam) &&
    spendCapNoticeReady &&
    !spendCapNoticeDismissed;

  function dismissPersonalSpendCapNotice() {
    try {
      localStorage.setItem(PERSONAL_SPEND_CAP_NOTICE_KEY, "1");
    } catch {
      /* private browsing / storage blocked */
    }
    setSpendCapNoticeDismissed(true);
  }

  useEffect(() => {
    try {
      setSpendCapNoticeDismissed(localStorage.getItem(PERSONAL_SPEND_CAP_NOTICE_KEY) === "1");
    } catch {
      setSpendCapNoticeDismissed(false);
    }
    setSpendCapNoticeReady(true);
  }, []);

  const draftPurchasePrices = useMemo(
    () =>
      draftPurchasePricesForSelection(
        builder.selected,
        mySavedTeam,
        marketPriceForId,
        listedPriceForId,
      ),
    [builder.selected, mySavedTeam, marketPriceForId, listedPriceForId],
  );

  const spend = useMemo(
    () => squadSpend(builder.selected, draftPurchasePrices, marketPriceForId),
    [builder.selected, draftPurchasePrices, marketPriceForId],
  );

  const validation = useMemo(
    () =>
      validateTeam({
        teamName: builder.teamName,
        selected: builder.selected,
        captain: builder.captain,
        viceCaptain: builder.viceCaptain,
        keeper: builder.keeper,
        byId: playersById,
        budget: draftBudget,
        priceForPlayerId: (id) => priceForIdFromMap(id, draftPurchasePrices, marketPriceForId),
        grandfatheredRelaxed: mySavedTeam ? isGrandfatheredPricingTeam(mySavedTeam) : false,
      }),
    [builder, playersById, draftBudget, draftPurchasePrices, marketPriceForId, mySavedTeam],
  );

  const mySavedTeamBudgetIssue = useMemo(() => {
    if (!mySavedTeam || mySavedTeam.players.length !== SQUAD_SIZE) return null;
    if (isGrandfatheredPricingTeam(mySavedTeam)) return null;
    const teamSpend = squadSpendForTeam(mySavedTeam, listedPriceForId, marketPriceForId);
    const overBy = Math.max(0, teamSpend - squadBudget);
    if (overBy <= 0) return null;
    return { spend: teamSpend, overBudget: true, overBy };
  }, [mySavedTeam, listedPriceForId, marketPriceForId, squadBudget]);

  const mySavedTeamHydrateWire = useMemo(
    () => (mySavedTeam ? savedTeamHydrateWireKey(mySavedTeam) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable string from squad fields only
    [mySavedTeam?.uid, mySavedTeam?.players?.join(","), mySavedTeam?.captain, mySavedTeam?.viceCaptain, mySavedTeam?.keeper, (mySavedTeam?.name ?? "").trim()],
  );

  useEffect(() => {
    if (!authUser || !mySavedTeam) return;
    const wire = mySavedTeamHydrateWire;
    if (clearedSavedTeamWireKeyRef.current !== null) {
      if (wire === clearedSavedTeamWireKeyRef.current) return;
      clearedSavedTeamWireKeyRef.current = null;
    }
    setBuilder((prev) => {
      if (prev.selected.length > 0) return prev;
      const next = builderStateFromSavedTeam(mySavedTeam, playersById);
      if (next.selected.length === 0) return prev;
      return { ...next, teamName: next.teamName || prev.teamName };
    });
  }, [authUser, mySavedTeam, mySavedTeamHydrateWire, playersById]);

  /** After End GW, reload saved squad into the draft panel (do not leave it blank). */
  useEffect(() => {
    if (!authUser || !mySavedTeam || mySavedTeam.players.length !== SQUAD_SIZE) return;
    if (builder.selected.length > 0) return;
    clearedSavedTeamWireKeyRef.current = null;
    const next = builderStateFromSavedTeam(mySavedTeam, playersById);
    if (next.selected.length !== SQUAD_SIZE) return;
    setBuilder(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when GW advances or saved squad arrives empty-handed
  }, [currentGameweek, mySavedTeam?.uid, mySavedTeam?.players?.join(","), playersById]);

  /** When saved squad is over budget (form pricing), load it into Draft so managers can fix without rebuilding from scratch. */
  useEffect(() => {
    if (!authUser || !mySavedTeamBudgetIssue || locked) return;
    const next = builderStateFromSavedTeam(mySavedTeam!, playersById);
    if (next.selected.length !== SQUAD_SIZE) return;
    setBuilder((prev) => {
      const same =
        prev.selected.length === next.selected.length &&
        prev.selected.every((id, i) => id === next.selected[i]);
      if (same && prev.teamName === next.teamName) return prev;
      return { ...next, teamName: next.teamName || prev.teamName };
    });
  }, [authUser, mySavedTeam, mySavedTeamBudgetIssue, playersById, locked]);

  useEffect(() => {
    if (!authUser || ownerNameTouched) return;
    const fromTeam = mySavedTeam ? ownerFieldFromFirestore(mySavedTeam.ownerName) : undefined;
    setOwnerNameInput(fromTeam ?? accountHolderName(authUser));
  }, [authUser, mySavedTeam, ownerNameTouched]);

  const pricingAmnestyActive = isFreeSquadRebuildGameweek(currentGameweek, freeSquadRebuildGameweek);

  const transferSavePreview = useMemo(() => {
    void lockClock;
    return buildTransferSavePreview(
      mySavedTeam ?? null,
      builder.selected,
      currentGameweek,
      playersById,
      new Date(),
      freeSquadRebuildGameweek,
    );
  }, [mySavedTeam, builder.selected, currentGameweek, playersById, lockClock, freeSquadRebuildGameweek]);

  const transferBaselineSet = useMemo(() => {
    if (!mySavedTeam || builder.selected.length !== SQUAD_SIZE) return null;
    void lockClock;
    const now = new Date();
    const penaltiesApply = transferPenaltiesApplyForTeam(
      currentGameweek,
      mySavedTeam,
      now,
      freeSquadRebuildGameweek,
    );
    return new Set(squadTransferBaseline(mySavedTeam, penaltiesApply, currentGameweek));
  }, [mySavedTeam, builder.selected, currentGameweek, lockClock, freeSquadRebuildGameweek]);

  const saveTeamButtonLabel = useMemo(() => {
    if (savingTeam) return "Saving…";
    if (!validation.checks.withinBudget) return "Fix squad over budget";
    if (!transferSavePreview || locked) return "Save team to Firebase";
    if (transferSavePreview.kind === "first") return "Save team (first squad)";
    if (!transferSavePreview.penaltiesApply) return "Save team (no transfer charge)";
    if (transferSavePreview.extras > 0) {
      return `Save team (−${transferSavePreview.penaltyDue} league pts)`;
    }
    if (transferSavePreview.T > 0) {
      return `Save team (${transferSavePreview.freeUsed} free transfer${transferSavePreview.freeUsed === 1 ? "" : "s"})`;
    }
    return "Save team to Firebase";
  }, [savingTeam, transferSavePreview, locked, validation.checks.withinBudget]);

  const transferRulesFootnote = useMemo(() => {
    void lockClock;
    const now = new Date();
    const gw1Open = !transferPenaltiesApplyInGameweek(currentGameweek);
    const newJoinGrace =
      !!mySavedTeam &&
      transferPenaltiesApplyInGameweek(currentGameweek) &&
      !transferPenaltiesApplyForTeam(currentGameweek, mySavedTeam, now, freeSquadRebuildGameweek) &&
      !pricingAmnestyActive;
    return { gw1Open, newJoinGrace, pricingAmnesty: pricingAmnestyActive };
  }, [currentGameweek, mySavedTeam, lockClock, freeSquadRebuildGameweek, pricingAmnestyActive]);

  /** Free transfers you had when this gameweek opened (from saved team). */
  const freeTransfersAtLock = useMemo(() => {
    if (!mySavedTeam) return null;
    return resolveFreeTransfersAtGwStart(mySavedTeam.freeTransfersAtGwStart);
  }, [mySavedTeam]);

  const leaderboard = useMemo(() => {
    const rows = teams.map((t) => {
      const fielding = squadFieldingSummaryForGameweek(t, scoringPlayersById, currentGameweek, true);
      return {
        team: t,
        weekPts: computeWeekPoints(t, scoringPlayersById, currentGameweek),
        total: computeTeamTotal(t, scoringPlayersById, currentGameweek),
        capName: t.captain ? scoringPlayersById.get(t.captain)?.name ?? "—" : "—",
        vcName: t.viceCaptain ? scoringPlayersById.get(t.viceCaptain)?.name ?? "—" : "—",
        fieldingLabel: formatSquadFieldingSummary(fielding),
        health: evaluateSavedTeamHealth(t, playersById, squadBudget),
      };
    });
    rows.sort(compareLeaderboardRows);
    return rows;
  }, [teams, scoringPlayersById, currentGameweek, playersById, squadBudget]);

  const teamsNeedingFix = useMemo(
    () => leaderboard.filter((row) => row.health && !row.health.ok),
    [leaderboard],
  );

  const postPricingRevertPreview = useMemo(() => {
    const gwDoc = gwTeamsArchive.find((g) => g.gameweek === PRE_DYNAMIC_PRICING_SNAPSHOT_GW);
    if (!gwDoc) return { missingSnapshot: true as const, teams: [] as { name: string; uid: string }[] };
    const rows: { name: string; uid: string }[] = [];
    for (const t of teams) {
      const snap = gwDoc.teams.find((x) => x.uid === t.uid);
      if (!snap?.players?.length) continue;
      if (!squadMatchesGwSnapshot(t, snap)) {
        rows.push({ name: t.name, uid: t.uid });
      }
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return { missingSnapshot: false as const, teams: rows };
  }, [teams, gwTeamsArchive]);

  const completedGameweeks = useMemo(
    () => gwTeamsArchive.map((g) => g.gameweek).sort((a, b) => b - a),
    [gwTeamsArchive],
  );

  const historicalLeaderboard = useMemo((): LeaderboardRow[] | null => {
    if (leaderboardGwView === "live") return null;
    const doc = gwTeamsArchive.find((g) => g.gameweek === leaderboardGwView);
    if (!doc) return [];
    const rows: LeaderboardRow[] = doc.teams.map((ts) => {
      const team = gwSnapshotToSavedTeam(ts) as SavedTeam;
      const fielding = squadFieldingSummaryForGameweek(team, playersById, leaderboardGwView, false);
      return {
        team,
        weekPts: Math.round(ts.weekPoints * 10) / 10,
        total: Math.round(ts.cumulativePointsAfter * 10) / 10,
        capName: ts.captain ? playersById.get(ts.captain)?.name ?? "—" : "—",
        vcName: ts.viceCaptain ? playersById.get(ts.viceCaptain)?.name ?? "—" : "—",
        fieldingLabel: formatSquadFieldingSummary(fielding),
      };
    });
    rows.sort((a, b) => b.weekPts - a.weekPts || b.total - a.total || a.team.name.localeCompare(b.team.name));
    return rows;
  }, [leaderboardGwView, gwTeamsArchive, playersById]);

  const displayedLeaderboard: LeaderboardRow[] = historicalLeaderboard ?? leaderboard;
  const leaderboardViewLabel =
    leaderboardGwView === "live" ? `GW${currentGameweek} (live)` : `GW${leaderboardGwView} (archive)`;

  const viewingGameweek = leaderboardGwView === "live" ? currentGameweek : leaderboardGwView;

  const overallRankMaps = useMemo(() => {
    const prevDoc = gwTeamsArchive.find((g) => g.gameweek === viewingGameweek - 1);
    const previous = prevDoc ? cumulativeRanksByUid(prevDoc) : null;

    if (leaderboardGwView === "live") {
      const current = new Map<string, number>();
      leaderboard.forEach((row, i) => current.set(row.team.uid, i + 1));
      return { current, previous, compareGw: viewingGameweek > 1 ? viewingGameweek - 1 : null };
    }

    const doc = gwTeamsArchive.find((g) => g.gameweek === viewingGameweek);
    const current = doc ? cumulativeRanksByUid(doc) : new Map<string, number>();
    return { current, previous, compareGw: viewingGameweek > 1 ? viewingGameweek - 1 : null };
  }, [leaderboardGwView, viewingGameweek, leaderboard, gwTeamsArchive]);

  const gwBestXi = useMemo(() => {
    const live = leaderboardGwView === "live";
    const pool = live ? [...scoringPlayersById.values()] : players;
    const xi = bestXiForGameweek(pool, viewingGameweek, live);
    return { gameweek: viewingGameweek, players: xi, provisional: live };
  }, [leaderboardGwView, viewingGameweek, scoringPlayersById, players]);

  const gwBestXiHistory = useMemo(
    () =>
      completedGameweeks.map((gw) => {
        const xi = bestXiForGameweek(players, gw, false);
        const top = xi[0];
        if (!top) return null;
        return { gameweek: gw, topName: top.name, topPoints: top.points };
      }).filter((x): x is { gameweek: number; topName: string; topPoints: number } => x != null),
    [completedGameweeks, players],
  );

  useEffect(() => {
    if (leaderboardGwView === "live") return;
    if (!completedGameweeks.includes(leaderboardGwView)) setLeaderboardGwView("live");
  }, [leaderboardGwView, completedGameweeks]);
  const hasUnreadPavilion = useMemo(() => {
    if (!authUser || !latestChatMeta) return false;
    if (latestChatMeta.userId === authUser.uid) return false;
    if (!chatLastSeenAt) return true;
    return latestChatMeta.createdAt.toMillis() > chatLastSeenAt.toMillis();
  }, [authUser, latestChatMeta, chatLastSeenAt]);

  const bestSquad = useMemo(() => generateBestSquad(draftPoolPlayers), [draftPoolPlayers]);
  const selectedCount = builder.selected.length;
  const budgetPct = Math.min(100, Math.max(0, (spend / draftBudget) * 100));

  /** Squad panel order = pick order (easier to edit than price-sorted). */
  const selectedInPickOrder = useMemo(
    () => builder.selected.map((id) => playersById.get(id)).filter(Boolean as unknown as <T>(v: T | undefined) => v is T),
    [builder.selected, playersById],
  );

  // ── Draft handlers ─────────────────────────────────────────────────────────

  function toggleSelected(id: number) {
    if (locked) return;
    const p = playersById.get(id);
    if (!p) return;
    setBuilder((prev) => {
      const already = prev.selected.includes(id);
      if (already) {
        return { ...prev, selected: prev.selected.filter((x) => x !== id),
          captain: prev.captain === id ? null : prev.captain,
          viceCaptain: prev.viceCaptain === id ? null : prev.viceCaptain,
          keeper: prev.keeper === id ? null : prev.keeper };
      }
      const nextSelected = [...prev.selected, id];
      const nextPrices = draftPurchasePricesForSelection(
        nextSelected,
        mySavedTeam,
        (pid) => playersById.get(pid)?.price ?? 0,
        (pid) => playersById.get(pid)?.basePrice ?? playersById.get(pid)?.price,
      );
      const nextSpend = squadSpend(nextSelected, nextPrices, (pid) => playersById.get(pid)?.price ?? 0);
      if (!p.available || prev.selected.length >= SQUAD_SIZE || nextSpend > draftBudget) return prev;
      if (!canAddPlayerForRoles(id, prev.selected, playersById)) return prev;
      return { ...prev, selected: nextSelected };
    });
  }

  function setRole(role: "captain" | "viceCaptain" | "keeper", id: number) {
    if (locked) return;
    if (role === "keeper" && playersById.get(id)?.role !== "wk") return;
    setBuilder((prev) => {
      if (!prev.selected.includes(id)) return prev;
      if ((role === "captain" && prev.viceCaptain === id) || (role === "viceCaptain" && prev.captain === id)) return prev;
      return { ...prev, [role]: id } as BuilderState;
    });
  }

  function clearBuilder() {
    if (mySavedTeam) clearedSavedTeamWireKeyRef.current = savedTeamHydrateWireKey(mySavedTeam);
    else clearedSavedTeamWireKeyRef.current = null;
    setBuilder({ teamName: "", selected: [], captain: null, viceCaptain: null, keeper: null });
  }

  async function saveTeam() {
    if (locked || !validation.ok || !authUser) return;
    if (!validation.checks.withinBudget) {
      setActionError(`Squad spend is ${money(validation.spend)} — cap is ${money(draftBudget)}. Remove or swap players before saving.`);
      return;
    }
    setSavingTeam(true);
    try {
      await runAction("Save team", async () => {
        const ref = doc(db, "teams", authUser.uid);
        const snap = await getDoc(ref);
        const existing = snap.exists()
          ? savedTeamFromFirestoreDoc({ id: snap.id, data: () => snap.data() as Record<string, unknown> })
          : null;

        const newPlayers = [...builder.selected];
        const prevCumulative = existing?.cumulativePoints ?? 0;
        const nowSave = new Date();
        const playerJoinedGameweek = buildPlayerJoinedGameweekAfterSave(existing, newPlayers, currentGameweek, nowSave);
        const playerPurchasePrices = buildPurchasePricesAfterSave({
          existing,
          newPlayers,
          marketPriceForId,
          listedPriceForId,
        });

        const penaltiesApply = transferPenaltiesApplyForTeam(
          currentGameweek,
          existing,
          nowSave,
          freeSquadRebuildGameweek,
        );

        let baseline: number[];
        let freeAtGwStart: number;

        if (!existing) {
          baseline = [...newPlayers];
          freeAtGwStart = FREE_TRANSFERS_PER_WEEK;
        } else {
          const hasBaseline =
            Array.isArray(existing.transferBaselinePlayers) &&
            existing.transferBaselinePlayers.length === SQUAD_SIZE;
          const baselineFromStored = hasBaseline
            ? [...existing.transferBaselinePlayers!]
            : existing.players.length === SQUAD_SIZE
              ? [...existing.players]
              : [...newPlayers];
          freeAtGwStart = resolveFreeTransfersAtGwStart(existing.freeTransfersAtGwStart);
          const rollBaselineForNewJoinerGrace =
            !penaltiesApply && transferPenaltiesApplyInGameweek(currentGameweek);
          baseline = rollBaselineForNewJoinerGrace ? [...newPlayers] : baselineFromStored;
        }

        const T = countOutgoingPlayerChanges(baseline, newPlayers);
        const extras = penaltiesApply ? transferExtrasAgainstFree(T, freeAtGwStart) : 0;
        const penaltyDue = penaltiesApply ? penaltyPointsForExtras(extras) : 0;
        const oldApplied = existing?.transferPenaltyPointsApplied ?? 0;
        const newCumulative = Math.round((prevCumulative - (penaltyDue - oldApplied)) * 10) / 10;

        await setDoc(
          ref,
          {
            name: builder.teamName.trim(),
            ownerName: ownerNameInput.trim() || accountHolderName(authUser),
            players: newPlayers,
            captain: builder.captain,
            viceCaptain: builder.viceCaptain,
            keeper: builder.keeper,
            createdBy: authUser.uid,
            createdAt: serverTimestamp(),
            cumulativePoints: newCumulative,
            transferBaselinePlayers: baseline,
            freeTransfersAtGwStart: freeAtGwStart,
            transferPenaltyPointsApplied: penaltyDue,
            playerJoinedGameweek,
            playerPurchasePrices,
            ...(!existing ? { firstSaveGameweek: currentGameweek } : {}),
          },
          { merge: true },
        );
      });
      setBuilder((prev) => ({ ...prev, teamName: "" }));
      setOwnerNameTouched(false);
      setTab("leaderboard");
    } finally {
      setSavingTeam(false);
    }
  }

  // ── Admin handlers ─────────────────────────────────────────────────────────

  function adminLogin() {
    if (pin !== ADMIN_PIN) { setPin(""); setTimeout(() => pinInputRef.current?.focus(), 0); return; }
    setAdminAuthed(true);
    setPin("");
    setTab("admin");
  }

  function adminLogout() { setAdminAuthed(false); }

  async function enablePricingAmnestyAndNotify() {
    if (!authUser) return;
    if (
      !window.confirm(
        `Enable a free full squad rebuild for GW${currentGameweek} (no transfer penalties until lineup lock) and post a notice to the Pavilion for all managers?`,
      )
    ) {
      return;
    }
    setPricingAmnestyBusy(true);
    try {
      await runAction("Pricing amnesty", async () => {
        await assertLeagueAdminFirestoreAccess(authUser);
        await setDoc(
          doc(db, "gameState", "current"),
          { freeSquadRebuildGameweek: currentGameweek },
          { merge: true },
        );
        await addDoc(collection(db, "chatMessages"), {
          userId: authUser.uid,
          displayName: accountHolderName(authUser),
          message: pricingAmnestyPavilionMessage(currentGameweek, LINEUP_LOCK_SUMMARY),
          createdAt: serverTimestamp(),
          mentionedUserIds: [],
          deleted: false,
          isAdmin: true,
        });
      });
      setFreeSquadRebuildGameweek(currentGameweek);
    } finally {
      setPricingAmnestyBusy(false);
    }
  }

  async function runAdminAccessProbe() {
    if (!authUser) return;
    setAdminAccessProbing(true);
    setAdminAccessProbe(null);
    try {
      const otherUid = teams.find((t) => t.uid !== authUser.uid)?.uid ?? null;
      const lines = await probeLeagueAdminWrites(authUser, otherUid);
      setAdminAccessProbe(lines.join("\n"));
    } catch (e: unknown) {
      setAdminAccessProbe(e instanceof Error ? e.message : String(e));
    } finally {
      setAdminAccessProbing(false);
    }
  }

  function editLocalPlayer(id: number, patch: Partial<Player>) {
    setLocalPlayers((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...patch };
        const playedStat =
          next.runs > 0 ||
          next.fours > 0 ||
          next.sixes > 0 ||
          next.wickets > 0 ||
          next.maidens > 0 ||
          next.catches > 0 ||
          next.wkCatches > 0 ||
          next.stumpings > 0 ||
          next.runOuts > 0;
        if (playedStat && next.didNotPlay) {
          return { ...next, didNotPlay: false };
        }
        return next;
      }),
    );
    setUnsavedStats(true);
  }

  function openPlayedPicker() {
    const seed = localPlayers
      .filter((p) => !p.didNotPlay)
      .filter((p) =>
        p.runs > 0 ||
        p.fours > 0 ||
        p.sixes > 0 ||
        p.wickets > 0 ||
        p.maidens > 0 ||
        p.catches > 0 ||
        p.wkCatches > 0 ||
        p.stumpings > 0 ||
        p.runOuts > 0,
      )
      .map((p) => p.id);
    setPlayedPickerIds(seed);
    setPlayedPickerOpen(true);
  }

  function toggleDidNotPlay(id: number, on: boolean) {
    setLocalPlayers((prev) => prev.map((p) => (p.id === id ? applyDidNotPlayToPlayer(p, on) : p)));
    if (on) {
      setPlayedPickerIds((prev) => prev.filter((x) => x !== id));
    }
    setUnsavedStats(true);
    setActionError(null);
  }

  function applyAllPastWeeksDidNotPlayRepair() {
    if (
      !window.confirm(
        "Mark every past gameweek (and this week’s blank rows) as Did not play where a player has all-zero stats and did not bat? Ducks (DNB off, 0 runs) are kept as played. Then click Save stats to persist — this one-time banner will disappear after save.",
      )
    ) {
      return;
    }
    const source = unsavedStats ? localPlayers : players;
    const repaired = repairAllPlayersDidNotPlayHistory(source);
    const changed = countDidNotPlayHistoryRepairs(source, repaired);
    setLocalPlayers(repaired);
    setUnsavedStats(true);
    pendingDnpHistoryRepairRef.current = true;
    setDnpRepairNote(
      changed > 0
        ? `Applied DNP to ${changed} player-week row(s). Click Save stats to write to Firebase.`
        : "No rows needed changing — if prices still look wrong, check ducks have DNB unchecked.",
    );
    setActionError(null);
  }

  function openHistoryWeekEdit(playerId: number, week: number) {
    setHistoryWeekEdit({ playerId, week });
    setActionError(null);
  }

  function editHistoryWeek(playerId: number, week: number, patch: Partial<WeekRecord>) {
    setLocalPlayers((prev) =>
      prev.map((p) => {
        if (p.id !== playerId) return p;
        if (week === currentGameweek) {
          const current = weekRecordFromPlayer(p, week, currentGameweek) ?? emptyWeekRecord(week);
          const merged = finalizeWeekRecord({ ...current, ...patch });
          return { ...p, ...weekRecordToLivePlayerFields(merged) };
        }
        const history = [...(p.history ?? [])];
        const idx = history.findIndex((h) => h.week === week);
        if (idx >= 0) {
          history[idx] = finalizeWeekRecord({ ...history[idx], ...patch });
        } else {
          history.push(finalizeWeekRecord({ ...emptyWeekRecord(week), ...patch }));
          history.sort((a, b) => a.week - b.week);
        }
        return { ...p, history };
      }),
    );
    setUnsavedStats(true);
  }

  function toggleHistoryWeekDidNotPlay(playerId: number, week: number, on: boolean) {
    setLocalPlayers((prev) =>
      prev.map((p) => {
        if (p.id !== playerId) return p;
        if (week === currentGameweek) {
          return on ? applyDidNotPlayToPlayer(p, true) : { ...p, didNotPlay: false };
        }
        const history = [...(p.history ?? [])];
        const idx = history.findIndex((h) => h.week === week);
        const base = idx >= 0 ? history[idx] : emptyWeekRecord(week);
        const next = applyHistoryWeekDidNotPlay(base, on);
        if (idx >= 0) history[idx] = next;
        else {
          history.push(next);
          history.sort((a, b) => a.week - b.week);
        }
        return { ...p, history };
      }),
    );
    setUnsavedStats(true);
  }

  function applyPlayedPicker() {
    if (playedPickerIds.length !== EXPECTED_PLAYERS_PER_GW) {
      setActionError(
        `Select exactly ${EXPECTED_PLAYERS_PER_GW} players who played before applying.`,
      );
      return;
    }
    const played = new Set(playedPickerIds);
    setLocalPlayers((prev) =>
      prev.map((p) => {
        if (played.has(p.id)) {
          return { ...p, didNotPlay: false, didNotBat: false, notOut: false };
        }
        return {
          ...p,
          runs: 0,
          fours: 0,
          sixes: 0,
          wickets: 0,
          maidens: 0,
          catches: 0,
          wkCatches: 0,
          stumpings: 0,
          runOuts: 0,
          didNotBat: false,
          didNotPlay: true,
          notOut: false,
        };
      }),
    );
    setUnsavedStats(true);
    setPlayedPickerOpen(false);
    setShowOnlyPlayedRows(true);
    setActionError(null);
  }

  function startFreshGameweekSheet() {
    setLocalPlayers((prev) =>
      prev.map((p) => ({
        ...p,
        runs: 0,
        fours: 0,
        sixes: 0,
        wickets: 0,
        maidens: 0,
        catches: 0,
        wkCatches: 0,
        stumpings: 0,
        runOuts: 0,
        didNotBat: false,
        didNotPlay: false,
        notOut: false,
      })),
    );
    setUnsavedStats(true);
    setShowOnlyPlayedRows(false);
    setActionError(null);
  }

  async function importFromPlayCricket() {
    const id = pcMatchId.trim();
    if (!id || !/^\d+$/.test(id)) {
      setPcNote("Enter the numeric match ID from the Play Cricket scorecard URL.");
      return;
    }
    setPcBusy(true);
    setPcNote(null);
    try {
      const res = await fetch(`/api/play-cricket/match?matchId=${encodeURIComponent(id)}`);
      const data = (await res.json()) as {
        error?: string;
        matchTitle?: string;
        players?: Record<
          string,
          {
            runs: number;
            fours: number;
            sixes: number;
            wickets: number;
            maidens: number;
            catches: number;
            wkCatches: number;
            stumpings: number;
            runOuts: number;
          }
        >;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const pool = data.players ?? {};
      let updatedCount = 0;
      setLocalPlayers((prev) =>
        prev.map((p) => {
          const key = normalizePlayCricketName(p.name);
          const stats = pool[key];
          if (!stats) return p;
          updatedCount += 1;
          return {
            ...p,
            runs: stats.runs,
            fours: stats.fours,
            sixes: stats.sixes,
            wickets: stats.wickets,
            maidens: stats.maidens,
            catches: stats.catches,
            wkCatches: stats.wkCatches,
            stumpings: stats.stumpings,
            runOuts: stats.runOuts,
            didNotBat: false,
            didNotPlay: false,
            notOut: false,
          };
        }),
      );
      setUnsavedStats(true);
      setPcNote(
        `Imported ${updatedCount} player row(s) from “${data.matchTitle ?? id}”. ` +
          "Review WK catches and run-outs if needed, then Save stats.",
      );
    } catch (e: unknown) {
      setPcNote(e instanceof Error ? e.message : String(e));
    } finally {
      setPcBusy(false);
    }
  }

  async function saveStats() {
    setSavingStats(true);
    try {
      await runAction("Save stats", async () => {
        const committedSnapshot = localPlayers.map(clonePlayerAdminSnapshot);
        // Snapshot what you are about to write (admin table = localPlayers, including unsaved cells)
        await addDoc(collection(db, "snapshots"), {
          gameweek: currentGameweek,
          createdAt: serverTimestamp(),
          createdBy: authUser?.uid ?? null,
          label: "auto-before-save",
          players: committedSnapshot.map((p) => ({
            id: p.id,
            name: p.name,
            teamTier: p.teamTier,
            role: p.role,
            price: p.price,
            runs: p.runs,
            fours: p.fours,
            sixes: p.sixes,
            wickets: p.wickets,
            maidens: p.maidens,
            catches: p.catches,
            wkCatches: p.wkCatches,
            stumpings: p.stumpings,
            runOuts: p.runOuts,
            didNotBat: Boolean(p.didNotBat),
            didNotPlay: Boolean(p.didNotPlay),
            notOut: Boolean(p.notOut),
            available: p.available,
            history: p.history ?? [],
          })),
        });

        const batch = writeBatch(db);
        for (const p of committedSnapshot) {
          batch.set(
            doc(db, "players", String(p.id)),
            {
              name: p.name,
              teamTier: p.teamTier,
              role: p.role,
              price: p.price,
              runs: p.runs,
              fours: p.fours,
              sixes: p.sixes,
              wickets: p.wickets,
              maidens: p.maidens,
              catches: p.catches,
              wkCatches: p.wkCatches,
              stumpings: p.stumpings,
              runOuts: p.runOuts,
              didNotBat: Boolean(p.didNotBat),
              didNotPlay: Boolean(p.didNotPlay),
              notOut: Boolean(p.notOut),
              available: p.available,
              history: p.history ?? [],
            },
            { merge: true },
          );
        }
        await batch.commit();
        statsSavePendingRef.current = committedSnapshot;
        if (pendingDnpHistoryRepairRef.current) {
          await setDoc(
            doc(db, "gameState", "current"),
            { dnpHistoryRepairDone: true },
            { merge: true },
          );
          pendingDnpHistoryRepairRef.current = false;
          setDnpHistoryRepairDone(true);
          setDnpRepairNote(null);
        }
      });
      setUnsavedStats(false);
      setSavedStatsFlash(true);
      setTimeout(() => setSavedStatsFlash(false), 2000);
    } finally {
      setSavingStats(false);
    }
  }

  async function bulkAvailability(val: boolean) {
    statsSavePendingRef.current = null;
    const updated = localPlayers.map((p) => ({ ...p, available: val }));
    setLocalPlayers(updated);
    skipPlayerSyncRef.current = true;
    setUnsavedStats(false);
    await runAction("Bulk availability", async () => {
      const batch = writeBatch(db);
      for (const p of updated) batch.update(doc(db, "players", String(p.id)), { available: p.available });
      await batch.commit();
    });
  }

  async function restoreSnapshot(snapshotId: string) {
    statsSavePendingRef.current = null;
    setRestoringSnapshotId(snapshotId);
    try {
      await runAction("Restore snapshot", async () => {
        const snapRef = doc(db, "snapshots", snapshotId);
        const snap = await getDoc(snapRef);
        if (!snap.exists()) throw new Error("Snapshot not found.");
        const data: any = snap.data();
        const list: any[] = Array.isArray(data.players) ? data.players : [];
        const batch = writeBatch(db);
        for (const raw of list) {
          const id = Number(raw?.id);
          if (!Number.isFinite(id)) continue;
          batch.set(
            doc(db, "players", String(id)),
            {
              name: String(raw?.name ?? ""),
              teamTier: parseTeamTier(raw?.teamTier, id),
              role: parsePlayerRole(raw?.role, id),
              price: clampNonNegativeInt(Number(raw?.price ?? 0)),
              runs: clampNonNegativeInt(Number(raw?.runs ?? 0)),
              fours: clampNonNegativeInt(Number(raw?.fours ?? 0)),
              sixes: clampNonNegativeInt(Number(raw?.sixes ?? 0)),
              wickets: clampNonNegativeInt(Number(raw?.wickets ?? 0)),
              maidens: clampNonNegativeInt(Number(raw?.maidens ?? 0)),
              catches: clampNonNegativeInt(Number(raw?.catches ?? 0)),
              wkCatches: clampNonNegativeInt(Number(raw?.wkCatches ?? 0)),
              stumpings: clampNonNegativeInt(Number(raw?.stumpings ?? 0)),
              runOuts: clampNonNegativeInt(Number(raw?.runOuts ?? 0)),
              didNotBat: Boolean(raw?.didNotBat),
              didNotPlay: Boolean(raw?.didNotPlay),
              notOut: Boolean(raw?.notOut),
              available: Boolean(raw?.available),
              history: Array.isArray(raw?.history) ? raw.history : [],
            },
            { merge: true },
          );
        }
        await batch.commit();
      });
      setUnsavedStats(false);
    } finally {
      setRestoringSnapshotId(null);
    }
  }

  async function addPlayer() {
    statsSavePendingRef.current = null;
    const name = newName.trim();
    if (!name) return;
    const nextId =
      Math.max(0, ...localPlayers.map((p) => p.id), ...players.map((p) => p.id)) + 1;
    const newPlayer: Player = {
      id: nextId,
      name,
      role: newPlayerRole,
      teamTier: newTeamTier,
      price: newPrice,
      runs: 0,
      fours: 0,
      sixes: 0,
      wickets: 0,
      maidens: 0,
      catches: 0,
      wkCatches: 0,
      stumpings: 0,
      runOuts: 0,
      available: true,
      notOut: false,
      history: [],
    };
    const updated = [...localPlayers, newPlayer];
    setLocalPlayers(updated);
    setNewName("");
    setNewPrice(5);
    setNewPlayerRole("bat");
    await runAction("Add player", async () =>
      setDoc(doc(db, "players", String(newPlayer.id)), {
        name: newPlayer.name,
        role: newPlayer.role,
        teamTier: newPlayer.teamTier,
        price: newPlayer.price,
        runs: 0,
        fours: 0,
        sixes: 0,
        wickets: 0,
        maidens: 0,
        catches: 0,
        wkCatches: 0,
        stumpings: 0,
        runOuts: 0,
        notOut: false,
        available: true,
        history: [],
      }),
    );
    skipPlayerSyncRef.current = true;
    setUnsavedStats(false);
  }

  async function deletePlayer(id: number) {
    if (!window.confirm("Delete this player? This cannot be undone.")) return;
    statsSavePendingRef.current = null;
    const updated = localPlayers.filter((p) => p.id !== id);
    setLocalPlayers(updated);
    skipPlayerSyncRef.current = true;
    setUnsavedStats(false);
    await runAction("Delete player", async () => deleteDoc(doc(db, "players", String(id))));
    // Also remove from any saved teams
    await runAction("Update affected teams", async () => {
      const batch = writeBatch(db);
      for (const team of teams) {
        if (team.players.includes(id)) {
          const nextPlayers = team.players.filter((pid) => pid !== id);
          const base = team.transferBaselinePlayers ?? team.players;
          const nextBaseline = base.filter((pid) => pid !== id);
          batch.update(doc(db, "teams", team.uid), {
            players: nextPlayers,
            ...(nextBaseline.length > 0 ? { transferBaselinePlayers: nextBaseline } : {}),
            captain: team.captain === id ? null : team.captain,
            viceCaptain: team.viceCaptain === id ? null : team.viceCaptain,
            keeper: team.keeper === id ? null : team.keeper,
          });
        }
      }
      await batch.commit();
    });
  }

  async function endGameweek() {
    statsSavePendingRef.current = null;
    const gw = currentGameweek;
    /** Use admin table when it has unsaved edits so GW points match what you see in Admin. */
    const sourcePlayers = unsavedStats ? localPlayers : players;
    const playersByIdForGw = new Map(sourcePlayers.map((p) => [p.id, p]));
    const updatedPlayersRaw = sourcePlayers.map((p) => ({
      ...p,
      history: [
        ...(p.history ?? []),
        {
          week: gw,
          runs: p.runs,
          fours: p.fours,
          sixes: p.sixes,
          wickets: p.wickets,
          maidens: p.maidens,
          catches: p.catches,
          wkCatches: p.wkCatches,
          stumpings: p.stumpings,
          runOuts: p.runOuts,
          points: calculatePoints(p),
          ...(p.didNotBat ? { didNotBat: true as const } : {}),
          ...(p.didNotPlay ? { didNotPlay: true as const } : {}),
          ...(p.notOut ? { notOut: true as const } : {}),
        },
      ],
      runs: 0,
      fours: 0,
      sixes: 0,
      wickets: 0,
      maidens: 0,
      catches: 0,
      wkCatches: 0,
      stumpings: 0,
      runOuts: 0,
      didNotBat: false,
      didNotPlay: false,
      notOut: false,
    }));
    const pricingAfterGw = computeDynamicPricingMap(updatedPlayersRaw);
    const updatedPlayers = updatedPlayersRaw.map((p) => ({
      ...p,
      price: pricingAfterGw.get(p.id)?.effectivePrice ?? p.price,
    }));

    try {
      await runAction("End gameweek", async () => {
        if (!authUser) throw new Error("Sign in required.");
        await assertLeagueAdminFirestoreAccess(authUser);

        const teamSnapshots: GwTeamSnapshot[] = [];
        const teamBatch = writeBatch(db);
        for (const team of teams) {
          const weekPts = computeWeekPoints(team, playersByIdForGw, gw);
          const baseline =
            team.transferBaselinePlayers?.length === SQUAD_SIZE ? team.transferBaselinePlayers : team.players;
          const TEnd = countOutgoingPlayerChanges(baseline, team.players);
          const F = resolveFreeTransfersAtGwStart(team.freeTransfersAtGwStart);
          const unused = Math.max(0, F - TEnd);
          const nextFree = freeTransfersAfterRollover(unused);
          const cumulativeBefore = team.cumulativePoints ?? 0;
          const cumulativeAfter = Math.round((cumulativeBefore + weekPts) * 10) / 10;
          const playerPurchasePrices =
            team.playerPurchasePrices && Object.keys(team.playerPurchasePrices).length > 0
              ? team.playerPurchasePrices
              : buildPurchasePricesAfterSave({
                  existing: team,
                  newPlayers: team.players,
                  marketPriceForId: (id) =>
                    pricingAfterGw.get(id)?.effectivePrice ?? playersByIdForGw.get(id)?.price ?? 0,
                  listedPriceForId: (id) => playersByIdForGw.get(id)?.price,
                });
          teamSnapshots.push({
            uid: team.uid,
            name: team.name,
            ownerName: team.ownerName,
            players: [...team.players],
            captain: team.captain,
            viceCaptain: team.viceCaptain,
            keeper: team.keeper,
            weekPoints: weekPts,
            cumulativePointsBefore: cumulativeBefore,
            cumulativePointsAfter: cumulativeAfter,
            transferBaselinePlayers: [...baseline],
            freeTransfersAtGwStart: F,
            transferPenaltyPointsApplied: team.transferPenaltyPointsApplied ?? 0,
            playerJoinedGameweek: team.playerJoinedGameweek ? { ...team.playerJoinedGameweek } : {},
          });
          teamBatch.update(doc(db, "teams", team.uid), {
            name: team.name,
            ownerName: team.ownerName ?? null,
            players: [...team.players],
            captain: team.captain,
            viceCaptain: team.viceCaptain,
            keeper: team.keeper,
            cumulativePoints: cumulativeAfter,
            transferBaselinePlayers: [...team.players],
            freeTransfersAtGwStart: nextFree,
            transferPenaltyPointsApplied: 0,
            playerJoinedGameweek: team.playerJoinedGameweek ?? {},
            playerPurchasePrices,
          });
        }

        const playerBatch = writeBatch(db);
        for (const p of updatedPlayers) {
          playerBatch.update(doc(db, "players", String(p.id)), {
            runs: p.runs,
            fours: p.fours,
            sixes: p.sixes,
            wickets: p.wickets,
            maidens: p.maidens,
            catches: p.catches,
            wkCatches: p.wkCatches,
            stumpings: p.stumpings,
            runOuts: p.runOuts,
            didNotBat: false,
            didNotPlay: false,
            notOut: false,
            history: p.history,
            price: p.price,
          });
        }

        try {
          await teamBatch.commit();
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`teams batch — ${msg}`);
        }
        try {
          await playerBatch.commit();
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`players batch — ${msg}`);
        }
        try {
          await setDoc(doc(db, "gwTeams", String(gw)), {
            gameweek: gw,
            endedAt: serverTimestamp(),
            endedBy: authUser.uid,
            teams: teamSnapshots,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(
            `gwTeams write — ${msg}. In Firebase project "${firebaseProjectId}", open Firestore → Rules and publish rules that include match /gwTeams/{gameweekId} (see firestore.rules in the repo).`,
          );
        }
        try {
          await setDoc(doc(db, "gameState", "current"), { currentGameweek: gw + 1, freeSquadRebuildGameweek: deleteField() }, { merge: true });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`gameState write — ${msg}`);
        }
      });
      clearedSavedTeamWireKeyRef.current = null;
      const mine = teams.find((t) => t.uid === authUser?.uid);
      if (mine && mine.players.length === SQUAD_SIZE) {
        setBuilder(builderStateFromSavedTeam(mine, playersByIdForGw));
      }
      setLocalPlayers(updatedPlayers);
      setUnsavedStats(false);
      setTab("draft");
    } catch {
      /* runAction already set actionError */
    }
  }

  async function restoreSquadsFromLastEndedGw() {
    const lastGw = completedGameweeks[0];
    if (lastGw == null) {
      setActionError("No completed gameweek snapshot found in gwTeams.");
      return;
    }
    if (
      !window.confirm(
        `Restore every manager’s squad (players, C/VC/WK) from the GW${lastGw} snapshot? Points and current GW are not changed. Use if squads look empty after End GW.`,
      )
    ) {
      return;
    }
    try {
      await runAction(`Restore squads from GW${lastGw}`, async () => {
        const gwRef = doc(db, "gwTeams", String(lastGw));
        const gwSnap = await getDoc(gwRef);
        if (!gwSnap.exists()) throw new Error(`gwTeams/${lastGw} not found.`);
        const gwDoc = parseGwTeamsDoc(gwSnap.data() as Record<string, unknown>);
        if (!gwDoc?.teams.length) throw new Error(`GW${lastGw} snapshot has no teams.`);
        const batch = writeBatch(db);
        for (const ts of gwDoc.teams) {
          if (!ts.players?.length) continue;
          const playerPurchasePrices = purchasePricesForRestoredSnapshot(
            ts.players,
            ts.playerJoinedGameweek,
            marketPriceForId,
            listedPriceForId,
          );
          batch.update(doc(db, "teams", ts.uid), firestoreTeamFieldsFromGwSnapshot(ts, playerPurchasePrices));
        }
        await batch.commit();
      });
      clearedSavedTeamWireKeyRef.current = null;
      if (authUser && mySavedTeam) {
        const snap = gwTeamsArchive.find((g) => g.gameweek === lastGw)?.teams.find((t) => t.uid === authUser.uid);
        if (snap) {
          setBuilder(builderStateFromSavedTeam(gwSnapshotToSavedTeam(snap) as SavedTeam, playersById));
        }
      }
    } catch {
      /* runAction sets actionError */
    }
  }

  async function revertSquadsChangedAfterPricing() {
    const gw = PRE_DYNAMIC_PRICING_SNAPSHOT_GW;
    const preview = postPricingRevertPreview;
    if (preview.missingSnapshot) {
      setActionError(`No GW${gw} snapshot in gwTeams — cannot revert post-pricing squad changes.`);
      return;
    }
    if (preview.teams.length === 0) {
      setActionError(`Every squad already matches the GW${gw} snapshot. Nothing to revert.`);
      return;
    }
    const names = preview.teams.map((t) => t.name).join(", ");
    if (
      !window.confirm(
        `Revert ${preview.teams.length} team(s) to their GW${gw} squads (players, C/VC/WK, transfer state, opening purchase prices)?\n\n` +
          `${names}\n\n` +
          `League points are not changed. Managers who did not change after dynamic pricing are untouched.`,
      )
    ) {
      return;
    }
    setRevertPostPricingBusy(true);
    try {
      await runAction(`Revert post-pricing squads to GW${gw}`, async () => {
        const gwRef = doc(db, "gwTeams", String(gw));
        const gwSnap = await getDoc(gwRef);
        if (!gwSnap.exists()) throw new Error(`gwTeams/${gw} not found.`);
        const gwDoc = parseGwTeamsDoc(gwSnap.data() as Record<string, unknown>);
        if (!gwDoc?.teams.length) throw new Error(`GW${gw} snapshot has no teams.`);

        const revertUids = new Set(preview.teams.map((t) => t.uid));
        const batch = writeBatch(db);
        for (const ts of gwDoc.teams) {
          if (!revertUids.has(ts.uid) || !ts.players?.length) continue;
          const playerPurchasePrices = purchasePricesForRestoredSnapshot(
            ts.players,
            ts.playerJoinedGameweek,
            marketPriceForId,
            listedPriceForId,
          );
          batch.update(doc(db, "teams", ts.uid), firestoreTeamFieldsFromGwSnapshot(ts, playerPurchasePrices));
        }
        await batch.commit();
      });
      clearedSavedTeamWireKeyRef.current = null;
      if (authUser) {
        const snap = gwTeamsArchive
          .find((g) => g.gameweek === gw)
          ?.teams.find((t) => t.uid === authUser.uid);
        if (snap && preview.teams.some((t) => t.uid === authUser.uid)) {
          setBuilder(builderStateFromSavedTeam(gwSnapshotToSavedTeam(snap) as SavedTeam, playersById));
        }
      }
    } catch {
      /* runAction sets actionError */
    } finally {
      setRevertPostPricingBusy(false);
    }
  }

  async function undoLastGameweek() {
    if (currentGameweek <= 1) return;
    const gwToUndo = currentGameweek - 1;
    if (
      !window.confirm(
        `Undo ending GW${gwToUndo}? This restores GW${gwToUndo} as the active gameweek, puts that week’s player stats back on the admin table, reverses leaderboard totals for that round, and restores every saved squad to what it was when GW${gwToUndo} ended. Any GW${currentGameweek} stats or squad changes will be lost. Continue?`,
      )
    ) {
      return;
    }
    statsSavePendingRef.current = null;
    setUndoingGameweek(true);
    try {
      await runAction("Undo last gameweek", async () => {
        const gwRef = doc(db, "gwTeams", String(gwToUndo));
        const gwSnap = await getDoc(gwRef);
        if (!gwSnap.exists()) {
          throw new Error(
            `No squad snapshot for GW${gwToUndo}. Snapshots are saved when you End GW — older weeks cannot be undone this way.`,
          );
        }
        const gwDoc = parseGwTeamsDoc(gwSnap.data() as Record<string, unknown>);
        if (!gwDoc || gwDoc.teams.length === 0) {
          throw new Error(`GW${gwToUndo} snapshot is empty or invalid.`);
        }

        const sourcePlayers = unsavedStats ? localPlayers : players;
        const batch = writeBatch(db);

        for (const p of sourcePlayers) {
          const hist = [...(p.history ?? [])];
          const idx = hist.findIndex((h) => h.week === gwToUndo);
          if (idx === -1) continue;
          const rec = hist[idx];
          const newHist = hist.filter((_, i) => i !== idx);
          batch.update(doc(db, "players", String(p.id)), {
            runs: rec.runs,
            fours: rec.fours,
            sixes: rec.sixes,
            wickets: rec.wickets,
            maidens: rec.maidens,
            catches: rec.catches,
            wkCatches: rec.wkCatches,
            stumpings: rec.stumpings,
            runOuts: rec.runOuts,
            didNotBat: Boolean(rec.didNotBat),
            didNotPlay: Boolean(rec.didNotPlay),
            notOut: Boolean(rec.notOut),
            history: newHist,
          });
        }

        for (const ts of gwDoc.teams) {
          batch.update(doc(db, "teams", ts.uid), {
            name: ts.name,
            ownerName: ts.ownerName ?? null,
            players: [...ts.players],
            captain: ts.captain,
            viceCaptain: ts.viceCaptain,
            keeper: ts.keeper,
            cumulativePoints: ts.cumulativePointsBefore,
            transferBaselinePlayers: [...ts.transferBaselinePlayers],
            freeTransfersAtGwStart: ts.freeTransfersAtGwStart,
            transferPenaltyPointsApplied: ts.transferPenaltyPointsApplied ?? 0,
            playerJoinedGameweek: ts.playerJoinedGameweek ?? {},
          });
        }

        batch.set(doc(db, "gameState", "current"), { currentGameweek: gwToUndo }, { merge: true });
        await batch.commit();
      });
      setUnsavedStats(false);
      setLeaderboardGwView("live");
    } finally {
      setUndoingGameweek(false);
    }
  }

  async function resetSeasonStatsKeepSquads() {
    if (
      !window.confirm(
        "Starts a clean GW1 with 0 points for everyone: every team’s leaderboard “This week” and “Total” go to 0 (player stat rows cleared), cumulative scores and transfer hits reset — but each manager keeps the same squad, captain, and vice. Player pool is unchanged. Cannot be undone. Continue?",
      )
    ) {
      return;
    }
    statsSavePendingRef.current = null;
    try {
      await runAction("Season reset — keep squads", async () => {
        await resetAllPlayerDocumentsStats();
        await deleteAllGwTeamsDocs(db);

        const teamSnap = await getDocs(collection(db, "teams"));
        const writeLimit = 450;
        let batch = writeBatch(db);
        let ops = 0;
        const flush = async () => {
          if (ops === 0) return;
          await batch.commit();
          batch = writeBatch(db);
          ops = 0;
        };

        for (const d of teamSnap.docs) {
          const data = d.data() as Record<string, unknown>;
          const plist = Array.isArray(data.players)
            ? data.players.map((x) => Number(x)).filter((n) => Number.isFinite(n))
            : [];
          const patch: Record<string, unknown> = {
            cumulativePoints: 0,
            transferPenaltyPointsApplied: 0,
            freeTransfersAtGwStart: FREE_TRANSFERS_PER_WEEK,
            playerJoinedGameweek: {},
          };
          if (plist.length === SQUAD_SIZE) patch.transferBaselinePlayers = plist;
          batch.update(d.ref, patch);
          ops += 1;
          if (ops >= writeLimit) await flush();
        }

        batch.set(doc(db, "gameState", "current"), { currentGameweek: 1 }, { merge: true });
        ops += 1;
        await flush();
      });
      setUnsavedStats(false);
      setLeaderboardGwView("live");
    } catch {
      /* runAction already set actionError */
    }
  }

  async function resetSeasonPoints() {
    if (
      !window.confirm(
        "Clears every player’s stats and history, deletes EVERY saved fantasy team from Firebase, and sets the league to GW1. Custom-added players stay in the pool. Cannot be undone. Continue?",
      )
    ) {
      return;
    }
    statsSavePendingRef.current = null;
    try {
      await runAction("Reset stats & remove teams", async () => {
        await resetAllPlayerDocumentsStats();
        await deleteAllGwTeamsDocs(db);

        const teamSnap = await getDocs(collection(db, "teams"));
        const writeLimit = 450;
        let batch = writeBatch(db);
        let ops = 0;
        const flush = async () => {
          if (ops === 0) return;
          await batch.commit();
          batch = writeBatch(db);
          ops = 0;
        };

        for (const d of teamSnap.docs) {
          batch.delete(d.ref);
          ops += 1;
          if (ops >= writeLimit) await flush();
        }

        batch.set(doc(db, "gameState", "current"), { currentGameweek: 1 }, { merge: true });
        ops += 1;
        await flush();
      });
      setUnsavedStats(false);
      clearBuilder();
      setLeaderboardGwView("live");
      setTab("draft");
    } catch {
      /* runAction already set actionError */
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!authReady || (authUser && !fsReady)) {
    return (
      <div className="min-h-screen bg-[#080808] text-white flex items-center justify-center">
        <div className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10 text-center">
          <div className="text-base font-semibold">Loading…</div>
          <div className="mt-1 text-sm text-zinc-400">Connecting to Firebase.</div>
        </div>
      </div>
    );
  }

  if (!authUser) return null;

  return (
    <div className="min-h-screen bg-[#080808] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[600px] w-[900px] rounded-full bg-red-800/8 blur-[140px]" />
      </div>

      <div className="relative mx-auto w-full max-w-none px-3 pb-24 pt-6 sm:px-6 lg:px-8 sm:pb-10">

        {/* ── Header ── */}
        <header className="rounded-2xl border border-white/8 bg-zinc-900/60 px-4 py-4 backdrop-blur-md sm:px-6 sm:py-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-3">
              <div className="relative h-11 w-11 shrink-0 drop-shadow-lg">
                <Image src="/logo.png" alt="Nondies CC" fill className="object-contain" priority />
              </div>
              <div>
                <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{APP_NAME}</h1>
                <p className="mt-0.5 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                  GW{currentGameweek} · Oxford &amp; Bletchingdon Nondescripts
                </p>
                <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-600">
                  Made by <span className="font-semibold text-red-400">Hashim</span>
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-300">
              <Pill>Signed in as {accountHolderName(authUser)}</Pill>
              {fsError ? <Pill tone="amber">Sync issue: {fsError}</Pill> : null}
              {actionError ? <Pill tone="amber">{actionError}</Pill> : null}
              <Pill tone="red"><Users className="h-3.5 w-3.5" />{selectedCount}/{SQUAD_SIZE}</Pill>
              <span
                title={
                  usesPersonalSpendCap
                    ? `Your transfer cap = current saved squad spend at purchase prices (${money(draftBudget)})`
                    : dynamicBudget.floorCost != null
                      ? `Cap = cheapest legal squad (${money(dynamicBudget.floorCost)}) + ${money(dynamicBudget.headroom)} headroom`
                      : undefined
                }
              >
                <Pill tone={spend > draftBudget ? "red" : "neutral"}>
                  <span className="font-medium">{money(spend)}</span>
                  <span className="text-zinc-400">/ {money(draftBudget)}</span>
                </Pill>
              </span>
              <Pill tone={locked ? "amber" : "green"}>
                {locked ? <Lock className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                {locked ? `Locked (${formatLockTime(lockDate)})` : `Locks ${formatLockTime(lockDate)}`}
              </Pill>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:items-center sm:justify-end">
            <TabButton active={tab === "draft"} onClick={() => setTab("draft")} icon={<Shield className="h-4 w-4" />} label="Draft" />
            <TabButton active={tab === "leaderboard"} onClick={() => setTab("leaderboard")} icon={<Trophy className="h-4 w-4" />} label="Leaderboard" />
            <TabButton active={tab === "players"} onClick={() => setTab("players")} icon={<Users className="h-4 w-4" />} label="Players" />
            <TabButton active={tab === "admin"} onClick={() => setTab("admin")} icon={<Settings className="h-4 w-4" />} label="Admin" />
            <button type="button" onClick={() => void logout()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-medium text-zinc-300 ring-1 ring-white/10 hover:bg-white/10 hover:text-white transition"
              title="Sign out">
              <LogOut className="h-4 w-4" />
              <span className="hidden xl:inline">Sign out</span>
            </button>
            <Link href="/rules"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-medium text-zinc-300 ring-1 ring-white/10 hover:bg-white/10 hover:text-white transition"
              title="How to play">
              <span className="text-xs font-bold">?</span>
              <span className="hidden sm:inline">Rules</span>
            </Link>
            <Link href="/pavilion"
              className={[
                "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ring-1 transition",
                hasUnreadPavilion
                  ? "bg-red-600/20 text-red-100 ring-red-500/40 hover:bg-red-600/30"
                  : "bg-white/5 text-zinc-300 ring-white/10 hover:bg-white/10 hover:text-white",
              ].join(" ")}
              title="Pavilion chat">
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">Pavilion</span>
              {hasUnreadPavilion ? <span className="h-2 w-2 rounded-full bg-red-300" aria-label="Unread Pavilion messages" /> : null}
            </Link>
          </div>
        </header>

        {mySavedTeamBudgetIssue ? (
          <div className="mt-4">
            <SquadOverBudgetBanner
              spend={mySavedTeamBudgetIssue.spend}
              overBy={mySavedTeamBudgetIssue.overBy}
              budget={squadBudget}
              locked={locked}
              onOpenDraft={() => setTab("draft")}
            />
          </div>
        ) : null}

        {showPersonalSpendCapAnnouncement ? (
          <div className={mySavedTeamBudgetIssue ? "mt-3" : "mt-4"}>
            <PersonalSpendCapAnnouncement
              spendCap={personalSpendCap}
              onDismiss={dismissPersonalSpendCapNotice}
              onOpenDraft={() => setTab("draft")}
            />
          </div>
        ) : mySavedTeam && usesPersonalSpendCap && !pricingAmnestyActive ? (
          <div className={mySavedTeamBudgetIssue ? "mt-3" : "mt-4"}>
            <GrandfatheredSquadReminder spendCap={personalSpendCap!} />
          </div>
        ) : null}

        {pricingAmnestyActive ? (
          <div className={mySavedTeamBudgetIssue ? "mt-3" : "mt-4"}>
            <FreeSquadRebuildBanner
              gameweek={currentGameweek}
              locked={locked}
              onOpenDraft={() => setTab("draft")}
            />
          </div>
        ) : null}

        <main className="mt-6 grid gap-5 lg:grid-cols-12">

          {/* ── Draft tab ── */}
          {tab === "draft" ? (
            <>
              <section className="order-2 lg:order-1 lg:col-span-7">
                <Card>
                  <CardHeader title="Draft pool"
                    subtitle={
                      mySavedTeam && usesPersonalSpendCap
                        ? `${GRANDFATHERED_SQUAD_MESSAGE} Transfer cap ${money(draftBudget)} (your saved squad spend). New picks use dynamic prices (£${POOL_PRICE_BAND.min}–£${POOL_PRICE_BAND.max}).`
                        : mySavedTeam && isGrandfatheredPricingTeam(mySavedTeam)
                          ? `${GRANDFATHERED_SQUAD_MESSAGE} Draft pool shows dynamic prices (£${POOL_PRICE_BAND.min}–£${POOL_PRICE_BAND.max}) for anyone you add or swap in.`
                          : `Squad shape: ${SQUAD_ROLES.bat} batters, ${SQUAD_ROLES.ar} all-rounders, ${SQUAD_ROLES.bowl} bowlers, ${SQUAD_ROLES.wk} WK — cap ${money(squadBudget)} at current market prices (£${POOL_PRICE_BAND.min}–£${POOL_PRICE_BAND.max}). New teams must fit the full dynamic rules.`
                    }
                    right={
                      <div className="flex max-w-[16rem] flex-col items-end gap-2 sm:max-w-none">
                        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
                          <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)}
                            className="h-4 w-4 rounded border-white/20 bg-white/10 text-red-600 focus:ring-red-500/60" />
                          Available only
                        </label>
                        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
                          <input type="checkbox" checked={draftSquadOnly} onChange={(e) => setDraftSquadOnly(e.target.checked)}
                            className="h-4 w-4 rounded border-white/20 bg-white/10 text-red-600 focus:ring-red-500/60" />
                          My squad only
                        </label>
                      </div>
                    }
                  />
                  <CardBody>
                    <div className="flex flex-wrap gap-2">
                      {(["all", "1", "2"] as const).map((key) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setDraftTeamFilter(key)}
                          className={[
                            "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition",
                            draftTeamFilter === key
                              ? "bg-red-600 text-white ring-red-500/40"
                              : "bg-white/5 text-zinc-300 ring-white/10 hover:bg-white/10",
                          ].join(" ")}
                        >
                          {key === "all" ? "All squads" : key === "1" ? "1st XI only" : "2nd XI only"}
                        </button>
                      ))}
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <TextField value={search} onChange={setSearch} placeholder="Search players…"
                        right={<Search className="h-4 w-4 text-zinc-500" />} />
                      <div className="block sm:col-span-2 lg:col-span-1">
                        <div className="mb-1.5 text-xs font-medium text-zinc-300">Sort pool</div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <select
                            value={draftSortKey}
                            onChange={(e) => setDraftSortKey(e.target.value as DraftSortKey)}
                            className="min-w-0 flex-1 rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60"
                          >
                            <optgroup label="Roster">
                              <option value="id">Player ID</option>
                              <option value="name">Name</option>
                              <option value="role">Role</option>
                              <option value="teamTier">Squad (1st / 2nd XI)</option>
                              <option value="available">Listed available</option>
                              <option value="price">Price</option>
                              <option value="picked">Times picked (league)</option>
                            </optgroup>
                            <optgroup label="This gameweek stats">
                              <option value="runs">Runs</option>
                              <option value="fours">Fours</option>
                              <option value="sixes">Sixes</option>
                              <option value="wickets">Wickets</option>
                              <option value="maidens">Maidens</option>
                              <option value="catches">Catches</option>
                              <option value="wkCatches">WK catches</option>
                              <option value="stumpings">Stumpings</option>
                              <option value="runOuts">Run outs</option>
                              <option value="gwPoints">GW fantasy points</option>
                            </optgroup>
                            <optgroup label="Season">
                              <option value="seasonPts">Season Σ points</option>
                            </optgroup>
                          </select>
                          <select
                            value={draftSortDir}
                            onChange={(e) => setDraftSortDir(e.target.value as "asc" | "desc")}
                            className="w-full shrink-0 rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60 sm:w-36"
                            aria-label="Sort direction"
                          >
                            <option value="desc">High → low</option>
                            <option value="asc">Low → high</option>
                          </select>
                        </div>
                      </div>
                      <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10 sm:col-span-2 lg:col-span-1">
                        <div className="text-xs font-medium text-zinc-300">
                          {usesPersonalSpendCap ? "Your spend cap" : "Budget"}
                        </div>
                        <div className="mt-2 flex items-baseline justify-between gap-3">
                          <div className="text-sm text-zinc-200">
                            <span className="font-semibold text-white">{money(spend)}</span>{" "}
                            <span className="text-zinc-400">/ {money(draftBudget)}</span>
                          </div>
                          <div className="text-xs text-zinc-500">{Math.round(budgetPct)}%</div>
                        </div>
                        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                          <div className={["h-2 rounded-full", spend > draftBudget ? "bg-red-500" : "bg-red-600"].join(" ")} style={{ width: `${budgetPct}%` }} />
                        </div>
                      </div>
                    </div>

                    {locked && (
                      <div className="mt-4 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200 ring-1 ring-amber-500/30">
                        <div className="flex items-start gap-2">
                          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <div className="font-semibold">Selection locked after {LINEUP_LOCK_SUMMARY} (your time).</div>
                            <div className="mt-1 text-amber-200/80">Ask an admin to end the gameweek after the weekend.</div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 divide-y divide-white/10 overflow-hidden rounded-2xl ring-1 ring-white/10">
                      {players.length === 0 ? (
                        <div className="p-4 text-sm text-zinc-400">
                          There are no players in Firestore yet (or the roster was cleared). League admins should open{" "}
                          <strong className="text-zinc-200">Admin → Player stats</strong> to add players or run a season reset. Everyone sees the same pool once documents exist in the{" "}
                          <code className="rounded bg-white/10 px-1 font-mono text-xs">players</code> collection.
                        </div>
                      ) : filteredPlayers.length === 0 ? (
                        <div className="p-4 text-sm text-zinc-400">
                          {draftSquadOnly && selectedCount === 0
                            ? "Add players from the full pool first — then turn on “My squad only” to focus on your picks."
                            : draftSquadOnly
                              ? "No one in your current squad matches search / squad filters."
                              : "No players match your search or filters."}
                        </div>
                      ) : filteredPlayers.map((p) => {
                        const selected = builder.selected.includes(p.id);
                        const wouldBust =
                          !selected &&
                          squadSpend(
                            [...builder.selected, p.id],
                            draftPurchasePricesForSelection(
                              [...builder.selected, p.id],
                              mySavedTeam,
                              marketPriceForId,
                              listedPriceForId,
                            ),
                            marketPriceForId,
                          ) > draftBudget;
                        const full = !selected && selectedCount >= SQUAD_SIZE;
                        const roleFull = !selected && !canAddPlayerForRoles(p.id, builder.selected, playersById);
                        const disabled = locked || !p.available || wouldBust || full || roleFull;
                        const pickCount = ownership.get(p.id) ?? 0;
                        const ownershipPct = teams.length > 0 ? Math.round((pickCount / teams.length) * 100) : 0;
                        const seasonStats = seasonCricketStatsFromHistory(p.history);
                        const seasonFantasy = seasonFantasyBreakdownFromHistory(p.history);

                        return (
                          <div
                            key={p.id}
                            role="button"
                            tabIndex={disabled ? -1 : 0}
                            onClick={() => {
                              if (!disabled) toggleSelected(p.id);
                            }}
                            onKeyDown={(e) => {
                              if (disabled) return;
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggleSelected(p.id);
                              }
                            }}
                            className={["flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-red-500/50",
                              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-white/5",
                              selected ? "border-l-4 border-l-red-500 bg-red-600/10" : "border-l-4 border-l-transparent"].join(" ")}
                          >
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold text-white">{p.name}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                                  <PriceWithForm price={p.price} basePrice={p.basePrice} priceDelta={p.priceDelta} />
                                  <span className="text-zinc-600">•</span>
                                  <span>{seasonStats.runs} runs</span>
                                  <span className="text-zinc-600">•</span>
                                  <span>{seasonStats.wickets} wkts</span>
                                  <span className="text-zinc-600">•</span>
                                  <span>{seasonStats.innings} inns</span>
                                  <span className="text-zinc-600">•</span>
                                  <span>{seasonStats.notOuts} NO</span>
                                  <span className="text-zinc-600">•</span>
                                  <span className="font-medium text-emerald-200">
                                    Σ {seasonFantasy.total} pts
                                  </span>
                                  <span className="text-zinc-600">•</span>
                                  <span className="text-zinc-400">
                                    Avg {seasonStats.average === null ? "—" : seasonStats.average.toFixed(2)}
                                  </span>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <Pill tone="amber">{ROLE_LABEL[p.role]}</Pill>
                                  <Pill tone={p.teamTier === 1 ? "blue" : "neutral"}>{TEAM_TIER_SHORT[p.teamTier]}</Pill>
                                  {p.available ? <Pill tone="green">Available</Pill> : <Pill tone="amber">Unavailable</Pill>}
                                  <Pill tone={teams.length > 0 && ownershipPct >= 50 ? "amber" : "neutral"}>
                                    {teams.length > 0 ? `${pickCount}/${teams.length} (${ownershipPct}%)` : "0 picked"}
                                  </Pill>
                                  {wouldBust ? <Pill tone="red">Over budget</Pill> : null}
                                  {full ? <Pill tone="red">Squad full</Pill> : null}
                                  {roleFull ? <Pill tone="red">Role full</Pill> : null}
                                </div>
                                {p.history.length > 0 && <div className="mt-2"><FormDots history={p.history} /></div>}
                              </div>
                            {selected ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!locked) toggleSelected(p.id);
                                }}
                                disabled={locked}
                                className="shrink-0 rounded-xl bg-red-600/90 px-3 py-2 text-xs font-bold text-white ring-1 ring-red-500/50 hover:bg-red-500 disabled:opacity-50"
                              >
                                Remove
                              </button>
                            ) : (
                              <span className="shrink-0 inline-flex items-center justify-center rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 ring-1 ring-white/10">
                                Add
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardBody>
                </Card>
              </section>

              <section className="order-1 lg:order-2 lg:col-span-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
                <Card>
                  <CardHeader title={`Your squad (${SQUAD_SIZE})`} subtitle={`Pick order below. Use Draft pool → “My squad only” to focus on changes. Shape ${SQUAD_ROLES.bat}-${SQUAD_ROLES.ar}-${SQUAD_ROLES.bowl}-${SQUAD_ROLES.wk} — then C, VC, WK (WK only on a WK-listed player).${currentGameweek > 1 ? " GW2+: saves use free transfers and point hits for extras; managers who first save this gameweek get unlimited edits until lineup lock." : ""}`}
                    right={
                      <button type="button" onClick={clearBuilder} disabled={locked && selectedCount > 0}
                        className="rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-60">
                        Clear
                      </button>
                    }
                  />
                  <CardBody>
                    <div className="grid gap-3">
                      {authUser ? (
                        <TransferImpactPanel
                          currentGameweek={currentGameweek}
                          selectedCount={selectedCount}
                          freeAtLock={freeTransfersAtLock}
                          preview={transferSavePreview}
                          rules={transferRulesFootnote}
                          locked={locked}
                        />
                      ) : null}

                      <TextField
                        value={ownerNameInput}
                        onChange={(v) => {
                          setOwnerNameInput(v);
                          setOwnerNameTouched(true);
                        }}
                        placeholder="Owner name shown on leaderboard"
                        label="Owner name"
                      />
                      <TextField value={builder.teamName} onChange={(v) => setBuilder((p) => ({ ...p, teamName: v }))}
                        placeholder="Team name (e.g., Captain's XI)" label="Team name" />

                      <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs font-medium text-zinc-300">Validation</div>
                          <Pill tone={validation.ok ? "green" : "amber"}>{validation.ok ? "Ready to save" : "Incomplete"}</Pill>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm">
                          {[
                            ["Players", `${selectedCount}/${SQUAD_SIZE}`, validation.checks.count],
                            [
                              "Shape",
                              `Bat ${draftRoleCounts.bat}/${SQUAD_ROLES.bat} · AR ${draftRoleCounts.ar}/${SQUAD_ROLES.ar} · Bowl ${draftRoleCounts.bowl}/${SQUAD_ROLES.bowl} · WK ${draftRoleCounts.wk}/${SQUAD_ROLES.wk}${
                                PROVISIONAL_SQUAD_SHAPE && !squadCompositionOk(builder.selected, playersById) && selectedCount === SQUAD_SIZE
                                  ? " · provisional OK"
                                  : ""
                              }`,
                              PROVISIONAL_SQUAD_SHAPE ? true : validation.checks.composition,
                            ],
                            ["Budget", `${money(validation.spend)} / ${money(draftBudget)}`, validation.checks.withinBudget],
                            ["Captain", builder.captain ? "Selected" : "Missing", validation.checks.captain],
                            ["Vice-captain", builder.viceCaptain ? "Selected" : "Missing", validation.checks.viceCaptain],
                            ["Wicketkeeper", builder.keeper ? "On WK player" : "Missing", validation.checks.keeper],
                            ["Availability", validation.checks.allAvailable ? "OK" : "Issue", validation.checks.allAvailable],
                          ].map(([label, val, ok]) => (
                            <div key={String(label)} className="flex items-center justify-between">
                              <span className="text-zinc-300">{label}</span>
                              <span className={ok ? "text-emerald-200" : "text-amber-200"}>{val}</span>
                            </div>
                          ))}
                        </div>
                        {!validation.ok && validation.problems.length > 0 && (
                          <div className="mt-3 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200 ring-1 ring-amber-500/30">
                            <ul className="list-disc space-y-1 pl-4 text-amber-200/90">
                              {validation.problems.slice(0, 8).map((prob) => <li key={prob}>{prob}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>

                      <div className="divide-y divide-white/10 overflow-hidden rounded-2xl ring-1 ring-white/10">
                        {selectedInPickOrder.length === 0 ? (
                          <div className="p-4 text-sm text-zinc-400">Pick players from the pool to build your squad.</div>
                        ) : selectedInPickOrder.map((p) => {
                          const isC = builder.captain === p.id;
                          const isVC = builder.viceCaptain === p.id;
                          const isWK = builder.keeper === p.id;
                          return (
                            <div key={p.id} className="px-4 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-white">{p.name}</div>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                                    <Pill tone="amber">{ROLE_LABEL[p.role]}</Pill>
                                    <Pill tone={p.teamTier === 1 ? "blue" : "neutral"}>{TEAM_TIER_SHORT[p.teamTier]}</Pill>
                                    <PriceWithForm price={p.price} basePrice={p.basePrice} priceDelta={p.priceDelta} />
                                    {transferBaselineSet && !transferBaselineSet.has(p.id) ? (
                                      <Pill tone="green">Transfer in</Pill>
                                    ) : null}
                                    {!p.available && <Pill tone="amber">Unavailable</Pill>}
                                  </div>
                                  <div className="mt-2 flex gap-2">
                                    {(["captain", "viceCaptain", "keeper"] as const).map((roleBtn) => {
                                      const active = roleBtn === "captain" ? isC : roleBtn === "viceCaptain" ? isVC : isWK;
                                      const disabledRole =
                                        locked
                                        || (roleBtn === "captain" && isVC)
                                        || (roleBtn === "viceCaptain" && isC)
                                        || (roleBtn === "keeper" && p.role !== "wk");
                                      const label = roleBtn === "captain" ? "C" : roleBtn === "viceCaptain" ? "VC" : "WK";
                                      const activeColor = roleBtn === "captain" ? "bg-red-600 text-white ring-red-500/40"
                                        : roleBtn === "viceCaptain" ? "bg-amber-500 text-black ring-amber-400/50"
                                        : "bg-sky-500 text-black ring-sky-400/50";
                                      return (
                                        <button key={roleBtn} type="button" onClick={() => setRole(roleBtn, p.id)}
                                          disabled={!!disabledRole}
                                          className={["rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition",
                                            active ? activeColor : "bg-white/5 text-zinc-200 ring-white/10 hover:bg-white/10",
                                            disabledRole ? "opacity-60" : ""].join(" ")}>
                                          {label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                                <button type="button" onClick={() => toggleSelected(p.id)} disabled={locked}
                                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-red-600/15 px-3 py-2 text-xs font-bold text-red-200 ring-1 ring-red-500/35 hover:bg-red-600/25 disabled:opacity-50">
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                  Remove
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {validation.ok &&
                      transferSavePreview?.kind === "returning" &&
                      transferSavePreview.extras > 0 &&
                      !locked ? (
                        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100 ring-1 ring-amber-500/30">
                          Confirm save: this costs <strong className="text-amber-50">−{transferSavePreview.penaltyDue} league points</strong> (
                          {transferSavePreview.extras} extra transfer{transferSavePreview.extras === 1 ? "" : "s"} at −{POINTS_PER_EXTRA_TRANSFER} each).
                        </div>
                      ) : null}

                      <button type="button" onClick={() => void saveTeam()} disabled={locked || !validation.ok || savingTeam}
                        className={["rounded-2xl px-4 py-3 text-sm font-bold transition ring-1",
                          locked || !validation.ok || savingTeam
                            ? "bg-white/5 text-zinc-400 ring-white/10"
                            : transferSavePreview?.kind === "returning" && transferSavePreview.extras > 0
                              ? "bg-amber-600 text-white ring-amber-500/50 hover:bg-amber-500"
                              : "bg-red-600 text-white ring-red-500/40 hover:bg-red-500"].join(" ")}>
                        {saveTeamButtonLabel}
                      </button>
                      <div className="text-xs text-zinc-500">
                        Transfer summary above updates as you add or remove players. Saving merges into Firebase; league total includes transfer hits.
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </section>
            </>
          ) : null}

          {/* ── Leaderboard tab ── */}
          {tab === "leaderboard" ? (
            <section className="lg:col-span-12">
              <Card>
                <CardHeader
                  title={`Leaderboard — ${leaderboardViewLabel}`}
                  subtitle={
                    leaderboardGwView === "live"
                      ? "Total = cumulative points across completed gameweeks plus this week. Last login updates when managers open the app. Squads needing a fix are sorted to the bottom."
                      : "Archived squads from when this gameweek was ended. Totals include points through this week."
                  }
                />
                <CardBody>
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <label className="block flex-1 sm:max-w-xs">
                      <div className="mb-1.5 text-xs font-medium text-zinc-400">Gameweek</div>
                      <select
                        value={leaderboardGwView === "live" ? "live" : String(leaderboardGwView)}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLeaderboardGwView(v === "live" ? "live" : Number(v));
                        }}
                        className="w-full rounded-xl bg-white/5 px-3 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60"
                        aria-label="Select gameweek to view"
                      >
                        <option value="live">Live — GW{currentGameweek}</option>
                        {completedGameweeks.map((gw) => (
                          <option key={gw} value={String(gw)}>
                            GW{gw} — archived squads
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {gwBestXi.players.length > 0 ? (
                    <div className="mb-4 rounded-2xl bg-amber-500/10 p-4 ring-1 ring-amber-500/30 sm:p-5">
                      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300/90">
                            Best XI — GW{gwBestXi.gameweek}
                            {gwBestXi.provisional ? " (provisional)" : ""}
                          </div>
                          <p className="mt-1 text-sm text-amber-100/75">
                            Top {BEST_XI_SIZE} individual fantasy scorers this gameweek (raw player points, no captain boost).
                          </p>
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {gwBestXi.players.map((p, idx) => (
                          <div
                            key={p.id}
                            className="flex items-center justify-between gap-3 rounded-xl bg-zinc-950/50 px-3 py-2.5 ring-1 ring-white/10"
                          >
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-xs font-bold text-amber-100 ring-1 ring-amber-500/30">
                                {idx + 1}
                              </span>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-white">{p.name}</div>
                                <div className="text-xs text-zinc-400">{ROLE_LABEL[p.role]}</div>
                              </div>
                            </div>
                            <div className="shrink-0 text-right text-sm font-bold text-amber-100">{p.points}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {gwBestXiHistory.length > 0 ? (
                    <div className="mb-4 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Past best XI (top scorer)</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {gwBestXiHistory.map((row) => (
                          <button
                            key={row.gameweek}
                            type="button"
                            onClick={() => setLeaderboardGwView(row.gameweek)}
                            className={[
                              "rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition",
                              leaderboardGwView === row.gameweek
                                ? "bg-red-600/25 text-red-100 ring-red-500/40"
                                : "bg-zinc-950/60 text-zinc-300 ring-white/10 hover:bg-white/10",
                            ].join(" ")}
                          >
                            GW{row.gameweek}: {row.topName} ({row.topPoints})
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {overallRankMaps.compareGw != null ? (
                    <p className="mb-3 text-xs text-zinc-500">
                      Overall ladder movement vs end of GW{overallRankMaps.compareGw}. Archived weeks also sort by GW points — overall rank shows season position.
                    </p>
                  ) : null}

                  {leaderboardGwView === "live" && teamsNeedingFix.length > 0 ? (
                    <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3.5 text-sm text-amber-100 ring-1 ring-amber-500/30">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
                        <div>
                          <div className="font-semibold text-amber-50">
                            {teamsNeedingFix.length} team{teamsNeedingFix.length === 1 ? "" : "s"} need to fix their squad
                          </div>
                          <p className="mt-1 leading-relaxed text-amber-100/90">
                            New teams must fit the dynamic cap. Wrong 2-2-2-1 shape is allowed provisionally — squads still score. Original season squads are not flagged below.
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {teamsNeedingFix.map((row) => (
                              <span
                                key={row.team.uid}
                                className="rounded-full bg-amber-950/50 px-2.5 py-1 text-xs font-medium text-amber-100 ring-1 ring-amber-500/25"
                              >
                                {row.team.name}
                                {row.health?.labels.length ? ` · ${row.health.labels[0]}` : ""}
                                {" · "}
                                last login {formatLastLogin(lastLoginByUid.get(row.team.uid), lastLoginNowMs)}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {displayedLeaderboard.length === 0 ? (
                    <div className="rounded-2xl bg-white/5 p-6 text-center ring-1 ring-white/10">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-600/15 ring-1 ring-red-500/30">
                        <Trophy className="h-6 w-6 text-red-300" />
                      </div>
                      <div className="mt-3 text-base font-semibold">
                        {leaderboardGwView === "live" ? "No teams yet" : `No squads archived for GW${leaderboardGwView}`}
                      </div>
                      <div className="mt-1 text-sm text-zinc-400">
                        {leaderboardGwView === "live"
                          ? "Save your squad to appear here."
                          : "This gameweek was ended before squad snapshots were enabled, or no teams existed then."}
                      </div>
                      {leaderboardGwView === "live" ? (
                        <button type="button" onClick={() => setTab("draft")} className="mt-4 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-red-500/40 hover:bg-red-500">
                          Start drafting
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {displayedLeaderboard.map((row, idx) => {
                        const movement = rankMovement(
                          overallRankMaps.current,
                          overallRankMaps.previous,
                          row.team.uid,
                        );
                        const weekRank = idx + 1;
                        return (
                        <div key={row.team.uid} className={["rounded-2xl p-4 ring-1 sm:p-5",
                          row.team.uid === authUser.uid ? "bg-red-600/8 ring-red-500/20" : "bg-white/5 ring-white/10",
                          row.health && !row.health.ok ? "border border-amber-500/25" : ""].join(" ")}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                {leaderboardGwView !== "live" ? (
                                  <Pill tone={weekRank === 1 ? "green" : "neutral"}>GW #{weekRank}</Pill>
                                ) : null}
                                {leaderboardGwView === "live" && row.health && !row.health.ok ? (
                                  <Pill tone="amber">Fix squad</Pill>
                                ) : null}
                                {leaderboardGwView === "live" && row.health?.ok && isGrandfatheredPricingTeam(row.team) ? (
                                  <Pill tone="neutral">Original squad</Pill>
                                ) : null}
                                <RankMovementPill
                                  overallRank={movement.overallRank}
                                  previousRank={movement.previousRank}
                                  delta={movement.delta}
                                  compareGw={overallRankMaps.compareGw}
                                />
                                <div className="truncate text-lg font-bold">{row.team.name}</div>
                                {row.team.uid === authUser.uid && <Pill tone="blue">You</Pill>}
                              </div>
                              <div className="mt-1 text-xs text-zinc-400">
                                Owner{" "}
                                <span className="font-semibold text-zinc-200">
                                  {resolveOwnerDisplayName(row.team, authUser)}
                                </span>
                                <span className="text-zinc-500">
                                  {" · "}
                                  Last login{" "}
                                  <span className="font-medium text-zinc-300">
                                    {formatLastLogin(lastLoginByUid.get(row.team.uid), lastLoginNowMs)}
                                  </span>
                                </span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                <Pill><span className="text-zinc-400">Captain</span>{" "}<span className="font-semibold">{row.capName}</span></Pill>
                                <Pill><span className="text-zinc-400">VC</span>{" "}<span className="font-semibold">{row.vcName}</span></Pill>
                                {row.fieldingLabel ? (
                                  <Pill tone="green">
                                    <span className="text-zinc-400">Fielding</span>{" "}
                                    <span className="font-semibold">{row.fieldingLabel}</span>
                                  </Pill>
                                ) : null}
                                {leaderboardGwView === "live" && row.health && !row.health.ok ? (
                                  row.health.labels.map((label) => (
                                    <Pill key={label} tone="red">
                                      {label}
                                    </Pill>
                                  ))
                                ) : null}
                              </div>
                            </div>
                            <div className="shrink-0 flex items-end gap-5 sm:flex-col sm:items-end sm:gap-1">
                              <div className="text-right">
                                <div className="text-xs font-medium text-zinc-500">
                                  {leaderboardGwView === "live" ? "This week" : "GW points"}
                                </div>
                                <div className="text-xl font-bold text-zinc-200">{row.weekPts}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs font-medium text-zinc-400">Total</div>
                                <div className="text-3xl font-black tracking-tight text-white">{row.total}</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => setTeamModal(row.team)}
                                className="rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10"
                              >
                                View squad
                              </button>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </CardBody>
              </Card>
            </section>
          ) : null}

          {tab === "players" ? (
            <section className="lg:col-span-12">
              <Card>
                <CardHeader
                  title="Player points"
                  subtitle="Cumulative season view. Bat / Bowl / Fld are season fantasy points (Fld = outfield catches + WK catches + stumpings + run-outs). Captain boosts apply on the team leaderboard, not here."
                />
                <CardBody>
                  <PlayerCompareCharts players={players} currentGameweek={currentGameweek} />

                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="text-xs text-zinc-400">
                      <span className="font-semibold text-zinc-200">Scoring:</span>{" "}
                      1 run = 1 pt, 4 = +1, 6 = +2, run milestones 25/50/75/100 = +15/+26/+32/+42, 1 wicket = 15 pts, maiden = +4, haul bonuses 3–10 wkts = +8 to +60, outfield catch = 8, WK catch = 10, stumping = 12, run-out = 10. Bat and bowl tuned so a great week in either discipline lands near ~90–115 pts.{" "}
                      <span className="text-zinc-500">
                        Column groups separate roster, batting stats, bowling stats, fielding &amp; WK stats, then GW fantasy breakdown (Bat / Bowl / Fld) before season Σ and total GW.
                      </span>
                    </div>
                    <div className="flex w-full shrink-0 flex-col gap-2 sm:max-w-md sm:flex-row">
                      <select
                        value={playersTabSortKey}
                        onChange={(e) => setPlayersTabSortKey(e.target.value as DraftSortKey)}
                        className="min-w-0 flex-1 rounded-xl bg-white/5 px-3 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60"
                        aria-label="Sort players table"
                      >
                        <optgroup label="Roster">
                          <option value="id">Player ID</option>
                          <option value="name">Name</option>
                          <option value="role">Role</option>
                          <option value="teamTier">Squad</option>
                          <option value="price">Price</option>
                          <option value="picked">Times picked</option>
                        </optgroup>
                        <optgroup label="Cumulative">
                          <option value="runs">Runs</option>
                          <option value="highScore">High score (HS)</option>
                          <option value="fours">Fours</option>
                          <option value="sixes">Sixes</option>
                          <option value="wickets">Wickets</option>
                          <option value="bestBowling">Best bowling (BB)</option>
                          <option value="maidens">Maidens</option>
                          <option value="catches">Catches</option>
                          <option value="wkCatches">WK catches</option>
                          <option value="stumpings">Stumpings</option>
                          <option value="runOuts">Run outs</option>
                          <option value="gwPoints">Fantasy points</option>
                        </optgroup>
                        <optgroup label="Season">
                          <option value="seasonPts">Season Σ</option>
                          <option value="playedGws">GWs played</option>
                        </optgroup>
                      </select>
                      <select
                        value={playersTabSortDir}
                        onChange={(e) => setPlayersTabSortDir(e.target.value as "asc" | "desc")}
                        className="w-full rounded-xl bg-white/5 px-3 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60 sm:w-36"
                        aria-label="Players table sort direction"
                      >
                        <option value="desc">High → low</option>
                        <option value="asc">Low → high</option>
                      </select>
                      <label className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm text-zinc-300 ring-1 ring-white/10 sm:whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={hideInactivePlayers}
                          onChange={(e) => setHideInactivePlayers(e.target.checked)}
                          className="rounded border-white/20 bg-zinc-900 text-red-600 focus:ring-red-500/60"
                        />
                        Hide inactive
                      </label>
                    </div>
                  </div>
                  <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/10">
                    <div className="max-h-[min(75vh,52rem)] overflow-auto bg-zinc-950/40">
                      <table className="min-w-[1380px] w-full border-collapse">
                        <thead className="text-xs font-semibold text-zinc-300">
                          <tr>
                            <PlayersSortTh label="Player" colKey="name" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky left-0 top-0 z-40 bg-zinc-950 text-left shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="Role" colKey="role" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-left shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="Squad" colKey="teamTier" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-left shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="Price" colKey="price" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label={<><div className="text-[10px] font-bold uppercase tracking-wider text-sky-400/90">Batting</div><div className="mt-1 text-zinc-200">Runs</div></>} colKey="runs" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 border-l border-white/15 bg-zinc-950 text-right align-bottom shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="HS" colKey="highScore" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="4s" colKey="fours" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="6s" colKey="sixes" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label={<><div className="text-[10px] font-bold uppercase tracking-wider text-amber-400/90">Bowling</div><div className="mt-1 text-zinc-200">Wkts</div></>} colKey="wickets" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 border-l border-white/15 bg-zinc-950 text-right align-bottom shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="BB" colKey="bestBowling" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="Maid" colKey="maidens" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label={<><div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/90">Fielding</div><div className="mt-1 text-zinc-200">Catches</div></>} colKey="catches" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 border-l border-white/15 bg-zinc-950 text-right align-bottom shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="WK c." colKey="wkCatches" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="Stump." colKey="stumpings" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="RO" colKey="runOuts" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label={<><div className="text-[10px] font-bold uppercase tracking-wider text-white/70">Fantasy</div><div className="mt-1 text-zinc-200">Bat</div></>} colKey="batPts" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 border-l border-white/15 bg-zinc-950 text-right align-bottom shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="Bowl" colKey="bowlPts" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="Fld" colKey="fieldPts" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="Σ pts" colKey="seasonPts" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 border-l border-white/15 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="Inns" colKey="innings" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="NO" colKey="notOuts" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="Avg" colKey="average" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10 text-sm text-zinc-100">
                          {playerPoints.map(({ player: p, season }) => {
                            const seasonFantasy = seasonFantasyBreakdownFromHistory(p.history);
                            return (
                              <tr key={p.id}>
                                <td className="sticky left-0 z-30 bg-zinc-950 px-4 py-3 font-semibold text-white shadow-[1px_0_0_0_rgba(255,255,255,0.06)]">{p.name}</td>
                                <td className="px-4 py-3 text-zinc-300">{ROLE_LABEL[p.role]}</td>
                                <td className="px-4 py-3 text-zinc-300">{TEAM_TIER_SHORT[p.teamTier]}</td>
                                <td className="px-4 py-3 text-right text-zinc-200">
                                  <PriceWithForm price={p.price} basePrice={p.basePrice} priceDelta={p.priceDelta} />
                                </td>
                                <td className="border-l border-white/10 px-4 py-3 text-right text-zinc-200">{season.runs}</td>
                                <td className="px-4 py-3 text-right text-zinc-200">{season.highScore}</td>
                                <td className="px-4 py-3 text-right text-zinc-200">{season.fours}</td>
                                <td className="px-4 py-3 text-right text-zinc-200">{season.sixes}</td>
                                <td className="border-l border-white/10 px-4 py-3 text-right text-zinc-200">{season.wickets}</td>
                                <td className="px-4 py-3 text-right text-zinc-200">{season.bestBowlingWkts}/{season.bestBowlingMaidens}</td>
                                <td className="px-4 py-3 text-right text-zinc-200">{season.maidens}</td>
                                <td className="border-l border-white/10 px-4 py-3 text-right text-zinc-200">{season.catches}</td>
                                <td className="px-4 py-3 text-right text-zinc-200">{season.wkCatches}</td>
                                <td className="px-4 py-3 text-right text-zinc-200">{season.stumpings}</td>
                                <td className="px-4 py-3 text-right text-zinc-200">{season.runOuts}</td>
                                <td className="border-l border-white/10 px-4 py-3 text-right font-medium text-sky-200/95">{seasonFantasy.batting}</td>
                                <td className="px-4 py-3 text-right font-medium text-amber-200/95">{seasonFantasy.bowling}</td>
                                <td className="px-4 py-3 text-right font-medium text-emerald-200/95">{seasonFantasy.fielding}</td>
                                <td className="border-l border-white/10 px-4 py-3 text-right font-semibold text-emerald-200">
                                  {sumSeasonPointsFromHistory(p.history)}
                                </td>
                                <td className="px-4 py-3 text-right text-zinc-300">{season.innings}</td>
                                <td className="px-4 py-3 text-right text-zinc-300">{season.notOuts}</td>
                                <td className="px-4 py-3 text-right font-semibold text-sky-200">
                                  {season.average == null ? "—" : season.average.toFixed(2)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </section>
          ) : null}

          {/* ── Admin tab ── */}
          {tab === "admin" ? (
            <section className="lg:col-span-12">
              <Card>
                <CardHeader title="Admin"
                  subtitle="The draft pool and leaderboard read live from Firestore for every signed-in user. Add/delete player and bulk availability apply immediately. Stat cells update everyone only after you click Save stats — End gameweek uses the numbers currently in this table (including unsaved cells)."
                  right={adminAuthed ? (
                    <button type="button" onClick={adminLogout}
                      className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10">
                      <LogOut className="h-4 w-4" />Logout
                    </button>
                  ) : null}
                />
                <CardBody>
                  {!adminAuthed ? (
                    <div className="mx-auto max-w-md">
                      <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-red-600/15 ring-1 ring-red-500/30">
                            <Settings className="h-5 w-5 text-red-300" />
                          </div>
                          <div>
                            <div className="text-base font-semibold">Admin login</div>
                            <div className="mt-1 text-sm text-zinc-400">Enter the PIN to manage players and end the gameweek.</div>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3">
                          <label className="block">
                            <div className="mb-1.5 text-xs font-medium text-zinc-300">PIN</div>
                            <input ref={pinInputRef} value={pin} onChange={(e) => setPin(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && adminLogin()}
                              type="password" inputMode="numeric" placeholder="••••"
                              className="w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60" />
                          </label>
                          <button type="button" onClick={adminLogin}
                            className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-red-500/40 hover:bg-red-500">
                            Login
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-6">

                      <div className="rounded-2xl bg-sky-500/10 px-4 py-3 text-xs leading-relaxed text-sky-100 ring-1 ring-sky-500/25 break-words">
                        <div className="font-semibold text-sky-50">Firebase league admin (required for End GW, Save stats, reset)</div>
                        <p className="mt-1 text-sky-200/90">
                          The PIN only unlocks this screen. Firestore also needs your account marked as league admin: in{" "}
                          <span className="font-medium text-white">Firebase Console → Firestore → Start collection</span>, create collection{" "}
                          <code className="rounded bg-black/30 px-1 font-mono text-[11px]">leagueAdmins</code>, add a document whose ID is{" "}
                          <strong>your user id</strong> (copy below), leave the document empty or add a dummy field. Publish updated{" "}
                          <code className="rounded bg-black/30 px-1 font-mono text-[11px]">firestore.rules</code> if you have not already.
                        </p>
                        <p className="mt-2 font-mono text-[11px] text-white break-all">UID: {authUser.uid}</p>
                        <p className="mt-1 font-mono text-[11px] text-sky-200/90 break-all">
                          Firebase project: {firebaseProjectId}
                        </p>
                        <button
                          type="button"
                          onClick={() => void runAdminAccessProbe()}
                          disabled={adminAccessProbing}
                          className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/15 hover:bg-white/15 disabled:opacity-50"
                        >
                          {adminAccessProbing ? "Testing…" : "Test Firestore admin access"}
                        </button>
                        {adminAccessProbe ? (
                          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 font-mono text-[10px] text-sky-100">
                            {adminAccessProbe}
                          </pre>
                        ) : null}
                      </div>

                      <div className="rounded-xl bg-white/[0.04] px-4 py-3 text-xs leading-relaxed text-zinc-400 ring-1 ring-white/10">
                        <span className="font-semibold text-zinc-200">Transfer policy</span> (enforced on save; rollover on End GW):{" "}
                        <strong className="text-zinc-300">GW1 pre-lock = unlimited free changes</strong>, then{" "}
                        <strong className="text-zinc-300">{FREE_TRANSFERS_PER_WEEK}</strong> free player changes per gameweek, up to{" "}
                        <strong className="text-zinc-300">{MAX_BANKED_FREE_TRANSFERS}</strong> banked, max{" "}
                        <strong className="text-zinc-300">{MAX_FREE_TRANSFERS_IN_GW}</strong> free in hand, then{" "}
                        <strong className="text-zinc-300">−{POINTS_PER_EXTRA_TRANSFER}</strong> league points per extra change. Tunables in{" "}
                        <code className="rounded bg-black/30 px-1 font-mono text-[11px] text-zinc-300">lib/leagueConfig.ts</code>.
                      </div>

                      <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3.5 text-sm text-emerald-100 ring-1 ring-emerald-500/25">
                        <div className="font-semibold text-emerald-50">Pricing update · free squad rebuild</div>
                        <p className="mt-1.5 leading-relaxed text-emerald-100/90">
                          Lets every manager change their full 7 this gameweek with no transfer penalties (until lineup lock) and posts the notice to the{" "}
                          <strong className="text-white">Pavilion</strong>. Budget cap still applies — squads over cap must be fixed before save.
                        </p>
                        {pricingAmnestyActive ? (
                          <p className="mt-2 text-xs font-medium text-emerald-200">Active for GW{currentGameweek}.</p>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void enablePricingAmnestyAndNotify()}
                          disabled={pricingAmnestyBusy}
                          className="mt-3 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white ring-1 ring-emerald-500/50 hover:bg-emerald-500 disabled:opacity-50"
                        >
                          {pricingAmnestyBusy
                            ? "Working…"
                            : pricingAmnestyActive
                              ? "Post Pavilion notice again"
                              : `Enable free rebuild GW${currentGameweek} + notify`}
                        </button>
                      </div>

                      <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3.5 text-sm text-amber-100 ring-1 ring-amber-500/25">
                        <div className="font-semibold text-amber-50">
                          Revert post-pricing squad changes → GW{PRE_DYNAMIC_PRICING_SNAPSHOT_GW}
                        </div>
                        <p className="mt-1.5 leading-relaxed text-amber-100/90">
                          Managers who changed their XI after dynamic pricing went live are restored to their locked GW
                          {PRE_DYNAMIC_PRICING_SNAPSHOT_GW} squad with opening purchase prices. Points and gameweek are unchanged;
                          squads that already match GW{PRE_DYNAMIC_PRICING_SNAPSHOT_GW} are left alone.
                        </p>
                        {postPricingRevertPreview.missingSnapshot ? (
                          <p className="mt-2 text-xs font-medium text-amber-200/90">
                            No GW{PRE_DYNAMIC_PRICING_SNAPSHOT_GW} snapshot loaded — run End GW first or check gwTeams in Firebase.
                          </p>
                        ) : postPricingRevertPreview.teams.length === 0 ? (
                          <p className="mt-2 text-xs font-medium text-emerald-200/90">
                            All squads match GW{PRE_DYNAMIC_PRICING_SNAPSHOT_GW} — nothing to revert.
                          </p>
                        ) : (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {postPricingRevertPreview.teams.map((t) => (
                              <span
                                key={t.uid}
                                className="rounded-full bg-amber-950/50 px-2.5 py-1 text-xs font-medium text-amber-100 ring-1 ring-amber-500/25"
                              >
                                {t.name}
                              </span>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => void revertSquadsChangedAfterPricing()}
                          disabled={
                            revertPostPricingBusy ||
                            postPricingRevertPreview.missingSnapshot ||
                            postPricingRevertPreview.teams.length === 0
                          }
                          className="mt-3 rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white ring-1 ring-amber-500/50 hover:bg-amber-500 disabled:opacity-50"
                        >
                          {revertPostPricingBusy
                            ? "Reverting…"
                            : postPricingRevertPreview.teams.length === 0
                              ? "Nothing to revert"
                              : `Revert ${postPricingRevertPreview.teams.length} team(s) to GW${PRE_DYNAMIC_PRICING_SNAPSHOT_GW}`}
                        </button>
                      </div>

                      {/* Action buttons */}
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <button type="button" onClick={() => void endGameweek()}
                          className="rounded-2xl bg-red-600 px-4 py-3 text-sm font-bold text-white ring-1 ring-red-500/40 hover:bg-red-500">
                          End GW{currentGameweek} &amp; carry over points
                        </button>
                        <button
                          type="button"
                          onClick={() => void undoLastGameweek()}
                          disabled={currentGameweek <= 1 || undoingGameweek}
                          className={[
                            "rounded-2xl px-4 py-3 text-sm font-bold ring-1 transition",
                            currentGameweek <= 1 || undoingGameweek
                              ? "bg-white/5 text-zinc-500 ring-white/10 cursor-not-allowed"
                              : "bg-amber-700/40 text-amber-50 ring-amber-500/35 hover:bg-amber-600/45",
                          ].join(" ")}
                        >
                          {undoingGameweek ? "Undoing…" : `Undo end of GW${currentGameweek - 1}`}
                        </button>
                        <button
                          type="button"
                          onClick={() => void restoreSquadsFromLastEndedGw()}
                          disabled={completedGameweeks.length === 0}
                          className={[
                            "rounded-2xl px-4 py-3 text-sm font-bold ring-1 transition",
                            completedGameweeks.length === 0
                              ? "bg-white/5 text-zinc-500 ring-white/10 cursor-not-allowed"
                              : "bg-sky-800/40 text-sky-50 ring-sky-500/35 hover:bg-sky-700/45",
                          ].join(" ")}
                        >
                          Restore squads from last GW snapshot
                        </button>
                        <button type="button" onClick={() => void bulkAvailability(true)}
                          className="rounded-2xl bg-white/5 px-4 py-3 text-sm font-bold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10">
                          Activate all players
                        </button>
                        <button type="button" onClick={() => void bulkAvailability(false)}
                          className="rounded-2xl bg-white/5 px-4 py-3 text-sm font-bold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10">
                          Deactivate all players
                        </button>
                      </div>

                      <div className="mt-5 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/10 sm:p-5">
                        <div className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">New season — points &amp; GW1</div>
                        <p className="mt-2 text-sm text-zinc-400">
                          <strong className="text-zinc-200">Keep squads:</strong> leaderboard and player stat sheet go to zero, GW1 — same lineups stay in Firebase.
                          <span className="mx-1.5 text-zinc-600">·</span>
                          <strong className="text-zinc-200">Delete teams:</strong> same as above but removes every saved squad (everyone must draft again).
                        </p>
                        <div className="mt-4 flex flex-col gap-3">
                          <button type="button" onClick={() => void resetSeasonStatsKeepSquads()}
                            className="w-full rounded-2xl bg-sky-700/50 px-4 py-4 text-left text-sm font-bold text-sky-50 ring-2 ring-sky-400/40 hover:bg-sky-600/45 sm:text-base">
                            <span className="block">Recommended — all points to 0 &amp; GW1</span>
                            <span className="mt-1 block text-xs font-semibold text-sky-200/90">Keeps every manager&apos;s team · clears stats only</span>
                          </button>
                          <button type="button" onClick={() => void resetSeasonPoints()}
                            className="w-full rounded-2xl bg-zinc-900 px-4 py-3 text-left text-sm font-bold text-zinc-300 ring-1 ring-white/15 hover:bg-zinc-800">
                            <span className="block">Hard reset — delete all saved teams</span>
                            <span className="mt-1 block text-xs font-normal text-zinc-500">Player pool unchanged · everyone must save a new squad</span>
                          </button>
                        </div>
                      </div>
                      <p className="text-xs leading-relaxed text-zinc-400">
                        After <strong className="text-zinc-200">End GW</strong>, each saved team keeps its running total (<strong className="text-zinc-200">Total</strong> on the leaderboard).
                        A locked squad snapshot is saved for that gameweek — everyone can browse past picks on the Leaderboard tab.
                        <strong className="text-zinc-200"> Undo end of GW</strong> restores the previous gameweek if you ended it by mistake (requires a snapshot from that End GW).
                        Players&apos; editable stat rows go to zero for the new gameweek until match data is entered, so GW / base points display as{" "}
                        <strong className="text-zinc-200">0</strong> until then.
                      </p>
                      {/* Play Cricket import */}
                      <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4 sm:p-5">
                        <div className="text-base font-semibold text-white">Import from Play Cricket</div>
                        <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                          Request an API token from the ECB (club Play Cricket admin), then set{" "}
                          <span className="font-mono text-zinc-400">PLAY_CRICKET_API_TOKEN</span> in{" "}
                          <span className="font-mono text-zinc-400">.env.local</span> on the server and restart{" "}
                          <span className="font-mono text-zinc-400">npm run dev</span>. Paste a match ID from the scorecard URL,
                          fetch stats, review the table, and Save stats.
                        </p>
                        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                          <label className="block flex-1 min-w-[200px]">
                            <div className="mb-1.5 text-xs font-medium text-zinc-300">Play Cricket match ID</div>
                            <input
                              value={pcMatchId}
                              onChange={(e) => setPcMatchId(e.target.value)}
                              inputMode="numeric"
                              placeholder="e.g. 12345678"
                              className="w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60"
                            />
                          </label>
                          <button
                            type="button"
                            disabled={pcBusy}
                            onClick={() => void importFromPlayCricket()}
                            className={[
                              "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ring-1 transition",
                              pcBusy
                                ? "bg-white/5 text-zinc-500 ring-white/10 cursor-wait"
                                : "bg-sky-600 text-white ring-sky-500/40 hover:bg-sky-500",
                            ].join(" ")}
                          >
                            <Download className="h-4 w-4 shrink-0" />
                            {pcBusy ? "Fetching…" : "Fetch & apply to table"}
                          </button>
                        </div>
                        {pcNote ? (
                          <div className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-xs text-zinc-300 ring-1 ring-white/10">
                            {pcNote}
                          </div>
                        ) : null}
                      </div>

                      {/* Rewind / restore */}
                      <div className="rounded-2xl bg-white/5 ring-1 ring-white/10">
                        <div className="border-b border-white/10 p-4 sm:p-5">
                          <div className="text-base font-semibold">What changed this week</div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            Tracks each stats save in GW{currentGameweek}, with who changed it and approximately how many player rows changed.
                          </div>
                        </div>
                        <div className="p-4 sm:p-5">
                          {weeklyChangeFeed.length === 0 ? (
                            <div className="text-sm text-zinc-400">No stat saves recorded this gameweek yet.</div>
                          ) : (
                            <div className="grid gap-2">
                              {weeklyChangeFeed.map((entry) => (
                                <div key={entry.id} className="flex flex-col gap-1 rounded-xl bg-black/20 px-3 py-2 ring-1 ring-white/10 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="min-w-0 text-sm text-zinc-200">
                                    <span className="font-semibold">{entry.changedRows}</span>{" "}
                                    {entry.changedRows === 1 ? "player row changed" : "player rows changed"}
                                  </div>
                                  <div className="text-xs text-zinc-500">
                                    {entry.when} · {entry.editedBy}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-white/5 ring-1 ring-white/10">
                        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                          <div>
                            <div className="text-base font-semibold">Rewind player stats</div>
                            <div className="mt-0.5 text-xs text-zinc-500">
                              Every time you hit <span className="text-zinc-200 font-semibold">Save stats</span> a snapshot is saved first. Restore one to undo mistakes.
                            </div>
                          </div>
                          <div className="text-xs text-zinc-500">
                            Need access? Make sure your Firebase account has the <span className="text-zinc-200 font-semibold">admin</span> claim and sign out/in.
                          </div>
                        </div>
                        <div className="border-t border-white/10 p-4 sm:p-5">
                          {snapshots.length === 0 ? (
                            <div className="text-sm text-zinc-400">No snapshots yet.</div>
                          ) : (
                            <div className="grid gap-2">
                              {snapshots.map((s) => (
                                <div key={s.id} className="flex flex-col gap-2 rounded-2xl bg-black/20 p-4 ring-1 ring-white/10 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                                      <Pill tone="neutral">GW{s.gameweek}</Pill>
                                      <span className="truncate text-zinc-100">{s.label ?? "snapshot"}</span>
                                    </div>
                                    <div className="mt-1 text-xs text-zinc-500">
                                      Snapshot id <span className="font-mono text-zinc-400">{s.id}</span>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void restoreSnapshot(s.id)}
                                    disabled={!!restoringSnapshotId}
                                    className={["rounded-xl px-4 py-2 text-xs font-bold ring-1 transition",
                                      restoringSnapshotId
                                        ? "bg-white/5 text-zinc-400 ring-white/10"
                                        : "bg-white/5 text-zinc-200 ring-white/10 hover:bg-white/10"].join(" ")}
                                  >
                                    {restoringSnapshotId === s.id ? "Restoring…" : "Restore"}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Best squad preview */}
                      <div className="rounded-2xl bg-white/5 ring-1 ring-white/10">
                        <div className="flex items-center justify-between p-4 sm:p-5">
                          <div>
                            <div className="flex items-center gap-2 text-base font-semibold">
                              <Star className="h-4 w-4 text-amber-400" />
                              Best squad — GW{currentGameweek}
                            </div>
                            <div className="mt-0.5 text-xs text-zinc-500">{`Top ${SQUAD_SIZE} performers based on current week’s stats`}</div>
                          </div>
                          <button type="button" onClick={() => setShowBestXI((v) => !v)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/30 hover:bg-amber-500/20 transition">
                            {showBestXI ? <>Hide <ChevronUp className="h-3.5 w-3.5" /></> : <>Show <ChevronDown className="h-3.5 w-3.5" /></>}
                          </button>
                        </div>
                        {showBestXI && (
                          <div className="border-t border-white/10 p-4 sm:p-5">
                            {bestSquad.entries.length === 0 ? (
                              <div className="text-sm text-zinc-400">No players with stats yet. Enter stats below then check back.</div>
                            ) : (
                              <>
                                <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
                                  <table className="w-full border-collapse text-sm">
                                    <thead className="bg-black/30">
                                      <tr className="text-left text-xs font-semibold text-zinc-400">
                                        <th className="px-4 py-2.5">#</th>
                                        <th className="px-4 py-2.5">Player</th>
                                        <th className="px-4 py-2.5 text-right">Pts</th>
                                        <th className="px-4 py-2.5 text-right">Role</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/8">
                                      {bestSquad.entries.map(({ player, points }, i) => {
                                        const isC = player.id === bestSquad.captainId;
                                        const isVC = player.id === bestSquad.viceCaptainId;
                                        const eff = Math.round(points * (isC ? 2 : isVC ? 1.5 : 1) * 10) / 10;
                                        return (
                                          <tr key={player.id} className={isC || isVC ? "bg-amber-500/5" : ""}>
                                            <td className="px-4 py-2.5 text-zinc-500 text-xs">{i + 1}</td>
                                            <td className="px-4 py-2.5 font-semibold text-white">{player.name}</td>
                                            <td className="px-4 py-2.5 text-right font-bold text-white">{eff}</td>
                                            <td className="px-4 py-2.5 text-right">
                                              {isC ? <span className="rounded-md bg-red-600/20 px-2 py-0.5 text-xs font-bold text-red-300 ring-1 ring-red-500/30">C</span>
                                                : isVC ? <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300 ring-1 ring-amber-500/30">VC</span>
                                                : <span className="text-xs text-zinc-600">—</span>}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                                <div className="mt-3 text-right text-xs text-zinc-500">
                                  Best squad total:{" "}
                                  <span className="font-bold text-white">
                                    {bestSquad.entries.reduce((s, { player, points }) =>
                                      Math.round((s + points * (player.id === bestSquad.captainId ? 2 : player.id === bestSquad.viceCaptainId ? 1.5 : 1)) * 10) / 10, 0)} pts
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Add player */}
                      <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 sm:p-5">
                        <div className="mb-3 text-sm font-semibold text-white">Add player</div>
                        <div className="flex flex-wrap gap-3">
                          <div className="flex-1 min-w-[180px]">
                            <TextField value={newName} onChange={setNewName} placeholder="Full name" label="Name" />
                          </div>
                          <label className="block w-36">
                            <div className="mb-1.5 text-xs font-medium text-zinc-300">Role</div>
                            <select
                              value={newPlayerRole}
                              onChange={(e) => setNewPlayerRole(e.target.value as PlayerRole)}
                              className="w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60"
                            >
                              <option value="bat">Batter</option>
                              <option value="ar">All-rounder</option>
                              <option value="bowl">Bowler</option>
                              <option value="wk">WK</option>
                            </select>
                          </label>
                          <label className="block w-36">
                            <div className="mb-1.5 text-xs font-medium text-zinc-300">Squad</div>
                            <select
                              value={newTeamTier}
                              onChange={(e) => setNewTeamTier(Number(e.target.value) as TeamTier)}
                              className="w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60"
                            >
                              <option value={1}>1st XI</option>
                              <option value={2}>2nd XI</option>
                            </select>
                          </label>
                          <div className="w-24">
                            <label className="block">
                              <div className="mb-1.5 text-xs font-medium text-zinc-300">Price</div>
                              <NumberInput variant="field" value={newPrice} onChange={setNewPrice} min={1} className="text-center" />
                            </label>
                          </div>
                          <div className="flex items-end">
                            <button type="button" onClick={() => void addPlayer()} disabled={!newName.trim()}
                              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-red-500/40 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed">
                              <Plus className="h-4 w-4" /> Add
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Player stats table */}
                      {!dnpHistoryRepairDone && adminAuthed ? (
                        <div className="rounded-2xl border border-sky-500/35 bg-sky-500/10 px-4 py-3.5 text-sm text-sky-100 ring-1 ring-sky-500/25">
                          <div className="font-semibold text-sky-50">One-time fix: Did not play on past gameweeks</div>
                          <p className="mt-1.5 leading-relaxed text-sky-100/90">
                            Before dynamic pricing, non-squad players may have been saved as DNB with zeros. This marks every past week (and blank current rows) as{" "}
                            <strong className="text-white">Did not play</strong> so they keep base price. Ducks stay as played (DNB unchecked).
                          </p>
                          {dnpRepairNote ? (
                            <p className="mt-2 text-xs font-medium text-emerald-200">{dnpRepairNote}</p>
                          ) : null}
                          <button
                            type="button"
                            onClick={applyAllPastWeeksDidNotPlayRepair}
                            className="mt-3 rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white ring-1 ring-sky-500/50 hover:bg-sky-500"
                          >
                            Apply DNP fix to all past weeks
                          </button>
                        </div>
                      ) : null}

                      <div className="rounded-2xl bg-white/5 ring-1 ring-white/10">
                        <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 lg:pr-3">
                            <button
                              type="button"
                              onClick={() => setWeeklyAuditOpen((v) => !v)}
                              className="inline-flex items-center gap-2 text-sm font-semibold text-white hover:text-zinc-200"
                            >
                              Weekly performance audit
                              {weeklyAuditOpen ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
                            </button>
                            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-zinc-500">
                              Every player × every gameweek: points, DNP (did not play), DNB (in XI but did not bat), and stat summary.
                              Amber cells are DNP with all-zero stats — often wrong if they were in the playing XI but only fielded.
                              Click any cell to edit that week&apos;s stats (runs, fielding, DNP/DNB). Then Save stats to persist.
                              On the <strong className="font-medium text-zinc-400">Players</strong> tab, select up to four names to compare points per GW on a chart.
                            </p>
                          </div>
                          {weeklyAuditOpen ? (
                            <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
                              <label className="relative min-w-[10rem] flex-1 sm:flex-none sm:w-44">
                                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                                <input
                                  value={weeklyAuditQuery}
                                  onChange={(e) => setWeeklyAuditQuery(e.target.value)}
                                  placeholder="Filter by name…"
                                  className="w-full rounded-xl bg-white/5 py-2 pl-8 pr-3 text-xs text-white placeholder:text-zinc-500 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60"
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => setWeeklyAuditDnpOnly((v) => !v)}
                                className={["rounded-xl px-3 py-2 text-xs font-semibold ring-1 transition",
                                  weeklyAuditDnpOnly
                                    ? "bg-zinc-600/30 text-zinc-100 ring-zinc-500/40"
                                    : "bg-white/5 text-zinc-300 ring-white/10 hover:bg-white/10"].join(" ")}
                              >
                                DNP weeks only
                              </button>
                              <button
                                type="button"
                                onClick={() => setWeeklyAuditSuspiciousOnly((v) => !v)}
                                className={["rounded-xl px-3 py-2 text-xs font-semibold ring-1 transition",
                                  weeklyAuditSuspiciousOnly
                                    ? "bg-amber-600/20 text-amber-100 ring-amber-500/40"
                                    : "bg-white/5 text-zinc-300 ring-white/10 hover:bg-white/10"].join(" ")}
                              >
                                Review zeros
                              </button>
                            </div>
                          ) : null}
                        </div>
                        {weeklyAuditOpen ? (
                          auditGameweeks.length === 0 ? (
                            <div className="p-5 text-sm text-zinc-500">No completed gameweeks yet.</div>
                          ) : (
                            <div className="max-h-[min(70vh,36rem)] overflow-auto">
                              <table className="w-full min-w-max border-collapse text-xs">
                                <thead className="sticky top-0 z-20 bg-zinc-950/95 backdrop-blur">
                                  <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-wide text-zinc-500">
                                    <th className="sticky left-0 z-30 min-w-[9rem] bg-zinc-950/95 px-3 py-2 font-semibold">Player</th>
                                    {auditGameweeks.map((week) => (
                                      <th key={week} className="min-w-[4.5rem] px-1.5 py-2 text-center font-semibold">
                                        GW{week}
                                        {week === currentGameweek ? <span className="block text-[9px] font-normal normal-case text-sky-400">live</span> : null}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {weeklyAuditPlayers.map((p) => (
                                    <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                                      <td className="sticky left-0 z-10 bg-zinc-950/90 px-3 py-1.5 font-medium text-zinc-200">
                                        <span className="block truncate max-w-[9rem]" title={p.name}>{p.name}</span>
                                        <span className="text-[10px] text-zinc-500">{p.teamTier === 1 ? "1st" : "2nd"} · {p.role.toUpperCase()}</span>
                                      </td>
                                      {auditGameweeks.map((week) => {
                                        const h = weekRecordFromPlayer(p, week, currentGameweek);
                                        if (!h) {
                                          return (
                                            <td key={week} className="px-1 py-1">
                                              <button
                                                type="button"
                                                title={`GW${week}: no record — click to add stats`}
                                                onClick={() => openHistoryWeekEdit(p.id, week)}
                                                className="mx-auto flex w-full min-w-[4.25rem] items-center justify-center rounded-lg px-1 py-2 text-zinc-600 ring-1 ring-white/5 transition hover:bg-white/5 hover:text-zinc-400"
                                              >
                                                —
                                              </button>
                                            </td>
                                          );
                                        }
                                        const suspicious = weekRecordLooksLikeSuspiciousDnp(h);
                                        const isDnp = Boolean(h.didNotPlay);
                                        const isDnb = !isDnp && Boolean(h.didNotBat);
                                        const cellTitle = `${weekAuditTooltip(h)}\n\nClick to edit this week.`;
                                        if (isDnp) {
                                          return (
                                            <td key={week} className="px-1 py-1">
                                              <button
                                                type="button"
                                                title={cellTitle}
                                                onClick={() => openHistoryWeekEdit(p.id, week)}
                                                className={["mx-auto flex w-full min-w-[4.25rem] flex-col items-center rounded-lg px-1 py-1 ring-1 transition hover:brightness-110",
                                                  suspicious
                                                    ? "bg-amber-500/15 text-amber-100 ring-amber-500/35"
                                                    : "bg-zinc-800/60 text-zinc-400 ring-zinc-600/30"].join(" ")}
                                              >
                                                <span className="font-bold leading-none">DNP</span>
                                                <span className="mt-0.5 text-[10px] opacity-80">0 pts</span>
                                              </button>
                                            </td>
                                          );
                                        }
                                        return (
                                          <td key={week} className="px-1 py-1">
                                            <button
                                              type="button"
                                              title={cellTitle}
                                              onClick={() => openHistoryWeekEdit(p.id, week)}
                                              className={["mx-auto flex w-full min-w-[4.25rem] flex-col items-center rounded-lg px-1 py-1.5 ring-1 ring-transparent transition hover:bg-white/5 hover:ring-white/10",
                                                isDnb ? "text-sky-300" : h.points > 0 ? "text-emerald-300" : "text-zinc-400"].join(" ")}
                                            >
                                              <span className="font-semibold tabular-nums leading-none">{h.points} pts</span>
                                              {isDnb ? <span className="mt-0.5 text-[10px] text-sky-400/80">DNB</span> : null}
                                              <span className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-zinc-500">
                                                {weekAuditStatSummary(h)}
                                              </span>
                                            </button>
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {weeklyAuditPlayers.length === 0 ? (
                                <div className="border-t border-white/10 p-4 text-center text-sm text-zinc-500">No players match this filter.</div>
                              ) : null}
                            </div>
                          )
                        ) : null}
                      </div>

                      <div className="rounded-2xl bg-white/5 ring-1 ring-white/10">
                        <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0 lg:pr-3">
                            <div className="text-sm font-semibold text-white">Player stats</div>
                            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-500">
                              <strong className="font-medium text-zinc-400">Catches</strong> is outfield total (includes catches credited before WK split). Enter{" "}
                              <strong className="font-medium text-zinc-400">WK c.</strong>, <strong className="font-medium text-zinc-400">Stump.</strong> and{" "}
                              <strong className="font-medium text-zinc-400">RO</strong> in their columns — each run-out <em>involvement</em> is <strong className="font-medium text-zinc-400">1</strong> in RO.
                            </p>
                            {unsavedStats && <div className="mt-1 text-xs text-amber-400">Unsaved changes</div>}
                          </div>
                          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
                            <button
                              type="button"
                              onClick={() => setShowOnlyPlayedRows((v) => !v)}
                              className={["inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ring-1 transition",
                                showOnlyPlayedRows
                                  ? "bg-sky-600/25 text-sky-100 ring-sky-500/40 hover:bg-sky-600/35"
                                  : "bg-white/5 text-zinc-200 ring-white/10 hover:bg-white/10"].join(" ")}
                            >
                              {showOnlyPlayedRows ? "Showing selected 22" : "Show selected 22 only"}
                            </button>
                            <button
                              type="button"
                              onClick={startFreshGameweekSheet}
                              className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 ring-1 ring-white/10 transition hover:bg-white/10"
                            >
                              Start fresh GW sheet
                            </button>
                            <button
                              type="button"
                              onClick={openPlayedPicker}
                              className="inline-flex items-center gap-2 rounded-xl bg-sky-600/15 px-3 py-2 text-xs font-semibold text-sky-200 ring-1 ring-sky-500/35 transition hover:bg-sky-600/25"
                            >
                              Select 22 who played
                            </button>
                            <button type="button" onClick={() => void saveStats()} disabled={!unsavedStats || savingStats}
                              className={["inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold ring-1 transition",
                                savedStatsFlash ? "bg-emerald-600/20 text-emerald-300 ring-emerald-500/30"
                                  : unsavedStats && !savingStats ? "bg-red-600 text-white ring-red-500/40 hover:bg-red-500"
                                  : "bg-white/5 text-zinc-500 ring-white/10 opacity-50 cursor-not-allowed"].join(" ")}>
                              <Save className="h-3.5 w-3.5" />
                              {savingStats ? "Saving…" : savedStatsFlash ? "Saved ✓" : "Save stats"}
                            </button>
                          </div>
                        </div>
                        <div className="max-h-[min(75vh,52rem)] overflow-auto">
                          <table className="table-fixed w-full min-w-[1460px] border-collapse">
                            <colgroup>
                              <col className="min-w-[11rem]" />
                              <col className="w-40" />
                              <col className="w-32" />
                              <col className="w-20" />
                              <col className="w-20" />
                              <col className="w-20" />
                              <col className="w-20" />
                              <col className="w-20" />
                              <col className="w-20" />
                              <col className="w-20" />
                              <col className="w-20" />
                              <col className="w-20" />
                              <col className="w-20" />
                              <col className="w-20" />
                              <col className="w-16" />
                              <col className="w-16" />
                              <col className="w-24" />
                              <col className="w-12" />
                            </colgroup>
                            <thead className="bg-black/40">
                              <tr className="text-left text-xs font-semibold text-zinc-300">
                                <AdminStatsSortTh
                                  label="Player"
                                  colKey="name"
                                  sort={adminStatsSort}
                                  onSort={toggleAdminStatsSort}
                                  className="sticky left-0 top-0 z-40 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]"
                                />
                                <AdminStatsSortTh label="Role" colKey="role" sort={adminStatsSort} onSort={toggleAdminStatsSort} className="sticky top-0 z-20 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                                <AdminStatsSortTh label="Squad" colKey="teamTier" sort={adminStatsSort} onSort={toggleAdminStatsSort} className="sticky top-0 z-20 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                                <AdminStatsSortTh label="Avail" colKey="available" sort={adminStatsSort} onSort={toggleAdminStatsSort} className="sticky top-0 z-20 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                                <AdminStatsSortTh compact label="Price" colKey="price" sort={adminStatsSort} onSort={toggleAdminStatsSort} className="sticky top-0 z-20 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                                <AdminStatsSortTh compact label="Runs" colKey="runs" sort={adminStatsSort} onSort={toggleAdminStatsSort} className="sticky top-0 z-20 border-l border-white/15 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" title="Use DNB when they did not bat (not a duck). No batting fantasy pts; 4s/6s locked off." />
                                <AdminStatsSortTh compact label="4s" colKey="fours" sort={adminStatsSort} onSort={toggleAdminStatsSort} className="sticky top-0 z-20 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                                <AdminStatsSortTh compact label="6s" colKey="sixes" sort={adminStatsSort} onSort={toggleAdminStatsSort} className="sticky top-0 z-20 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                                <AdminStatsSortTh compact label="Wkts" colKey="wickets" sort={adminStatsSort} onSort={toggleAdminStatsSort} className="sticky top-0 z-20 border-l border-white/15 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                                <AdminStatsSortTh compact label="Maid" colKey="maidens" sort={adminStatsSort} onSort={toggleAdminStatsSort} className="sticky top-0 z-20 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                                <AdminStatsSortTh compact label="Catches" colKey="catches" sort={adminStatsSort} onSort={toggleAdminStatsSort} className="sticky top-0 z-20 border-l border-white/15 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                                <AdminStatsSortTh compact label="WK c." colKey="wkCatches" sort={adminStatsSort} onSort={toggleAdminStatsSort} className="sticky top-0 z-20 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                                <AdminStatsSortTh compact label="Stump." colKey="stumpings" sort={adminStatsSort} onSort={toggleAdminStatsSort} className="sticky top-0 z-20 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                                <AdminStatsSortTh compact label="RO" colKey="runOuts" sort={adminStatsSort} onSort={toggleAdminStatsSort} className="sticky top-0 z-20 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" title="Run-out involvements this GW" />
                                <AdminStatsSortTh compact label="GW" colKey="points" sort={adminStatsSort} onSort={toggleAdminStatsSort} className="sticky top-0 z-20 border-l border-white/15 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                                <AdminStatsSortTh compact label="Σ" colKey="season" sort={adminStatsSort} onSort={toggleAdminStatsSort} className="sticky top-0 z-20 bg-zinc-950 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                                <th className="sticky top-0 z-20 bg-zinc-950 px-2 py-3 text-center text-zinc-400 shadow-[0_1px_0_0_rgba(255,255,255,0.06)]">Form</th>
                                <th className="sticky top-0 z-20 bg-zinc-950 px-2 py-3 text-center shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" aria-label="Actions" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10">
                              {adminVisiblePlayers.map((p) => (
                                <tr key={p.id} className="text-sm text-zinc-100">
                                  <td className="sticky left-0 z-30 bg-zinc-950 px-4 py-3 font-semibold text-white shadow-[1px_0_0_0_rgba(255,255,255,0.06)]">
                                    <span>{p.name}</span>
                                    {p.didNotPlay ? (
                                      <span className="ml-2 rounded-md bg-zinc-600/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-300 ring-1 ring-zinc-500/40">
                                        DNP
                                      </span>
                                    ) : null}
                                  </td>
                                  <td className="px-2 py-3 align-middle">
                                    <select
                                      value={p.role}
                                      onChange={(e) =>
                                        editLocalPlayer(p.id, { role: e.target.value as PlayerRole })
                                      }
                                      className="w-full rounded-lg border border-zinc-500/80 bg-zinc-800 py-2 pl-2 pr-8 text-sm font-medium text-white shadow-[inset_0_1px_3px_rgba(0,0,0,0.45)] outline-none focus-visible:border-red-500 focus-visible:ring-2 focus-visible:ring-red-500/50"
                                    >
                                      <option value="bat">Batter</option>
                                      <option value="ar">All-rounder</option>
                                      <option value="bowl">Bowler</option>
                                      <option value="wk">WK</option>
                                    </select>
                                  </td>
                                  <td className="px-2 py-3 align-middle">
                                    <select
                                      value={p.teamTier}
                                      onChange={(e) =>
                                        editLocalPlayer(p.id, { teamTier: Number(e.target.value) as TeamTier })
                                      }
                                      className="w-full rounded-lg border border-zinc-500/80 bg-zinc-800 py-2 pl-2 pr-8 text-sm font-medium text-white shadow-[inset_0_1px_3px_rgba(0,0,0,0.45)] outline-none focus-visible:border-red-500 focus-visible:ring-2 focus-visible:ring-red-500/50"
                                    >
                                      <option value={1}>1st XI</option>
                                      <option value={2}>2nd XI</option>
                                    </select>
                                  </td>
                                  <td className="px-4 py-3">
                                    <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                                      <input type="checkbox" checked={p.available}
                                        onChange={(e) => editLocalPlayer(p.id, { available: e.target.checked })}
                                        className="h-4 w-4 rounded border-white/20 bg-white/10 text-red-600 focus:ring-red-500/60" />
                                      {p.available ? <span className="text-emerald-200">On</span> : <span className="text-amber-200">Off</span>}
                                    </label>
                                  </td>
                                  <td className="px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.price}
                                      onChange={(v) => editLocalPlayer(p.id, { price: v })}
                                      className="text-center"
                                    />
                                    {(() => {
                                      const pr = adminPricingMap.get(p.id);
                                      if (!pr) return null;
                                      if (p.didNotPlay) {
                                        return (
                                          <div className="mt-1 text-center text-[10px] text-zinc-500">
                                            Draft {money(pr.effectivePrice)} · base (DNP this GW)
                                          </div>
                                        );
                                      }
                                      if (pr.valueRank != null && pr.pricedPoolSize != null) {
                                        return (
                                          <div className="mt-1 text-center text-[10px] text-zinc-500">
                                            #{pr.valueRank}/{pr.pricedPoolSize} form · listed {money(pr.basePrice)}
                                          </div>
                                        );
                                      }
                                      if (pr.priceDelta === 0) return null;
                                      return (
                                        <div className="mt-1 text-center text-[10px] text-zinc-500">
                                          Draft {money(pr.effectivePrice)}
                                          <span className={pr.priceDelta > 0 ? " text-emerald-400" : " text-amber-400"}>
                                            {" "}
                                            ({pr.priceDelta > 0 ? "+" : ""}
                                            {pr.priceDelta})
                                          </span>
                                        </div>
                                      );
                                    })()}
                                  </td>
                                  <td className="border-l border-white/10 px-2 py-3 align-middle">
                                    <div className="flex min-w-[4.5rem] flex-col items-center gap-1.5">
                                      <NumberInput
                                        variant="field"
                                        value={p.runs}
                                        disabled={Boolean(p.didNotPlay || p.didNotBat)}
                                        onChange={(v) =>
                                          editLocalPlayer(p.id, {
                                            runs: v,
                                            ...(v > 0 ? { didNotBat: false } : {}),
                                          })
                                        }
                                        className="text-center"
                                      />
                                      <div className="flex flex-wrap items-center justify-center gap-2">
                                        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                                          <input
                                            type="checkbox"
                                            checked={Boolean(p.didNotPlay)}
                                            onChange={(e) => toggleDidNotPlay(p.id, e.target.checked)}
                                            className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 text-zinc-400 focus:ring-zinc-500/50"
                                          />
                                          DNP
                                        </label>
                                        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300/90">
                                          <input
                                            type="checkbox"
                                            checked={Boolean(p.didNotBat)}
                                            disabled={Boolean(p.didNotPlay)}
                                            onChange={(e) => {
                                              const on = e.target.checked;
                                              editLocalPlayer(
                                                p.id,
                                                on
                                                  ? { didNotBat: true, notOut: false, runs: 0, fours: 0, sixes: 0 }
                                                  : { didNotBat: false },
                                              );
                                            }}
                                            className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 text-sky-500 focus:ring-sky-500/50 disabled:opacity-40"
                                          />
                                          DNB
                                        </label>
                                        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/90">
                                          <input
                                            type="checkbox"
                                            checked={Boolean(p.notOut)}
                                            disabled={Boolean(p.didNotPlay || p.didNotBat)}
                                            onChange={(e) =>
                                              editLocalPlayer(
                                                p.id,
                                                e.target.checked
                                                  ? { notOut: true, didNotBat: false }
                                                  : { notOut: false },
                                              )
                                            }
                                            className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 text-emerald-500 focus:ring-emerald-500/50"
                                          />
                                          NO
                                        </label>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.fours}
                                      disabled={Boolean(p.didNotPlay || p.didNotBat)}
                                      onChange={(v) => editLocalPlayer(p.id, { fours: v, ...(v > 0 ? { didNotBat: false } : {}) })}
                                      className="text-center"
                                    />
                                  </td>
                                  <td className="px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.sixes}
                                      disabled={Boolean(p.didNotPlay || p.didNotBat)}
                                      onChange={(v) => editLocalPlayer(p.id, { sixes: v, ...(v > 0 ? { didNotBat: false } : {}) })}
                                      className="text-center"
                                    />
                                  </td>
                                  <td className="border-l border-white/10 px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.wickets}
                                      disabled={Boolean(p.didNotPlay)}
                                      onChange={(v) => editLocalPlayer(p.id, { wickets: v })}
                                      className="text-center"
                                    />
                                  </td>
                                  <td className="px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.maidens}
                                      disabled={Boolean(p.didNotPlay)}
                                      onChange={(v) => editLocalPlayer(p.id, { maidens: v })}
                                      className="text-center"
                                    />
                                  </td>
                                  <td className="border-l border-white/10 px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.catches}
                                      disabled={Boolean(p.didNotPlay)}
                                      onChange={(v) => editLocalPlayer(p.id, { catches: v })}
                                      className="text-center"
                                    />
                                  </td>
                                  <td className="px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.wkCatches}
                                      disabled={Boolean(p.didNotPlay)}
                                      onChange={(v) => editLocalPlayer(p.id, { wkCatches: v })}
                                      className="text-center"
                                    />
                                  </td>
                                  <td className="px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.stumpings}
                                      disabled={Boolean(p.didNotPlay)}
                                      onChange={(v) => editLocalPlayer(p.id, { stumpings: v })}
                                      className="text-center"
                                    />
                                  </td>
                                  <td className="px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.runOuts}
                                      disabled={Boolean(p.didNotPlay)}
                                      onChange={(v) => editLocalPlayer(p.id, { runOuts: v })}
                                      className="text-center"
                                    />
                                  </td>
                                  <td className="border-l border-white/10 px-2 py-3 text-center align-middle">
                                    <span className="text-base font-bold tabular-nums text-white">{calculatePoints(p)}</span>
                                  </td>
                                  <td className="px-2 py-3 text-center align-middle">
                                    <span className="text-base font-semibold tabular-nums text-emerald-200">{sumSeasonPointsFromHistory(p.history)}</span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <FormDots history={p.history} />
                                  </td>
                                  <td className="px-4 py-3">
                                    <button type="button" onClick={() => void deletePlayer(p.id)}
                                      className="inline-flex items-center justify-center rounded-lg bg-white/5 p-1.5 text-zinc-500 ring-1 ring-white/10 hover:bg-red-500/20 hover:text-red-300 transition">
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                    </div>
                  )}
                </CardBody>
              </Card>
            </section>
          ) : null}

        </main>
      </div>

      {historyWeekEditCtx ? (
        <AdminHistoryWeekEditorModal
          playerName={historyWeekEditCtx.player.name}
          week={historyWeekEditCtx.week}
          isLive={historyWeekEditCtx.isLive}
          record={historyWeekEditCtx.record}
          onClose={() => setHistoryWeekEdit(null)}
          onEdit={(patch) => editHistoryWeek(historyWeekEditCtx.player.id, historyWeekEditCtx.week, patch)}
          onToggleDidNotPlay={(on) =>
            toggleHistoryWeekDidNotPlay(historyWeekEditCtx.player.id, historyWeekEditCtx.week, on)
          }
        />
      ) : null}

      {playedPickerOpen ? (
        <div
          role="presentation"
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm"
          onClick={() => setPlayedPickerOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="played-picker-title"
            className="w-full max-w-2xl rounded-3xl bg-zinc-950 ring-1 ring-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div>
                <div id="played-picker-title" className="text-lg font-bold text-white">
                  Who played in GW{currentGameweek}?
                </div>
                <div className="mt-1 text-xs text-zinc-400">
                  Unticked players are marked <strong className="text-zinc-200">Did not play</strong> (no stats, no form or price impact). Use DNB on the table only for players who played but did not bat.
                </div>
                <div className="mt-1 text-xs font-semibold text-sky-200">
                  Selected: {playedPickerIds.length}/{EXPECTED_PLAYERS_PER_GW}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPlayedPickerOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-zinc-300 ring-1 ring-white/10 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-auto px-5 py-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPlayedPickerIds(localPlayers.map((p) => p.id))}
                  className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setPlayedPickerIds([])}
                  className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10"
                >
                  Clear all
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {adminSortedPlayers.map((p) => {
                  const on = playedPickerIds.includes(p.id);
                  return (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          setPlayedPickerIds((prev) =>
                            e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id),
                          )
                        }
                        className="h-4 w-4 rounded border-white/20 bg-white/10 text-sky-500 focus:ring-sky-500/50"
                      />
                      <span className="truncate">{p.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
              <button
                type="button"
                onClick={() => setPlayedPickerOpen(false)}
                className="rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-300 ring-1 ring-white/10 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyPlayedPicker}
                disabled={playedPickerIds.length !== EXPECTED_PLAYERS_PER_GW}
                className={[
                  "rounded-xl px-3 py-2 text-xs font-semibold ring-1 transition",
                  playedPickerIds.length === EXPECTED_PLAYERS_PER_GW
                    ? "bg-sky-600 text-white ring-sky-500/40 hover:bg-sky-500"
                    : "bg-white/5 text-zinc-500 ring-white/10 cursor-not-allowed",
                ].join(" ")}
              >
                Apply selection
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {teamModal ? (
        <div
          role="presentation"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-sm"
          onClick={() => setTeamModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="team-modal-title"
            className="flex max-h-[min(88dvh,100%)] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-zinc-950 ring-1 ring-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <div id="team-modal-title" className="truncate text-lg font-bold">{teamModal.name}</div>
                <div className="mt-0.5 text-xs text-zinc-400">
                  Owner{" "}
                  <span className="font-semibold text-zinc-200">
                    {resolveOwnerDisplayName(teamModal, authUser)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTeamModal(null)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/5 text-zinc-300 ring-1 ring-white/10 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              <div className="grid gap-2">
                {(teamModal.players ?? []).map((pid) => {
                  const modalLive = leaderboardGwView === "live";
                  const modalGw = modalLive ? currentGameweek : leaderboardGwView;
                  const pool = modalLive ? scoringPlayersById : playersById;
                  const p = pool.get(pid);
                  if (!p) return null;
                  const hist = !modalLive ? (p.history ?? []).find((h) => h.week === modalGw) : null;
                  const statLine = hist ?? p;
                  const scoresThisGw = playerScoresInGameweek(teamModal, pid, modalGw);
                  const fieldingLabel = scoresThisGw ? formatSquadFieldingSummary(squadFieldingFromStatLine(statLine)) : null;
                  const basePts = scoresThisGw ? calculatePoints(statLine) : 0;
                  const isC = teamModal.captain === pid;
                  const isVC = teamModal.viceCaptain === pid;
                  const isWK = teamModal.keeper === pid;
                  return (
                    <div key={pid} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 ring-1 ring-white/10">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-white">{p.name}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs">
                          <Pill>{money(p.price)}{p.priceDelta ? (p.priceDelta > 0 ? ` (+${p.priceDelta})` : ` (${p.priceDelta})`) : ""}</Pill>
                          <Pill tone="amber">{ROLE_LABEL[p.role]}</Pill>
                          <Pill tone={p.teamTier === 1 ? "blue" : "neutral"}>{TEAM_TIER_SHORT[p.teamTier]}</Pill>
                          {isC ? <Pill tone="red">C</Pill> : null}
                          {isVC ? <Pill tone="amber">VC</Pill> : null}
                          {isWK ? <Pill tone="blue">WK</Pill> : null}
                          {fieldingLabel ? <Pill tone="green">{fieldingLabel}</Pill> : null}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-medium text-zinc-400">Base pts</div>
                        <div className="text-base font-black text-white">{basePts}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 text-xs text-zinc-500">
                <span className="text-zinc-300">Base points</span> only — captain (2×) and vice-captain (1.5×) boosts count on the leaderboard, not in this list.
              </div>
            </div>

            <div className="shrink-0 border-t border-white/10 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:hidden">
              <button
                type="button"
                onClick={() => setTeamModal(null)}
                className="w-full rounded-xl bg-white/10 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/8 bg-zinc-950/80 backdrop-blur-md sm:hidden">
        <div className="mx-auto flex max-w-6xl gap-2 px-3 py-3">
          <TabButton active={tab === "draft"} onClick={() => setTab("draft")} icon={<Shield className="h-4 w-4" />} label="Draft" />
          <TabButton active={tab === "leaderboard"} onClick={() => setTab("leaderboard")} icon={<Trophy className="h-4 w-4" />} label="Leaderboard" />
          <TabButton active={tab === "players"} onClick={() => setTab("players")} icon={<Users className="h-4 w-4" />} label="Players" />
          <TabButton active={tab === "admin"} onClick={() => setTab("admin")} icon={<Settings className="h-4 w-4" />} label="Admin" />
          <Link href="/pavilion"
            className={[
              "inline-flex flex-1 items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-medium ring-1 transition",
              hasUnreadPavilion
                ? "bg-red-600/20 text-red-100 ring-red-500/40 hover:bg-red-600/30"
                : "bg-white/5 text-zinc-300 ring-white/10 hover:bg-white/10 hover:text-white",
            ].join(" ")}>
            <MessageSquare className="h-4 w-4" />
            Pavilion
            {hasUnreadPavilion ? <span className="h-2 w-2 rounded-full bg-red-300" aria-label="Unread Pavilion messages" /> : null}
          </Link>
        </div>
      </nav>
    </div>
  );
}
