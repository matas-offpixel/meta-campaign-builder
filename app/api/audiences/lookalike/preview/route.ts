import { NextResponse, type NextRequest } from "next/server";

import {
  buildLookalikePreview,
  isLookalikeTier,
  normaliseCountryCode,
  type LookalikeSeedCandidate,
  type LookalikeTier,
} from "@/lib/audiences/lookalike-types";
import {
  audienceSourceRateLimitBody,
  isMetaAdAccountRateLimitError,
} from "@/lib/audiences/meta-rate-limit";
import { resolveAudienceSourceContext } from "@/lib/audiences/sources";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

interface LookalikePreviewBody {
  clientId?: unknown;
  labelOverride?: unknown;
  seeds?: unknown;
  tier?: unknown;
  country?: unknown;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as LookalikePreviewBody | null;
  const parsed = parsePreviewBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  try {
    const context = await resolveAudienceSourceContext(supabase, user.id, parsed.clientId);
    if (!context) {
      return NextResponse.json({ ok: false, error: "Client not found" }, { status: 403 });
    }

    const { data: clientRow } = await supabase
      .from("clients")
      .select("slug, name")
      .eq("id", parsed.clientId)
      .maybeSingle();
    const clientSlug = (clientRow as { slug?: string | null } | null)?.slug ?? null;
    const clientName =
      (clientRow as { name?: string | null } | null)?.name ?? context.clientName;

    const preview = buildLookalikePreview({
      clientSlug,
      clientName,
      labelOverride: parsed.labelOverride,
      seeds: parsed.seeds,
      tier: parsed.tier,
      country: parsed.country,
    });

    return NextResponse.json({ ok: true, preview });
  } catch (err) {
    if (isMetaAdAccountRateLimitError(err)) {
      return NextResponse.json(
        { ok: false, error: audienceSourceRateLimitBody(err).message },
        { status: 429 },
      );
    }
    const message = err instanceof Error ? err.message : "Preview failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

interface ParsedPreviewBody {
  ok: true;
  clientId: string;
  labelOverride: string | null;
  seeds: LookalikeSeedCandidate[];
  tier: LookalikeTier;
  country: string;
}

function parsePreviewBody(
  body: LookalikePreviewBody | null,
): ParsedPreviewBody | { ok: false; error: string } {
  const clientId =
    typeof body?.clientId === "string" ? body.clientId.trim() : null;
  if (!clientId) return { ok: false, error: "clientId is required" };

  const tier = body?.tier;
  const tierNum =
    typeof tier === "number"
      ? tier
      : typeof tier === "string"
        ? Number(tier)
        : NaN;
  if (!isLookalikeTier(tierNum)) {
    return { ok: false, error: "tier must be 1, 2, or 3 (percent)" };
  }

  const country = normaliseCountryCode(body?.country);

  const seeds = parseSeeds(body?.seeds);
  if (seeds.length === 0) {
    return { ok: false, error: "Pick at least one seed audience" };
  }

  const labelOverride =
    typeof body?.labelOverride === "string" && body.labelOverride.trim()
      ? body.labelOverride.trim()
      : null;

  return {
    ok: true,
    clientId,
    labelOverride,
    seeds,
    tier: tierNum,
    country,
  };
}

function parseSeeds(raw: unknown): LookalikeSeedCandidate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: LookalikeSeedCandidate[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const metaAudienceId =
      typeof e.metaAudienceId === "string" ? e.metaAudienceId.trim() : "";
    const name = typeof e.name === "string" ? e.name.trim() : "";
    if (!metaAudienceId || !name) continue;
    if (seen.has(metaAudienceId)) continue;
    seen.add(metaAudienceId);
    out.push({
      metaAudienceId,
      name,
      source: e.source === "db" ? "db" : "meta",
      localAudienceId:
        typeof e.localAudienceId === "string" ? e.localAudienceId : null,
      metaSubtype: typeof e.metaSubtype === "string" ? e.metaSubtype : null,
      audienceSubtype:
        typeof e.audienceSubtype === "string" ? e.audienceSubtype : null,
      funnelStage: typeof e.funnelStage === "string" ? e.funnelStage : null,
      approximateCount:
        typeof e.approximateCount === "number" ? e.approximateCount : null,
    });
  }
  return out;
}
