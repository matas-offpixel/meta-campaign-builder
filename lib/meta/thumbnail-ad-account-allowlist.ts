/**
 * Pure ad-account allowlist helpers for the creative-thumbnail proxy.
 *
 * Safe for `node --test` (no `@/` / Next / Supabase). Used by
 * `verifyAdAccountForThumbnail` and `handleCreativeThumbnailGet` so ads
 * living in a per-event `events.meta_ad_account_id` override still pass
 * auth — the #772–#776 sweep missed this surface (Electric Brixton /
 * NX26-DJEZ, 2026-08-18).
 */

import { withoutActPrefix } from "./ad-account-id.ts";

/** Bare numeric Meta ad account id (no `act_` prefix) — project storage convention. */
export function normalizeMetaAdAccountId(
  raw: string | null | undefined,
): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  return withoutActPrefix(t);
}

/** Compare Graph `account_id` (may be `act_…` or digits) to one stored client id. */
export function adAccountMatchesClient(
  graphAccountId: string | null | undefined,
  clientAdAccountId: string | null | undefined,
): boolean {
  if (!graphAccountId || !clientAdAccountId) return false;
  return (
    normalizeMetaAdAccountId(graphAccountId) ===
    normalizeMetaAdAccountId(clientAdAccountId)
  );
}

/**
 * True when the ad's Graph `account_id` matches ANY entry in the allowed set
 * (client default ∪ per-event overrides). This is the set-based verify used
 * after the Graph `account_id` lookup.
 */
export function adAccountMatchesAny(
  graphAccountId: string | null | undefined,
  allowedAdAccountIds: readonly string[],
): boolean {
  if (!graphAccountId || allowedAdAccountIds.length === 0) return false;
  const graph = normalizeMetaAdAccountId(graphAccountId);
  if (!graph) return false;
  for (const raw of allowedAdAccountIds) {
    const allowed = normalizeMetaAdAccountId(raw);
    if (allowed && allowed === graph) return true;
  }
  return false;
}

/**
 * Build the normalised allowlist for a client: default
 * `clients.meta_ad_account_id` plus every DISTINCT non-null
 * `events.meta_ad_account_id` override. Empty when nothing is configured
 * (caller should serve the placeholder, not 403).
 */
export function mergeClientAllowedAdAccountIds(
  clientDefault: string | null | undefined,
  eventOverrides: readonly (string | null | undefined)[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | null | undefined) => {
    const id = normalizeMetaAdAccountId(raw);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  push(clientDefault);
  for (const raw of eventOverrides) push(raw);
  return out;
}

/** Injected DB seam for {@link loadAllowedAdAccountIdsForClient} (node-test friendly). */
export interface AllowedAdAccountsDb {
  getClientMetaAdAccountId(clientId: string): Promise<string | null>;
  listEventMetaAdAccountIds(clientId: string): Promise<(string | null)[]>;
}

/**
 * Resolve the full allowlist for a client (share-token or session path).
 * One logical query pair: client default + DISTINCT event overrides.
 */
export async function loadAllowedAdAccountIdsForClient(
  db: AllowedAdAccountsDb,
  clientId: string,
): Promise<string[]> {
  const [clientDefault, eventOverrides] = await Promise.all([
    db.getClientMetaAdAccountId(clientId),
    db.listEventMetaAdAccountIds(clientId),
  ]);
  return mergeClientAllowedAdAccountIds(clientDefault, eventOverrides);
}
