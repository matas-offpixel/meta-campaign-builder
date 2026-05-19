import "server-only";

/**
 * lib/cron/match-attribution.ts
 *
 * Server-side runner for the dark-build attribution matching pass.
 * Walks unmatched `ticketing_purchase_events` from the last 30 days
 * and, for each row, asks the pure `matchPurchase` helper to pick
 * its best `meta_click_touchpoints` candidate.
 *
 * Idempotent. Each `ticketing_purchase_events.id` resolves to
 * exactly one row in `attribution_order_matches` via the unique
 * constraint on `purchase_event_id`. Re-running the cron over the
 * same purchases is a no-op upsert; resurfacing a previously-
 * unmatched purchase whose touchpoint just landed flips the row to
 * a real match.
 *
 * Scoping window: 30 days. Tied to the typical click-attribution
 * horizon — we want to keep retrying late-landing touchpoints (a
 * Meta CAPI delivery delay can be hours) but stop scanning after
 * a month so the cron stays bounded.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  matchPurchase,
  type MatchPurchaseInput,
  type MatchTouchpointInput,
  type MatchResult,
} from "@/lib/attribution/matcher";

/**
 * Public summary the cron route returns. Counts feed the deploy
 * dashboard so the operator can spot regressions (e.g. "matched
 * fell to 0% on this deploy → fbclid snippet ships broken").
 */
export interface MatchAttributionResult {
  scanned: number;
  matched: number;
  unmatched: number;
  emailMatches: number;
  externalIdMatches: number;
  fbcMatches: number;
  /** ISO timestamp of the cron pass start. */
  ranAt: string;
}

interface PurchaseRow {
  id: string;
  client_id: string;
  purchased_at: string;
  email_hash: string | null;
  external_id_hash: string | null;
  fbc: string | null;
}

interface TouchpointRow {
  id: string;
  client_id: string;
  clicked_at: string;
  email_hash: string | null;
  external_id_hash: string | null;
  fbc: string | null;
}

const SCAN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const PURCHASE_PAGE_SIZE = 200;

/**
 * Run a matching pass. Caller supplies a service-role Supabase
 * client; the runner iterates pages of unmatched purchases, loads
 * the per-client touchpoint pool once, and writes match rows
 * back via upsert.
 */
export async function runMatchAttribution(
  supabase: SupabaseClient,
): Promise<MatchAttributionResult> {
  const ranAt = new Date().toISOString();
  const sinceIso = new Date(Date.now() - SCAN_WINDOW_MS).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;

  let scanned = 0;
  let matched = 0;
  let unmatched = 0;
  let emailMatches = 0;
  let externalIdMatches = 0;
  let fbcMatches = 0;

  // Per-client touchpoint cache so we don't re-query the same set
  // for every purchase batch under the same client.
  const touchpointsByClient = new Map<string, TouchpointRow[]>();

  // Page through unmatched purchases. The LEFT JOIN is expressed
  // as a NOT IN (SELECT ...) so PostgREST stays happy without us
  // having to expose a dedicated view.
  //
  // We sort by `purchased_at ASC` so the earliest unmatched rows
  // settle first — a long-tail unmatched purchase that finally
  // gets a touchpoint match doesn't keep getting deferred behind
  // newer ones.
  let from = 0;
  while (true) {
    const { data: purchaseRows, error: purchaseErr } = await sb
      .from("ticketing_purchase_events")
      .select("id, client_id, purchased_at, email_hash, external_id_hash, fbc")
      .gte("purchased_at", sinceIso)
      .order("purchased_at", { ascending: true })
      .range(from, from + PURCHASE_PAGE_SIZE - 1);
    if (purchaseErr) {
      throw new Error(
        `[match-attribution] purchase page read failed: ${purchaseErr.message}`,
      );
    }
    const page = (purchaseRows ?? []) as PurchaseRow[];
    if (page.length === 0) break;

    // Skip rows that already have a final match. We don't want to
    // re-flip an existing `email_hash` match to `unmatched` just
    // because the touchpoint snapshot rolled over.
    const purchaseIds = page.map((r) => r.id);
    const { data: existingMatches } = await sb
      .from("attribution_order_matches")
      .select("purchase_event_id, match_strategy")
      .in("purchase_event_id", purchaseIds);

    const finalMatchedIds = new Set<string>();
    for (const m of (existingMatches ?? []) as Array<{
      purchase_event_id: string;
      match_strategy: string;
    }>) {
      // Re-run only the unmatched ones — a previously-unmatched
      // purchase might now have a touchpoint waiting.
      if (m.match_strategy !== "unmatched") {
        finalMatchedIds.add(m.purchase_event_id);
      }
    }

    const candidates = page.filter((r) => !finalMatchedIds.has(r.id));
    scanned += candidates.length;

    const matchRows: Array<{
      client_id: string;
      event_id: string | null;
      purchase_event_id: string;
      touchpoint_id: string | null;
      match_strategy: MatchResult["strategy"];
      confidence_score: number;
      matched_at: string;
    }> = [];

    for (const purchase of candidates) {
      const touchpoints = await loadTouchpointsForClient(
        sb,
        purchase.client_id,
        sinceIso,
        touchpointsByClient,
      );
      const purchaseInput: MatchPurchaseInput = {
        purchaseEventId: purchase.id,
        purchasedAt: purchase.purchased_at,
        emailHash: purchase.email_hash,
        externalIdHash: purchase.external_id_hash,
        fbc: purchase.fbc,
      };
      const candidateInputs: MatchTouchpointInput[] = touchpoints.map(
        (t): MatchTouchpointInput => ({
          touchpointId: t.id,
          clickedAt: t.clicked_at,
          emailHash: t.email_hash,
          externalIdHash: t.external_id_hash,
          fbc: t.fbc,
        }),
      );
      const result = matchPurchase(purchaseInput, candidateInputs);

      if (result.strategy === "unmatched") unmatched += 1;
      else matched += 1;
      if (result.strategy === "email_hash") emailMatches += 1;
      else if (result.strategy === "external_id") externalIdMatches += 1;
      else if (result.strategy === "fbc_cookie") fbcMatches += 1;

      matchRows.push({
        client_id: purchase.client_id,
        event_id: null,
        purchase_event_id: purchase.id,
        touchpoint_id: result.touchpointId,
        match_strategy: result.strategy,
        confidence_score: result.confidence,
        matched_at: ranAt,
      });
    }

    if (matchRows.length > 0) {
      // We need event_id on every row. Pull it from the purchase
      // event we already have in memory.
      const eventIdByPurchase = new Map(
        page.map((p) => [p.id, (p as unknown as { event_id?: string }).event_id ?? null]),
      );
      // event_id wasn't selected above — re-query just for the
      // matched batch. Cheap (200 rows max).
      const { data: eventIdRows } = await sb
        .from("ticketing_purchase_events")
        .select("id, event_id")
        .in(
          "id",
          matchRows.map((r) => r.purchase_event_id),
        );
      for (const row of (eventIdRows ?? []) as Array<{
        id: string;
        event_id: string;
      }>) {
        eventIdByPurchase.set(row.id, row.event_id);
      }
      for (const r of matchRows) {
        r.event_id = eventIdByPurchase.get(r.purchase_event_id) ?? null;
      }
      const upsertPayload = matchRows.filter((r) => r.event_id != null);
      if (upsertPayload.length > 0) {
        const { error: upsertErr } = await sb
          .from("attribution_order_matches")
          .upsert(upsertPayload, { onConflict: "purchase_event_id" });
        if (upsertErr) {
          throw new Error(
            `[match-attribution] match upsert failed: ${upsertErr.message}`,
          );
        }
      }
    }

    if (page.length < PURCHASE_PAGE_SIZE) break;
    from += PURCHASE_PAGE_SIZE;
  }

  return {
    scanned,
    matched,
    unmatched,
    emailMatches,
    externalIdMatches,
    fbcMatches,
    ranAt,
  };
}

/**
 * Lazy per-client touchpoint loader. Caches per cron run so we
 * don't re-fetch the same touchpoint pool for sibling purchases
 * under the same client.
 */
async function loadTouchpointsForClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  clientId: string,
  sinceIso: string,
  cache: Map<string, TouchpointRow[]>,
): Promise<TouchpointRow[]> {
  const cached = cache.get(clientId);
  if (cached) return cached;

  // Pull touchpoints for the client only — `fbclid` is unique-
  // global but the matcher only joins within a client so cross-
  // tenant noise stays out.
  const { data, error } = await sb
    .from("meta_click_touchpoints")
    .select("id, client_id, clicked_at, email_hash, external_id_hash, fbc")
    .eq("client_id", clientId)
    .gte("clicked_at", sinceIso)
    .order("clicked_at", { ascending: false })
    .limit(20_000);
  if (error) {
    console.warn(
      `[match-attribution] touchpoint load failed client_id=${clientId} error=${error.message}`,
    );
    cache.set(clientId, []);
    return [];
  }
  const rows = (data ?? []) as TouchpointRow[];
  cache.set(clientId, rows);
  return rows;
}
