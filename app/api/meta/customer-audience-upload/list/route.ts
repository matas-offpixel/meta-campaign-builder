/**
 * GET /api/meta/customer-audience-upload/list?adAccountId=act_...
 *
 * Returns existing CUSTOM audiences (excluding lookalikes) on the given ad
 * account. Used by the append-mode picker in the Customer Audience Upload tool.
 *
 * Caches for 60s per ad account to keep the picker snappy without hammering
 * the Meta rate limits.
 */

import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { normalizeAdAccountId } from "@/lib/meta/ad-account";
import { classifyLaunchMetaCode } from "@/lib/meta/launch-error-classify";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

export interface ExistingAudience {
  id: string;
  name: string;
  approximateSize: number | null;
  subtype: string;
}

// Simple in-process 60 s cache keyed by adAccountId.
const cache = new Map<string, { expires: number; audiences: ExistingAudience[] }>();

function getCached(adAccountId: string): ExistingAudience[] | null {
  const entry = cache.get(adAccountId);
  if (!entry || Date.now() > entry.expires) return null;
  return entry.audiences;
}

function setCached(adAccountId: string, audiences: ExistingAudience[]) {
  cache.set(adAccountId, { expires: Date.now() + 60_000, audiences });
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const adAccountRaw = searchParams.get("adAccountId");

  if (!adAccountRaw) {
    return Response.json({ error: "adAccountId query param is required" }, { status: 400 });
  }

  const adAccountId = normalizeAdAccountId(adAccountRaw);
  if (!adAccountId) {
    return Response.json({ error: "Invalid adAccountId format" }, { status: 400 });
  }

  const cached = getCached(adAccountId);
  if (cached) {
    return Response.json({ data: cached });
  }

  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch {
    return Response.json(
      {
        error: "Facebook session expired or not connected. Reconnect Facebook in Account Setup.",
        code: 190,
        data: [],
      },
      { status: 401 },
    );
  }

  const url = new URL(`${BASE}/${adAccountId}/customaudiences`);
  url.searchParams.set("access_token", token);
  url.searchParams.set(
    "fields",
    "id,name,subtype,approximate_count_lower_bound",
  );
  url.searchParams.set("limit", "200");

  let res: Response;
  try {
    res = await fetch(url.toString(), { cache: "no-store" });
  } catch {
    return Response.json(
      { error: "Network error contacting Meta API. Try again.", data: [] },
      { status: 502 },
    );
  }

  const json = (await res.json()) as {
    data?: {
      id: string;
      name: string;
      subtype?: string;
      approximate_count_lower_bound?: number;
    }[];
    error?: { message: string; code?: number; type?: string };
  };

  if (!res.ok || json.error) {
    const e = json.error ?? { message: `HTTP ${res.status}` };
    const kind = classifyLaunchMetaCode(e.code);
    console.error(
      `[customer-audience-upload/list] Meta error: code=${e.code} msg="${e.message}"`,
    );
    if (kind === "auth") {
      return Response.json(
        {
          error: "Facebook session expired. Reconnect Facebook in Account Setup.",
          code: 190,
          data: [],
        },
        { status: 401 },
      );
    }
    return Response.json({ error: e.message, code: e.code, data: [] }, { status: 502 });
  }

  // Exclude lookalikes — only CUSTOM subtype is valid for append uploads
  const audiences: ExistingAudience[] = (json.data ?? [])
    .filter((a) => a.subtype !== "LOOKALIKE")
    .map((a) => ({
      id: a.id,
      name: a.name,
      approximateSize: a.approximate_count_lower_bound ?? null,
      subtype: a.subtype ?? "CUSTOM",
    }));

  setCached(adAccountId, audiences);

  console.info(
    `[customer-audience-upload/list] Returning ${audiences.length} audiences for ${adAccountId}`,
  );

  return Response.json({ data: audiences });
}
