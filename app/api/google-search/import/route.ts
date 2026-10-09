import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createGoogleSearchPlanTreeFromDraft } from "@/lib/db/google-search-plans";
import { defaultSitelinkSeeds } from "@/lib/google-search/sitelink-defaults";
import {
  STRUCTURE_MODES,
  DEFAULT_STRUCTURE_MODE,
  type GoogleSearchStructureMode,
} from "@/lib/google-search/types";
import {
  describeEmptyGoogleSearchImport,
  parseGoogleSearchPlanXlsx,
} from "@/lib/google-search/xlsx-import";
import {
  detectWorkbookKindFromBuffer,
  tabsReadSuffix,
  unknownWorkbookMessage,
  type GoogleWorkbookDetection,
} from "@/lib/google-search/workbook";
import { createGoogleVideoPlanTreeFromDraft, defaultVideoBusinessName } from "@/lib/db/google-video-plans";
import { findVideoReimport } from "@/lib/google-video/reimport";
import {
  countDraftPlacements,
  describeEmptyGoogleVideoImport,
  parseGoogleVideoPlanXlsx,
} from "@/lib/google-video/xlsx-import";

/**
 * POST /api/google-search/import
 *
 * Accepts a multipart upload of a Google Search plan xlsx (J2 Melodic
 * format), parses it into a draft tree, inserts the tree under the
 * authenticated user's account, and returns the new plan id + parser
 * warnings. `detectWorkbookKind` decides the importer first:
 *   - video: the YouTube video importer; the plan opens at /google-video/[id].
 *   - unknown: 422 with the tabs found and the tabs each kind needs.
 *   - search: as before. "Parsed 0 campaigns" also names the tabs read.
 * Every response carries `kind`.
 *
 * Form fields:
 *   - file                  required, xlsx binary
 *   - event_id              optional, UUID of the linked event
 *   - google_ads_account_id optional, UUID from google_ads_accounts
 *   - plan_name             optional, override the parser-derived name
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Expected multipart/form-data with a 'file' field." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "Missing required form field: file (xlsx)." },
      { status: 400 },
    );
  }
  const eventId = readUuid(form.get("event_id"));
  const googleAdsAccountId = readUuid(form.get("google_ads_account_id"));
  const planNameOverride = readNonEmptyString(form.get("plan_name"));
  const rawMode = readNonEmptyString(form.get("structure_mode"));
  const structureMode: GoogleSearchStructureMode =
    rawMode && (STRUCTURE_MODES as readonly string[]).includes(rawMode)
      ? (rawMode as GoogleSearchStructureMode)
      : DEFAULT_STRUCTURE_MODE;

  let draft: ReturnType<typeof parseGoogleSearchPlanXlsx>;
  let detected: GoogleWorkbookDetection;
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    detected = detectWorkbookKindFromBuffer(buffer);
    if (detected.kind === "unknown") {
      return NextResponse.json(
        {
          ok: false,
          kind: detected.kind,
          error: unknownWorkbookMessage(detected.tabs),
          tabs: detected.tabs,
        },
        { status: 422 },
      );
    }
    if (detected.kind === "video") {
      return importVideoPlan(supabase, user.id, buffer, {
        planName: planNameOverride ?? file.name?.replace(/\.xlsx$/i, "") ?? null,
        sourceFilename: file.name || null,
        eventId,
        googleAdsAccountId,
        importAsNew: form.get("import_as_new") === "1",
      });
    }
    draft = parseGoogleSearchPlanXlsx(buffer, {
      fallbackPlanName: planNameOverride ?? file.name?.replace(/\.xlsx$/i, "") ?? undefined,
      structureMode,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Failed to parse xlsx: ${err instanceof Error ? err.message : "unknown error"}`,
      },
      { status: 400 },
    );
  }

  if (planNameOverride) draft.plan.name = planNameOverride;
  if (draft.campaigns.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        kind: detected.kind,
        error: `${describeEmptyGoogleSearchImport(draft.warnings)} ${tabsReadSuffix(detected)}`,
        warnings: draft.warnings,
        tabs: detected.tabs,
      },
      { status: 422 },
    );
  }

  try {
    // Seed default sitelinks if the parser didn't produce any (xlsx Phase 1
    // doesn't extract sitelinks — they're added in the wizard). Look up the
    // event's venue so the Venue Info sitelink can include it.
    let venueName: string | null = null;
    if (eventId) {
      const { data: evt } = await supabase
        .from("events")
        .select("venue_name")
        .eq("id", eventId)
        .eq("user_id", user.id)
        .maybeSingle();
      venueName = (evt as { venue_name?: string | null } | null)?.venue_name ?? null;
    }
    if (draft.sitelinks.length === 0) {
      draft.sitelinks = defaultSitelinkSeeds({ venueName });
    }

    const { plan_id } = await createGoogleSearchPlanTreeFromDraft(
      supabase,
      user.id,
      draft,
      {
        event_id: eventId,
        google_ads_account_id: googleAdsAccountId,
      },
    );
    return NextResponse.json(
      {
        ok: true,
        kind: "search",
        plan_id,
        warnings: draft.warnings,
        summary: {
          campaigns: draft.campaigns.length,
          ad_groups: draft.campaigns.reduce((s, c) => s + c.ad_groups.length, 0),
          keywords: draft.campaigns.reduce(
            (s, c) => s + c.ad_groups.reduce((ss, ag) => ss + ag.keywords.length, 0),
            0,
          ),
          rsas: draft.campaigns.reduce(
            (s, c) => s + c.ad_groups.reduce((ss, ag) => ss + ag.rsas.length, 0),
            0,
          ),
          negatives: draft.negatives.length,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Insert failed: ${err instanceof Error ? err.message : "unknown error"}`,
        warnings: draft.warnings,
      },
      { status: 500 },
    );
  }
}

async function importVideoPlan(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  buffer: Uint8Array,
  options: {
    planName: string | null;
    sourceFilename: string | null;
    eventId: string | null;
    googleAdsAccountId: string | null;
    importAsNew: boolean;
  },
): Promise<NextResponse> {
  if (!options.importAsNew && options.eventId && options.sourceFilename) {
    const { data, error } = await supabase
      .from("google_video_plans")
      .select("id, name, event_id, source_filename")
      .eq("user_id", userId)
      .eq("event_id", options.eventId)
      .eq("source_filename", options.sourceFilename);
    if (error) {
      return NextResponse.json({ ok: false, kind: "video", error: error.message }, { status: 500 });
    }
    const match = findVideoReimport(
      (data ?? []) as Array<{ id: string; name: string; event_id: string | null; source_filename: string | null }>,
      options.eventId,
      options.sourceFilename,
    );
    if (match) {
      return NextResponse.json(
        {
          ok: false,
          kind: "video",
          code: "duplicate_import",
          error: `This event already has a YouTube plan from ${options.sourceFilename}.`,
          existing_plan_id: match.id,
          existing_plan_name: match.name,
          existing_plan_href: `/google-video/${match.id}`,
        },
        { status: 409 },
      );
    }
  }
  const draft = parseGoogleVideoPlanXlsx(buffer, {
    fallbackPlanName: options.planName ?? undefined,
    sourceFilename: options.sourceFilename,
  });
  const placements = countDraftPlacements(draft);
  if (placements === 0) {
    return NextResponse.json(
      { ok: false, kind: "video", error: describeEmptyGoogleVideoImport(draft.tabs), warnings: draft.warnings, tabs: draft.tabs },
      { status: 422 },
    );
  }
  try {
    draft.plan.business_name ??= await defaultVideoBusinessName(supabase, userId, options.eventId);
    const { plan_id } = await createGoogleVideoPlanTreeFromDraft(supabase, userId, draft, {
      event_id: options.eventId,
      google_ads_account_id: options.googleAdsAccountId,
    });
    return NextResponse.json(
      {
        ok: true,
        kind: "video",
        plan_id,
        warnings: draft.warnings,
        summary: { campaigns: draft.campaigns.length, placements, ads: draft.ads.length },
      },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        kind: "video",
        error: `Insert failed: ${err instanceof Error ? err.message : "unknown error"}`,
        warnings: draft.warnings,
      },
      { status: 500 },
    );
  }
}

function readUuid(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function readNonEmptyString(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
