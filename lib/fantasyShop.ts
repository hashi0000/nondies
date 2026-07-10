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
      "Make unlimited squad changes for this gameweek only. After the gameweek ends, your squad automatically reverts to its previous state.",
    category: "wildcard",
  },
  {
    id: "full-wildcard",
    name: "Full Wildcard",
    cost: 250,
    description: "Permanently rebuild your squad with unlimited transfers.",
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
    description: "Captain earns double points for one gameweek.",
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
      "If your selected fixture is abandoned or cancelled, affected players receive their average points instead of zero.",
    category: "utility",
  },
] as const;

/** Rules to implement with game logic later — shown in the shop UI for now. */
export const SHOP_PLANNED_RULES: readonly string[] = [
  "Only one paid booster can be active each gameweek (Powerplay is separate and free for everyone).",
  "Triple Captain and Captain's Confidence cannot be used in the same gameweek.",
  "A confirmation step is required before spending Fantasy Points.",
  "Purchase history will be stored so managers can review boosters used throughout the season.",
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

/** UI-only: one paid booster active per GW (Powerplay excluded). */
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
    if (isPaidBooster(item)) return active;
  }
  return null;
}

export function formatFantasyPoints(n: number): string {
  return `${Math.round(n)} FP`;
}
