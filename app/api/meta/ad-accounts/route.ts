import { createClient } from "@/lib/supabase/server";
import { fetchAdAccounts, MetaApiError } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { classifyEnrichError } from "@/lib/meta/fetch-ad-accounts";
import { decideAdAccountsRouteResponse } from "@/lib/meta/ad-accounts-route-decision";
import {
  readUserAdAccountListCache,
  upsertUserAdAccountListCache,
} from "@/lib/db/user-ad-account-list-cache";

export async function GET() {
  // ── 1. Verify Supabase session ────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  // ── 2. Resolve freshest available token ───────────────────────────────────
  let token: string;
  let tokenSource: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
    tokenSource = resolved.source;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No Meta token available";
    console.error("[/api/meta/ad-accounts] token resolution failed:", msg);
    return Response.json({ error: msg }, { status: 502 });
  }

  console.info(`[/api/meta/ad-accounts] token source=${tokenSource}`);

  // ── 3. Fetch from Meta Graph API (with last-known-good stale fallback) ───
  let liveAccounts: Awaited<ReturnType<typeof fetchAdAccounts>> | null = null;
  let liveError: unknown = null;
  try {
    liveAccounts = await fetchAdAccounts(token);
  } catch (err) {
    liveError = err;
  }

  const cached =
    liveAccounts == null && liveError != null
      ? await readUserAdAccountListCache(user.id)
      : null;

  const decision = decideAdAccountsRouteResponse({
    liveAccounts,
    liveError,
    cached,
    isRateLimited: (err) => classifyEnrichError(err).rateLimited,
  });

  if (decision.kind === "fresh") {
    const unavailable = decision.accounts.filter((a) => a.unavailableReason);
    if (unavailable.length > 0) {
      console.warn(
        `[/api/meta/ad-accounts] ${unavailable.length}/${decision.accounts.length} account(s) unavailable after enrich:`,
        unavailable.map((a) => ({
          id: a.id,
          reason: a.unavailableReason,
          meta_code: a.unavailableMetaCode,
        })),
      );
    }

    // Fire-and-forget upsert — never block or fail the response on cache write.
    void upsertUserAdAccountListCache(user.id, decision.accounts);

    return Response.json({
      data: decision.accounts,
      count: decision.accounts.length,
      unavailableCount: unavailable.length,
      tokenSource,
      stale: false,
    });
  }

  if (decision.kind === "stale") {
    console.warn(
      `[/api/meta/ad-accounts] serving stale cache (base list rate-limited) user=${user.id} staleAsOf=${decision.staleAsOf} count=${decision.accounts.length}`,
    );
    // Stale fallback must keep every cached account selectable — strip any
    // prior enrich unavailableReason so the picker is fully usable.
    const accounts = decision.accounts.map((a) => {
      if (!a.unavailableReason) return a;
      const {
        unavailableReason: _r,
        unavailableMetaCode: _c,
        unavailableDetail: _d,
        ...rest
      } = a;
      return rest;
    });
    return Response.json({
      data: accounts,
      count: accounts.length,
      unavailableCount: 0,
      tokenSource,
      stale: true,
      staleAsOf: decision.staleAsOf,
    });
  }

  // decision.kind === "error"
  const err = decision.err;
  if (err instanceof MetaApiError) {
    return Response.json(err.toJSON(), { status: 502 });
  }

  console.error("[/api/meta/ad-accounts] Unexpected error:", err);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
