import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  insertAdditionalSpendEntry,
  listAdditionalSpendForVenue,
  type AdditionalSpendCategory,
} from "@/lib/db/additional-spend";
import {
  logAdditionalSpendValidationFailure,
  parseMoneyAmountInput,
  parseSpendDateToIso,
} from "@/lib/additional-spend-parse";
import { assertVenueShareTokenWritable } from "@/lib/db/share-token-venue-write-scope";

/**
 * GET/POST /api/venues/by-share-token/[token]/additional-spend
 *
 * Token-scoped CRUD for venue-level additional spend — same
 * validation as the authenticated internal route, but authorised by
 * the venue report share token (scope='venue'). Follows the
 * per-event `/api/events/by-share-token/...` pattern; surface
 * re-uses `listAdditionalSpendForVenue` / `insertAdditionalSpendEntry`
 * so the store shape stays identical whether the row is written from
 * the internal dashboard or the public share URL.
 *
 * `can_edit` gating: GET sets `requireCanEdit: false` so view-only
 * tokens can still display existing entries. POST requires
 * `can_edit=true`; internal PATCH of the share flips that on.
 */

const CATEGORIES: readonly AdditionalSpendCategory[] = [
  "PR",
  "INFLUENCER",
  "PRINT",
  "RADIO",
  "OTHER",
] as const;

function isCategory(s: string): s is AdditionalSpendCategory {
  return (CATEGORIES as readonly string[]).includes(s);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  const scope = await assertVenueShareTokenWritable(token, supabase, {
    requireCanEdit: false,
  });
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
  }

  const entries = await listAdditionalSpendForVenue(
    supabase,
    scope.clientId,
    scope.eventCode,
  );
  console.log(
    `[venue-share-spend GET] client_id=${scope.clientId} event_code=${scope.eventCode} token=${token.slice(0, 8)}… entriesReturned=${entries.length}`,
  );
  return NextResponse.json({ ok: true, entries });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  const scope = await assertVenueShareTokenWritable(token, supabase);
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const dateResult = parseSpendDateToIso(b.date);
  const amountResult = parseMoneyAmountInput(b.amount);
  const categoryRaw = typeof b.category === "string" ? b.category : "OTHER";
  const label = typeof b.label === "string" ? b.label : "";
  const notes =
    b.notes === null || b.notes === undefined ? null : String(b.notes);

  if (!dateResult.ok) {
    logAdditionalSpendValidationFailure(
      "POST venue by-share-token: date",
      body,
      { message: dateResult.message },
    );
    return NextResponse.json(
      {
        ok: false,
        error: dateResult.message,
        fieldErrors: { date: dateResult.message },
      },
      { status: 400 },
    );
  }
  if (!amountResult.ok) {
    logAdditionalSpendValidationFailure(
      "POST venue by-share-token: amount",
      body,
      { message: amountResult.message },
    );
    return NextResponse.json(
      {
        ok: false,
        error: amountResult.message,
        fieldErrors: { amount: amountResult.message },
      },
      { status: 400 },
    );
  }

  const date = dateResult.isoDate;
  const amount = amountResult.value;
  const category = isCategory(categoryRaw) ? categoryRaw : "OTHER";

  try {
    const row = await insertAdditionalSpendEntry(supabase, {
      userId: scope.ownerUserId,
      eventId: scope.anchorEventId,
      date,
      amount,
      category,
      label,
      notes,
      scope: "venue",
      venueEventCode: scope.eventCode,
    });
    console.log(
      `[venue-share-spend POST] client_id=${scope.clientId} event_code=${scope.eventCode} token=${token.slice(0, 8)}… inserted id=${row?.id} amount=${amount} date=${date}`,
    );
    return NextResponse.json({ ok: true, entry: row });
  } catch (err) {
    console.error(
      `[venue-share-spend POST] client_id=${scope.clientId} event_code=${scope.eventCode} token=${token.slice(0, 8)}… insert failed:`,
      err instanceof Error ? err.stack : err,
    );
    const msg = err instanceof Error ? err.message : "Insert failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
