/**
 * SU2 (design record 2026-11-25-signups-into-meta): each show's
 * "{code} · Signups" list in the template tab.
 *
 * #1367 writes a show's item into its templates once the list exists
 * (lib/customer-lists/templates.ts: customer_list, role signups, the list's
 * Meta id, detail { name, code, ad_account_id }). This module adds what the
 * tab reads alongside, from customer_list_syncs (counts only, never a hash):
 *
 *  - a made list's count, what's on it now: sent less removed (SU1);
 *  - the list as a known audience in the account that holds it, so it reads
 *    Reused there and "held in {account}" anywhere else;
 *  - a switched-on show whose list isn't made yet, as an item with no Meta
 *    id and the day the sync makes it (presale day 08:00 London, else
 *    general-sale day; lib/customer-lists/rules.ts listTriggerAt), for each
 *    template whose shows include it (#1367's own match). Never stored: Save
 *    to template saves pages only.
 *
 * A show with no sale date, or whose show day has passed, gets no waiting
 * row: the sync won't make its list.
 *
 * Pure. No `@/` imports, so node --test loads it.
 */

import { listTriggerAt, showListName, syncState } from "../customer-lists/rules.ts";
import { templateMatchesShow } from "../customer-lists/templates.ts";
import type { AudienceTemplate, KnownAudience, TemplateItem } from "./resolve.ts";

/** The customer_list_syncs columns the tab reads. */
export interface SyncRowIn {
  event_id: string;
  meta_audience_id: string | null;
  ad_account_id: string;
  enabled: boolean;
  sent_total: number;
  removed_total: number;
}

/** The events columns the tab reads for a waiting list. */
export interface SyncEventIn {
  id: string;
  event_code: string | null;
  name: string | null;
  presale_at: string | null;
  general_sale_at: string | null;
  event_date: string | null;
}

export const SHOW_SIGNUPS_SOURCE = "show_signups";

function waitingItem(code: string, madeOn: string): TemplateItem {
  return {
    kind: "customer_list",
    listRole: "signups",
    familyKey: null,
    pageId: null,
    retentionDays: null,
    interestId: null,
    interestName: null,
    metaAudienceId: null,
    detail: { name: showListName(code), code, source: SHOW_SIGNUPS_SOURCE, madeOn },
  };
}

export function withShowSignups(
  templates: AudienceTemplate[],
  syncs: SyncRowIn[],
  events: SyncEventIn[],
  now: Date,
): { templates: AudienceTemplate[]; known: KnownAudience[] } {
  const byList = new Map(syncs.filter((s) => s.meta_audience_id).map((s) => [s.meta_audience_id!, s]));
  const known: KnownAudience[] = [...byList.values()].map((s) => ({
    source: "row",
    metaAudienceId: s.meta_audience_id!,
    accountId: s.ad_account_id,
    subtype: "customer_list",
    listRole: "signups",
    familyKey: null,
  }));

  const eventById = new Map(events.map((e) => [e.id, e]));
  const waiting = syncs.flatMap((s) => {
    if (!s.enabled || s.meta_audience_id) return [];
    const e = eventById.get(s.event_id);
    if (!e?.event_code) return [];
    const state = syncState(e, now);
    if (state.state === "no_sale_date" || state.state === "show_passed") return [];
    const at = listTriggerAt(e);
    return at ? [{ event: e, code: e.event_code, madeOn: at.toISOString() }] : [];
  });

  const out = templates.map((t) => {
    const items = t.items.map((it) => {
      if (it.kind !== "customer_list" || it.listRole !== "signups" || !it.metaAudienceId) return it;
      const s = byList.get(it.metaAudienceId);
      return s ? { ...it, detail: { ...it.detail, signups: Math.max(0, s.sent_total - s.removed_total) } } : it;
    });
    const have = new Set(items.filter((i) => i.listRole === "signups").map((i) => i.detail.code));
    const extra = waiting
      .filter((w) => !have.has(w.code) && templateMatchesShow({ notes: t.shows.join(", ") }, w.code, w.event.name))
      .map((w) => waitingItem(w.code, w.madeOn));
    return extra.length || items !== t.items ? { ...t, items: [...items, ...extra] } : t;
  });
  return { templates: out, known };
}
