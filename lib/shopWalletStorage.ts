import {
  type ShopItem,
  type ShopItemId,
  shopItemById,
} from "@/lib/fantasyShop";

export function activePerkItems(activeItemIds: ShopItemId[]): ShopItem[] {
  return activeItemIds
    .map((id) => shopItemById(id))
    .filter((item): item is ShopItem => Boolean(item));
}

export function paidActivePerks(activeItemIds: ShopItemId[]): ShopItem[] {
  return activePerkItems(activeItemIds).filter((item) => !item.alwaysActive);
}

export function hasAnyActivePerks(activeItemIds: ShopItemId[]): boolean {
  return paidActivePerks(activeItemIds).length > 0;
}
