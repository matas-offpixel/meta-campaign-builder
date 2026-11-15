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
import { loadFinalCounts } from "../internal-counts/final-count.ts";
import { canBeReferenceShow } from "./form.ts";
import { loadEventConfig, type EventConfig } from "./read.ts";

type Db = Pick<SupabaseClient, "from">;

export interface ReferenceOption {
  id: string;
  name: string;
  eventDate: string | null;
  isUmbrella: boolean;
  /** HD1's final count (ruling c) is stored for this show. */
  hasFinalCount: boolean;
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
  const others = rows.filter((r) => r.id !== eventId);
  const finals = await loadFinalCounts(sb, others.map((r) => r.id));
  const options = others
    .map((r) => ({ id: r.id, name: r.name, eventDate: r.event_date, isUmbrella: r.is_umbrella === true, hasFinalCount: finals.has(r.id) }))
    .filter((o) => canBeReferenceShow(o));
  return { config, options };
}
