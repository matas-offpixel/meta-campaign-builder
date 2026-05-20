import { NextResponse, type NextRequest } from "next/server";

import {
  buildPagePreview,
  isBulkPageSubtype,
  pagePreviewToInserts,
  type BulkPageSubtype,
} from "@/lib/audiences/bulk-page-types";
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

export const maxDuration = 300;
export const runtime = "nodejs";

/**
 * Sequential cell processing concurrency. Each cell may fan out to up to
 * `ceil(pageCount / 5)` Meta writes inside the existing split path
 * (writeSplitPageEngagement, PR #427), so this is the cell-level cap that
 * keeps total Meta-write fan-out predictable against the #80004 ad-account
 * rate limit. Concurrency=2 means at most two split chains in flight at once.
 */
const CELL_CONCURRENCY = 2;

interface BulkPageCreateBody {
  clientId?: unknown;
  labelOverride?: unknown;
  subtypes?: unknown;
  retentions?: unknown;
  fbPageIds?: unknown;
  fbSummaries?: unknown;
  igAccountIds?: unknown;
  igSummaries?: unknown;
  createOnMeta?: unknown;
}

interface SourceSummary {
  id: string;
  name: string;
  slug?: string;
}

interface CellResultSuccess {
  audienceId: string;
  metaAudienceId: string | null;
  name: string;
  subtype: BulkPageSubtype;
  retentionDays: number;
  willSplit: boolean;
  partCount: number;
}

interface CellResultFailure {
  audienceId: string;
  error: string;
  name: string;
  subtype: BulkPageSubtype;
  retentionDays: number;
  willSplit: boolean;
  partCount: number;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => null)) as BulkPageCreateBody | null;
  const parsed = parseCreateBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400 },
    );
  }

  try {
    const context = await resolveAudienceSourceContext(
      supabase,
      user.id,
      parsed.clientId,
    );
    if (!context) {
      return NextResponse.json(
        { ok: false, error: "Client not found" },
        { status: 403 },
      );
    }

    const { data: clientRow } = await supabase
      .from("clients")
      .select("slug, name")
      .eq("id", parsed.clientId)
      .maybeSingle();
    const clientSlug =
      (clientRow as { slug?: string | null } | null)?.slug ?? null;
    const clientName =
      (clientRow as { name?: string | null } | null)?.name ?? context.clientName;

    const sourceOpts = {
      clientSlug,
      clientName,
      labelOverride: parsed.labelOverride,
      subtypes: parsed.subtypes,
      retentions: parsed.retentions,
      fbPageIds: parsed.fbPageIds,
      fbSummaries: parsed.fbSummaries,
      igAccountIds: parsed.igAccountIds,
      igSummaries: parsed.igSummaries,
    };
    const preview = buildPagePreview(sourceOpts);

    const inserts = pagePreviewToInserts(preview, sourceOpts, {
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
    const cellByIndex = preview.cells;

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
      cellByIndex,
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
        {
          ok: false,
          error: audienceSourceRateLimitBody(err).message,
        },
        { status: 429 },
      );
    }
    const message = err instanceof Error ? err.message : "Bulk create failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * Process draft cells sequentially with concurrency CELL_CONCURRENCY. Each cell
 * calls `createMetaCustomAudience(audienceId)` which (via PR #427's path) auto-
 * splits >5-source sets internally. Per-cell try/catch keeps a single failed
 * cell from aborting the matrix.
 */
async function writeCellsWithConcurrency(
  drafts: MetaCustomAudience[],
  cells: ReturnType<typeof buildPagePreview>["cells"],
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ successes: CellResultSuccess[]; failures: CellResultFailure[] }> {
  const successes: CellResultSuccess[] = [];
  const failures: CellResultFailure[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < drafts.length) {
      const idx = cursor++;
      const draft = drafts[idx]!;
      const cell = cells[idx]!;
      try {
        const updated = await createMetaCustomAudience(draft.id, {
          userId,
          supabase,
        });
        successes.push({
          audienceId: draft.id,
          metaAudienceId: updated.metaAudienceId,
          name: draft.name,
          subtype: cell.subtype,
          retentionDays: cell.retentionDays,
          willSplit: cell.willSplit,
          partCount: cell.partCount,
        });
      } catch (err) {
        failures.push({
          audienceId: draft.id,
          error: err instanceof Error ? err.message : String(err),
          name: draft.name,
          subtype: cell.subtype,
          retentionDays: cell.retentionDays,
          willSplit: cell.willSplit,
          partCount: cell.partCount,
        });
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(CELL_CONCURRENCY, drafts.length) },
      worker,
    ),
  );
  return { successes, failures };
}

interface ParsedCreateBody {
  ok: true;
  clientId: string;
  labelOverride: string | null;
  subtypes: BulkPageSubtype[];
  retentions: number[];
  fbPageIds: string[];
  fbSummaries: SourceSummary[];
  igAccountIds: string[];
  igSummaries: SourceSummary[];
  createOnMeta: boolean;
}

function parseCreateBody(
  body: BulkPageCreateBody | null,
): ParsedCreateBody | { ok: false; error: string } {
  const clientId =
    typeof body?.clientId === "string" ? body.clientId.trim() : null;
  if (!clientId) return { ok: false, error: "clientId is required" };

  const subtypes = Array.isArray(body?.subtypes)
    ? (body.subtypes as unknown[]).filter(isBulkPageSubtype)
    : [];
  if (subtypes.length === 0) {
    return { ok: false, error: "Pick at least one subtype" };
  }

  const retentions = parseRetentions(body?.retentions);
  if (retentions.length === 0) {
    return { ok: false, error: "Pick at least one retention window" };
  }

  const fbPageIds = parseIdList(body?.fbPageIds);
  const igAccountIds = parseIdList(body?.igAccountIds);

  const needsFb = subtypes.some(
    (s) => s === "page_engagement_fb" || s === "page_followers_fb",
  );
  const needsIg = subtypes.some(
    (s) => s === "page_engagement_ig" || s === "page_followers_ig",
  );

  if (needsFb && fbPageIds.length === 0) {
    return {
      ok: false,
      error: "Pick at least one Facebook page for FB subtypes",
    };
  }
  if (needsIg && igAccountIds.length === 0) {
    return {
      ok: false,
      error: "Pick at least one Instagram account for IG subtypes",
    };
  }

  const labelOverride =
    typeof body?.labelOverride === "string" && body.labelOverride.trim()
      ? body.labelOverride.trim()
      : null;

  return {
    ok: true,
    clientId,
    labelOverride,
    subtypes,
    retentions,
    fbPageIds,
    fbSummaries: parseSourceSummaries(body?.fbSummaries),
    igAccountIds,
    igSummaries: parseSourceSummaries(body?.igSummaries),
    createOnMeta: body?.createOnMeta === true,
  };
}

function parseIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of raw) {
    const id = typeof entry === "string" ? entry.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function parseRetentions(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<number>();
  for (const entry of raw) {
    const n =
      typeof entry === "number"
        ? Math.trunc(entry)
        : typeof entry === "string"
          ? Math.trunc(Number(entry))
          : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= 365) out.add(n);
  }
  return Array.from(out).sort((a, b) => a - b);
}

function parseSourceSummaries(raw: unknown): SourceSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: SourceSummary[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id.trim() : "";
    if (!id) continue;
    out.push({
      id,
      name: typeof e.name === "string" && e.name.trim() ? e.name : id,
      slug: typeof e.slug === "string" && e.slug.trim() ? e.slug : undefined,
    });
  }
  return out;
}
