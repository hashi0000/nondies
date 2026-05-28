"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { calculatePoints, clampNonNegativeInt, fantasyPointsBreakdown } from "@/lib/fantasyPoints";
import {
  BUDGET,
  FREE_TRANSFERS_PER_WEEK,
  LINEUP_LOCK_HOUR,
  LINEUP_LOCK_MINUTE,
  LINEUP_LOCK_SUMMARY,
  LINEUP_LOCK_WEEKDAY,
  MAX_BANKED_FREE_TRANSFERS,
  POINTS_PER_EXTRA_TRANSFER,
  type PlayerRole,
  ROLE_LABEL,
  SQUAD_ROLES,
  SQUAD_SIZE,
} from "@/lib/leagueConfig";
import {
  countOutgoingPlayerChanges,
  freeTransfersAfterRollover,
  MAX_FREE_TRANSFERS_IN_GW,
  penaltyPointsForExtras,
  transferExtrasAgainstFree,
} from "@/lib/transfers";
import { normalizePlayCricketName } from "@/lib/playCricket/names";
import {
  deleteAllGwTeamsDocs,
  gwSnapshotToSavedTeam,
  parseGwTeamsDoc,
  type GwTeamSnapshot,
  type GwTeamsDoc,
} from "@/lib/gwTeams";

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
  /** True when batter remained not out this gameweek. */
  notOut?: boolean;
};

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
  /** Batter remained not out in this GW. Used for batting average on player leaderboard. */
  notOut?: boolean;
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
  | "average";

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
  for (const h of history ?? []) {
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
  }
  const outs = Math.max(innings - notOuts, 0);
  const average = outs > 0 ? runs / outs : null;
  return { runs, fours, sixes, wickets, maidens, catches, wkCatches, stumpings, runOuts, innings, notOuts, outs, average };
}

function seasonFantasyBreakdownFromHistory(history: WeekRecord[] | undefined) {
  let batting = 0;
  let bowling = 0;
  let fielding = 0;
  for (const h of history ?? []) {
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

/**
 * First time a player appears on a saved squad (new team or transfer in).
 * GW1: they score in the opening gameweek like everyone else.
 * GW2+: they only start counting from the *next* gameweek so they can’t farm points from stats already on the board.
 */
function firstScoringGameweekForNewSigning(currentGameweek: number): number {
  return currentGameweek > 1 ? currentGameweek + 1 : 1;
}

function transferPenaltiesApplyInGameweek(currentGameweek: number): boolean {
  return currentGameweek > 1;
}

/** True when saves should apply transfer limits and point hits (vs GW1 or new-joiner grace before lock). */
function transferPenaltiesApplyForTeam(currentGameweek: number, existing: SavedTeam | null, now: Date): boolean {
  if (!transferPenaltiesApplyInGameweek(currentGameweek)) return false;
  if (!existing) return false;
  const fsg = existing.firstSaveGameweek;
  if (typeof fsg !== "number" || !Number.isFinite(fsg)) return true;
  if (Math.floor(fsg) === currentGameweek && !isSelectionLocked(now)) return false;
  return true;
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
): Record<string, number> {
  const next: Record<string, number> = {};
  if (!existing) {
    const j = firstScoringGameweekForNewSigning(gameweek);
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
      next[key] = n;
    } else {
      next[key] = firstScoringGameweekForNewSigning(gameweek);
    }
  }
  return next;
}

function computeWeekPoints(team: SavedTeam, byId: Map<number, Player>, scoringGameweek: number) {
  let total = 0;
  for (const id of team.players) {
    if (playerFirstGameweekOnTeam(team, id) > scoringGameweek) continue;
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
    if (playerFirstGameweekOnTeam(team, id) > scoringGameweek) continue;
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
}) {
  const { teamName, selected, captain, viceCaptain, keeper, byId } = args;
  const set = new Set(selected);
  const sel = selected.map((id) => byId.get(id)).filter(Boolean) as Player[];
  const spend = sel.reduce((s, p) => s + p.price, 0);
  const compositionOk = squadCompositionOk(selected, byId);
  const keeperPlayer = keeper !== null ? byId.get(keeper) : undefined;
  const keeperIsWkRole = keeperPlayer?.role === "wk";
  const checks = {
    teamName: teamName.trim().length > 0,
    count: selected.length === SQUAD_SIZE,
    captain: captain !== null && set.has(captain),
    viceCaptain: viceCaptain !== null && set.has(viceCaptain),
    keeper: keeper !== null && set.has(keeper) && keeperIsWkRole,
    withinBudget: spend <= BUDGET,
    uniqueLeadership: captain !== null && viceCaptain !== null ? captain !== viceCaptain : true,
    allAvailable: sel.every((p) => p.available),
    composition: compositionOk,
  };
  const ok = Object.values(checks).every(Boolean);
  const problems: string[] = [];
  if (!checks.teamName) problems.push("Enter a team name.");
  if (!checks.count) problems.push(`Pick exactly ${SQUAD_SIZE} players.`);
  if (!checks.composition) {
    const c = countRolesInSelection(selected, byId);
    problems.push(
      `Squad must be ${SQUAD_ROLES.bat} batters, ${SQUAD_ROLES.ar} all-rounders, ${SQUAD_ROLES.bowl} bowlers, ${SQUAD_ROLES.wk} wicketkeeper (currently ${c.bat}/${c.ar}/${c.bowl}/${c.wk}).`,
    );
  }
  if (!checks.withinBudget) problems.push(`Stay within budget (${money(BUDGET)}).`);
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
  return { ok, checks, spend, problems };
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
        const dnb = Boolean(rec.didNotBat);
        const title = dnb ? `GW${rec.week}: DNB${rec.points > 0 ? ` · ${rec.points} pts` : ""}` : `GW${rec.week}: ${rec.points} pts`;
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
      } else {
        setCurrentGameweek(1);
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

  // Firebase auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthUser(u);
      setAuthReady(true);
      if (!u) router.replace("/login");
    });
    return () => unsub();
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

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
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

  const spend = useMemo(
    () => builder.selected.reduce((s, id) => s + (playersById.get(id)?.price ?? 0), 0),
    [builder.selected, playersById]
  );

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
      const rows = players
        .filter((p) => p.available)
        .map((p) => {
          const season = seasonCricketStatsFromHistory(p.history);
          const seasonFantasy = seasonFantasyBreakdownFromHistory(p.history);
          return {
            player: p,
            season,
            seasonFantasy,
            seasonPoints: sumSeasonPointsFromHistory(p.history),
            picked: ownership.get(p.id) ?? 0,
          };
        });
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
          case "picked": cmp = a.picked - b.picked; break;
          case "innings": cmp = a.season.innings - b.season.innings; break;
          case "notOuts": cmp = a.season.notOuts - b.season.notOuts; break;
          case "average":
            cmp = (a.season.average ?? -1) - (b.season.average ?? -1);
            break;
          default: cmp = 0;
        }
        if (cmp !== 0) return mult * cmp;
        return a.player.name.localeCompare(b.player.name);
      });
      return rows;
    },
    [players, playersTabSortKey, playersTabSortDir, ownership],
  );

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sel = new Set(builder.selected);
    return players
      .filter((p) => (draftTeamFilter === "all" ? true : p.teamTier === Number(draftTeamFilter)))
      .filter((p) => (onlyAvailable ? p.available : true))
      .filter((p) => (!draftSquadOnly || sel.has(p.id)))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
      .sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        return compareDraftPoolPlayers(a, b, draftSortKey, draftSortDir, ownership);
      });
  }, [players, draftTeamFilter, onlyAvailable, draftSquadOnly, builder.selected, search, draftSortKey, draftSortDir, ownership]);

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

  const validation = useMemo(() => validateTeam({
    teamName: builder.teamName, selected: builder.selected,
    captain: builder.captain, viceCaptain: builder.viceCaptain,
    keeper: builder.keeper, byId: playersById,
  }), [builder, playersById]);

  const mySavedTeam = useMemo(
    () => (authUser ? teams.find((t) => t.uid === authUser.uid) : undefined),
    [teams, authUser],
  );

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

  useEffect(() => {
    if (!authUser || ownerNameTouched) return;
    const fromTeam = mySavedTeam ? ownerFieldFromFirestore(mySavedTeam.ownerName) : undefined;
    setOwnerNameInput(fromTeam ?? accountHolderName(authUser));
  }, [authUser, mySavedTeam, ownerNameTouched]);

  const transferSavePreview = useMemo(() => {
    if (builder.selected.length !== SQUAD_SIZE) return null;
    void lockClock;
    const now = new Date();
    const penaltiesApply = transferPenaltiesApplyForTeam(currentGameweek, mySavedTeam ?? null, now);
    if (!mySavedTeam) {
      return { kind: "first" as const, penaltiesApply };
    }
    const useLastSavedAsPreviewBaseline =
      !penaltiesApply &&
      transferPenaltiesApplyInGameweek(currentGameweek) &&
      mySavedTeam.players.length === SQUAD_SIZE;
    const baseline = useLastSavedAsPreviewBaseline
      ? [...mySavedTeam.players]
      : mySavedTeam.transferBaselinePlayers?.length === SQUAD_SIZE
        ? mySavedTeam.transferBaselinePlayers
        : mySavedTeam.players;
    const F =
      typeof mySavedTeam.freeTransfersAtGwStart === "number" && Number.isFinite(mySavedTeam.freeTransfersAtGwStart)
        ? Math.max(0, Math.min(Math.floor(mySavedTeam.freeTransfersAtGwStart), MAX_FREE_TRANSFERS_IN_GW))
        : MAX_FREE_TRANSFERS_IN_GW;
    const T = countOutgoingPlayerChanges(baseline, builder.selected);
    const extras = penaltiesApply ? transferExtrasAgainstFree(T, F) : 0;
    const penaltyDue = penaltiesApply ? penaltyPointsForExtras(extras) : 0;
    const penaltyDelta = penaltyDue - (mySavedTeam.transferPenaltyPointsApplied ?? 0);
    const freeUsed = penaltiesApply ? Math.min(T, F) : T;
    return { kind: "returning" as const, penaltiesApply, T, F, extras, penaltyDue, penaltyDelta, freeUsed };
  }, [mySavedTeam, builder.selected, currentGameweek, lockClock]);

  const transferRulesFootnote = useMemo(() => {
    void lockClock;
    const now = new Date();
    const gw1Open = !transferPenaltiesApplyInGameweek(currentGameweek);
    const newJoinGrace =
      !!mySavedTeam &&
      transferPenaltiesApplyInGameweek(currentGameweek) &&
      !transferPenaltiesApplyForTeam(currentGameweek, mySavedTeam, now);
    return { gw1Open, newJoinGrace };
  }, [currentGameweek, mySavedTeam, lockClock]);

  /** Free transfers you had when this gameweek opened (from saved team). */
  const freeTransfersAtLock = useMemo(() => {
    if (!mySavedTeam) return null;
    return typeof mySavedTeam.freeTransfersAtGwStart === "number" && Number.isFinite(mySavedTeam.freeTransfersAtGwStart)
      ? Math.max(0, Math.min(Math.floor(mySavedTeam.freeTransfersAtGwStart), MAX_FREE_TRANSFERS_IN_GW))
      : MAX_FREE_TRANSFERS_IN_GW;
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
      };
    });
    rows.sort((a, b) => b.total - a.total || a.team.name.localeCompare(b.team.name));
    return rows;
  }, [teams, scoringPlayersById, currentGameweek]);

  const completedGameweeks = useMemo(
    () => gwTeamsArchive.map((g) => g.gameweek).sort((a, b) => b - a),
    [gwTeamsArchive],
  );

  const historicalLeaderboard = useMemo(() => {
    if (leaderboardGwView === "live") return null;
    const doc = gwTeamsArchive.find((g) => g.gameweek === leaderboardGwView);
    if (!doc) return [];
    const rows = doc.teams.map((ts) => {
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

  const displayedLeaderboard = historicalLeaderboard ?? leaderboard;
  const leaderboardViewLabel =
    leaderboardGwView === "live" ? `GW${currentGameweek} (live)` : `GW${leaderboardGwView} (archive)`;

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

  const bestSquad = useMemo(() => generateBestSquad(players), [players]);
  const selectedCount = builder.selected.length;
  const budgetPct = Math.min(100, Math.max(0, (spend / BUDGET) * 100));

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
      const subSpend = prev.selected.reduce((s, pid) => s + (playersById.get(pid)?.price ?? 0), 0);
      if (!p.available || prev.selected.length >= SQUAD_SIZE || subSpend + p.price > BUDGET) return prev;
      if (!canAddPlayerForRoles(id, prev.selected, playersById)) return prev;
      return { ...prev, selected: [...prev.selected, id] };
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
        const playerJoinedGameweek = buildPlayerJoinedGameweekAfterSave(existing, newPlayers, currentGameweek);

        const nowSave = new Date();
        const penaltiesApply = transferPenaltiesApplyForTeam(currentGameweek, existing, nowSave);

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
          freeAtGwStart =
            typeof existing.freeTransfersAtGwStart === "number" && Number.isFinite(existing.freeTransfersAtGwStart)
              ? Math.max(0, Math.min(Math.floor(existing.freeTransfersAtGwStart), MAX_FREE_TRANSFERS_IN_GW))
              : MAX_FREE_TRANSFERS_IN_GW;
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
    setLocalPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setUnsavedStats(true);
  }

  function openPlayedPicker() {
    const seed = localPlayers
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

  function applyPlayedPicker() {
    if (playedPickerIds.length !== EXPECTED_PLAYERS_PER_GW) {
      setActionError(
        `Select exactly ${EXPECTED_PLAYERS_PER_GW} players who played before applying auto DNB.`,
      );
      return;
    }
    const played = new Set(playedPickerIds);
    setLocalPlayers((prev) =>
      prev.map((p) => {
        if (played.has(p.id)) {
          return { ...p, didNotBat: false, notOut: false };
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
          didNotBat: true,
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
              notOut: Boolean(p.notOut),
              available: p.available,
              history: p.history ?? [],
            },
            { merge: true },
          );
        }
        await batch.commit();
        statsSavePendingRef.current = committedSnapshot;
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
    const updatedPlayers = sourcePlayers.map((p) => ({
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
      notOut: false,
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
          const F =
            typeof team.freeTransfersAtGwStart === "number" && Number.isFinite(team.freeTransfersAtGwStart)
              ? Math.max(0, Math.min(Math.floor(team.freeTransfersAtGwStart), MAX_FREE_TRANSFERS_IN_GW))
              : MAX_FREE_TRANSFERS_IN_GW;
          const unused = Math.max(0, F - TEnd);
          const nextFree = freeTransfersAfterRollover(unused);
          const cumulativeBefore = team.cumulativePoints ?? 0;
          const cumulativeAfter = Math.round((cumulativeBefore + weekPts) * 10) / 10;
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
            notOut: false,
            history: p.history,
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
          await setDoc(doc(db, "gameState", "current"), { currentGameweek: gw + 1 }, { merge: true });
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
          batch.update(doc(db, "teams", ts.uid), {
            name: ts.name,
            ownerName: ts.ownerName ?? null,
            players: [...ts.players],
            captain: ts.captain,
            viceCaptain: ts.viceCaptain,
            keeper: ts.keeper,
            transferBaselinePlayers: [...ts.transferBaselinePlayers],
            freeTransfersAtGwStart: ts.freeTransfersAtGwStart,
            transferPenaltyPointsApplied: ts.transferPenaltyPointsApplied ?? 0,
            playerJoinedGameweek: ts.playerJoinedGameweek ?? {},
          });
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
              <Pill tone={spend > BUDGET ? "red" : "neutral"}>
                <span className="font-medium">{money(spend)}</span>
                <span className="text-zinc-400">/ {money(BUDGET)}</span>
              </Pill>
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

        <main className="mt-6 grid gap-5 lg:grid-cols-12">

          {/* ── Draft tab ── */}
          {tab === "draft" ? (
            <>
              <section className="order-2 lg:order-1 lg:col-span-7">
                <Card>
                  <CardHeader title="Draft pool"
                    subtitle={`Squad shape: ${SQUAD_ROLES.bat} batters, ${SQUAD_ROLES.ar} all-rounders, ${SQUAD_ROLES.bowl} bowlers, ${SQUAD_ROLES.wk} WK — max ${money(BUDGET)}. Draft cards show season-to-date stats and Σ points for scouting form. Your leaderboard only banks weeks you owned a player.`}
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
                        <div className="text-xs font-medium text-zinc-300">Budget</div>
                        <div className="mt-2 flex items-baseline justify-between gap-3">
                          <div className="text-sm text-zinc-200">
                            <span className="font-semibold text-white">{money(spend)}</span>{" "}
                            <span className="text-zinc-400">/ {money(BUDGET)}</span>
                          </div>
                          <div className="text-xs text-zinc-500">{Math.round(budgetPct)}%</div>
                        </div>
                        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                          <div className={["h-2 rounded-full", spend > BUDGET ? "bg-red-500" : "bg-red-600"].join(" ")} style={{ width: `${budgetPct}%` }} />
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
                        const wouldBust = !selected && spend + p.price > BUDGET;
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
                                  <span className="font-medium text-zinc-200">{money(p.price)}</span>
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
                        <div className="rounded-xl border border-sky-500/35 bg-sky-950/25 p-3 ring-1 ring-sky-500/20">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-sky-300/90">Transfers · GW{currentGameweek}</div>
                          {!mySavedTeam ? (
                            <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                              {currentGameweek > 1 ? (
                                <>
                                  <strong className="text-zinc-100">Joining mid-season:</strong> your first save stores this squad. If that first save is in the current gameweek, you can keep changing freely until lineup lock; after lock, saves use your free transfers and can cost league points for extras — see rules.
                                </>
                              ) : (
                                <>
                                  First save creates your squad — <strong className="text-zinc-100">no transfer penalties</strong> until you have a saved team to compare against.
                                </>
                              )}
                            </p>
                          ) : freeTransfersAtLock !== null ? (
                            <>
                              <p className="mt-2 text-sm text-zinc-200">
                                Free transfers at this lock:{" "}
                                <strong className="tabular-nums text-white">{freeTransfersAtLock}</strong>
                                <span className="text-zinc-500"> (cap {MAX_FREE_TRANSFERS_IN_GW} usable in one GW)</span>
                              </p>
                              {currentGameweek > 1 ? (
                                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                                  Season in progress — each player change beyond your free allowance costs{" "}
                                  <strong className="text-amber-200/95">−{POINTS_PER_EXTRA_TRANSFER}</strong> league pts when you save (see breakdown below with a full squad).
                                </p>
                              ) : null}
                              {!transferRulesFootnote.gw1Open && transferRulesFootnote.newJoinGrace ? (
                                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                                  <strong className="text-zinc-200">New this gameweek:</strong> unlimited player changes until lineup lock — then saves use your free transfers and{" "}
                                  <strong className="text-amber-200/95">−{POINTS_PER_EXTRA_TRANSFER}</strong> league pts per extra change beyond that allowance.
                                </p>
                              ) : transferRulesFootnote.gw1Open ? (
                                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                                  <strong className="text-zinc-200">Opening gameweek (GW1):</strong> unlimited free player changes until we move to GW2 and normal transfer limits apply.
                                </p>
                              ) : selectedCount < SQUAD_SIZE ? (
                                <p className="mt-1 text-xs leading-relaxed text-amber-200/90">
                                  Select all {SQUAD_SIZE} players to preview extra-transfer league points (beyond your free allowance).
                                </p>
                              ) : transferSavePreview?.kind === "returning" ? (
                                <div className="mt-2 space-y-1.5 border-t border-white/10 pt-2 text-sm text-zinc-200">
                                  <p>
                                    Outgoing changes vs saved baseline:{" "}
                                    <strong className="tabular-nums text-white">{transferSavePreview.T}</strong>
                                  </p>
                                  <p className="text-zinc-300">
                                    <strong className="tabular-nums text-emerald-200/95">{transferSavePreview.freeUsed}</strong> covered by free
                                    {transferSavePreview.extras > 0 ? (
                                      <>
                                        {" · "}
                                        <strong className="tabular-nums text-amber-200">{transferSavePreview.extras}</strong> extra at{" "}
                                        <strong className="tabular-nums text-amber-200">−{POINTS_PER_EXTRA_TRANSFER}</strong> pts each →{" "}
                                        <strong className="text-amber-200">−{transferSavePreview.penaltyDue}</strong> GW league pts total
                                      </>
                                    ) : (
                                      <span className="text-emerald-200/90"> — no point deduction from transfers.</span>
                                    )}
                                  </p>
                                </div>
                              ) : null}
                            </>
                          ) : null}
                        </div>
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
                              `Bat ${draftRoleCounts.bat}/${SQUAD_ROLES.bat} · AR ${draftRoleCounts.ar}/${SQUAD_ROLES.ar} · Bowl ${draftRoleCounts.bowl}/${SQUAD_ROLES.bowl} · WK ${draftRoleCounts.wk}/${SQUAD_ROLES.wk}`,
                              validation.checks.composition,
                            ],
                            ["Budget", `${money(validation.spend)} / ${money(BUDGET)}`, validation.checks.withinBudget],
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
                                    <span className="font-medium text-zinc-200">{money(p.price)}</span>
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

                      {validation.ok && transferSavePreview && !locked ? (
                        <div className="rounded-xl bg-white/[0.04] px-3 py-2.5 text-xs leading-relaxed text-zinc-400 ring-1 ring-white/10">
                          {transferSavePreview.kind === "first" ? (
                            <span>
                              First save: <strong className="text-zinc-200">no transfer charge</strong>. Your gameweek baseline becomes this squad.
                            </span>
                          ) : !transferSavePreview.penaltiesApply ? (
                            <span>
                              <strong className="text-zinc-200">Opening week:</strong> unlimited free player changes until GW2 transfer rules apply.
                            </span>
                          ) : transferSavePreview.extras === 0 ? (
                            <span>
                              vs GW baseline: <strong className="text-zinc-200">{transferSavePreview.T}</strong> player{" "}
                              {transferSavePreview.T === 1 ? "change" : "changes"} —{" "}
                              <strong className="text-zinc-200">{transferSavePreview.freeUsed}</strong> on free allowance (
                              <strong className="text-zinc-200">{transferSavePreview.F}</strong> at lock) — no point hit.
                            </span>
                          ) : (
                            <span>
                              vs GW baseline: <strong className="text-zinc-200">{transferSavePreview.T}</strong> changes (
                              <strong className="text-zinc-200">{transferSavePreview.freeUsed}</strong> free,{" "}
                              <strong className="text-amber-200">{transferSavePreview.extras}</strong> extra at{" "}
                              <strong className="text-amber-200">−{POINTS_PER_EXTRA_TRANSFER}</strong> each →{" "}
                              <strong className="text-amber-200">−{transferSavePreview.penaltyDue}</strong> GW pts).
                              {transferSavePreview.penaltyDelta !== 0 ? (
                                <>
                                  {" "}
                                  This save moves cumulative by{" "}
                                  <strong className={transferSavePreview.penaltyDelta > 0 ? "text-amber-200" : "text-emerald-200"}>
                                    {transferSavePreview.penaltyDelta > 0 ? "−" : "+"}
                                    {Math.abs(transferSavePreview.penaltyDelta)}
                                  </strong>{" "}
                                  pts.
                                </>
                              ) : null}
                            </span>
                          )}
                          {currentGameweek > 1 ? (
                            <span className="mt-2 block border-t border-white/10 pt-2 text-zinc-500">
                              <strong className="text-zinc-300">Mid-season signings:</strong> anyone not on your saved squad at the start of GW{currentGameweek} only earns fantasy points from{" "}
                              <strong className="text-zinc-300">GW{currentGameweek + 1}</strong> — not from this gameweek&apos;s stats (stops loading up on players who already banked a big week).
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      <button type="button" onClick={() => void saveTeam()} disabled={locked || !validation.ok || savingTeam}
                        className={["rounded-2xl px-4 py-3 text-sm font-bold transition ring-1",
                          locked || !validation.ok || savingTeam
                            ? "bg-white/5 text-zinc-400 ring-white/10"
                            : "bg-red-600 text-white ring-red-500/40 hover:bg-red-500"].join(" ")}>
                        {savingTeam ? "Saving…" : "Save team to Firebase"}
                      </button>
                      <div className="text-xs text-zinc-500">Each account has one saved team. Saving merges into Firebase; cumulative score includes automatic transfer hits.</div>
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
                      ? "Total = cumulative points across completed gameweeks plus this week. View past gameweeks to see locked squads."
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
                      {displayedLeaderboard.map((row, idx) => (
                        <div key={row.team.uid} className={["rounded-2xl p-4 ring-1 sm:p-5",
                          row.team.uid === authUser.uid ? "bg-red-600/8 ring-red-500/20" : "bg-white/5 ring-white/10"].join(" ")}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Pill tone={idx === 0 ? "green" : "neutral"}>#{idx + 1}</Pill>
                                <div className="truncate text-lg font-bold">{row.team.name}</div>
                                {row.team.uid === authUser.uid && <Pill tone="blue">You</Pill>}
                              </div>
                              <div className="mt-1 text-xs text-zinc-400">
                                Owner{" "}
                                <span className="font-semibold text-zinc-200">
                                  {resolveOwnerDisplayName(row.team, authUser)}
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
                      ))}
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
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="text-xs text-zinc-400">
                      <span className="font-semibold text-zinc-200">Scoring:</span>{" "}
                      1 run = 1 point, 4 = +1, 6 = +2, 25/50/75/100 run bonuses = +10/+16/+18/+25, 1 wicket = 16 points, maiden = +4, wicket-haul bonuses from 3 wickets (+8) up to 10 wickets (+80), outfield catch = 8 points, wicketkeeping catch = 10, stumping = 12, run-out involvement = 10.{" "}
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
                          <option value="fours">Fours</option>
                          <option value="sixes">Sixes</option>
                          <option value="wickets">Wickets</option>
                          <option value="maidens">Maidens</option>
                          <option value="catches">Catches</option>
                          <option value="wkCatches">WK catches</option>
                          <option value="stumpings">Stumpings</option>
                          <option value="runOuts">Run outs</option>
                          <option value="gwPoints">Fantasy points</option>
                        </optgroup>
                        <optgroup label="Season">
                          <option value="seasonPts">Season Σ</option>
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
                            <PlayersSortTh label="4s" colKey="fours" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label="6s" colKey="sixes" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 bg-zinc-950 text-right shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
                            <PlayersSortTh label={<><div className="text-[10px] font-bold uppercase tracking-wider text-amber-400/90">Bowling</div><div className="mt-1 text-zinc-200">Wkts</div></>} colKey="wickets" sort={{ key: playersTabSortKey, dir: playersTabSortDir }} onSort={togglePlayersSort} className="sticky top-0 z-20 border-l border-white/15 bg-zinc-950 text-right align-bottom shadow-[0_1px_0_0_rgba(255,255,255,0.06)]" />
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
                                <td className="px-4 py-3 text-right text-zinc-200">{money(p.price)}</td>
                                <td className="border-l border-white/10 px-4 py-3 text-right text-zinc-200">{season.runs}</td>
                                <td className="px-4 py-3 text-right text-zinc-200">{season.fours}</td>
                                <td className="px-4 py-3 text-right text-zinc-200">{season.sixes}</td>
                                <td className="border-l border-white/10 px-4 py-3 text-right text-zinc-200">{season.wickets}</td>
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
                        <strong className="text-zinc-300">{FREE_TRANSFERS_PER_WEEK}</strong> free player change per gameweek, up to{" "}
                        <strong className="text-zinc-300">{MAX_BANKED_FREE_TRANSFERS}</strong> banked, max{" "}
                        <strong className="text-zinc-300">{MAX_FREE_TRANSFERS_IN_GW}</strong> free in hand, then{" "}
                        <strong className="text-zinc-300">−{POINTS_PER_EXTRA_TRANSFER}</strong> league points per extra change. Tunables in{" "}
                        <code className="rounded bg-black/30 px-1 font-mono text-[11px] text-zinc-300">lib/leagueConfig.ts</code>.
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
                              Who played? Auto DNB
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
                                  <td className="sticky left-0 z-30 bg-zinc-950 px-4 py-3 font-semibold text-white shadow-[1px_0_0_0_rgba(255,255,255,0.06)]">{p.name}</td>
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
                                  </td>
                                  <td className="border-l border-white/10 px-2 py-3 align-middle">
                                    <div className="flex min-w-[4.5rem] flex-col items-center gap-1.5">
                                      <NumberInput
                                        variant="field"
                                        value={p.runs}
                                        disabled={Boolean(p.didNotBat)}
                                        onChange={(v) =>
                                          editLocalPlayer(p.id, {
                                            runs: v,
                                            ...(v > 0 ? { didNotBat: false } : {}),
                                          })
                                        }
                                        className="text-center"
                                      />
                                      <div className="flex items-center gap-2">
                                        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300/90">
                                          <input
                                            type="checkbox"
                                            checked={Boolean(p.didNotBat)}
                                            onChange={(e) => {
                                              const on = e.target.checked;
                                              editLocalPlayer(
                                                p.id,
                                                on
                                                  ? { didNotBat: true, notOut: false, runs: 0, fours: 0, sixes: 0 }
                                                  : { didNotBat: false },
                                              );
                                            }}
                                            className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 text-sky-500 focus:ring-sky-500/50"
                                          />
                                          DNB
                                        </label>
                                        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/90">
                                          <input
                                            type="checkbox"
                                            checked={Boolean(p.notOut)}
                                            disabled={Boolean(p.didNotBat)}
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
                                      disabled={Boolean(p.didNotBat)}
                                      onChange={(v) => editLocalPlayer(p.id, { fours: v, ...(v > 0 ? { didNotBat: false } : {}) })}
                                      className="text-center"
                                    />
                                  </td>
                                  <td className="px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.sixes}
                                      disabled={Boolean(p.didNotBat)}
                                      onChange={(v) => editLocalPlayer(p.id, { sixes: v, ...(v > 0 ? { didNotBat: false } : {}) })}
                                      className="text-center"
                                    />
                                  </td>
                                  <td className="border-l border-white/10 px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.wickets}
                                      onChange={(v) => editLocalPlayer(p.id, { wickets: v })}
                                      className="text-center"
                                    />
                                  </td>
                                  <td className="px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.maidens}
                                      onChange={(v) => editLocalPlayer(p.id, { maidens: v })}
                                      className="text-center"
                                    />
                                  </td>
                                  <td className="border-l border-white/10 px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.catches}
                                      onChange={(v) => editLocalPlayer(p.id, { catches: v })}
                                      className="text-center"
                                    />
                                  </td>
                                  <td className="px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.wkCatches}
                                      onChange={(v) => editLocalPlayer(p.id, { wkCatches: v })}
                                      className="text-center"
                                    />
                                  </td>
                                  <td className="px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.stumpings}
                                      onChange={(v) => editLocalPlayer(p.id, { stumpings: v })}
                                      className="text-center"
                                    />
                                  </td>
                                  <td className="px-2 py-3 align-middle">
                                    <NumberInput
                                      variant="field"
                                      value={p.runOuts}
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
                  Unticked players are set to all zero stats and auto DNB.
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
                  const scoresThisGw = playerFirstGameweekOnTeam(teamModal, pid) <= modalGw;
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
                          <Pill>{money(p.price)}</Pill>
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
