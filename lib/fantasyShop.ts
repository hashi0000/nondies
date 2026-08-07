/** Fantasy Shop — catalog and types (UI + future game logic). */

export type ShopItemId =
  | "batter-boost"
  | "bowler-boost"
  | "wildcard-lite"
  | "full-wildcard"
  | "triple-captain"
  | "captains-confidence"
  | "lucky-dip"
  | "powerplay"
  | "free-transfer"
  | "rain-dance";

export type ShopItemCategory = "batting" | "bowling" | "wildcard" | "captain" | "utility";

export type ShopItem = {
  id: ShopItemId;
  name: string;
  cost: number;
  description: string;
  category: ShopItemCategory;
  /** Free for everyone — no FP spend (e.g. Powerplay). */
  alwaysFree?: boolean;
  /** Shown as permanently owned / always on (Powerplay). */
  alwaysActive?: boolean;
  /** One purchase lasts the whole season (e.g. Full Wildcard). */
  permanent?: boolean;
  /** Cannot be active alongside Triple Captain. */
  conflictsWith?: ShopItemId[];
};

export const SHOP_ITEMS: readonly ShopItem[] = [
  {
    id: "batter-boost",
    name: "Batter Boost",
    cost: 50,
    description: "Double batting points for one gameweek.",
    category: "batting",
  },
  {
    id: "bowler-boost",
    name: "Bowler Boost",
    cost: 50,
    description: "Double bowling points for one gameweek.",
    category: "bowling",
  },
  {
    id: "wildcard-lite",
    name: "Wildcard Lite",
    cost: 100,
    description:
      "Make unlimited squad changes for this gameweek only (no transfer point hits).",
    category: "wildcard",
  },
  {
    id: "full-wildcard",
    name: "Full Wildcard",
    cost: 250,
    description: "Permanently rebuild your squad with unlimited transfers for the rest of the season.",
    category: "wildcard",
    permanent: true,
  },
  {
    id: "triple-captain",
    name: "Triple Captain",
    cost: 120,
    description: "Captain earns triple points for one gameweek.",
    category: "captain",
    conflictsWith: ["captains-confidence"],
  },
  {
    id: "captains-confidence",
    name: "Captain's Confidence",
    cost: 50,
    description:
      "Locks in your captain's double points for this gameweek (same 2× as the standard captain bonus). Cannot be combined with Triple Captain.",
    category: "captain",
    conflictsWith: ["triple-captain"],
  },
  {
    id: "lucky-dip",
    name: "Lucky Dip",
    cost: 60,
    description: "Randomly selects one player in your squad to receive a 1.5× points multiplier for the gameweek.",
    category: "utility",
  },
  {
    id: "powerplay",
    name: "Powerplay",
    cost: 0,
    description:
      "Once per gameweek, your highest scoring player automatically receives double points. This is free and available to everyone.",
    category: "utility",
    alwaysFree: true,
    alwaysActive: true,
  },
  {
    id: "free-transfer",
    name: "Free Transfer",
    cost: 75,
    description: "Grants one additional transfer without any penalty.",
    category: "utility",
  },
  {
    id: "rain-dance",
    name: "Rain Dance",
    cost: 100,
    description:
      "If your selected fixture is abandoned or cancelled, affected players receive their average points instead of zero. (Coming soon — purchase is stored but not applied yet.)",
    category: "utility",
  },
] as const;

/** Shop rules shown in the UI. */
export const SHOP_PLANNED_RULES: readonly string[] = [
  "One scoring booster per gameweek (Lucky Dip, Batter/Bowler Boost, Triple Captain, or Captain's Confidence). Powerplay is free and always on.",
  "Transfer perks (Free Transfer / Wildcards) can be used alongside a scoring booster.",
  "Triple Captain and Captain's Confidence cannot be used in the same gameweek.",
  "Batter Boost / Bowler Boost double batting or bowling points across your whole squad.",
  "Lucky Dip stacks with captain / Powerplay on the chosen player.",
  "A confirmation step is required before spending Fantasy Points.",
];

export type ShopPurchaseRecord = {
  id: string;
  itemId: ShopItemId;
  itemName: string;
  cost: number;
  purchasedAt: string;
  gameweek?: number;
};

export type ShopWalletState = {
  balance: number;
  ownedItemIds: ShopItemId[];
  activeItemIds: ShopItemId[];
  purchaseHistory: ShopPurchaseRecord[];
};

export function shopItemById(id: ShopItemId): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === id);
}

export function isPaidBooster(item: ShopItem): boolean {
  return !item.alwaysFree && item.cost > 0;
}

/** Scoring chips share one slot; transfer chips share another; Rain Dance stacks with both. */
export type ShopActiveSlot = "scoring" | "transfer" | "standalone";

export function shopActiveSlot(item: ShopItem): ShopActiveSlot | null {
  if (item.alwaysFree || item.id === "powerplay") return null;
  switch (item.id) {
    case "batter-boost":
    case "bowler-boost":
    case "lucky-dip":
    case "triple-captain":
    case "captains-confidence":
      return "scoring";
    case "free-transfer":
    case "wildcard-lite":
    case "full-wildcard":
      return "transfer";
    default:
      return "standalone";
  }
}

/** One scoring booster + one transfer perk can both be active (Powerplay is always free). */
export function hasConflictingActiveBooster(
  item: ShopItem,
  activeItemIds: ShopItemId[],
): ShopItem | null {
  for (const activeId of activeItemIds) {
    if (activeId === "powerplay") continue;
    const active = shopItemById(activeId);
    if (!active || !isPaidBooster(active)) continue;
    if (item.id === activeId) continue;
    if (item.conflictsWith?.includes(activeId)) return active;
    if (active.conflictsWith?.includes(item.id)) return active;
  }
  const slot = shopActiveSlot(item);
  if (!slot || slot === "standalone") return null;
  for (const activeId of activeItemIds) {
    if (activeId === "powerplay" || activeId === item.id) continue;
    const active = shopItemById(activeId);
    if (!active || !isPaidBooster(active)) continue;
    if (shopActiveSlot(active) === slot) return active;
  }
  return null;
}

export function formatFantasyPoints(n: number): string {
  return `${Math.round(n)} FP`;
}

/** Persisted on `teams/{uid}.fantasyShop` in Firestore. */
export type TeamFantasyShopState = {
  ownedItemIds: ShopItemId[];
  activeItemIds: ShopItemId[];
  activeGameweek: number;
  purchaseHistory: ShopPurchaseRecord[];
  /** Squad player chosen for Lucky Dip this gameweek (set at purchase). */
  luckyDipPlayerId?: number | null;
};

const SHOP_ITEM_ID_SET = new Set<string>(SHOP_ITEMS.map((item) => item.id));

function filterShopItemIds(raw: unknown, fallback: ShopItemId[]): ShopItemId[] {
  if (!Array.isArray(raw)) return fallback;
  const ids = raw.filter((x): x is ShopItemId => typeof x === "string" && SHOP_ITEM_ID_SET.has(x));
  return ids.length ? [...new Set(ids)] : fallback;
}

function parsePurchaseHistory(raw: unknown): ShopPurchaseRecord[] {
  if (!Array.isArray(raw)) return [];
  const rows: ShopPurchaseRecord[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const itemId = typeof o.itemId === "string" && SHOP_ITEM_ID_SET.has(o.itemId) ? (o.itemId as ShopItemId) : null;
    if (!itemId) continue;
    rows.push({
      id: String(o.id ?? `${Date.now()}-${itemId}`),
      itemId,
      itemName: String(o.itemName ?? shopItemById(itemId)?.name ?? itemId),
      cost: Number(o.cost ?? 0),
      purchasedAt: String(o.purchasedAt ?? new Date().toISOString()),
      gameweek: o.gameweek != null ? Number(o.gameweek) : undefined,
    });
  }
  return rows;
}

export function emptyTeamFantasyShop(gameweek: number): TeamFantasyShopState {
  return {
    ownedItemIds: ["powerplay"],
    activeItemIds: ["powerplay"],
    activeGameweek: gameweek,
    purchaseHistory: [],
    luckyDipPlayerId: null,
  };
}

export function parseTeamFantasyShop(raw: unknown, currentGameweek: number): TeamFantasyShopState {
  if (!raw || typeof raw !== "object") return emptyTeamFantasyShop(currentGameweek);
  const o = raw as Record<string, unknown>;
  const storedGw = Number(o.activeGameweek);
  const ownedItemIds = filterShopItemIds(o.ownedItemIds, ["powerplay"]);
  let activeItemIds = filterShopItemIds(o.activeItemIds, ["powerplay"]);
  let luckyDipPlayerId: number | null = null;
  if (!Number.isFinite(storedGw) || storedGw !== currentGameweek) {
    // New gameweek: clear one-week boosters; keep permanent owned items + Powerplay.
    activeItemIds = ["powerplay"];
    for (const id of ownedItemIds) {
      const item = shopItemById(id);
      if (item?.permanent && !activeItemIds.includes(id)) activeItemIds.push(id);
    }
  } else if (o.luckyDipPlayerId != null && Number.isFinite(Number(o.luckyDipPlayerId))) {
    luckyDipPlayerId = Number(o.luckyDipPlayerId);
  }
  if (!activeItemIds.includes("powerplay")) activeItemIds = ["powerplay", ...activeItemIds];
  return {
    ownedItemIds: ownedItemIds.includes("powerplay") ? ownedItemIds : (["powerplay", ...ownedItemIds] as ShopItemId[]),
    activeItemIds,
    activeGameweek: currentGameweek,
    purchaseHistory: parsePurchaseHistory(o.purchaseHistory),
    luckyDipPlayerId,
  };
}

export function shopWalletFromTeam(cumulativePoints: number, shop: TeamFantasyShopState): ShopWalletState {
  return {
    balance: Math.max(0, Math.round(cumulativePoints)),
    ownedItemIds: shop.ownedItemIds,
    activeItemIds: shop.activeItemIds,
    purchaseHistory: shop.purchaseHistory,
  };
}

function pickLuckyDipPlayer(playerIds: number[]): number | null {
  const eligible = playerIds.filter((id) => Number.isFinite(id));
  if (!eligible.length) return null;
  const idx = Math.floor(Math.random() * eligible.length);
  return eligible[idx] ?? null;
}

export function buildTeamFantasyShopAfterPurchase(args: {
  shop: TeamFantasyShopState;
  item: ShopItem;
  gameweek: number;
  alreadyOwned: boolean;
  squadPlayerIds?: number[];
}): TeamFantasyShopState {
  const { shop, item, gameweek, alreadyOwned } = args;
  const cost = alreadyOwned ? 0 : item.cost;
  const record: ShopPurchaseRecord = {
    id: `${Date.now()}-${item.id}`,
    itemId: item.id,
    itemName: item.name,
    cost,
    purchasedAt: new Date().toISOString(),
    gameweek,
  };

  const ownedItemIds = shop.ownedItemIds.includes(item.id) ? shop.ownedItemIds : [...shop.ownedItemIds, item.id];

  let activeItemIds = [...shop.activeItemIds];
  const slot = shopActiveSlot(item);
  if (slot === "scoring" || slot === "transfer") {
    activeItemIds = activeItemIds.filter((id) => {
      if (id === "powerplay") return true;
      const active = shopItemById(id);
      if (!active) return true;
      return shopActiveSlot(active) !== slot;
    });
  }
  if (!activeItemIds.includes(item.id)) activeItemIds.push(item.id);

  let luckyDipPlayerId = shop.luckyDipPlayerId ?? null;
  if (item.id === "lucky-dip") {
    const squad = args.squadPlayerIds ?? [];
    if (squad.length) {
      const keepExisting =
        alreadyOwned &&
        luckyDipPlayerId != null &&
        squad.includes(luckyDipPlayerId);
      if (!keepExisting) luckyDipPlayerId = pickLuckyDipPlayer(squad);
    }
  }

  return {
    ownedItemIds,
    activeItemIds,
    activeGameweek: gameweek,
    purchaseHistory: [record, ...shop.purchaseHistory].slice(0, 100),
    luckyDipPlayerId,
  };
}
