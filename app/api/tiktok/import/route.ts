/**
 * POST /api/tiktok/import
 *
 * Multipart upload endpoint for TikTok manual report XLSX exports.
 *
 * The team drops 1–7 sheets (campaign, ad, geo, demographic, interest,
 * search-term) plus a target event + campaign_name + date range. We
 * auto-detect each sheet's shape from its header row, parse rows
 * through the matching shape parser, assemble a `TikTokManualReportSnapshot`
 * and upsert it into `tiktok_manual_reports` keyed on
 * `(user_id, campaign_name, date_range_start, date_range_end)` — re-running
 * the import for the same window replaces the snapshot in place rather than
 * creating duplicate rows (see migration 028 for the unique constraint).
 *
 * `runtime = "nodejs"` is required: the `xlsx` package needs Buffer APIs
 * and File.arrayBuffer() at the size of a multi-megabyte sheet, neither
 * of which work cleanly on the Edge runtime.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";

import { createClient } from "@/lib/supabase/server";
import { parseAdSheet } from "@/lib/tiktok/parsers/ad";
import { parseCampaignSheet } from "@/lib/tiktok/parsers/campaign";
import { parseDemographicSheet } from "@/lib/tiktok/parsers/demographic";
import { parseGeoSheet } from "@/lib/tiktok/parsers/geo";
import { parseInterestSheet } from "@/lib/tiktok/parsers/interest";
import { parseSearchTermSheet } from "@/lib/tiktok/parsers/search-term";
import {
  detectFileType,
  type TikTokFileType,
} from "@/lib/tiktok/parsers/shared";
import type {
  TikTokAdRow,
  TikTokCampaignTotals,
  TikTokDemographicRow,
  TikTokGeoRow,
  TikTokImportErrorReason,
  TikTokImportResult,
  TikTokInterestRow,
  TikTokManualReportSnapshot,
  TikTokSearchTermRow,
} from "@/lib/types/tiktok";

const MAX_FILES = 7;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ParsedFile {
  name: string;
  shape: TikTokFileType;
}

function errorResponse(
  reason: TikTokImportErrorReason,
  message: string,
  status: number,
): NextResponse<TikTokImportResult> {
  return NextResponse.json<TikTokImportResult>(
    { ok: false, error: { reason, message } },
    { status },
  );
}

export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return errorResponse("not_signed_in", "Not signed in.", 401);
  }

  // ── Parse multipart form ─────────────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorResponse("invalid_field", "Invalid multipart body.", 400);
  }

  const event_id = String(form.get("event_id") ?? "").trim();
  const client_id = String(form.get("client_id") ?? "").trim();
  const campaign_name = String(form.get("campaign_name") ?? "").trim();
  const date_range_start = String(form.get("date_range_start") ?? "").trim();
  const date_range_end = String(form.get("date_range_end") ?? "").trim();

  if (!event_id) return errorResponse("missing_field", "event_id is required.", 400);
  if (!client_id) return errorResponse("missing_field", "client_id is required.", 400);
  if (!campaign_name)
    return errorResponse("missing_field", "campaign_name is required.", 400);
  if (!date_range_start)
    return errorResponse("missing_field", "date_range_start is required.", 400);
  if (!date_range_end)
    return errorResponse("missing_field", "date_range_end is required.", 400);

  if (!UUID_RE.test(event_id))
    return errorResponse("invalid_field", "event_id must be a UUID.", 400);
  if (!UUID_RE.test(client_id))
    return errorResponse("invalid_field", "client_id must be a UUID.", 400);
  if (!ISO_DATE_RE.test(date_range_start))
    return errorResponse(
      "invalid_field",
      "date_range_start must be ISO YYYY-MM-DD.",
      400,
    );
  if (!ISO_DATE_RE.test(date_range_end))
    return errorResponse(
      "invalid_field",
      "date_range_end must be ISO YYYY-MM-DD.",
      400,
    );
  if (date_range_end < date_range_start)
    return errorResponse(
      "invalid_field",
      "date_range_end must be >= date_range_start.",
      400,
    );

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0)
    return errorResponse("no_files", "Attach at least one .xlsx file.", 400);
  if (files.length > MAX_FILES)
    return errorResponse(
      "too_many_files",
      `Attach at most ${MAX_FILES} files (received ${files.length}).`,
      400,
    );

  // ── Ownership: event must exist, belong to the user, and link to client_id ──
  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, user_id, client_id, tiktok_account_id")
    .eq("id", event_id)
    .maybeSingle();

  if (eventErr) {
    console.warn("[tiktok/import] event lookup failed:", eventErr.message);
    return errorResponse("event_not_found", "Failed to look up event.", 500);
  }
  if (!event) {
    return errorResponse("event_not_found", "Event not found.", 404);
  }
  if (event.user_id !== user.id) {
    return errorResponse("forbidden", "Event belongs to another user.", 403);
  }
  if (event.client_id !== client_id) {
    return errorResponse(
      "forbidden",
      "Event does not belong to the supplied client.",
      403,
    );
  }

  // ── Parse each file ──────────────────────────────────────────────────
  let campaign: TikTokCampaignTotals | null = null;
  const ads: TikTokAdRow[] = [];
  const geo: TikTokGeoRow[] = [];
  const demographics: TikTokDemographicRow[] = [];
  const interests: TikTokInterestRow[] = [];
  const searchTerms: TikTokSearchTermRow[] = [];

  const detected: ParsedFile[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const file of files) {
    const name = file.name || "(unnamed)";
    let rows: unknown[][];
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const workbook = XLSX.read(buf, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        skipped.push({ name, reason: "no sheets in workbook" });
        continue;
      }
      const sheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: false,
        defval: "",
      });
    } catch (err) {
      console.warn(
        "[tiktok/import] failed to read xlsx",
        name,
        err instanceof Error ? err.message : err,
      );
      skipped.push({ name, reason: "could not read xlsx" });
      continue;
    }

    if (!rows || rows.length === 0) {
      skipped.push({ name, reason: "empty sheet" });
      continue;
    }

    const shape = detectFileType(rows[0], rows[1]);
    if (!shape) {
      skipped.push({ name, reason: "unrecognised header row" });
      continue;
    }

    try {
      switch (shape) {
        case "campaign": {
          const parsed = parseCampaignSheet(rows);
          if (parsed) {
            // Override the parser's campaign_name with the user-supplied
            // one so dedupe / display align with what the rest of the
            // dashboard knows the campaign as. The parser still captures
            // every other field from the row.
            campaign = { ...parsed, campaign_name };
          }
          break;
        }
        case "ad":
          ads.push(...parseAdSheet(rows));
          break;
        case "geo":
          geo.push(...parseGeoSheet(rows));
          break;
        case "demographic":
          demographics.push(...parseDemographicSheet(rows));
          break;
        case "interest":
          interests.push(...parseInterestSheet(rows));
          break;
        case "search_term":
          searchTerms.push(...parseSearchTermSheet(rows));
          break;
      }
      detected.push({ name, shape });
    } catch (err) {
      console.warn(
        "[tiktok/import] parser failed for",
        name,
        err instanceof Error ? err.message : err,
      );
      skipped.push({ name, reason: "parser threw" });
    }
  }

  if (detected.length === 0) {
    return errorResponse(
      "no_recognised_files",
      "None of the uploaded files matched a known TikTok export shape.",
      400,
    );
  }

  // ── Assemble snapshot + upsert ───────────────────────────────────────
  const snapshot: TikTokManualReportSnapshot = {
    v: 1,
    fetchedAt: new Date().toISOString(),
    date_range_start,
    date_range_end,
    campaign,
    ads,
    geo,
    demographics,
    interests,
    searchTerms,
  };

  const { data: report, error: upsertErr } = await supabase
    .from("tiktok_manual_reports")
    .upsert(
      {
        user_id: user.id,
        client_id,
        event_id,
        tiktok_account_id: event.tiktok_account_id ?? null,
        campaign_name,
        date_range_start,
        date_range_end,
        source: "manual_xlsx",
        // Cast through unknown to satisfy the generated `Json` type — the
        // snapshot is structurally a plain JSON tree but TS can't prove
        // that across our discriminated unions.
        snapshot_json: snapshot as unknown as Record<string, unknown>,
      },
      {
        onConflict: "user_id,campaign_name,date_range_start,date_range_end",
      },
    )
    .select("id")
    .maybeSingle();

  if (upsertErr) {
    console.warn("[tiktok/import] upsert failed:", upsertErr.message);
    return errorResponse(
      "persist_failed",
      `Failed to persist report: ${upsertErr.message}`,
      500,
    );
  }
  if (!report) {
    return errorResponse(
      "persist_failed",
      "Upsert returned no row.",
      500,
    );
  }

  return NextResponse.json<TikTokImportResult>(
    {
      ok: true,
      report_id: report.id,
      detected_files: detected,
      skipped,
    },
    { status: 200 },
  );
}
