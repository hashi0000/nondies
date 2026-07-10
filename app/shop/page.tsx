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
import { collection, doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  formatFantasyPoints,
  hasConflictingActiveBooster,
  isPaidBooster,
  SHOP_ITEMS,
  SHOP_PLANNED_RULES,
  shopItemById,
  type ShopItem,
  type ShopItemId,
  type ShopPurchaseRecord,
  type ShopWalletState,
} from "@/lib/fantasyShop";

const APP_NAME = "Nondies Fantasy League";

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

function emptyWallet(balance: number): ShopWalletState {
  return {
    balance,
    ownedItemIds: ["powerplay"],
    activeItemIds: ["powerplay"],
    purchaseHistory: [],
  };
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
  const [currentGameweek, setCurrentGameweek] = useState(1);
  const [wallet, setWallet] = useState<ShopWalletState | null>(null);
  const [pendingItem, setPendingItem] = useState<ShopItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    const gsRef = doc(db, "gameState", "current");
    const unsubGs = onSnapshot(gsRef, (snap) => {
      setCurrentGameweek(snap.exists() ? Number(snap.data()?.currentGameweek ?? 1) : 1);
    });
    const unsubTeam = onSnapshot(doc(db, "teams", authUser.uid), (snap) => {
      const pts = snap.exists() ? Number(snap.data()?.cumulativePoints ?? 0) : 0;
      setLeagueBalance(Number.isFinite(pts) ? Math.round(pts) : 0);
    });
    return () => {
      unsubGs();
      unsubTeam();
    };
  }, [authUser]);

  useEffect(() => {
    if (wallet == null) {
      setWallet(emptyWallet(leagueBalance));
    }
  }, [leagueBalance, wallet]);

  const displayBalance = wallet?.balance ?? leagueBalance;

  const sortedItems = useMemo(
    () => [...SHOP_ITEMS].sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name)),
    [],
  );

  function requestPurchase(item: ShopItem) {
    setNotice(null);
    if (item.alwaysFree || item.alwaysActive) return;
    if (!wallet) return;

    const alreadyOwned = wallet.ownedItemIds.includes(item.id);
    if (!alreadyOwned && wallet.balance < item.cost) {
      setNotice(`Not enough Fantasy Points — you need ${formatFantasyPoints(item.cost)}.`);
      return;
    }

    const conflict = hasConflictingActiveBooster(item, wallet.activeItemIds);
    if (conflict && isPaidBooster(item) && !wallet.activeItemIds.includes(item.id)) {
      setNotice(`Only one paid booster can be active per gameweek (${conflict.name} is already active).`);
      return;
    }

    setPendingItem(item);
  }

  function confirmPurchase() {
    if (!pendingItem || !wallet) return;
    const item = pendingItem;
    const alreadyOwned = wallet.ownedItemIds.includes(item.id);
    const cost = alreadyOwned ? 0 : item.cost;
    if (!alreadyOwned && wallet.balance < cost) return;

    const record: ShopPurchaseRecord = {
      id: `${Date.now()}-${item.id}`,
      itemId: item.id,
      itemName: item.name,
      cost,
      purchasedAt: new Date().toISOString(),
      gameweek: currentGameweek,
    };

    const ownedItemIds = wallet.ownedItemIds.includes(item.id)
      ? wallet.ownedItemIds
      : [...wallet.ownedItemIds, item.id];

    let activeItemIds = [...wallet.activeItemIds];
    if (isPaidBooster(item)) {
      activeItemIds = activeItemIds.filter((id) => {
        const active = shopItemById(id);
        return !active || !isPaidBooster(active) || id === "powerplay";
      });
    }
    if (!activeItemIds.includes(item.id)) activeItemIds.push(item.id);

    setWallet({
      balance: wallet.balance - cost,
      ownedItemIds,
      activeItemIds,
      purchaseHistory: [record, ...wallet.purchaseHistory],
    });
    setPendingItem(null);
    setNotice(
      alreadyOwned
        ? `${item.name} activated for GW${currentGameweek} — UI preview only.`
        : `${item.name} purchased — UI preview only (game logic not wired yet).`,
    );
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
                  Preview balance from your league total (GW{currentGameweek}). Wallet &amp; scoring hooks coming later.
                </p>
              </div>
            </div>
            <div className="rounded-xl bg-black/25 px-4 py-3 text-sm text-zinc-300 ring-1 ring-white/10">
              <div className="inline-flex items-center gap-2 font-semibold text-zinc-100">
                <Sparkles className="h-4 w-4 text-amber-300" />
                Spend FP on power-ups
              </div>
              <p className="mt-1 text-xs text-zinc-400">Purchases below are UI-only until game logic is connected.</p>
            </div>
          </div>
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
              if (wallet && isPaidBooster(item)) {
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
            <p className="mt-1 text-xs text-zinc-500">Session preview — will persist to Firebase when game logic ships.</p>
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
                  Activate <strong className="text-white">{pendingItem.name}</strong> for GW{currentGameweek}?
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
              This is a UI preview only — no league scoring or transfers will change yet.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={confirmPurchase}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white ring-1 ring-red-500/50 hover:bg-red-500"
              >
                {wallet?.ownedItemIds.includes(pendingItem.id) ? "Activate" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setPendingItem(null)}
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
