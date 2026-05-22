import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createGoogleSearchPlanTreeFromDraft } from "@/lib/db/google-search-plans";
import {
  STRUCTURE_MODES,
  DEFAULT_STRUCTURE_MODE,
  type GoogleSearchStructureMode,
} from "@/lib/google-search/types";
import { parseGoogleSearchPlanXlsx } from "@/lib/google-search/xlsx-import";

/**
 * POST /api/google-search/import
 *
 * Accepts a multipart upload of a Google Search plan xlsx (J2 Melodic
 * format), parses it into a draft tree, inserts the tree under the
 * authenticated user's account, and returns the new plan id + parser
 * warnings.
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
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
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
        error: "Parsed 0 campaigns from the xlsx — check the Keywords tab structure.",
        warnings: draft.warnings,
      },
      { status: 422 },
    );
  }

  try {
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
