import { NextResponse, type NextRequest } from "next/server";

import {
  buildPagePreview,
  isBulkPageSubtype,
  type BulkPageSubtype,
} from "@/lib/audiences/bulk-page-types";
import {
  audienceSourceRateLimitBody,
  isMetaAdAccountRateLimitError,
} from "@/lib/audiences/meta-rate-limit";
import { resolveAudienceSourceContext } from "@/lib/audiences/sources";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;
export const runtime = "nodejs";

interface BulkPagePreviewBody {
  clientId?: unknown;
  labelOverride?: unknown;
  subtypes?: unknown;
  retentions?: unknown;
  fbPageIds?: unknown;
  fbSummaries?: unknown;
  igAccountIds?: unknown;
  igSummaries?: unknown;
}

interface SourceSummary {
  id: string;
  name: string;
  slug?: string;
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

  const body = (await req.json().catch(() => null)) as BulkPagePreviewBody | null;
  const parsed = parsePreviewBody(body);
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
    const clientSlug = (clientRow as { slug?: string | null } | null)?.slug ?? null;
    const clientName =
      (clientRow as { name?: string | null } | null)?.name ?? context.clientName;

    const preview = buildPagePreview({
      clientSlug,
      clientName,
      labelOverride: parsed.labelOverride,
      subtypes: parsed.subtypes,
      retentions: parsed.retentions,
      fbPageIds: parsed.fbPageIds,
      fbSummaries: parsed.fbSummaries,
      igAccountIds: parsed.igAccountIds,
      igSummaries: parsed.igSummaries,
    });

    return NextResponse.json({ ok: true, preview });
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
    const message = err instanceof Error ? err.message : "Preview failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

interface ParsedPreviewBody {
  ok: true;
  clientId: string;
  labelOverride: string | null;
  subtypes: BulkPageSubtype[];
  retentions: number[];
  fbPageIds: string[];
  fbSummaries: SourceSummary[];
  igAccountIds: string[];
  igSummaries: SourceSummary[];
}

function parsePreviewBody(
  body: BulkPagePreviewBody | null,
): ParsedPreviewBody | { ok: false; error: string } {
  const clientId =
    typeof body?.clientId === "string" ? body.clientId.trim() : null;
  if (!clientId) {
    return { ok: false, error: "clientId is required" };
  }

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
