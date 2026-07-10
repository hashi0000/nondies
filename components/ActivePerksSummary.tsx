"use client";

import Link from "next/link";
import { ShoppingBag, Zap } from "lucide-react";
import type { ShopItemId } from "@/lib/fantasyShop";
import { paidActivePerks } from "@/lib/shopWalletStorage";

type ActivePerksSummaryProps = {
  activeItemIds: ShopItemId[];
  gameweek: number;
  compact?: boolean;
  className?: string;
};

export function ActivePerksSummary({
  activeItemIds,
  gameweek,
  compact = false,
  className = "",
}: ActivePerksSummaryProps) {
  const paid = paidActivePerks(activeItemIds);

  if (compact) {
    return (
      <Link
        href="/shop"
        title={paid.length ? `Active perks GW${gameweek}` : "No paid perks — open Fantasy Shop"}
        className={[
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ring-1 transition hover:opacity-90",
          paid.length
            ? "bg-sky-500/15 text-sky-100 ring-sky-500/35"
            : "bg-white/5 text-zinc-400 ring-white/10",
          className,
        ].join(" ")}
      >
        <Zap className="h-3.5 w-3.5 shrink-0" />
        {paid.length ? (
          <span className="max-w-[14rem] truncate font-medium">{paid.map((p) => p.name).join(", ")}</span>
        ) : (
          <span>No perks active</span>
        )}
      </Link>
    );
  }

  return (
    <section
      className={[
        "rounded-2xl border p-4 ring-1 sm:p-5",
        paid.length
          ? "border-sky-500/30 bg-gradient-to-br from-sky-500/10 to-zinc-900/60 ring-sky-500/25"
          : "border-white/10 bg-zinc-900/50 ring-white/10",
        className,
      ].join(" ")}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-white">
            <Zap className={`h-4 w-4 ${paid.length ? "text-sky-300" : "text-zinc-500"}`} />
            Active perks · GW{gameweek}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Powerplay is always included for everyone. Paid boosters show here when activated.
          </p>
        </div>
        <Link
          href="/shop"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 ring-1 ring-white/10 transition hover:bg-white/10"
        >
          <ShoppingBag className="h-3.5 w-3.5" />
          Fantasy Shop
        </Link>
      </div>

      {paid.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-2">
          {paid.map((item) => (
            <li
              key={item.id}
              className="rounded-xl bg-sky-600/20 px-3 py-2 text-sm font-medium text-sky-100 ring-1 ring-sky-500/35"
            >
              {item.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-zinc-400">
          No paid perks active this gameweek.{" "}
          <span className="text-emerald-300/90">Powerplay</span> is on automatically.
        </p>
      )}
    </section>
  );
}
