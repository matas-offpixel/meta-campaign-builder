/**
 * lib/event-config/panel.ts
 *
 * What the event page's config panel (D9) needs: the event's config and the
 * client's other events to pick reference shows from. Read with the
 * signed-in user's client, so RLS keeps it to the user's own events.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAllPaged } from "../db/paged-read.ts";
import { canBeReferenceShow, londonToday } from "./form.ts";
import { loadEventConfig, type EventConfig } from "./read.ts";

type Db = Pick<SupabaseClient, "from">;

export interface ReferenceOption {
  id: string;
  name: string;
  eventDate: string | null;
  isUmbrella: boolean;
}

export interface EventConfigPanelData {
  config: EventConfig;
  /** The client's other events that can be references (canBeReferenceShow), latest show first. */
  options: ReferenceOption[];
}

export async function loadEventConfigPanel(
  sb: Db,
  eventId: string,
  clientId: string | null,
  today: string = londonToday(),
): Promise<EventConfigPanelData | null> {
  const config = await loadEventConfig(sb, eventId);
  if (!config) return null;
  const rows = clientId
    ? await loadAllPaged<{ id: string; name: string; event_date: string | null; is_umbrella: boolean | null }>(
        sb,
        "events",
        "id,name,event_date,is_umbrella",
        ["id"],
        (q) => q.eq("client_id", clientId),
        { orderBy: [{ column: "event_date", ascending: false, nullsFirst: false }] },
      )
    : [];
  const options = rows
    .filter((r) => r.id !== eventId)
    .map((r) => ({ id: r.id, name: r.name, eventDate: r.event_date, isUmbrella: r.is_umbrella === true }))
    .filter((o) => canBeReferenceShow(o, today));
  return { config, options };
}
