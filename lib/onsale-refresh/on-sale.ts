/**
 * The one "on sale" predicate (G2): the loader and the event page's panel
 * mount read the same rule, so every event the refresh posts about shows
 * the panel. Not cancelled, the show still ahead, and either the status
 * says on sale or the general sale date has passed. Brand campaigns are
 * the page's own exclusion. Show week is the refresh's stop (R1).
 */

import { showWeekMonday } from "../drive/tree.ts";

export type OnSaleFields = {
  status: string | null | undefined;
  event_date: string | null | undefined;
  general_sale_at: string | null | undefined;
};

export function isOnSale(event: OnSaleFields, today: string): boolean {
  if (event.status === "cancelled") return false;
  const day = event.event_date?.slice(0, 10);
  if (!day || day < today) return false;
  if (event.status === "on_sale") return true;
  const sale = event.general_sale_at?.slice(0, 10);
  return Boolean(sale && sale <= today);
}

/** From the Monday of show week the refresh has stopped. */
export function isShowWeek(eventDate: string | null | undefined, today: string): boolean {
  const monday = showWeekMonday(eventDate);
  return Boolean(monday && today >= monday);
}
