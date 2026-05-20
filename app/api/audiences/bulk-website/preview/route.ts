import { NextResponse, type NextRequest } from "next/server";

import {
  buildWebsitePreview,
  isBulkWebsitePixelEvent,
  type BulkWebsitePixelEvent,
} from "@/lib/audiences/bulk-website-types";
import {
  audienceSourceRateLimitBody,
  isMetaAdAccountRateLimitError,
} from "@/lib/audiences/meta-rate-limit";
import { resolveAudienceSourceContext } from "@/lib/audiences/sources";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;
export const runtime = "nodejs";

interface BulkWebsitePreviewBody {
  clientId?: unknown;
  pixelId?: unknown;
  labelOverride?: unknown;
  pixelEvents?: unknown;
  urlKeywords?: unknown;
  retentions?: unknown;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as BulkWebsitePreviewBody | null;
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

    const preview = buildWebsitePreview({
      clientSlug,
      clientName,
      labelOverride: parsed.labelOverride,
      pixelId: parsed.pixelId,
      pixelEvents: parsed.pixelEvents,
      urlKeywords: parsed.urlKeywords,
      retentions: parsed.retentions,
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
  pixelId: string;
  labelOverride: string | null;
  pixelEvents: BulkWebsitePixelEvent[];
  urlKeywords: string[];
  retentions: number[];
}

function parsePreviewBody(
  body: BulkWebsitePreviewBody | null,
): ParsedPreviewBody | { ok: false; error: string } {
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

  return { ok: true, clientId, pixelId, labelOverride, pixelEvents, urlKeywords, retentions };
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
