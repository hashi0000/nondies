"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Crown, LogOut, Lock, Search, Settings, Shield, Trophy, Users } from "lucide-react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";

type Player = {
  id: number;
  name: string;
  price: number;
  runs: number;
  wickets: number;
  catches: number;
  available: boolean;
};

type SavedTeam = {
  id: number;
  name: string;
  players: number[];
  captain: number | null;
  viceCaptain: number | null;
  keeper: number | null;
};

type BuilderState = {
  teamName: string;
  selected: number[];
  captain: number | null;
  viceCaptain: number | null;
  keeper: number | null;
};

type TabKey = "draft" | "leaderboard" | "admin";

const APP_NAME = "Nondies Fantasy League";
const ADMIN_PIN = "1234"; // Change the admin PIN here.

// Change these here if needed.
const SQUAD_SIZE = 11;
const BUDGET = 100;

const STORAGE_KEYS = {
  // Bump this when you change seeded players/stats/prices and want the app to re-seed.
  players: "nondies-fantasy.players.v2",
  teams: "nondies-fantasy.teams.v1",
  builder: "nondies-fantasy.builder.v1",
  admin: "nondies-fantasy.admin.v1",
} as const;

// Change seeded players here.
const SEEDED_PLAYERS: Player[] = [
  { id: 1, name: "Arfan Ahmed", price: 15, runs: 92, wickets: 65, catches: 4, available: true },
  { id: 2, name: "Kamran Ahmed", price: 10, runs: 169, wickets: 27, catches: 0, available: true },
  { id: 3, name: "Hetu Hirpara", price: 10, runs: 120, wickets: 20, catches: 10, available: true },
  { id: 4, name: "Danial Khan", price: 10, runs: 181, wickets: 23, catches: 4, available: true },
  { id: 5, name: "Nabeel Khan", price: 9, runs: 147, wickets: 17, catches: 2, available: true },
  { id: 6, name: "Sayyid Hashim Ali Shah", price: 9, runs: 347, wickets: 5, catches: 5, available: true },
  { id: 7, name: "Bharadwaj Tanikella", price: 9, runs: 130, wickets: 15, catches: 3, available: true },
  { id: 8, name: "Sarim Zafar", price: 8, runs: 134, wickets: 11, catches: 0, available: true },
  { id: 9, name: "Pablo Mukherjee", price: 11, runs: 640, wickets: 0, catches: 5, available: true },
  { id: 10, name: "Aizaz Khan", price: 9, runs: 344, wickets: 0, catches: 8, available: true },
  { id: 11, name: "Mohammad Awais Abid", price: 8, runs: 273, wickets: 0, catches: 3, available: true },
  { id: 12, name: "Sulayman Warraich", price: 8, runs: 171, wickets: 8, catches: 5, available: true },
  { id: 13, name: "Hadi Ali", price: 7, runs: 182, wickets: 0, catches: 0, available: true },
  { id: 14, name: "Ismaeil Saghir", price: 9, runs: 228, wickets: 8, catches: 5, available: true },
  { id: 15, name: "Joseph Asplet", price: 7, runs: 185, wickets: 0, catches: 0, available: true },
  { id: 16, name: "Gareth Spackman", price: 7, runs: 157, wickets: 0, catches: 0, available: true },
  { id: 17, name: "Nicholas Smith", price: 6, runs: 118, wickets: 0, catches: 3, available: true },
  { id: 18, name: "Ross Brown", price: 6, runs: 6, wickets: 10, catches: 0, available: true },
  { id: 19, name: "William Goodfellow", price: 6, runs: 50, wickets: 5, catches: 0, available: true },
  { id: 20, name: "Zain Raja", price: 6, runs: 96, wickets: 0, catches: 3, available: true },
  { id: 21, name: "Nayyer Ahmed", price: 6, runs: 44, wickets: 0, catches: 5, available: true },
  { id: 22, name: "Haris Malak", price: 6, runs: 0, wickets: 4, catches: 0, available: true },
  { id: 23, name: "Rameez Ali", price: 5, runs: 0, wickets: 0, catches: 0, available: true },
  { id: 24, name: "Ayaz Khan", price: 5, runs: 0, wickets: 0, catches: 0, available: true },
  { id: 25, name: "Asif Shah", price: 5, runs: 0, wickets: 0, catches: 0, available: true },
  { id: 26, name: "Adnaan Rahman", price: 5, runs: 0, wickets: 0, catches: 0, available: true },
  { id: 27, name: "A Sidhu", price: 8, runs: 63, wickets: 17, catches: 2, available: true },
  { id: 28, name: "Abdullah Akhlaq", price: 6, runs: 115, wickets: 0, catches: 0, available: true },
  { id: 29, name: "Alexander Dellar", price: 5, runs: 25, wickets: 0, catches: 0, available: true },
  { id: 30, name: "Atif Mohammed", price: 6, runs: 71, wickets: 0, catches: 0, available: true },
  { id: 31, name: "Gaurav Samuel", price: 6, runs: 137, wickets: 0, catches: 0, available: true },
  { id: 32, name: "Ibraheem Mirza", price: 6, runs: 70, wickets: 0, catches: 0, available: true },
  { id: 33, name: "Muhammed Anas Awais", price: 5, runs: 6, wickets: 0, catches: 0, available: true },
  { id: 34, name: "Shabaaz Alam", price: 7, runs: 163, wickets: 5, catches: 2, available: true },
  { id: 35, name: "Sulaiman Hussain", price: 6, runs: 74, wickets: 0, catches: 0, available: true },
];

function clampNonNegativeInt(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function money(n: number) {
  return `£${n}`;
}

function formatLockTime(d: Date) {
  try {
    return d.toLocaleString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return d.toString();
  }
}

// Lock automatically every Friday 23:59 local browser time.
function getThisWeeksLockDate(now = new Date()) {
  const lock = new Date(now);
  const day = lock.getDay(); // 0 Sun ... 5 Fri ... 6 Sat
  const diffToFriday = 5 - day;
  lock.setDate(lock.getDate() + diffToFriday);
  lock.setHours(23, 59, 0, 0);
  return lock;
}

function isSelectionLocked(now = new Date()) {
  const lock = getThisWeeksLockDate(now);
  // If it's Sat/Sun, diffToFriday is negative -> lock is last Friday, so this returns true.
  return now.getTime() >= lock.getTime();
}

// Change scoring here.
function calculatePoints(p: Player) {
  // Batting
  const runPoints = clampNonNegativeInt(p.runs);
  let runBonus = 0;
  if (p.runs >= 100) runBonus = 25;
  else if (p.runs >= 75) runBonus = 15;
  else if (p.runs >= 50) runBonus = 10;
  else if (p.runs >= 25) runBonus = 5;

  // Bowling + Fielding
  const wicketPoints = clampNonNegativeInt(p.wickets) * 16;
  const catchPoints = clampNonNegativeInt(p.catches) * 8;

  return runPoints + runBonus + wicketPoints + catchPoints;
}

function validateTeam(args: {
  teamName: string;
  selected: number[];
  captain: number | null;
  viceCaptain: number | null;
  keeper: number | null;
  playersById: Map<number, Player>;
}) {
  const { teamName, selected, captain, viceCaptain, keeper, playersById } = args;
  const selectedSet = new Set(selected);

  const selectedPlayers = selected.map((id) => playersById.get(id)).filter(Boolean) as Player[];
  const spend = selectedPlayers.reduce((sum, p) => sum + p.price, 0);

  const checks = {
    teamName: teamName.trim().length > 0,
    count: selected.length === SQUAD_SIZE,
    captain: captain !== null && selectedSet.has(captain),
    viceCaptain: viceCaptain !== null && selectedSet.has(viceCaptain),
    keeper: keeper !== null && selectedSet.has(keeper),
    withinBudget: spend <= BUDGET,
    uniqueLeadership: captain !== null && viceCaptain !== null ? captain !== viceCaptain : true,
    allAvailable: selectedPlayers.every((p) => p.available),
  };

  const ok =
    checks.teamName &&
    checks.count &&
    checks.captain &&
    checks.viceCaptain &&
    checks.keeper &&
    checks.withinBudget &&
    checks.uniqueLeadership &&
    checks.allAvailable;

  const problems: string[] = [];
  if (!checks.teamName) problems.push("Enter a team name.");
  if (!checks.count) problems.push(`Pick exactly ${SQUAD_SIZE} players.`);
  if (!checks.withinBudget) problems.push(`Stay within budget (${money(BUDGET)}).`);
  if (!checks.captain) problems.push("Select a captain (C).");
  if (!checks.viceCaptain) problems.push("Select a vice-captain (VC).");
  if (!checks.uniqueLeadership) problems.push("Captain and vice-captain must be different players.");
  if (!checks.keeper) problems.push("Select a wicketkeeper (WK).");
  if (!checks.allAvailable) problems.push("Remove unavailable player(s) from your XI.");

  return { ok, checks, spend, problems };
}

function computeTeamTotal(team: SavedTeam, playersById: Map<number, Player>) {
  let total = 0;
  for (const id of team.players) {
    const p = playersById.get(id);
    if (!p) continue;
    const base = calculatePoints(p);
    let mult = 1;
    if (team.captain === id) mult = 2;
    else if (team.viceCaptain === id) mult = 1.5;
    total += base * mult;
  }
  return Math.round(total * 10) / 10;
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "red" | "green" | "amber" | "blue";
}) {
  const cls =
    tone === "green"
      ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30"
      : tone === "red"
        ? "bg-red-500/15 text-red-200 ring-1 ring-red-500/30"
        : tone === "amber"
          ? "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/30"
          : tone === "blue"
            ? "bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30"
            : "bg-white/5 text-zinc-200 ring-1 ring-white/10";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${cls}`}>
      {children}
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-zinc-950/60 ring-1 ring-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      {children}
    </div>
  );
}

function CardHeader({
  title,
  subtitle,
  right,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
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

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition",
        "ring-1 ring-white/10",
        active
          ? "bg-red-600 text-white shadow-[0_10px_30px_-15px_rgba(239,68,68,0.7)]"
          : "bg-white/5 text-zinc-200 hover:bg-white/10",
      ].join(" ")}
      aria-current={active ? "page" : undefined}
    >
      <span className="inline-flex items-center">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function TextField({
  value,
  onChange,
  placeholder,
  label,
  type = "text",
  right,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  type?: "text" | "password";
  right?: React.ReactNode;
}) {
  return (
    <label className="block">
      {label ? <div className="mb-1.5 text-xs font-medium text-zinc-300">{label}</div> : null}
      <div className="relative">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type={type}
          className={[
            "w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500",
            "ring-1 ring-white/10 outline-none transition focus:ring-2 focus:ring-red-500/60",
            right ? "pr-10" : "",
          ].join(" ")}
        />
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
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      step={step}
      onChange={(e) => onChange(clampNonNegativeInt(Number(e.target.value)))}
      className="w-full rounded-lg bg-white/5 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60"
    />
  );
}

export default function Page() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("draft");
  const [players, setPlayers] = useState<Player[]>(SEEDED_PLAYERS);
  const [teams, setTeams] = useState<SavedTeam[]>([]);
  const [builder, setBuilder] = useState<BuilderState>({
    teamName: "",
    selected: [],
    captain: null,
    viceCaptain: null,
    keeper: null,
  });

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [adminAuthed, setAdminAuthed] = useState(false);
  const [pin, setPin] = useState("");
  const pinInputRef = useRef<HTMLInputElement | null>(null);

  // Hydrate from localStorage once on mount.
  useEffect(() => {
    const savedPlayers = safeParseJson<Player[]>(localStorage.getItem(STORAGE_KEYS.players));
    const savedTeams = safeParseJson<SavedTeam[]>(localStorage.getItem(STORAGE_KEYS.teams));
    const savedBuilder = safeParseJson<BuilderState>(localStorage.getItem(STORAGE_KEYS.builder));
    const savedAdmin = safeParseJson<{ authed: boolean }>(localStorage.getItem(STORAGE_KEYS.admin));

    if (Array.isArray(savedPlayers) && savedPlayers.length > 0) setPlayers(savedPlayers);
    if (Array.isArray(savedTeams)) setTeams(savedTeams);
    if (savedBuilder && Array.isArray(savedBuilder.selected)) {
      setBuilder({
        teamName: String(savedBuilder.teamName ?? ""),
        selected: savedBuilder.selected.map((n) => Number(n)).filter((n) => Number.isFinite(n)),
        captain: savedBuilder.captain ?? null,
        viceCaptain: savedBuilder.viceCaptain ?? null,
        keeper: savedBuilder.keeper ?? null,
      });
    }
    if (savedAdmin?.authed) setAdminAuthed(true);
  }, []);

  // Firebase auth gate.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthUser(u);
      setAuthReady(true);
      if (!u) router.replace("/login");
    });
    return () => unsub();
  }, [router]);

  async function logout() {
    await signOut(auth);
    router.replace("/login");
  }

  // Persist key state.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.players, JSON.stringify(players));
  }, [players]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.teams, JSON.stringify(teams));
  }, [teams]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.builder, JSON.stringify(builder));
  }, [builder]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.admin, JSON.stringify({ authed: adminAuthed }));
  }, [adminAuthed]);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const locked = useMemo(() => isSelectionLocked(), []);
  const lockDate = useMemo(() => getThisWeeksLockDate(), []);

  const spend = useMemo(() => {
    return builder.selected.reduce((sum, id) => sum + (playersById.get(id)?.price ?? 0), 0);
  }, [builder.selected, playersById]);

  const ownership = useMemo(() => {
    const map = new Map<number, number>();
    for (const t of teams) {
      for (const id of t.players) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [teams]);

  const [search, setSearch] = useState("");
  const [onlyAvailable, setOnlyAvailable] = useState(true);

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

  const validation = useMemo(() => {
    return validateTeam({
      teamName: builder.teamName,
      selected: builder.selected,
      captain: builder.captain,
      viceCaptain: builder.viceCaptain,
      keeper: builder.keeper,
      playersById,
    });
  }, [builder, playersById]);

  function toggleSelected(id: number) {
    if (locked) return;
    const p = playersById.get(id);
    if (!p) return;

    setBuilder((prev) => {
      const already = prev.selected.includes(id);
      if (already) {
        const nextSelected = prev.selected.filter((x) => x !== id);
        return {
          ...prev,
          selected: nextSelected,
          captain: prev.captain === id ? null : prev.captain,
          viceCaptain: prev.viceCaptain === id ? null : prev.viceCaptain,
          keeper: prev.keeper === id ? null : prev.keeper,
        };
      }

      if (!p.available) return prev;
      if (prev.selected.length >= SQUAD_SIZE) return prev;
      if (spend + p.price > BUDGET) return prev;

      return { ...prev, selected: [...prev.selected, id] };
    });
  }

  function setRole(role: "captain" | "viceCaptain" | "keeper", id: number) {
    if (locked) return;
    setBuilder((prev) => {
      if (!prev.selected.includes(id)) return prev;
      if ((role === "captain" && prev.viceCaptain === id) || (role === "viceCaptain" && prev.captain === id)) {
        // Disallow C and VC being the same.
        return prev;
      }
      return { ...prev, [role]: id } as BuilderState;
    });
  }

  function saveTeam() {
    if (locked) return;
    if (!validation.ok) return;

    const name = builder.teamName.trim();
    const next: SavedTeam = {
      id: Date.now(),
      name,
      players: [...builder.selected],
      captain: builder.captain,
      viceCaptain: builder.viceCaptain,
      keeper: builder.keeper,
    };

    setTeams((prev) => {
      const idx = prev.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
      if (idx === -1) return [...prev, next];
      const copy = [...prev];
      copy[idx] = { ...next, id: prev[idx].id }; // keep stable id for overwritten team
      return copy;
    });

    setBuilder((prev) => ({ ...prev, teamName: "" }));
    setTab("leaderboard");
  }

  function clearBuilder() {
    setBuilder({ teamName: "", selected: [], captain: null, viceCaptain: null, keeper: null });
  }

  const leaderboard = useMemo(() => {
    const rows = teams.map((t) => {
      const total = computeTeamTotal(t, playersById);
      const capName = t.captain ? playersById.get(t.captain)?.name ?? "—" : "—";
      const vcName = t.viceCaptain ? playersById.get(t.viceCaptain)?.name ?? "—" : "—";
      return { team: t, total, capName, vcName };
    });
    rows.sort((a, b) => b.total - a.total || a.team.name.localeCompare(b.team.name));
    return rows;
  }, [teams, playersById]);

  function adminLogin() {
    if (pin === ADMIN_PIN) {
      setAdminAuthed(true);
      setPin("");
      setTab("admin");
      return;
    }
    setPin("");
    setTimeout(() => pinInputRef.current?.focus(), 0);
  }

  function adminLogout() {
    setAdminAuthed(false);
  }

  function updatePlayer(id: number, patch: Partial<Player>) {
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function bulkAvailability(nextAvailable: boolean) {
    setPlayers((prev) => prev.map((p) => ({ ...p, available: nextAvailable })));
  }

  function resetGameweek() {
    // Clears saved teams + in-progress builder. Leaves player stats/prices/availability intact.
    setTeams([]);
    clearBuilder();
    setTab("draft");
  }

  const selectedPlayers = useMemo(() => {
    return builder.selected.map((id) => playersById.get(id)).filter(Boolean) as Player[];
  }, [builder.selected, playersById]);

  const selectedSorted = useMemo(() => {
    return [...selectedPlayers].sort((a, b) => b.price - a.price || a.name.localeCompare(b.name));
  }, [selectedPlayers]);

  const selectedCount = builder.selected.length;
  const budgetPct = Math.min(100, Math.max(0, (spend / BUDGET) * 100));

  if (!authReady) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
            <div className="text-base font-semibold">Loading…</div>
            <div className="mt-1 text-sm text-zinc-400">Checking your sign-in status.</div>
          </div>
        </div>
      </div>
    );
  }

  if (!authUser) {
    // Redirect happens in the auth effect.
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-black to-black text-white">
      <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6 sm:pb-10">
        <header className="rounded-2xl border border-white/10 bg-gradient-to-r from-slate-950/90 via-zinc-950/90 to-black/80 px-4 py-4 shadow-[0_18px_45px_-30px_rgba(0,0,0,0.9)] sm:px-6 sm:py-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-red-600/20 ring-1 ring-red-500/40 shadow-[0_0_0_1px_rgba(248,113,113,0.2)]">
                <Crown className="h-5 w-5 text-red-300" />
              </span>
              <div>
                <h1 className="truncate text-2xl font-extrabold tracking-tight sm:text-3xl">
                  <span className="bg-gradient-to-r from-red-200 via-white to-red-300 bg-clip-text text-transparent">
                    {APP_NAME}
                  </span>
                </h1>
                <p className="mt-1 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                  Oxford &amp; Bletchingdon Nondescripts
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs sm:text-sm text-zinc-300">
              {authUser ? <Pill>Signed in as {authUser.displayName || authUser.email || authUser.phoneNumber || "Player"}</Pill> : null}
              <Pill tone="red">
                <Users className="h-3.5 w-3.5" />
                {selectedCount}/{SQUAD_SIZE} selected
              </Pill>
              <Pill tone={spend > BUDGET ? "red" : "neutral"}>
                <span className="font-medium">{money(spend)}</span>
                <span className="text-zinc-400">/ {money(BUDGET)}</span>
              </Pill>
              <Pill tone={locked ? "amber" : "green"}>
                {locked ? <Lock className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                {locked ? `Locked (since ${formatLockTime(lockDate)})` : `Locks ${formatLockTime(lockDate)}`}
              </Pill>
            </div>
          </div>

          <div className="flex gap-2 sm:items-center">
            <TabButton active={tab === "draft"} onClick={() => setTab("draft")} icon={<Shield className="h-4 w-4" />} label="Draft" />
            <TabButton active={tab === "leaderboard"} onClick={() => setTab("leaderboard")} icon={<Trophy className="h-4 w-4" />} label="Leaderboard" />
            <TabButton active={tab === "admin"} onClick={() => setTab("admin")} icon={<Settings className="h-4 w-4" />} label="Admin" />
            <button
              type="button"
              onClick={() => void logout()}
              className="hidden sm:inline-flex items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-medium text-zinc-200 ring-1 ring-white/10 hover:bg-white/10"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden xl:inline">Sign out</span>
            </button>
          </div>
        </header>

        <main className="mt-6 grid gap-5 lg:grid-cols-12">
          {tab === "draft" ? (
            <>
              <section className="lg:col-span-7">
                <Card>
                  <CardHeader
                    title="Draft pool"
                    subtitle="Search and tap to add/remove. Only available players can be picked."
                    right={
                      <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={onlyAvailable}
                          onChange={(e) => setOnlyAvailable(e.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-white/10 text-red-600 focus:ring-red-500/60"
                        />
                        Available only
                      </label>
                    }
                  />
                  <CardBody>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField value={search} onChange={setSearch} placeholder="Search players..." right={<Search className="h-4 w-4 text-zinc-500" />} />
                      <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                        <div className="text-xs font-medium text-zinc-300">Budget</div>
                        <div className="mt-2">
                          <div className="flex items-baseline justify-between gap-3">
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
                    </div>

                    {locked ? (
                      <div className="mt-4 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200 ring-1 ring-amber-500/30">
                        <div className="flex items-start gap-2">
                          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <div className="font-semibold">Team selection is locked.</div>
                            <div className="mt-1 text-amber-200/80">
                              Your XI can’t be changed after Friday 23:59. Ask an admin to reset the gameweek after the weekend.
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 divide-y divide-white/10 overflow-hidden rounded-2xl ring-1 ring-white/10">
                      {filteredPlayers.length === 0 ? (
                        <div className="p-4 text-sm text-zinc-400">No players match your search.</div>
                      ) : (
                        filteredPlayers.map((p) => {
                          const selected = builder.selected.includes(p.id);
                          const wouldBustBudget = !selected && spend + p.price > BUDGET;
                          const full = !selected && selectedCount >= SQUAD_SIZE;
                          const disabled = locked || !p.available || wouldBustBudget || full;

                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => toggleSelected(p.id)}
                              disabled={disabled}
                              className={[
                                "w-full text-left transition",
                                "px-4 py-3",
                                disabled ? "opacity-60" : "hover:bg-white/5",
                                selected ? "bg-red-600/10" : "bg-transparent",
                              ].join(" ")}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-white">{p.name}</div>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                                    <span className="font-medium text-zinc-200">{money(p.price)}</span>
                                    <span className="text-zinc-600">•</span>
                                    <span>Runs {p.runs}</span>
                                    <span className="text-zinc-600">•</span>
                                    <span>Wkts {p.wickets}</span>
                                    <span className="text-zinc-600">•</span>
                                    <span>Catches {p.catches}</span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {p.available ? <Pill tone="green">Available</Pill> : <Pill tone="amber">Unavailable</Pill>}
                                    <Pill>Picked {ownership.get(p.id) ?? 0}</Pill>
                                    {wouldBustBudget ? <Pill tone="red">Over budget</Pill> : null}
                                    {full ? <Pill tone="red">XI full</Pill> : null}
                                  </div>
                                </div>
                                <div className="shrink-0">
                                  <span
                                    className={[
                                      "inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold ring-1",
                                      selected ? "bg-red-600 text-white ring-red-500/40" : "bg-white/5 text-zinc-200 ring-white/10",
                                    ].join(" ")}
                                  >
                                    {selected ? "Remove" : "Add"}
                                  </span>
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </CardBody>
                </Card>
              </section>

              <section className="lg:col-span-5">
                <Card>
                  <CardHeader
                    title="Your XI"
                    subtitle="Assign captain, vice-captain, and wicketkeeper from your selected players."
                    right={
                      <button
                        type="button"
                        onClick={clearBuilder}
                        disabled={locked && selectedCount > 0}
                        className="rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-60"
                      >
                        Clear
                      </button>
                    }
                  />
                  <CardBody>
                    <div className="grid gap-3">
                      <TextField
                        value={builder.teamName}
                        onChange={(v) => setBuilder((p) => ({ ...p, teamName: v }))}
                        placeholder="Team name (e.g., Nondies XI)"
                        label="Team name"
                      />

                      <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs font-medium text-zinc-300">Validation</div>
                          <Pill tone={validation.ok ? "green" : "amber"}>{validation.ok ? "Ready to save" : "Incomplete"}</Pill>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-300">Players</span>
                            <span className={validation.checks.count ? "text-emerald-200" : "text-amber-200"}>
                              {selectedCount}/{SQUAD_SIZE}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-300">Budget</span>
                            <span className={validation.checks.withinBudget ? "text-emerald-200" : "text-red-200"}>
                              {money(validation.spend)} / {money(BUDGET)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-300">Captain</span>
                            <span className={validation.checks.captain ? "text-emerald-200" : "text-amber-200"}>
                              {builder.captain ? "Selected" : "Missing"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-300">Vice-captain</span>
                            <span className={validation.checks.viceCaptain ? "text-emerald-200" : "text-amber-200"}>
                              {builder.viceCaptain ? "Selected" : "Missing"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-300">Wicketkeeper</span>
                            <span className={validation.checks.keeper ? "text-emerald-200" : "text-amber-200"}>
                              {builder.keeper ? "Selected" : "Missing"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-300">Availability</span>
                            <span className={validation.checks.allAvailable ? "text-emerald-200" : "text-red-200"}>
                              {validation.checks.allAvailable ? "OK" : "Unavailable in XI"}
                            </span>
                          </div>
                        </div>

                        {!validation.ok && validation.problems.length > 0 ? (
                          <div className="mt-3 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200 ring-1 ring-amber-500/30">
                            <div className="font-semibold">To save your team:</div>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-200/90">
                              {validation.problems.slice(0, 5).map((p) => (
                                <li key={p}>{p}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>

                      <div className="divide-y divide-white/10 overflow-hidden rounded-2xl ring-1 ring-white/10">
                        {selectedSorted.length === 0 ? (
                          <div className="p-4 text-sm text-zinc-400">Pick players from the pool to build your XI.</div>
                        ) : (
                          selectedSorted.map((p) => {
                            const isC = builder.captain === p.id;
                            const isVC = builder.viceCaptain === p.id;
                            const isWK = builder.keeper === p.id;
                            return (
                              <div key={p.id} className="px-4 py-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-white">{p.name}</div>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                                      <span className="font-medium text-zinc-200">{money(p.price)}</span>
                                      {!p.available ? <Pill tone="amber">Unavailable</Pill> : null}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() => setRole("captain", p.id)}
                                        disabled={locked || isVC}
                                        className={[
                                          "rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition",
                                          isC ? "bg-red-600 text-white ring-red-500/40" : "bg-white/5 text-zinc-200 ring-white/10 hover:bg-white/10",
                                          locked || isVC ? "opacity-60" : "",
                                        ].join(" ")}
                                      >
                                        C
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setRole("viceCaptain", p.id)}
                                        disabled={locked || isC}
                                        className={[
                                          "rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition",
                                          isVC ? "bg-amber-500 text-black ring-amber-400/50" : "bg-white/5 text-zinc-200 ring-white/10 hover:bg-white/10",
                                          locked || isC ? "opacity-60" : "",
                                        ].join(" ")}
                                      >
                                        VC
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setRole("keeper", p.id)}
                                        disabled={locked}
                                        className={[
                                          "rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition",
                                          isWK ? "bg-sky-500 text-black ring-sky-400/50" : "bg-white/5 text-zinc-200 ring-white/10 hover:bg-white/10",
                                          locked ? "opacity-60" : "",
                                        ].join(" ")}
                                      >
                                        WK
                                      </button>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => toggleSelected(p.id)}
                                    disabled={locked}
                                    className="rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-60"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={saveTeam}
                        disabled={locked || !validation.ok}
                        className={[
                          "rounded-2xl px-4 py-3 text-sm font-bold transition",
                          "ring-1",
                          locked || !validation.ok
                            ? "bg-white/5 text-zinc-400 ring-white/10"
                            : "bg-red-600 text-white ring-red-500/40 hover:bg-red-500",
                        ].join(" ")}
                      >
                        Save team
                      </button>
                      <div className="text-xs text-zinc-500">
                        Saving will overwrite an existing team with the same name (case-insensitive).
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </section>
            </>
          ) : null}

          {tab === "leaderboard" ? (
            <section className="lg:col-span-12">
              <Card>
                <CardHeader title="Leaderboard" subtitle="Points are calculated from the current player stats." />
                <CardBody>
                  {leaderboard.length === 0 ? (
                    <div className="rounded-2xl bg-white/5 p-6 text-center ring-1 ring-white/10">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-600/15 ring-1 ring-red-500/30">
                        <Trophy className="h-6 w-6 text-red-300" />
                      </div>
                      <div className="mt-3 text-base font-semibold">No teams yet</div>
                      <div className="mt-1 text-sm text-zinc-400">Go to Draft and save your XI to appear here.</div>
                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={() => setTab("draft")}
                          className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-red-500/40 hover:bg-red-500"
                        >
                          Start drafting
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {leaderboard.map((row, idx) => (
                        <div key={row.team.id} className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 sm:p-5">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Pill tone={idx === 0 ? "green" : "neutral"}>#{idx + 1}</Pill>
                                <div className="truncate text-lg font-bold">{row.team.name}</div>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                <Pill>
                                  <span className="text-zinc-400">Captain</span>{" "}
                                  <span className="font-semibold text-zinc-200">{row.capName}</span>
                                </Pill>
                                <Pill>
                                  <span className="text-zinc-400">VC</span>{" "}
                                  <span className="font-semibold text-zinc-200">{row.vcName}</span>
                                </Pill>
                              </div>
                            </div>
                            <div className="shrink-0">
                              <div className="text-right">
                                <div className="text-xs font-medium text-zinc-400">Total points</div>
                                <div className="mt-1 text-3xl font-black tracking-tight text-white">{row.total}</div>
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

          {tab === "admin" ? (
            <section className="lg:col-span-12">
              <Card>
                <CardHeader
                  title="Admin"
                  subtitle="Manage weekly availability, prices and stats. Front-end only (localStorage)."
                  right={
                    adminAuthed ? (
                      <button
                        type="button"
                        onClick={adminLogout}
                        className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10"
                      >
                        <LogOut className="h-4 w-4" />
                        Logout
                      </button>
                    ) : null
                  }
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
                            <div className="mt-1 text-sm text-zinc-400">Enter the PIN to manage players and reset the gameweek.</div>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3">
                          <label className="block">
                            <div className="mb-1.5 text-xs font-medium text-zinc-300">PIN</div>
                            <input
                              ref={pinInputRef}
                              value={pin}
                              onChange={(e) => setPin(e.target.value)}
                              type="password"
                              inputMode="numeric"
                              placeholder="••••"
                              className="w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={adminLogin}
                            className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-red-500/40 hover:bg-red-500"
                          >
                            Login
                          </button>
                          <div className="text-xs text-zinc-500">
                            PIN is stored nowhere secure in v1. This is just a simple gate until you add proper auth.
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <button
                          type="button"
                          onClick={resetGameweek}
                          className="rounded-2xl bg-red-600 px-4 py-3 text-sm font-bold text-white ring-1 ring-red-500/40 hover:bg-red-500"
                        >
                          Reset gameweek (clear teams)
                        </button>
                        <button
                          type="button"
                          onClick={() => bulkAvailability(true)}
                          className="rounded-2xl bg-white/5 px-4 py-3 text-sm font-bold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10"
                        >
                          Activate all players
                        </button>
                        <button
                          type="button"
                          onClick={() => bulkAvailability(false)}
                          className="rounded-2xl bg-white/5 px-4 py-3 text-sm font-bold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10"
                        >
                          Deactivate all players
                        </button>
                        <button
                          type="button"
                          onClick={clearBuilder}
                          className="rounded-2xl bg-white/5 px-4 py-3 text-sm font-bold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10"
                        >
                          Clear in-progress draft
                        </button>
                      </div>

                      <div className="overflow-hidden rounded-2xl ring-1 ring-white/10">
                        <div className="overflow-x-auto bg-zinc-950/40">
                          <table className="w-full min-w-[900px] border-collapse">
                            <thead className="bg-black/40">
                              <tr className="text-left text-xs font-semibold text-zinc-300">
                                <th className="px-4 py-3">Player</th>
                                <th className="px-4 py-3">Avail</th>
                                <th className="px-4 py-3">Price</th>
                                <th className="px-4 py-3">Runs</th>
                                <th className="px-4 py-3">Wkts</th>
                                <th className="px-4 py-3">Catches</th>
                                <th className="px-4 py-3">Points</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10">
                              {players
                                .slice()
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((p) => {
                                  const pts = calculatePoints(p);
                                  return (
                                    <tr key={p.id} className="text-sm text-zinc-100">
                                      <td className="px-4 py-3 font-semibold text-white">{p.name}</td>
                                      <td className="px-4 py-3">
                                        <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                                          <input
                                            type="checkbox"
                                            checked={p.available}
                                            onChange={(e) => updatePlayer(p.id, { available: e.target.checked })}
                                            className="h-4 w-4 rounded border-white/20 bg-white/10 text-red-600 focus:ring-red-500/60"
                                          />
                                          {p.available ? <span className="text-emerald-200">On</span> : <span className="text-amber-200">Off</span>}
                                        </label>
                                      </td>
                                      <td className="px-4 py-3">
                                        <NumberInput value={p.price} onChange={(v) => updatePlayer(p.id, { price: v })} />
                                      </td>
                                      <td className="px-4 py-3">
                                        <NumberInput value={p.runs} onChange={(v) => updatePlayer(p.id, { runs: v })} />
                                      </td>
                                      <td className="px-4 py-3">
                                        <NumberInput value={p.wickets} onChange={(v) => updatePlayer(p.id, { wickets: v })} />
                                      </td>
                                      <td className="px-4 py-3">
                                        <NumberInput value={p.catches} onChange={(v) => updatePlayer(p.id, { catches: v })} />
                                      </td>
                                      <td className="px-4 py-3">
                                        <span className="font-bold text-white">{pts}</span>
                                      </td>
                                    </tr>
                                  );
                                })}
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

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-black/80 backdrop-blur sm:hidden">
        <div className="mx-auto flex max-w-6xl gap-2 px-3 py-3">
          <TabButton active={tab === "draft"} onClick={() => setTab("draft")} icon={<Shield className="h-4 w-4" />} label="Draft" />
          <TabButton active={tab === "leaderboard"} onClick={() => setTab("leaderboard")} icon={<Trophy className="h-4 w-4" />} label="Leaderboard" />
          <TabButton active={tab === "admin"} onClick={() => setTab("admin")} icon={<Settings className="h-4 w-4" />} label="Admin" />
        </div>
      </nav>
    </div>
  );
}

