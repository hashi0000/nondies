"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Coins,
  History,
  ShoppingBag,
  Sparkles,
  Zap,
} from "lucide-react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { ActivePerksSummary } from "@/components/ActivePerksSummary";
import {
  buildTeamFantasyShopAfterPurchase,
  formatFantasyPoints,
  hasConflictingActiveBooster,
  isPaidBooster,
  parseTeamFantasyShop,
  SHOP_ITEMS,
  SHOP_PLANNED_RULES,
  shopWalletFromTeam,
  type ShopItem,
  type TeamFantasyShopState,
} from "@/lib/fantasyShop";
import { resolveLuckyDipPlayerId } from "@/lib/shopScoring";
import { appendPointsAudit, parsePointsAudit } from "@/lib/teamPointsBackup";
import {
  parsePlayerStatLine,
  totalEarnedFantasyPoints,
  type PointsTeam,
  type ScoringPlayerLine,
} from "@/lib/teamFantasyPoints";

const APP_NAME = "Nondies Fantasy League";

type ShopPlayer = { id: number; name: string; role?: string };

type SavedSquad = {
  name: string;
  players: number[];
  captain: number | null;
  viceCaptain: number | null;
  keeper: number | null;
  playerJoinedGameweek?: Record<string, number>;
};

const CATEGORY_LABEL: Record<ShopItem["category"], string> = {
  batting: "Batting",
  bowling: "Bowling",
  wildcard: "Wildcard",
  captain: "Captain",
  utility: "Utility",
};

const CATEGORY_ACCENT: Record<ShopItem["category"], string> = {
  batting: "border-amber-500/35 bg-amber-500/10 ring-amber-500/25",
  bowling: "border-sky-500/35 bg-sky-500/10 ring-sky-500/25",
  wildcard: "border-violet-500/35 bg-violet-500/10 ring-violet-500/25",
  captain: "border-red-500/35 bg-red-500/10 ring-red-500/25",
  utility: "border-emerald-500/35 bg-emerald-500/10 ring-emerald-500/25",
};

function itemStatusLabel(item: ShopItem, owned: boolean, active: boolean): string {
  if (item.alwaysActive) return "Included — free for everyone";
  if (active) return "Active this gameweek";
  if (owned) return "Owned — not active this GW";
  return "Not owned";
}

function ShopItemCard({
  item,
  balance,
  owned,
  active,
  disabledReason,
  onBuy,
}: {
  item: ShopItem;
  balance: number;
  owned: boolean;
  active: boolean;
  disabledReason: string | null;
  onBuy: () => void;
}) {
  const canAfford = item.alwaysFree || balance >= item.cost;
  const buyDisabled =
    Boolean(disabledReason) ||
    item.alwaysFree ||
    item.alwaysActive ||
    (owned && item.permanent) ||
    (active && !item.alwaysActive);

  return (
    <article
      className={[
        "flex h-full flex-col rounded-2xl border p-4 ring-1 transition",
        CATEGORY_ACCENT[item.category],
        active ? "shadow-[0_0_0_1px_rgba(52,211,153,0.35)]" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            {CATEGORY_LABEL[item.category]}
          </div>
          <h3 className="mt-1 text-lg font-semibold text-white">{item.name}</h3>
        </div>
        <div className="shrink-0 text-right">
          {item.alwaysFree ? (
            <span className="rounded-full bg-emerald-600/25 px-2.5 py-1 text-xs font-bold text-emerald-100 ring-1 ring-emerald-500/40">
              Free
            </span>
          ) : (
            <span className="text-lg font-bold tabular-nums text-amber-200">{formatFantasyPoints(item.cost)}</span>
          )}
        </div>
      </div>

      <p className="mt-3 flex-1 text-sm leading-relaxed text-zinc-300">{item.description}</p>

      <div className="mt-3 rounded-lg bg-black/25 px-3 py-2 text-xs ring-1 ring-white/10">
        <span className="font-semibold text-zinc-400">Status: </span>
        <span className="text-zinc-100">{itemStatusLabel(item, owned, active)}</span>
        {!item.alwaysFree && !item.alwaysActive ? (
          <>
            <span className="mx-2 text-zinc-600">·</span>
            <span className={canAfford ? "font-semibold text-emerald-300" : "font-semibold text-red-300"}>
              {canAfford ? "Enough FP" : `Need ${formatFantasyPoints(item.cost - balance)} more`}
            </span>
          </>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {item.alwaysActive ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/20 px-2.5 py-1 text-xs font-semibold text-emerald-100 ring-1 ring-emerald-500/35">
            <Check className="h-3.5 w-3.5" />
            Active for everyone
          </span>
        ) : null}
        {owned && !item.alwaysActive ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-zinc-200 ring-1 ring-white/15">
            Owned
          </span>
        ) : null}
        {active && !item.alwaysActive ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-600/20 px-2.5 py-1 text-xs font-semibold text-sky-100 ring-1 ring-sky-500/35">
            <Zap className="h-3.5 w-3.5" />
            Active this GW
          </span>
        ) : null}
        {item.permanent ? (
          <span className="rounded-full bg-violet-600/20 px-2.5 py-1 text-xs font-semibold text-violet-100 ring-1 ring-violet-500/35">
            Season-long
          </span>
        ) : null}
      </div>

      <div className="mt-4">
        {item.alwaysActive ? (
          <button
            type="button"
            disabled
            className="w-full rounded-xl bg-white/5 px-4 py-2.5 text-sm font-semibold text-zinc-400 ring-1 ring-white/10"
          >
            Included
          </button>
        ) : owned && item.permanent ? (
          <button
            type="button"
            disabled
            className="w-full rounded-xl bg-white/5 px-4 py-2.5 text-sm font-semibold text-zinc-400 ring-1 ring-white/10"
          >
            Already owned
          </button>
        ) : (
          <button
            type="button"
            onClick={onBuy}
            disabled={buyDisabled || !canAfford}
            className={[
              "w-full rounded-xl px-4 py-2.5 text-sm font-bold ring-1 transition",
              buyDisabled || !canAfford
                ? "cursor-not-allowed bg-white/5 text-zinc-500 ring-white/10"
                : "bg-red-600 text-white ring-red-500/50 hover:bg-red-500",
            ].join(" ")}
          >
            {!canAfford ? "Not enough FP" : active ? "Active" : owned ? "Activate" : "Buy"}
          </button>
        )}
        {disabledReason ? (
          <p className="mt-2 text-xs text-amber-200/90">{disabledReason}</p>
        ) : !canAfford && !item.alwaysFree ? (
          <p className="mt-2 text-xs text-zinc-500">Need {formatFantasyPoints(item.cost - balance)} more.</p>
        ) : null}
      </div>
    </article>
  );
}

export default function FantasyShopPage() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [leagueBalance, setLeagueBalance] = useState(0);
  const [currentGameweek, setCurrentGameweek] = useState<number | null>(null);
  const [gameweekReady, setGameweekReady] = useState(false);
  const [teamShop, setTeamShop] = useState<TeamFantasyShopState | null>(null);
  const [hasTeamDoc, setHasTeamDoc] = useState(false);
  const [pendingItem, setPendingItem] = useState<ShopItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [savedSquad, setSavedSquad] = useState<SavedSquad | null>(null);
  const [playersById, setPlayersById] = useState<Map<number, ShopPlayer>>(new Map());
  const [playerStatsById, setPlayerStatsById] = useState<Map<number, ScoringPlayerLine>>(new Map());

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthUser(u);
      setAuthReady(true);
      if (!u) router.replace("/login");
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!authUser) return;
    const unsubGs = onSnapshot(doc(db, "gameState", "current"), (snap) => {
      const gw = snap.exists() ? Math.floor(Number(snap.data()?.currentGameweek ?? 1)) : 1;
      setCurrentGameweek(Number.isFinite(gw) && gw >= 1 ? gw : 1);
      setGameweekReady(true);
    });
    return () => unsubGs();
  }, [authUser]);

  useEffect(() => {
    if (!authUser || !gameweekReady || currentGameweek == null) return;
    const unsubTeam = onSnapshot(doc(db, "teams", authUser.uid), (snap) => {
      setHasTeamDoc(snap.exists());
      const pts = snap.exists() ? Number(snap.data()?.cumulativePoints ?? 0) : 0;
      setLeagueBalance(Number.isFinite(pts) ? Math.round(pts) : 0);
      if (snap.exists()) {
        const data = snap.data();
        setTeamShop(parseTeamFantasyShop(data?.fantasyShop, currentGameweek));
        setSavedSquad({
          name: String(data?.name ?? "My team"),
          players: Array.isArray(data?.players)
            ? data.players.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n))
            : [],
          captain: data?.captain != null ? Number(data.captain) : null,
          viceCaptain: data?.viceCaptain != null ? Number(data.viceCaptain) : null,
          keeper: data?.keeper != null ? Number(data.keeper) : null,
          playerJoinedGameweek:
            data?.playerJoinedGameweek && typeof data.playerJoinedGameweek === "object"
              ? (data.playerJoinedGameweek as Record<string, number>)
              : undefined,
        });
      } else {
        setSavedSquad(null);
        setTeamShop(null);
      }
    });
    const unsubPlayers = onSnapshot(collection(db, "players"), (snap) => {
      const map = new Map<number, ShopPlayer>();
      const stats = new Map<number, ScoringPlayerLine>();
      for (const d of snap.docs) {
        const data = d.data();
        const id = Number(data.id ?? d.id);
        if (!Number.isFinite(id)) continue;
        map.set(id, { id, name: String(data.name ?? `Player ${id}`), role: data.role ? String(data.role) : undefined });
        stats.set(id, parsePlayerStatLine(data as Record<string, unknown>));
      }
      setPlayersById(map);
      setPlayerStatsById(stats);
    });
    return () => {
      unsubTeam();
      unsubPlayers();
    };
  }, [authUser, currentGameweek, gameweekReady]);

  const pointsTeam = useMemo((): PointsTeam | null => {
    if (!savedSquad || !authUser) return null;
    return {
      uid: authUser.uid,
      players: savedSquad.players,
      captain: savedSquad.captain,
      viceCaptain: savedSquad.viceCaptain,
      cumulativePoints: leagueBalance,
      playerJoinedGameweek: savedSquad.playerJoinedGameweek,
      fantasyShop: teamShop ?? undefined,
    };
  }, [savedSquad, leagueBalance, authUser, teamShop]);

  const scoringGameweek = currentGameweek ?? 1;

  const spendableBalance = useMemo(() => {
    if (!pointsTeam || pointsTeam.players.length === 0 || currentGameweek == null) return leagueBalance;
    return totalEarnedFantasyPoints(pointsTeam, playerStatsById, currentGameweek);
  }, [pointsTeam, playerStatsById, currentGameweek, leagueBalance]);

  const wallet = useMemo(() => {
    if (!teamShop) return null;
    const base = shopWalletFromTeam(spendableBalance, teamShop);
    return { ...base, balance: spendableBalance };
  }, [teamShop, spendableBalance]);

  const displayBalance = spendableBalance;

  const sortedItems = useMemo(
    () => [...SHOP_ITEMS].sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name)),
    [],
  );

  const squadRows = useMemo(() => {
    if (!savedSquad?.players.length) return [];
    const luckyId =
      teamShop && authUser
        ? resolveLuckyDipPlayerId(teamShop, savedSquad.players, authUser.uid)
        : null;
    return savedSquad.players
      .map((id) => {
        const player = playersById.get(id);
        return {
          id,
          name: player?.name ?? `Player ${id}`,
          isCaptain: savedSquad.captain === id,
          isVice: savedSquad.viceCaptain === id,
          isKeeper: savedSquad.keeper === id,
          isLuckyDip: luckyId === id,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [savedSquad, playersById, teamShop, authUser]);

  function requestPurchase(item: ShopItem) {
    setNotice(null);
    if (item.alwaysFree || item.alwaysActive) return;
    if (!wallet) return;
    if (!gameweekReady || currentGameweek == null) {
      setNotice("Still loading the current gameweek — try again in a moment.");
      return;
    }

    const alreadyOwned = wallet.ownedItemIds.includes(item.id);
    if (!alreadyOwned && spendableBalance < item.cost) {
      setNotice(`Not enough Fantasy Points — you need ${formatFantasyPoints(item.cost)} (you have ${formatFantasyPoints(spendableBalance)}).`);
      return;
    }

    const conflict = hasConflictingActiveBooster(item, wallet.activeItemIds);
    if (conflict && isPaidBooster(item) && !wallet.activeItemIds.includes(item.id)) {
      setNotice(
        `${conflict.name} is already active in that slot. Scoring boosters share one slot; transfer perks share another — you can use one of each.`,
      );
      return;
    }

    setPendingItem(item);
  }

  async function confirmPurchase() {
    if (!pendingItem || !wallet || !teamShop || !authUser) return;
    if (!gameweekReady || currentGameweek == null) {
      setNotice("Still loading the current gameweek — try again in a moment.");
      return;
    }
    const item = pendingItem;
    const alreadyOwned = wallet.ownedItemIds.includes(item.id);
    const cost = alreadyOwned ? 0 : item.cost;
    if (!alreadyOwned && spendableBalance < cost) return;
    if (!hasTeamDoc) {
      setNotice("Save your squad in Draft first before spending Fantasy Points.");
      return;
    }

    const nextShop = buildTeamFantasyShopAfterPurchase({
      shop: teamShop,
      item,
      gameweek: currentGameweek,
      alreadyOwned,
      squadPlayerIds: savedSquad?.players ?? [],
    });
    const nextBalance = Math.max(0, leagueBalance - cost);

    setBuying(true);
    setNotice(null);
    try {
      const teamRef = doc(db, "teams", authUser.uid);
      const teamSnap = await getDoc(teamRef);
      const existingAudit = parsePointsAudit(teamSnap.exists() ? teamSnap.data()?.pointsAudit : undefined);
      const patch: Record<string, unknown> = {
        cumulativePoints: nextBalance,
        fantasyShop: nextShop,
      };
      if (cost > 0) {
        patch.pointsAudit = appendPointsAudit(existingAudit, {
          at: new Date().toISOString(),
          gameweek: currentGameweek,
          cumulativePoints: nextBalance,
          source: `shop:${item.id}`,
        });
      }
      await updateDoc(teamRef, patch);
      setPendingItem(null);
      setNotice(
        alreadyOwned
          ? `${item.name} activated for GW${currentGameweek}.`
          : `${item.name} purchased — ${formatFantasyPoints(cost)} deducted from your league total.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Purchase failed.";
      setNotice(`Could not complete purchase: ${msg}`);
    } finally {
      setBuying(false);
    }
  }

  if (!authReady || !authUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#080808] text-white">
        <div className="rounded-2xl bg-white/5 p-6 text-center ring-1 ring-white/10">
          <div className="text-base font-semibold">Loading Fantasy Shop…</div>
          <div className="mt-1 text-sm text-zinc-400">Checking account access.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080808] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-red-800/8 blur-[140px]" />
      </div>

      <div className="relative mx-auto w-full max-w-6xl px-4 pb-10 pt-6 sm:px-6">
        <header className="rounded-2xl border border-white/8 bg-zinc-900/60 px-4 py-4 backdrop-blur-md sm:px-6 sm:py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex items-center gap-3">
              <div className="relative h-10 w-10 shrink-0 drop-shadow-lg">
                <Image src="/logo.png" alt="Nondies CC" fill className="object-contain" priority />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Fantasy Shop</h1>
                <p className="mt-0.5 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">{APP_NAME}</p>
              </div>
            </div>
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-medium text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to game
            </Link>
          </div>
        </header>

        <section className="mt-5 rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/15 to-zinc-900/60 p-5 ring-1 ring-amber-500/25 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 ring-1 ring-amber-500/40">
                <Coins className="h-6 w-6 text-amber-200" />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-amber-200/80">
                  Your Fantasy Points
                </div>
                <div className="mt-1 text-3xl font-bold tabular-nums text-white">{formatFantasyPoints(displayBalance)}</div>
                <p className="mt-1 text-xs text-zinc-400">
                  Your league total for GW{scoringGameweek} — completed gameweeks plus this week&apos;s live squad score.
                  Purchases deduct from your team total on the leaderboard.
                </p>
              </div>
            </div>
            <div className="rounded-xl bg-black/25 px-4 py-3 text-sm text-zinc-300 ring-1 ring-white/10">
              <div className="inline-flex items-center gap-2 font-semibold text-zinc-100">
                <Sparkles className="h-4 w-4 text-amber-300" />
                Spend FP on power-ups
              </div>
              <p className="mt-1 text-xs text-zinc-400">Buy power-ups with points you&apos;ve earned this season.</p>
            </div>
          </div>
        </section>

        <ActivePerksSummary
          className="mt-5"
          activeItemIds={wallet?.activeItemIds ?? ["powerplay"]}
          gameweek={scoringGameweek}
        />

        <section className="mt-5 rounded-2xl border border-white/10 bg-zinc-900/50 p-5 ring-1 ring-white/10">
          <div className="text-sm font-semibold text-white">Your saved squad</div>
          <p className="mt-1 text-xs text-zinc-500">
            Active boosters apply to these players. Lucky Dip highlights the randomly chosen 1.5× player for this gameweek.
          </p>
          {squadRows.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {squadRows.map((row) => (
                <div
                  key={row.id}
                  className="inline-flex items-center gap-2 rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10"
                >
                  <span className="font-medium text-zinc-100">{row.name}</span>
                  <span className="flex gap-1">
                    {row.isCaptain ? (
                      <span className="rounded bg-red-600/30 px-1.5 py-0.5 text-[10px] font-bold text-red-100 ring-1 ring-red-500/40">
                        C
                      </span>
                    ) : null}
                    {row.isVice ? (
                      <span className="rounded bg-amber-600/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-100 ring-1 ring-amber-500/40">
                        VC
                      </span>
                    ) : null}
                    {row.isKeeper ? (
                      <span className="rounded bg-sky-600/30 px-1.5 py-0.5 text-[10px] font-bold text-sky-100 ring-1 ring-sky-500/40">
                        WK
                      </span>
                    ) : null}
                    {row.isLuckyDip ? (
                      <span className="rounded bg-violet-600/30 px-1.5 py-0.5 text-[10px] font-bold text-violet-100 ring-1 ring-violet-500/40">
                        Lucky Dip
                      </span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">
              No saved squad yet — pick your 7 in Draft before buying squad boosters.
            </p>
          )}
          {savedSquad?.name ? (
            <p className="mt-3 text-xs text-zinc-500">
              Team: <span className="text-zinc-300">{savedSquad.name}</span>
            </p>
          ) : null}
        </section>

        {notice ? (
          <div className="mt-4 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 ring-1 ring-amber-500/30">
            {notice}
          </div>
        ) : null}

        <section className="mt-6">
          <div className="mb-4 flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-red-300" />
            <h2 className="text-lg font-semibold text-white">Power-ups</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sortedItems.map((item) => {
              const owned = wallet?.ownedItemIds.includes(item.id) ?? item.alwaysActive ?? false;
              const active = wallet?.activeItemIds.includes(item.id) ?? item.alwaysActive ?? false;
              let disabledReason: string | null = null;
              if (!gameweekReady) {
                disabledReason = "Loading current gameweek…";
              } else if (wallet && isPaidBooster(item)) {
                const conflict = hasConflictingActiveBooster(item, wallet.activeItemIds);
                if (conflict && !active) {
                  disabledReason = `Conflicts with active ${conflict.name}.`;
                }
              }
              return (
                <ShopItemCard
                  key={item.id}
                  item={item}
                  balance={displayBalance}
                  owned={owned}
                  active={active}
                  disabledReason={disabledReason}
                  onBuy={() => requestPurchase(item)}
                />
              );
            })}
          </div>
        </section>

        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5 ring-1 ring-white/10">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <History className="h-4 w-4 text-zinc-400" />
              Purchase history
            </div>
            <p className="mt-1 text-xs text-zinc-500">Saved to your team — synced across devices.</p>
            {wallet && wallet.purchaseHistory.length > 0 ? (
              <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto">
                {wallet.purchaseHistory.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-black/30 px-3 py-2.5 text-sm ring-1 ring-white/10"
                  >
                    <div>
                      <div className="font-medium text-zinc-100">{row.itemName}</div>
                      <div className="text-xs text-zinc-500">
                        GW{row.gameweek ?? "?"} · {new Date(row.purchasedAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="shrink-0 font-semibold tabular-nums text-amber-200">
                      {row.cost === 0 ? "Free" : `−${formatFantasyPoints(row.cost)}`}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-zinc-500">No purchases yet this session.</p>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5 ring-1 ring-white/10">
            <div className="text-sm font-semibold text-white">Planned shop rules</div>
            <p className="mt-1 text-xs text-zinc-500">Balancing guidelines for when boosters go live.</p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-300">
              {SHOP_PLANNED_RULES.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {pendingItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-5 ring-1 ring-white/15 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">
              {wallet?.ownedItemIds.includes(pendingItem.id) ? "Confirm activation" : "Confirm purchase"}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">
              {wallet?.ownedItemIds.includes(pendingItem.id) ? (
                <>
                  Activate <strong className="text-white">{pendingItem.name}</strong> for GW{scoringGameweek}?
                </>
              ) : (
                <>
                  Spend <strong className="text-amber-200">{formatFantasyPoints(pendingItem.cost)}</strong> on{" "}
                  <strong className="text-white">{pendingItem.name}</strong>?
                </>
              )}
            </p>
            <p className="mt-2 text-xs text-zinc-500">{pendingItem.description}</p>
            <p className="mt-3 text-xs text-amber-200/90">
              {wallet?.ownedItemIds.includes(pendingItem.id)
                ? "Re-activating an owned perk does not cost extra FP."
                : `Your league total will drop by ${formatFantasyPoints(pendingItem.cost)}. Bowler/Batter Boost, Triple Captain, Lucky Dip, Powerplay, and transfer perks apply to this gameweek once confirmed.`}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void confirmPurchase()}
                disabled={buying}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white ring-1 ring-red-500/50 hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {buying ? "Processing…" : wallet?.ownedItemIds.includes(pendingItem.id) ? "Activate" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setPendingItem(null)}
                disabled={buying}
                className="flex-1 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-200 ring-1 ring-white/15 hover:bg-white/15"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
