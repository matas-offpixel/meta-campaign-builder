import { NextResponse, type NextRequest } from "next/server";

import {
  buildWebsitePreview,
  isBulkWebsitePixelEvent,
  websitePreviewToInserts,
  type BulkWebsitePreview,
  type BulkWebsitePixelEvent,
} from "@/lib/audiences/bulk-website-types";
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
 * Sequential cell concurrency for Meta writes. Pixel audiences are single-
 * source (no splitting path), so each cell = exactly one Meta POST. Two
 * concurrent POSTs keeps us well under #80004 per the same reasoning as the
 * bulk-page builder.
 */
const CELL_CONCURRENCY = 2;

interface BulkWebsiteCreateBody {
  clientId?: unknown;
  pixelId?: unknown;
  labelOverride?: unknown;
  pixelEvents?: unknown;
  urlKeywords?: unknown;
  retentions?: unknown;
  createOnMeta?: unknown;
}

interface CellResultSuccess {
  audienceId: string;
  metaAudienceId: string | null;
  name: string;
  pixelEvent: BulkWebsitePixelEvent;
  retentionDays: number;
}

interface CellResultFailure {
  audienceId: string;
  error: string;
  name: string;
  pixelEvent: BulkWebsitePixelEvent;
  retentionDays: number;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as BulkWebsiteCreateBody | null;
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

    const sourceOpts = {
      clientSlug,
      clientName,
      labelOverride: parsed.labelOverride,
      pixelId: parsed.pixelId,
      pixelEvents: parsed.pixelEvents,
      urlKeywords: parsed.urlKeywords,
      retentions: parsed.retentions,
    };
    const preview = buildWebsitePreview(sourceOpts);

    const inserts = websitePreviewToInserts(preview, {
      userId: user.id,
      clientId: parsed.clientId,
      metaAdAccountId: context.metaAdAccountId,
    });

    if (inserts.length === 0) {
      return NextResponse.json({ ok: true, preview, draftIds: [], successes: [], failures: [] });
    }

    const drafts = await createAudienceDrafts(inserts);
    const draftIds = drafts.map((d) => d.id);

    if (!(parsed.createOnMeta && metaAudienceWritesEnabled())) {
      return NextResponse.json({ ok: true, preview, draftIds, successes: [], failures: [] });
    }

    const { successes, failures } = await writeCellsWithConcurrency(
      drafts,
      preview,
      user.id,
      supabase,
    );

    return NextResponse.json({ ok: true, preview, draftIds, successes, failures });
  } catch (err) {
    if (isMetaAdAccountRateLimitError(err)) {
      return NextResponse.json(
        { ok: false, error: audienceSourceRateLimitBody(err).message },
        { status: 429 },
      );
    }
    const message = err instanceof Error ? err.message : "Bulk create failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * Process draft cells with bounded concurrency. Pixel audiences are single-
 * source — no split path fires inside createMetaCustomAudience. Per-cell
 * try/catch prevents one failure from aborting the matrix.
 */
async function writeCellsWithConcurrency(
  drafts: MetaCustomAudience[],
  preview: BulkWebsitePreview,
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
      const cell = preview.cells[idx]!;
      try {
        const updated = await createMetaCustomAudience(draft.id, { userId, supabase });
        successes.push({
          audienceId: draft.id,
          metaAudienceId: updated.metaAudienceId,
          name: draft.name,
          pixelEvent: cell.pixelEvent,
          retentionDays: cell.retentionDays,
        });
      } catch (err) {
        failures.push({
          audienceId: draft.id,
          error: err instanceof Error ? err.message : String(err),
          name: draft.name,
          pixelEvent: cell.pixelEvent,
          retentionDays: cell.retentionDays,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CELL_CONCURRENCY, drafts.length) }, worker));
  return { successes, failures };
}

interface ParsedCreateBody {
  ok: true;
  clientId: string;
  pixelId: string;
  labelOverride: string | null;
  pixelEvents: BulkWebsitePixelEvent[];
  urlKeywords: string[];
  retentions: number[];
  createOnMeta: boolean;
}

function parseCreateBody(
  body: BulkWebsiteCreateBody | null,
): ParsedCreateBody | { ok: false; error: string } {
  const clientId =
    typeof body?.clientId === "string" ? body.clientId.trim() : null;
  if (!clientId) return { ok: false, error: "clientId is required" };

  const pixelId =
    typeof body?.pixelId === "string" ? body.pixelId.trim() : null;
  if (!pixelId) return { ok: false, error: "pixelId is required" };

  const pixelEvents = Array.isArray(body?.pixelEvents)
    ? (body.pixelEvents as unknown[]).filter(isBulkWebsitePixelEvent)
    : [];
  if (pixelEvents.length === 0) {
    return { ok: false, error: "Pick at least one pixel event" };
  }

  const retentions = parseRetentions(body?.retentions);
  if (retentions.length === 0) {
    return { ok: false, error: "Pick at least one retention window" };
  }

  const urlKeywords = parseUrlKeywords(body?.urlKeywords);

  const labelOverride =
    typeof body?.labelOverride === "string" && body.labelOverride.trim()
      ? body.labelOverride.trim()
      : null;

  return {
    ok: true,
    clientId,
    pixelId,
    labelOverride,
    pixelEvents,
    urlKeywords,
    retentions,
    createOnMeta: body?.createOnMeta === true,
  };
}

function parseUrlKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const s = typeof entry === "string" ? entry.trim() : "";
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
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
    if (Number.isInteger(n) && n >= 1 && n <= 180) out.add(n);
  }
  return Array.from(out).sort((a, b) => a - b);
}
