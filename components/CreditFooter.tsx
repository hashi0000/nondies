"use client";

import { usePathname } from "next/navigation";

/**
 * Thin strip always pinned on-screen (below the mobile tab bar on `/`, or bottom safe-area elsewhere).
 * Headlines on each route also repeat the credit so it’s visible without scrolling past `min-h-screen` blocks.
 */
export function CreditFooter() {
  const pathname = usePathname();
  const onMainApp = pathname === "/";
  // Login & rules show the credit in-page; avoid a fixed strip covering buttons.
  if (pathname === "/login" || pathname === "/rules") return null;

  return (
    <footer
      role="contentinfo"
      className={[
        "shrink-0 border-t border-white/10 bg-zinc-950/95 px-4 py-2 text-center text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500 backdrop-blur-md",
        "pointer-events-none",
        // Mobile: pinned so it isn’t pushed below min-h-screen; sm+: in-flow (header also shows the credit).
        onMainApp
          ? "fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] z-[46] sm:relative sm:inset-auto sm:bottom-auto sm:z-auto sm:mt-auto sm:py-3 sm:pointer-events-auto"
          : "fixed inset-x-0 bottom-[max(0.5rem,env(safe-area-inset-bottom,0px))] z-[46] sm:relative sm:inset-auto sm:bottom-auto sm:z-auto sm:mt-auto sm:py-3 sm:pointer-events-auto",
      ].join(" ")}
    >
      <span className="text-zinc-600">Made by </span>
      <span className="font-semibold tracking-[0.12em] text-red-400">Hashim</span>
    </footer>
  );
}
