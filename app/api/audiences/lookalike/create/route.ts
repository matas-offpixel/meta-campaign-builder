import { NextResponse, type NextRequest } from "next/server";

import {
  buildLookalikePreview,
  isLookalikeTier,
  lookalikePreviewToInserts,
  normaliseCountryCode,
  type LookalikePreview,
  type LookalikeSeedCandidate,
  type LookalikeTier,
} from "@/lib/audiences/lookalike-types";
import {
  audienceSourceRateLimitBody,
  isMetaAdAccountRateLimitError,
} from "@/lib/audiences/meta-rate-limit";
import { resolveAudienceSourceContext } from "@/lib/audiences/sources";
import { createAudienceDrafts } from "@/lib/db/meta-custom-audiences";
import {
  createMetaCustomAudience,
  metaAudienceWritesEnabled,
} from "@/lib/meta/audience-write";
import { createClient } from "@/lib/supabase/server";
import type { MetaCustomAudience } from "@/lib/types/audience";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Sequential cell concurrency for Meta writes. Lookalikes are single-source
 * (no split path), so each cell = exactly one Meta POST. Two concurrent POSTs
 * keeps us well under #80004 per the same reasoning as the bulk-page and
 * bulk-website builders.
 */
const CELL_CONCURRENCY = 2;

interface LookalikeCreateBody {
  clientId?: unknown;
  labelOverride?: unknown;
  seeds?: unknown;
  tier?: unknown;
  country?: unknown;
  createOnMeta?: unknown;
}

interface CellSuccess {
  audienceId: string;
  metaAudienceId: string | null;
  name: string;
  seedMetaAudienceId: string;
  seedName: string;
}

interface CellFailure {
  audienceId: string;
  error: string;
  name: string;
  seedMetaAudienceId: string;
  seedName: string;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as LookalikeCreateBody | null;
  const parsed = parseCreateBody(body);
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

    const inserts = lookalikePreviewToInserts(preview, {
      userId: user.id,
      clientId: parsed.clientId,
      metaAdAccountId: context.metaAdAccountId,
    });

    if (inserts.length === 0) {
      return NextResponse.json({
        ok: true,
        preview,
        draftIds: [],
        successes: [],
        failures: [],
      });
    }

    const drafts = await createAudienceDrafts(inserts);
    const draftIds = drafts.map((d) => d.id);

    if (!(parsed.createOnMeta && metaAudienceWritesEnabled())) {
      return NextResponse.json({
        ok: true,
        preview,
        draftIds,
        successes: [],
        failures: [],
      });
    }

    const { successes, failures } = await writeCellsWithConcurrency(
      drafts,
      preview,
      user.id,
      supabase,
    );

    return NextResponse.json({
      ok: true,
      preview,
      draftIds,
      successes,
      failures,
    });
  } catch (err) {
    if (isMetaAdAccountRateLimitError(err)) {
      return NextResponse.json(
        { ok: false, error: audienceSourceRateLimitBody(err).message },
        { status: 429 },
      );
    }
    const message = err instanceof Error ? err.message : "Lookalike create failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * Process draft cells with bounded concurrency. Each cell calls
 * createMetaCustomAudience(audienceId), which hits the new "lookalike" branch
 * in audience-payload.ts. Per-cell try/catch keeps a single failed cell from
 * aborting the batch — e.g. a seed with <100 members fails individually and
 * the others still create.
 */
async function writeCellsWithConcurrency(
  drafts: MetaCustomAudience[],
  preview: LookalikePreview,
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ successes: CellSuccess[]; failures: CellFailure[] }> {
  const successes: CellSuccess[] = [];
  const failures: CellFailure[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < drafts.length) {
      const idx = cursor++;
      const draft = drafts[idx]!;
      const cell = preview.cells[idx]!;
      try {
        const updated = await createMetaCustomAudience(draft.id, { userId, supabase });
        successes.push({
          audienceId: draft.id,
          metaAudienceId: updated.metaAudienceId,
          name: draft.name,
          seedMetaAudienceId: cell.seedMetaAudienceId,
          seedName: cell.seedName,
        });
      } catch (err) {
        failures.push({
          audienceId: draft.id,
          error: err instanceof Error ? err.message : String(err),
          name: draft.name,
          seedMetaAudienceId: cell.seedMetaAudienceId,
          seedName: cell.seedName,
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CELL_CONCURRENCY, drafts.length) }, worker),
  );
  return { successes, failures };
}

interface ParsedCreateBody {
  ok: true;
  clientId: string;
  labelOverride: string | null;
  seeds: LookalikeSeedCandidate[];
  tier: LookalikeTier;
  country: string;
  createOnMeta: boolean;
}

function parseCreateBody(
  body: LookalikeCreateBody | null,
): ParsedCreateBody | { ok: false; error: string } {
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
    createOnMeta: body?.createOnMeta === true,
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
