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
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

// ─── Types ───────────────────────────────────────────────────────────────────

type WeekRecord = {
  week: number;
  runs: number;
  wickets: number;
  catches: number;
  wkCatches: number;
  stumpings: number;
  runOuts: number;
  points: number;
};

type Player = {
  id: number;
  name: string;
  price: number;
  runs: number;
  wickets: number;
  catches: number;
  wkCatches: number;
  stumpings: number;
  runOuts: number;
  available: boolean;
  history: WeekRecord[];
};

type SavedTeam = {
  uid: string;
  name: string;
  players: number[];
  captain: number | null;
  viceCaptain: number | null;
  keeper: number | null;
  cumulativePoints: number;
};

type BuilderState = {
  teamName: string;
  selected: number[];
  captain: number | null;
  viceCaptain: number | null;
  keeper: number | null;
};

type TabKey = "draft" | "leaderboard" | "players" | "admin";

// ─── Constants ───────────────────────────────────────────────────────────────

const APP_NAME = "Nondies Fantasy League";
const ADMIN_PIN = "1234";
const SQUAD_SIZE = 11;
const BUDGET = 100;

const LS = {
  builder: "nondies-fantasy.builder.v1",
  admin: "nondies-fantasy.admin.v1",
} as const;

const SEEDED_PLAYERS: Player[] = [
  { id: 1,  name: "Arfan Ahmed",             price: 15, runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 2,  name: "Kamran Ahmed",            price: 10, runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 3,  name: "Hetu Hirpara",            price: 10, runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 4,  name: "Danial Khan",             price: 10, runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 5,  name: "Nabeel Khan",             price: 9,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 6,  name: "Sayyid Hashim Ali Shah",  price: 9,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 7,  name: "Bharadwaj Tanikella",     price: 9,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 8,  name: "Sarim Zafar",             price: 8,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 9,  name: "Pablo Mukherjee",         price: 11, runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 10, name: "Aizaz Khan",              price: 9,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 11, name: "Mohammad Awais Abid",     price: 8,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 12, name: "Sulayman Warraich",       price: 8,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 13, name: "Hadi Ali",                price: 7,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 14, name: "Ismaeil Saghir",          price: 9,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 15, name: "Joseph Asplet",           price: 7,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 16, name: "Gareth Spackman",         price: 7,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 17, name: "Nicholas Smith",          price: 6,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 18, name: "Ross Brown",              price: 6,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 19, name: "William Goodfellow",      price: 6,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 20, name: "Zain Raja",               price: 6,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 21, name: "Nayyer Ahmed",            price: 6,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 22, name: "Haris Malak",             price: 6,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 23, name: "Rameez Ali",              price: 5,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 24, name: "Ayaz Khan",               price: 5,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 25, name: "Asif Shah",               price: 5,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 26, name: "Adnaan Rahman",           price: 5,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 27, name: "A Sidhu",                 price: 8,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 28, name: "Abdullah Akhlaq",         price: 6,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 29, name: "Alexander Dellar",        price: 5,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 30, name: "Atif Mohammed",           price: 6,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 31, name: "Gaurav Samuel",           price: 6,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 32, name: "Ibraheem Mirza",          price: 6,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 33, name: "Muhammed Anas Awais",     price: 5,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 34, name: "Shabaaz Alam",            price: 7,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
  { id: 35, name: "Sulaiman Hussain",        price: 6,  runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0, available: true, history: [] },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clampNonNegativeInt(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function money(n: number) { return `£${n}`; }

function formatLockTime(d: Date) {
  try {
    return d.toLocaleString(undefined, {
      weekday: "short", day: "2-digit", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return d.toString(); }
}

function getThisWeeksLockDate(now = new Date()) {
  const lock = new Date(now);
  const diffToFriday = 5 - lock.getDay();
  lock.setDate(lock.getDate() + diffToFriday);
  lock.setHours(23, 59, 0, 0);
  return lock;
}

function isSelectionLocked(now = new Date()) {
  return now.getTime() >= getThisWeeksLockDate(now).getTime();
}

function calculatePoints(p: Player) {
  const runs = clampNonNegativeInt(p.runs);
  let runBonus = 0;
  if (p.runs >= 100) runBonus = 25;
  else if (p.runs >= 75) runBonus = 15;
  else if (p.runs >= 50) runBonus = 10;
  else if (p.runs >= 25) runBonus = 5;

  const wickets = clampNonNegativeInt(p.wickets);
  const totalCatches = clampNonNegativeInt(p.catches);
  const wkC = clampNonNegativeInt(p.wkCatches);
  const stumpings = clampNonNegativeInt(p.stumpings);
  const runOuts = clampNonNegativeInt(p.runOuts);
  const outfieldCatches = Math.max(totalCatches - wkC, 0);

  const batting = runs + runBonus;
  const bowling = wickets * 16;
  const fielding = outfieldCatches * 8;

  // Wicketkeeper dismissals earn extra on top of normal catch points.
  const keeperBonuses = wkC * 10 + stumpings * 12 + runOuts * 10;

  return batting + bowling + fielding + keeperBonuses;
}

function computeWeekPoints(team: SavedTeam, byId: Map<number, Player>) {
  let total = 0;
  for (const id of team.players) {
    const p = byId.get(id);
    if (!p) continue;
    const base = calculatePoints(p);
    total += base * (team.captain === id ? 2 : team.viceCaptain === id ? 1.5 : 1);
  }
  return Math.round(total * 10) / 10;
}

function computeTeamTotal(team: SavedTeam, byId: Map<number, Player>) {
  return Math.round((computeWeekPoints(team, byId) + (team.cumulativePoints ?? 0)) * 10) / 10;
}

function generateBestXI(players: Player[]) {
  const scored = players.map((p) => ({ player: p, points: calculatePoints(p) })).sort((a, b) => b.points - a.points);
  const top11 = scored.slice(0, 11);
  return { entries: top11, captainId: top11[0]?.player.id ?? null, viceCaptainId: top11[1]?.player.id ?? null };
}

function validateTeam(args: {
  teamName: string; selected: number[]; captain: number | null;
  viceCaptain: number | null; keeper: number | null; byId: Map<number, Player>;
}) {
  const { teamName, selected, captain, viceCaptain, keeper, byId } = args;
  const set = new Set(selected);
  const sel = selected.map((id) => byId.get(id)).filter(Boolean) as Player[];
  const spend = sel.reduce((s, p) => s + p.price, 0);
  const checks = {
    teamName: teamName.trim().length > 0,
    count: selected.length === SQUAD_SIZE,
    captain: captain !== null && set.has(captain),
    viceCaptain: viceCaptain !== null && set.has(viceCaptain),
    keeper: keeper !== null && set.has(keeper),
    withinBudget: spend <= BUDGET,
    uniqueLeadership: captain !== null && viceCaptain !== null ? captain !== viceCaptain : true,
    allAvailable: sel.every((p) => p.available),
  };
  const ok = Object.values(checks).every(Boolean);
  const problems: string[] = [];
  if (!checks.teamName) problems.push("Enter a team name.");
  if (!checks.count) problems.push(`Pick exactly ${SQUAD_SIZE} players.`);
  if (!checks.withinBudget) problems.push(`Stay within budget (${money(BUDGET)}).`);
  if (!checks.captain) problems.push("Select a captain (C).");
  if (!checks.viceCaptain) problems.push("Select a vice-captain (VC).");
  if (!checks.uniqueLeadership) problems.push("Captain and vice-captain must be different.");
  if (!checks.keeper) problems.push("Select a wicketkeeper (WK).");
  if (!checks.allAvailable) problems.push("Remove unavailable players from your XI.");
  return { ok, checks, spend, problems };
}

// ─── UI Components ───────────────────────────────────────────────────────────

function FormDots({ history }: { history: WeekRecord[] }) {
  const recent = history.slice(-5);
  if (recent.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-zinc-500">Form</span>
      {Array.from({ length: 5 }).map((_, i) => {
        const offset = 5 - recent.length;
        const rec = i >= offset ? recent[i - offset] : null;
        if (!rec) return <span key={i} className="h-2.5 w-2.5 rounded-full bg-white/10" />;
        const color = rec.points >= 60 ? "bg-emerald-400" : rec.points >= 30 ? "bg-amber-400" : rec.points > 0 ? "bg-orange-500" : "bg-zinc-600";
        return <span key={i} className={`h-2.5 w-2.5 rounded-full ${color}`} title={`GW${rec.week}: ${rec.points} pts`} />;
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

function NumberInput({ value, onChange, min = 0, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; step?: number }) {
  return (
    <input type="number" value={Number.isFinite(value) ? value : 0} min={min} step={step}
      onChange={(e) => onChange(clampNonNegativeInt(Number(e.target.value)))}
      className="w-full rounded-lg bg-white/5 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60" />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Page() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("draft");

  // Game state — synced from Firestore
  const [players, setPlayers] = useState<Player[]>(SEEDED_PLAYERS);
  const [teams, setTeams] = useState<SavedTeam[]>([]);
  const [currentGameweek, setCurrentGameweek] = useState(1);
  const [fsReady, setFsReady] = useState(false);

  // Auth
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Draft builder — localStorage only
  const [builder, setBuilder] = useState<BuilderState>({ teamName: "", selected: [], captain: null, viceCaptain: null, keeper: null });

  // Admin
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [pin, setPin] = useState("");
  const pinInputRef = useRef<HTMLInputElement | null>(null);
  const [showBestXI, setShowBestXI] = useState(false);

  // Admin — local edits (not yet saved to Firestore)
  const [localPlayers, setLocalPlayers] = useState<Player[]>(SEEDED_PLAYERS);
  const [unsavedStats, setUnsavedStats] = useState(false);
  const [savingStats, setSavingStats] = useState(false);
  const [savedStatsFlash, setSavedStatsFlash] = useState(false);

  // Admin — add player form
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState(5);

  // Save team state
  const [savingTeam, setSavingTeam] = useState(false);

  // Firestore: listen to gameState/current
  useEffect(() => {
    const gsRef = doc(db, "gameState", "current");
    const unsub = onSnapshot(gsRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const p = (data.players as Player[] | undefined) ?? SEEDED_PLAYERS;
        const normalized = p.map((pl) => ({ ...pl, history: pl.history ?? [] }));
        setPlayers(normalized);
        setLocalPlayers(normalized);
        setCurrentGameweek(data.currentGameweek ?? 1);
      } else {
        // First run — initialize with seed data
        void setDoc(gsRef, { players: SEEDED_PLAYERS, currentGameweek: 1 });
      }
      setFsReady(true);
    }, () => setFsReady(true));
    return () => unsub();
  }, []);

  // Firestore: listen to teams collection
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "teams"), (snap) => {
      setTeams(snap.docs.map((d) => ({ uid: d.id, ...d.data() } as SavedTeam)));
    });
    return () => unsub();
  }, []);

  // Firebase auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthUser(u);
      setAuthReady(true);
      if (!u) router.replace("/login");
    });
    return () => unsub();
  }, [router]);

  // Hydrate builder + adminAuthed from localStorage
  useEffect(() => {
    const savedBuilder = safeParseJson<BuilderState>(localStorage.getItem(LS.builder));
    const savedAdmin = safeParseJson<{ authed: boolean }>(localStorage.getItem(LS.admin));
    if (savedBuilder && Array.isArray(savedBuilder.selected)) {
      setBuilder({
        teamName: String(savedBuilder.teamName ?? ""),
        selected: savedBuilder.selected.map(Number).filter(Number.isFinite),
        captain: savedBuilder.captain ?? null,
        viceCaptain: savedBuilder.viceCaptain ?? null,
        keeper: savedBuilder.keeper ?? null,
      });
    }
    if (savedAdmin?.authed) setAdminAuthed(true);
  }, []);

  // Persist builder + admin to localStorage
  useEffect(() => { localStorage.setItem(LS.builder, JSON.stringify(builder)); }, [builder]);
  useEffect(() => { localStorage.setItem(LS.admin, JSON.stringify({ authed: adminAuthed })); }, [adminAuthed]);

  // Sync localPlayers when Firestore updates AND admin has no unsaved changes
  useEffect(() => {
    if (!unsavedStats) setLocalPlayers(players);
  }, [players, unsavedStats]);

  async function logout() {
    await signOut(auth);
    router.replace("/login");
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const locked = useMemo(() => isSelectionLocked(), []);
  const lockDate = useMemo(() => getThisWeeksLockDate(), []);

  const spend = useMemo(
    () => builder.selected.reduce((s, id) => s + (playersById.get(id)?.price ?? 0), 0),
    [builder.selected, playersById]
  );

  const ownership = useMemo(() => {
    const map = new Map<number, number>();
    for (const t of teams) for (const id of t.players) map.set(id, (map.get(id) ?? 0) + 1);
    return map;
  }, [teams]);

  const [search, setSearch] = useState("");
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const playerPoints = useMemo(
    () =>
      players
        .filter((p) => p.available)
        .map((p) => ({ player: p, points: calculatePoints(p) }))
        .sort((a, b) => b.points - a.points || a.player.price - b.player.price),
    [players],
  );

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players
      .filter((p) => (onlyAvailable ? p.available : true))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
      .sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        if (b.price !== a.price) return b.price - a.price;
        return a.name.localeCompare(b.name);
      });
  }, [players, onlyAvailable, search]);

  const validation = useMemo(() => validateTeam({
    teamName: builder.teamName, selected: builder.selected,
    captain: builder.captain, viceCaptain: builder.viceCaptain,
    keeper: builder.keeper, byId: playersById,
  }), [builder, playersById]);

  const leaderboard = useMemo(() => {
    const rows = teams.map((t) => ({
      team: t,
      weekPts: computeWeekPoints(t, playersById),
      total: computeTeamTotal(t, playersById),
      capName: t.captain ? playersById.get(t.captain)?.name ?? "—" : "—",
      vcName: t.viceCaptain ? playersById.get(t.viceCaptain)?.name ?? "—" : "—",
    }));
    rows.sort((a, b) => b.total - a.total || a.team.name.localeCompare(b.team.name));
    return rows;
  }, [teams, playersById]);

  const bestXI = useMemo(() => generateBestXI(players), [players]);
  const selectedCount = builder.selected.length;
  const budgetPct = Math.min(100, Math.max(0, (spend / BUDGET) * 100));

  const selectedSorted = useMemo(
    () => builder.selected.map((id) => playersById.get(id)).filter(Boolean as unknown as <T>(v: T | undefined) => v is T)
      .sort((a, b) => b.price - a.price || a.name.localeCompare(b.name)),
    [builder.selected, playersById]
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
      if (!p.available || prev.selected.length >= SQUAD_SIZE || spend + p.price > BUDGET) return prev;
      return { ...prev, selected: [...prev.selected, id] };
    });
  }

  function setRole(role: "captain" | "viceCaptain" | "keeper", id: number) {
    if (locked) return;
    setBuilder((prev) => {
      if (!prev.selected.includes(id)) return prev;
      if ((role === "captain" && prev.viceCaptain === id) || (role === "viceCaptain" && prev.captain === id)) return prev;
      return { ...prev, [role]: id } as BuilderState;
    });
  }

  function clearBuilder() {
    setBuilder({ teamName: "", selected: [], captain: null, viceCaptain: null, keeper: null });
  }

  async function saveTeam() {
    if (locked || !validation.ok || !authUser) return;
    setSavingTeam(true);
    try {
      const existingTeam = teams.find((t) => t.uid === authUser.uid);
      await setDoc(doc(db, "teams", authUser.uid), {
        uid: authUser.uid,
        name: builder.teamName.trim(),
        players: [...builder.selected],
        captain: builder.captain,
        viceCaptain: builder.viceCaptain,
        keeper: builder.keeper,
        cumulativePoints: existingTeam?.cumulativePoints ?? 0,
      });
      setBuilder((prev) => ({ ...prev, teamName: "" }));
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

  function editLocalPlayer(id: number, patch: Partial<Player>) {
    setLocalPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setUnsavedStats(true);
  }

  async function saveStats() {
    setSavingStats(true);
    try {
      await setDoc(doc(db, "gameState", "current"), { players: localPlayers, currentGameweek }, { merge: true });
      setUnsavedStats(false);
      setSavedStatsFlash(true);
      setTimeout(() => setSavedStatsFlash(false), 2000);
    } finally {
      setSavingStats(false);
    }
  }

  async function bulkAvailability(val: boolean) {
    const updated = localPlayers.map((p) => ({ ...p, available: val }));
    setLocalPlayers(updated);
    setUnsavedStats(false);
    await setDoc(doc(db, "gameState", "current"), { players: updated, currentGameweek }, { merge: true });
  }

  async function addPlayer() {
    const name = newName.trim();
    if (!name) return;
    const nextId = Math.max(0, ...localPlayers.map((p) => p.id)) + 1;
    const newPlayer: Player = {
      id: nextId,
      name,
      price: newPrice,
      runs: 0,
      wickets: 0,
      catches: 0,
      wkCatches: 0,
      stumpings: 0,
      runOuts: 0,
      available: true,
      history: [],
    };
    const updated = [...localPlayers, newPlayer];
    setLocalPlayers(updated);
    setNewName("");
    setNewPrice(5);
    setUnsavedStats(false);
    await setDoc(doc(db, "gameState", "current"), { players: updated, currentGameweek }, { merge: true });
  }

  async function deletePlayer(id: number) {
    if (!window.confirm("Delete this player? This cannot be undone.")) return;
    const updated = localPlayers.filter((p) => p.id !== id);
    setLocalPlayers(updated);
    setUnsavedStats(false);
    await setDoc(doc(db, "gameState", "current"), { players: updated, currentGameweek }, { merge: true });
    // Also remove from any saved teams
    const batch = writeBatch(db);
    for (const team of teams) {
      if (team.players.includes(id)) {
        batch.update(doc(db, "teams", team.uid), {
          players: team.players.filter((pid) => pid !== id),
          captain: team.captain === id ? null : team.captain,
          viceCaptain: team.viceCaptain === id ? null : team.viceCaptain,
          keeper: team.keeper === id ? null : team.keeper,
        });
      }
    }
    await batch.commit();
  }

  async function endGameweek() {
    const gw = currentGameweek;
    const updatedPlayers = players.map((p) => ({
      ...p,
      history: [...(p.history ?? []), { week: gw, runs: p.runs, wickets: p.wickets, catches: p.catches, points: calculatePoints(p) }],
      runs: 0, wickets: 0, catches: 0,
    }));

    const batch = writeBatch(db);
    for (const team of teams) {
      const weekPts = computeWeekPoints(team, playersById);
      batch.update(doc(db, "teams", team.uid), {
        cumulativePoints: Math.round(((team.cumulativePoints ?? 0) + weekPts) * 10) / 10,
      });
    }
    batch.set(doc(db, "gameState", "current"), { players: updatedPlayers, currentGameweek: gw + 1 });
    await batch.commit();
    clearBuilder();
    setTab("draft");
  }

  async function fullReset() {
    if (!window.confirm("Full reset: deletes ALL teams and player history. Are you sure?")) return;
    const batch = writeBatch(db);
    for (const team of teams) batch.delete(doc(db, "teams", team.uid));
    batch.set(doc(db, "gameState", "current"), { players: SEEDED_PLAYERS, currentGameweek: 1 });
    await batch.commit();
    clearBuilder();
    setTab("draft");
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!authReady || !fsReady) {
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

      <div className="relative mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6 sm:pb-10">

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
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-300">
              <Pill>Signed in as {authUser.displayName || authUser.email || "Player"}</Pill>
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
          <div className="flex gap-2 sm:items-center">
            <TabButton active={tab === "draft"} onClick={() => setTab("draft")} icon={<Shield className="h-4 w-4" />} label="Draft" />
            <TabButton active={tab === "leaderboard"} onClick={() => setTab("leaderboard")} icon={<Trophy className="h-4 w-4" />} label="Leaderboard" />
            <TabButton active={tab === "players"} onClick={() => setTab("players")} icon={<Users className="h-4 w-4" />} label="Players" />
            <TabButton active={tab === "admin"} onClick={() => setTab("admin")} icon={<Settings className="h-4 w-4" />} label="Admin" />
            <button type="button" onClick={() => void logout()}
              className="hidden sm:inline-flex items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-medium text-zinc-300 ring-1 ring-white/10 hover:bg-white/10 hover:text-white transition"
              title="Sign out">
              <LogOut className="h-4 w-4" />
              <span className="hidden xl:inline">Sign out</span>
            </button>
            <Link href="/rules"
              className="hidden sm:inline-flex items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-medium text-zinc-300 ring-1 ring-white/10 hover:bg-white/10 hover:text-white transition"
              title="How to play">
              <span className="text-xs font-bold">?</span>
              <span className="hidden xl:inline">Rules</span>
            </Link>
          </div>
        </header>

        <main className="mt-6 grid gap-5 lg:grid-cols-12">

          {/* ── Draft tab ── */}
          {tab === "draft" ? (
            <>
              <section className="lg:col-span-7">
                <Card>
                  <CardHeader title="Draft pool" subtitle="Tap a player to add or remove them."
                    right={
                      <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
                        <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-white/10 text-red-600 focus:ring-red-500/60" />
                        Available only
                      </label>
                    }
                  />
                  <CardBody>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField value={search} onChange={setSearch} placeholder="Search players…"
                        right={<Search className="h-4 w-4 text-zinc-500" />} />
                      <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
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
                            <div className="font-semibold">Selection locked after Friday 23:59.</div>
                            <div className="mt-1 text-amber-200/80">Ask an admin to end the gameweek after the weekend.</div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 divide-y divide-white/10 overflow-hidden rounded-2xl ring-1 ring-white/10">
                      {filteredPlayers.length === 0 ? (
                        <div className="p-4 text-sm text-zinc-400">No players match your search.</div>
                      ) : filteredPlayers.map((p) => {
                        const selected = builder.selected.includes(p.id);
                        const wouldBust = !selected && spend + p.price > BUDGET;
                        const full = !selected && selectedCount >= SQUAD_SIZE;
                        const disabled = locked || !p.available || wouldBust || full;
                        const pickCount = ownership.get(p.id) ?? 0;
                        const ownershipPct = teams.length > 0 ? Math.round((pickCount / teams.length) * 100) : 0;

                        return (
                          <button key={p.id} type="button" onClick={() => toggleSelected(p.id)} disabled={disabled}
                            className={["w-full text-left transition px-4 py-3",
                              disabled ? "opacity-60" : "hover:bg-white/5",
                              selected ? "bg-red-600/10" : ""].join(" ")}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-white">{p.name}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                                  <span className="font-medium text-zinc-200">{money(p.price)}</span>
                                  <span className="text-zinc-600">•</span>
                                  <span>{p.runs} runs</span>
                                  <span className="text-zinc-600">•</span>
                                  <span>{p.wickets} wkts</span>
                                  <span className="text-zinc-600">•</span>
                                  <span>{p.catches} ct</span>
                                  <span className="text-zinc-600">•</span>
                                  <span className="font-medium text-zinc-200">{calculatePoints(p)} pts</span>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  {p.available ? <Pill tone="green">Available</Pill> : <Pill tone="amber">Unavailable</Pill>}
                                  <Pill tone={teams.length > 0 && ownershipPct >= 50 ? "amber" : "neutral"}>
                                    {teams.length > 0 ? `${pickCount}/${teams.length} (${ownershipPct}%)` : "0 picked"}
                                  </Pill>
                                  {wouldBust ? <Pill tone="red">Over budget</Pill> : null}
                                  {full ? <Pill tone="red">XI full</Pill> : null}
                                </div>
                                {p.history.length > 0 && <div className="mt-2"><FormDots history={p.history} /></div>}
                              </div>
                              <span className={["shrink-0 inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold ring-1",
                                selected ? "bg-red-600 text-white ring-red-500/40" : "bg-white/5 text-zinc-200 ring-white/10"].join(" ")}>
                                {selected ? "Remove" : "Add"}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </CardBody>
                </Card>
              </section>

              <section className="lg:col-span-5">
                <Card>
                  <CardHeader title="Your XI" subtitle="Assign captain, vice-captain, and wicketkeeper."
                    right={
                      <button type="button" onClick={clearBuilder} disabled={locked && selectedCount > 0}
                        className="rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-60">
                        Clear
                      </button>
                    }
                  />
                  <CardBody>
                    <div className="grid gap-3">
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
                            ["Budget", `${money(validation.spend)} / ${money(BUDGET)}`, validation.checks.withinBudget],
                            ["Captain", builder.captain ? "Selected" : "Missing", validation.checks.captain],
                            ["Vice-captain", builder.viceCaptain ? "Selected" : "Missing", validation.checks.viceCaptain],
                            ["Wicketkeeper", builder.keeper ? "Selected" : "Missing", validation.checks.keeper],
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
                              {validation.problems.slice(0, 5).map((prob) => <li key={prob}>{prob}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>

                      <div className="divide-y divide-white/10 overflow-hidden rounded-2xl ring-1 ring-white/10">
                        {selectedSorted.length === 0 ? (
                          <div className="p-4 text-sm text-zinc-400">Pick players from the pool to build your XI.</div>
                        ) : selectedSorted.map((p) => {
                          const isC = builder.captain === p.id;
                          const isVC = builder.viceCaptain === p.id;
                          const isWK = builder.keeper === p.id;
                          return (
                            <div key={p.id} className="px-4 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-white">{p.name}</div>
                                  <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
                                    <span className="font-medium text-zinc-200">{money(p.price)}</span>
                                    {!p.available && <Pill tone="amber">Unavailable</Pill>}
                                  </div>
                                  <div className="mt-2 flex gap-2">
                                    {(["captain", "viceCaptain", "keeper"] as const).map((role) => {
                                      const active = role === "captain" ? isC : role === "viceCaptain" ? isVC : isWK;
                                      const disabledRole = locked || (role === "captain" && isVC) || (role === "viceCaptain" && isC);
                                      const label = role === "captain" ? "C" : role === "viceCaptain" ? "VC" : "WK";
                                      const activeColor = role === "captain" ? "bg-red-600 text-white ring-red-500/40"
                                        : role === "viceCaptain" ? "bg-amber-500 text-black ring-amber-400/50"
                                        : "bg-sky-500 text-black ring-sky-400/50";
                                      return (
                                        <button key={role} type="button" onClick={() => setRole(role, p.id)}
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
                                  className="rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-60">
                                  Remove
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <button type="button" onClick={() => void saveTeam()} disabled={locked || !validation.ok || savingTeam}
                        className={["rounded-2xl px-4 py-3 text-sm font-bold transition ring-1",
                          locked || !validation.ok || savingTeam
                            ? "bg-white/5 text-zinc-400 ring-white/10"
                            : "bg-red-600 text-white ring-red-500/40 hover:bg-red-500"].join(" ")}>
                        {savingTeam ? "Saving…" : "Save team to Firebase"}
                      </button>
                      <div className="text-xs text-zinc-500">Each account has one saved team. Saving overwrites your previous entry.</div>
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
                <CardHeader title={`Leaderboard — GW${currentGameweek}`} subtitle="Total = cumulative points across all gameweeks." />
                <CardBody>
                  {leaderboard.length === 0 ? (
                    <div className="rounded-2xl bg-white/5 p-6 text-center ring-1 ring-white/10">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-600/15 ring-1 ring-red-500/30">
                        <Trophy className="h-6 w-6 text-red-300" />
                      </div>
                      <div className="mt-3 text-base font-semibold">No teams yet</div>
                      <div className="mt-1 text-sm text-zinc-400">Save your XI to appear here.</div>
                      <button type="button" onClick={() => setTab("draft")} className="mt-4 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-red-500/40 hover:bg-red-500">
                        Start drafting
                      </button>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {leaderboard.map((row, idx) => (
                        <div key={row.team.uid} className={["rounded-2xl p-4 ring-1 sm:p-5",
                          row.team.uid === authUser.uid ? "bg-red-600/8 ring-red-500/20" : "bg-white/5 ring-white/10"].join(" ")}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Pill tone={idx === 0 ? "green" : "neutral"}>#{idx + 1}</Pill>
                                <div className="truncate text-lg font-bold">{row.team.name}</div>
                                {row.team.uid === authUser.uid && <Pill tone="blue">You</Pill>}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                <Pill><span className="text-zinc-400">Captain</span>{" "}<span className="font-semibold">{row.capName}</span></Pill>
                                <Pill><span className="text-zinc-400">VC</span>{" "}<span className="font-semibold">{row.vcName}</span></Pill>
                              </div>
                            </div>
                            <div className="shrink-0 flex items-end gap-5 sm:flex-col sm:items-end sm:gap-1">
                              <div className="text-right">
                                <div className="text-xs font-medium text-zinc-500">This week</div>
                                <div className="text-xl font-bold text-zinc-200">{row.weekPts}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs font-medium text-zinc-400">Total</div>
                                <div className="text-3xl font-black tracking-tight text-white">{row.total}</div>
                              </div>
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
                  subtitle="Raw fantasy points for every available player (before captain/VC multipliers)."
                />
                <CardBody>
                  <div className="mb-4 text-xs text-zinc-400">
                    <span className="font-semibold text-zinc-200">Scoring:</span>{" "}
                    1 run = 1 point, 25/50/75/100 run bonuses = +5/+10/+15/+25, 1 wicket = 16 points, outfield catch = 8 points,{" "}
                    wicketkeeping catch = 10, stumping = 12, run-out involvement = 10.
                  </div>
                  <div className="overflow-hidden rounded-2xl ring-1 ring-white/10">
                    <div className="overflow-x-auto bg-zinc-950/40">
                      <table className="min-w-[900px] w-full border-collapse">
                        <thead className="bg-black/40 text-xs font-semibold text-zinc-300">
                          <tr>
                            <th className="px-4 py-3 text-left">Player</th>
                            <th className="px-4 py-3 text-right">Price</th>
                            <th className="px-4 py-3 text-right">Runs</th>
                            <th className="px-4 py-3 text-right">Wkts</th>
                            <th className="px-4 py-3 text-right">Catches</th>
                            <th className="px-4 py-3 text-right">WK c.</th>
                            <th className="px-4 py-3 text-right">Stumpings</th>
                            <th className="px-4 py-3 text-right">Run outs</th>
                            <th className="px-4 py-3 text-right">Points</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10 text-sm text-zinc-100">
                          {playerPoints.map(({ player: p, points }) => (
                            <tr key={p.id}>
                              <td className="px-4 py-3 font-semibold text-white">{p.name}</td>
                              <td className="px-4 py-3 text-right text-zinc-200">{money(p.price)}</td>
                              <td className="px-4 py-3 text-right text-zinc-200">{p.runs}</td>
                              <td className="px-4 py-3 text-right text-zinc-200">{p.wickets}</td>
                              <td className="px-4 py-3 text-right text-zinc-200">{p.catches}</td>
                              <td className="px-4 py-3 text-right text-zinc-200">{p.wkCatches}</td>
                              <td className="px-4 py-3 text-right text-zinc-200">{p.stumpings}</td>
                              <td className="px-4 py-3 text-right text-zinc-200">{p.runOuts}</td>
                              <td className="px-4 py-3 text-right font-bold text-white">{points}</td>
                            </tr>
                          ))}
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
                  subtitle="All changes save directly to Firebase and are visible to all users immediately."
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

                      {/* Action buttons */}
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <button type="button" onClick={() => void endGameweek()}
                          className="rounded-2xl bg-red-600 px-4 py-3 text-sm font-bold text-white ring-1 ring-red-500/40 hover:bg-red-500">
                          End GW{currentGameweek} &amp; carry over points
                        </button>
                        <button type="button" onClick={() => void bulkAvailability(true)}
                          className="rounded-2xl bg-white/5 px-4 py-3 text-sm font-bold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10">
                          Activate all players
                        </button>
                        <button type="button" onClick={() => void bulkAvailability(false)}
                          className="rounded-2xl bg-white/5 px-4 py-3 text-sm font-bold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10">
                          Deactivate all players
                        </button>
                        <button type="button" onClick={() => void fullReset()}
                          className="rounded-2xl bg-zinc-800 px-4 py-3 text-sm font-bold text-zinc-300 ring-1 ring-white/10 hover:bg-zinc-700 sm:col-span-2 lg:col-span-2">
                          Full reset (new season — clears all teams &amp; history)
                        </button>
                      </div>

                      {/* Best XI */}
                      <div className="rounded-2xl bg-white/5 ring-1 ring-white/10">
                        <div className="flex items-center justify-between p-4 sm:p-5">
                          <div>
                            <div className="flex items-center gap-2 text-base font-semibold">
                              <Star className="h-4 w-4 text-amber-400" />
                              Best XI — GW{currentGameweek}
                            </div>
                            <div className="mt-0.5 text-xs text-zinc-500">Top 11 performers based on current week&apos;s stats</div>
                          </div>
                          <button type="button" onClick={() => setShowBestXI((v) => !v)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/30 hover:bg-amber-500/20 transition">
                            {showBestXI ? <>Hide <ChevronUp className="h-3.5 w-3.5" /></> : <>Show <ChevronDown className="h-3.5 w-3.5" /></>}
                          </button>
                        </div>
                        {showBestXI && (
                          <div className="border-t border-white/10 p-4 sm:p-5">
                            {bestXI.entries.length === 0 ? (
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
                                      {bestXI.entries.map(({ player, points }, i) => {
                                        const isC = player.id === bestXI.captainId;
                                        const isVC = player.id === bestXI.viceCaptainId;
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
                                  Best XI total:{" "}
                                  <span className="font-bold text-white">
                                    {bestXI.entries.reduce((s, { player, points }) =>
                                      Math.round((s + points * (player.id === bestXI.captainId ? 2 : player.id === bestXI.viceCaptainId ? 1.5 : 1)) * 10) / 10, 0)} pts
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
                          <div className="w-24">
                            <label className="block">
                              <div className="mb-1.5 text-xs font-medium text-zinc-300">Price</div>
                              <NumberInput value={newPrice} onChange={setNewPrice} min={1} />
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
                        <div className="flex items-center justify-between border-b border-white/10 p-4 sm:p-5">
                          <div>
                            <div className="text-sm font-semibold text-white">Player stats</div>
                            {unsavedStats && <div className="mt-0.5 text-xs text-amber-400">Unsaved changes</div>}
                          </div>
                          <button type="button" onClick={() => void saveStats()} disabled={!unsavedStats || savingStats}
                            className={["inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold ring-1 transition",
                              savedStatsFlash ? "bg-emerald-600/20 text-emerald-300 ring-emerald-500/30"
                                : unsavedStats && !savingStats ? "bg-red-600 text-white ring-red-500/40 hover:bg-red-500"
                                : "bg-white/5 text-zinc-500 ring-white/10 opacity-50 cursor-not-allowed"].join(" ")}>
                            <Save className="h-3.5 w-3.5" />
                            {savingStats ? "Saving…" : savedStatsFlash ? "Saved ✓" : "Save stats"}
                          </button>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[1050px] border-collapse">
                            <thead className="bg-black/40">
                              <tr className="text-left text-xs font-semibold text-zinc-300">
                                <th className="px-4 py-3">Player</th>
                                <th className="px-4 py-3">Avail</th>
                                <th className="px-4 py-3">Price</th>
                                <th className="px-4 py-3">Runs</th>
                                <th className="px-4 py-3">Wkts</th>
                                <th className="px-4 py-3">Catches</th>
                                <th className="px-4 py-3">Pts</th>
                                <th className="px-4 py-3">Form</th>
                                <th className="px-4 py-3"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10">
                              {localPlayers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
                                <tr key={p.id} className="text-sm text-zinc-100">
                                  <td className="px-4 py-3 font-semibold text-white">{p.name}</td>
                                  <td className="px-4 py-3">
                                    <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                                      <input type="checkbox" checked={p.available}
                                        onChange={(e) => editLocalPlayer(p.id, { available: e.target.checked })}
                                        className="h-4 w-4 rounded border-white/20 bg-white/10 text-red-600 focus:ring-red-500/60" />
                                      {p.available ? <span className="text-emerald-200">On</span> : <span className="text-amber-200">Off</span>}
                                    </label>
                                  </td>
                                  <td className="px-4 py-3 w-24">
                                    <NumberInput value={p.price} onChange={(v) => editLocalPlayer(p.id, { price: v })} />
                                  </td>
                                  <td className="px-4 py-3 w-24">
                                    <NumberInput value={p.runs} onChange={(v) => editLocalPlayer(p.id, { runs: v })} />
                                  </td>
                                  <td className="px-4 py-3 w-24">
                                    <NumberInput value={p.wickets} onChange={(v) => editLocalPlayer(p.id, { wickets: v })} />
                                  </td>
                                  <td className="px-4 py-3 w-24">
                                    <NumberInput value={p.catches} onChange={(v) => editLocalPlayer(p.id, { catches: v })} />
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="font-bold text-white">{calculatePoints(p)}</span>
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

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/8 bg-zinc-950/80 backdrop-blur-md sm:hidden">
        <div className="mx-auto flex max-w-6xl gap-2 px-3 py-3">
          <TabButton active={tab === "draft"} onClick={() => setTab("draft")} icon={<Shield className="h-4 w-4" />} label="Draft" />
          <TabButton active={tab === "leaderboard"} onClick={() => setTab("leaderboard")} icon={<Trophy className="h-4 w-4" />} label="Leaderboard" />
          <TabButton active={tab === "players"} onClick={() => setTab("players")} icon={<Users className="h-4 w-4" />} label="Players" />
          <TabButton active={tab === "admin"} onClick={() => setTab("admin")} icon={<Settings className="h-4 w-4" />} label="Admin" />
        </div>
      </nav>
    </div>
  );
}
