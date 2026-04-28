/**
 * POST /api/clients/[id]/ticketing-import/parse
 *
 * Stage 1 of the weekly-ticket-tracker xlsx importer. Accepts a
 * multipart upload of the client's sheet, parses it into
 * `ParsedSnapshot[]`, then reconciles each row against the events
 * belonging to this client. The response powers the preview UI so
 * the operator can eyeball matches before committing to writes.
 *
 * Split vs a single-phase endpoint:
 *   - Parse + match is cheap (pure compute + one SELECT) but the
 *     import is a potentially-large INSERT that shouldn't run until
 *     the operator confirms the preview.
 *   - The preview bundles everything needed to render the table
 *     (matched / unmatched / errored) so Stage 2 only needs the
 *     minimal `{ eventId, snapshotAt, ticketsSold }` payload.
 *
 * Auth: signed-in session + ownership check (clients.user_id = user).
 * No RLS-only enforcement because the client row itself carries the
 * user_id scope we need — if the client isn't ours, we 403 early.
 *
 * `runtime = "nodejs"` is required: the `xlsx` package needs Buffer
 * APIs that don't exist on the Edge runtime. Matches the TikTok
 * import route's posture.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  parseTicketingWorkbook,
  type ParsedSnapshot,
  type ParseError,
} from "@/lib/ticketing/parse-ticketing-xlsx";
import {
  labelMatchScore,
  similarityScore,
} from "@/lib/ticketing/fuzzy-match";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface ClientEventRow {
  id: string;
  name: string;
  event_date: string | null;
  venue_name: string | null;
}

export interface ParsePreviewMatch {
  eventLabel: string;
  eventId: string;
  eventName: string;
  eventDate: string | null;
  venueName: string | null;
  /** All snapshots for this event across every sheet. */
  snapshots: ParsedSnapshot[];
}

export interface ParsePreviewResponse {
  ok: true;
  filename: string;
  sheets: Array<{
    name: string;
    eventsDetected: string[];
    weeksDetected: string[];
    snapshotCount: number;
  }>;
  matches: ParsePreviewMatch[];
  unmatched: Array<{
    eventLabel: string;
    snapshots: ParsedSnapshot[];
    /** Closest candidate(s) by name similarity — helps the operator
     *  decide whether to rename the sheet column or add a new event. */
    candidates: Array<{ id: string; name: string; score: number }>;
  }>;
  errors: ParseError[];
  totalSnapshots: number;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  // Ownership gate — belt + braces on top of RLS. A client loaded by
  // id but owned by another operator returns a clean 403.
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr) {
    return NextResponse.json(
      { ok: false, error: clientErr.message },
      { status: 500 },
    );
  }
  if (!client) {
    return NextResponse.json({ ok: false, error: "Client not found" }, { status: 404 });
  }
  if (client.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Upload ───────────────────────────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid multipart body" },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "Missing 'file' field" },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { ok: false, error: `File too large (max ${MAX_FILE_BYTES} bytes)` },
      { status: 413 },
    );
  }

  const referenceYearRaw = form.get("reference_year");
  const referenceYear =
    typeof referenceYearRaw === "string" && /^\d{4}$/.test(referenceYearRaw)
      ? parseInt(referenceYearRaw, 10)
      : undefined;

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseTicketingWorkbook(buf, { referenceYear });

  // ── Load this client's events for matching ────────────────────────────
  const { data: eventsData, error: eventsErr } = await supabase
    .from("events")
    .select("id, name, event_date, venue_name")
    .eq("client_id", clientId)
    .order("event_date", { ascending: true });
  if (eventsErr) {
    return NextResponse.json(
      { ok: false, error: eventsErr.message },
      { status: 500 },
    );
  }
  const events = (eventsData ?? []) as ClientEventRow[];

  // ── Reconcile ────────────────────────────────────────────────────────
  const byLabel = new Map<string, ParsedSnapshot[]>();
  for (const s of parsed.snapshots) {
    const list = byLabel.get(s.eventLabel) ?? [];
    list.push(s);
    byLabel.set(s.eventLabel, list);
  }

  const matches: ParsePreviewMatch[] = [];
  const unmatched: ParsePreviewResponse["unmatched"] = [];

  for (const [label, snapshots] of byLabel) {
    const match = findBestEventMatch(label, events);
    if (match) {
      matches.push({
        eventLabel: label,
        eventId: match.id,
        eventName: match.name,
        eventDate: match.event_date,
        venueName: match.venue_name,
        snapshots,
      });
    } else {
      const candidates = events
        .map((e) => ({
          id: e.id,
          name: e.name,
          score: similarityScore(label, e.name),
        }))
        .filter((c) => c.score > 0.2)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      unmatched.push({ eventLabel: label, snapshots, candidates });
    }
  }

  const response: ParsePreviewResponse = {
    ok: true,
    filename: file.name,
    sheets: parsed.sheets,
    matches: matches.sort((a, b) => a.eventName.localeCompare(b.eventName)),
    unmatched,
    errors: parsed.errors,
    totalSnapshots: parsed.snapshots.length,
  };
  return NextResponse.json(response);
}

/**
 * Match a sheet label to an event row using a layered set of rules:
 *   1. Exact case-insensitive match on `events.name`.
 *   2. Contains match ("Brighton Croatia" contains "Croatia" opponent).
 *   3. Jaccard-style token-overlap fallback threshold.
 *
 * When multiple rules tie, prefer the rule with higher score.
 * Exported for unit tests via the default export (but the current
 * module keeps it private — no test lives under lib/ for this helper
 * because the matcher is route-glue rather than a pure library).
 */
function findBestEventMatch(
  label: string,
  events: ClientEventRow[],
): ClientEventRow | null {
  let best: { score: number; event: ClientEventRow } | null = null;
  for (const ev of events) {
    const score = labelMatchScore(label, ev.name);
    if (score > (best?.score ?? 0)) {
      best = { score, event: ev };
    }
  }
  return best && best.score >= 0.6 ? best.event : null;
}
