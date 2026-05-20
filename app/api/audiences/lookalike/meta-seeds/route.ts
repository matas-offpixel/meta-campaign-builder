import { NextResponse, type NextRequest } from "next/server";

import {
  audienceSourceRateLimitBody,
  isMetaAdAccountRateLimitError,
} from "@/lib/audiences/meta-rate-limit";
import { resolveAudienceSourceContext } from "@/lib/audiences/sources";
import { withActPrefix } from "@/lib/meta/ad-account-id";
import { MetaApiError } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

/** Page size for the live Meta listing call. Single paginated request — keeps the
 *  rate-limit footprint small. */
const META_PAGE_LIMIT = 200;

/** Seeds returned to the form. Lookalike inputs are excluded — we don't
 *  lookalike a lookalike (Meta does technically allow it, but it's an
 *  ops footgun and out of scope for this builder). */
interface MetaSeedResponseItem {
  metaAudienceId: string;
  name: string;
  metaSubtype: string;
  approximateCount: number | null;
  operationStatus: string | null;
}

interface MetaSeedRawItem {
  id: string;
  name: string;
  subtype?: string;
  approximate_count_lower_bound?: number;
  approximate_count_upper_bound?: number;
  operation_status?: { code?: number; description?: string };
}

/**
 * GET /api/audiences/lookalike/meta-seeds?clientId=...
 *
 * Lists custom audiences live from the client's Meta ad account, normalised
 * to the seed-picker shape. Used as the "Load more from Meta" half of the
 * lookalike seed picker — surfaces manually-uploaded seeds (customer files,
 * partner-shared lists) that the tool's local meta_custom_audiences table
 * doesn't know about.
 *
 * Returns:
 *   { ok: true, seeds: [...] } on success
 *   { ok: false, error: "rate_limited" | "..."} on Meta rate limit / errors
 *
 * Ownership gate: resolveAudienceSourceContext enforces user owns clientId.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId")?.trim();
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "clientId is required" }, { status: 400 });
  }

  try {
    const context = await resolveAudienceSourceContext(supabase, user.id, clientId);
    if (!context) {
      return NextResponse.json({ ok: false, error: "Client not found" }, { status: 403 });
    }

    const { token } = await resolveServerMetaToken(supabase, user.id);
    const seeds = await listMetaCustomAudiencesForSeedPicker(
      context.metaAdAccountId,
      token,
    );
    return NextResponse.json({ ok: true, seeds });
  } catch (err) {
    if (isMetaAdAccountRateLimitError(err)) {
      return NextResponse.json(
        { ok: false, error: audienceSourceRateLimitBody(err).message },
        { status: 429 },
      );
    }
    const message = err instanceof Error ? err.message : "Failed to list Meta audiences";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function listMetaCustomAudiencesForSeedPicker(
  adAccountId: string,
  token: string,
): Promise<MetaSeedResponseItem[]> {
  const url = new URL(`${BASE}/${withActPrefix(adAccountId)}/customaudiences`);
  url.searchParams.set("access_token", token);
  url.searchParams.set(
    "fields",
    [
      "id",
      "name",
      "subtype",
      "approximate_count_lower_bound",
      "approximate_count_upper_bound",
      "operation_status",
    ].join(","),
  );
  url.searchParams.set("limit", String(META_PAGE_LIMIT));

  const response = await fetch(url.toString(), { cache: "no-store" });
  const json = (await response.json().catch(() => ({}))) as {
    data?: MetaSeedRawItem[];
    error?: { message?: string; code?: number; type?: string; error_subcode?: number };
  };

  if (!response.ok || json.error) {
    const e = json.error ?? { message: `HTTP ${response.status}` };
    throw new MetaApiError(
      e.message ?? `HTTP ${response.status}`,
      e.code,
      e.type,
      undefined,
      e.error_subcode,
      undefined,
      e as Record<string, unknown>,
    );
  }

  const raw = json.data ?? [];
  const out: MetaSeedResponseItem[] = [];
  for (const item of raw) {
    if (!item.id || !item.name) continue;
    const subtype = (item.subtype ?? "").toUpperCase();
    // Filter out lookalikes — building a lookalike from a lookalike is an
    // intentional out-of-scope footgun for this builder. Users wanting that
    // can build it manually in Meta's UI.
    if (subtype === "LOOKALIKE") continue;
    out.push({
      metaAudienceId: item.id,
      name: item.name,
      metaSubtype: subtype || "UNKNOWN",
      approximateCount:
        typeof item.approximate_count_lower_bound === "number"
          ? item.approximate_count_lower_bound
          : null,
      operationStatus: item.operation_status?.description ?? null,
    });
  }
  return out;
}
