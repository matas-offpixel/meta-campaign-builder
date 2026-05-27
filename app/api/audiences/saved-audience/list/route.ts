/**
 * GET /api/audiences/saved-audience/list?adAccountId=act_xxx
 *
 * Lists Saved Audiences on `adAccountId` for the Saved Audience clone tool.
 * Returns name + description + updated_at — targeting is fetched server-side
 * on the clone POST, so it doesn't need to ride along here.
 *
 * Ownership: any ad account the authenticated user has Meta access to is
 * fair game (the clone tool spans Business Manager, not our client table).
 * Meta enforces the access boundary on token use, so an account the user
 * doesn't have access to surfaces as a Meta permission error.
 *
 * Token policy: `resolveServerMetaToken` (DB-first, env fallback). Token
 * errors surface as 401 with code 190 so the client can show a reconnect
 * prompt — same pattern as `/api/meta/saved-audiences`.
 */

import { NextResponse, type NextRequest } from "next/server";

import { normalizeAdAccountId } from "@/lib/meta/ad-account";
import { MetaApiError } from "@/lib/meta/client";
import { listSavedAudiencesWithTargeting } from "@/lib/meta/saved-audience";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

interface SavedAudienceResponseItem {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string | null;
  hasTargeting: boolean;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const adAccountRaw = req.nextUrl.searchParams.get("adAccountId");
  if (!adAccountRaw) {
    return NextResponse.json(
      { ok: false, error: "adAccountId query param is required" },
      { status: 400 },
    );
  }
  const adAccountId = normalizeAdAccountId(adAccountRaw);
  if (!adAccountId) {
    return NextResponse.json(
      { ok: false, error: 'adAccountId must be numeric (optionally prefixed "act_")' },
      { status: 400 },
    );
  }

  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Facebook session expired or not connected. Reconnect Facebook in Account Setup, then try again.",
        code: 190,
      },
      { status: 401 },
    );
  }

  try {
    const audiences = await listSavedAudiencesWithTargeting(token, adAccountId);
    const data: SavedAudienceResponseItem[] = audiences.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      updatedAt: a.updatedAt,
      hasTargeting: Boolean(a.targeting && typeof a.targeting === "object"),
    }));
    return NextResponse.json({ ok: true, data, count: data.length });
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.code === 190 || err.code === 102) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Facebook session expired. Reconnect Facebook in Account Setup, then reload.",
            code: err.code,
          },
          { status: 401 },
        );
      }
      return NextResponse.json(
        {
          ok: false,
          error: err.userMsg ?? err.message,
          code: err.code ?? null,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to list Saved Audiences",
      },
      { status: 500 },
    );
  }
}
