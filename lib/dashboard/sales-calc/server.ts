import "server-only";

/**
 * lib/dashboard/sales-calc/server.ts
 *
 * The two ways in (D11): the internal page on the owner's session, and
 * the client share link on the service role behind its token. Both run
 * the same `buildSalesDashboard`. The share's figures are cached for at
 * most 5 minutes per client; the page never queries the database from
 * the viewer's browser.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveShareByToken } from "@/lib/db/report-shares";
import { createServiceRoleClient } from "@/lib/supabase/server";

import { salesForSurface, type SalesDashboardModel } from "../sales-vs-spend.ts";
import { loadEventOwners, loadSalesCalcInput } from "./load.ts";
import { storeLibraryEntries } from "./library-store.ts";
import { buildSalesDashboard, type SalesBuild } from "./model.ts";

/** D11: the share's figures are at most this old. */
export const SHARE_CACHE_MS = 5 * 60 * 1000;

const shareCache = new Map<string, { at: number; build: SalesBuild }>();

/** Internal: the owner's session (RLS). Stores library entries computed this run. */
export async function loadInternalSalesDashboard(sb: SupabaseClient, clientId: string): Promise<SalesBuild | null> {
  const input = await loadSalesCalcInput(sb, clientId);
  if (!input) return null;
  const build = buildSalesDashboard(input);
  if (build.freshLibrary.length) {
    const owners = await loadEventOwners(sb, build.freshLibrary.map((e) => e.eventId));
    const byOwner = new Map<string, typeof build.freshLibrary>();
    for (const entry of build.freshLibrary) {
      const userId = owners.get(entry.eventId);
      if (!userId) continue;
      byOwner.set(userId, [...(byOwner.get(userId) ?? []), entry]);
    }
    for (const [userId, entries] of byOwner) {
      try {
        await storeLibraryEntries(sb, entries, { userId, clientId });
      } catch (error) {
        // The figures are already computed in memory; a failed store is retried on the next load.
        console.error("[sales-calc] library store failed", error);
      }
    }
  }
  return build;
}

export type ShareSalesResult = { ok: true; model: SalesDashboardModel; build: SalesBuild } | { ok: false };

/** Share: the token is the credential. Only a client-scope token, only its own client. Never writes. */
export async function loadShareSalesDashboard(token: string, now = Date.now()): Promise<ShareSalesResult> {
  const resolved = await resolveShareByToken(token);
  if (!resolved.ok || resolved.share.scope !== "client") return { ok: false };
  const clientId = resolved.share.client_id;
  const cached = shareCache.get(clientId);
  let build = cached && now - cached.at < SHARE_CACHE_MS ? cached.build : null;
  if (!build) {
    const input = await loadSalesCalcInput(createServiceRoleClient(), clientId);
    if (!input) return { ok: false };
    build = buildSalesDashboard(input);
    shareCache.set(clientId, { at: now, build });
  }
  return { ok: true, model: salesForSurface(build.model, "share"), build };
}
