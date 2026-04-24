import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  insertAdditionalSpendEntry,
  listAdditionalSpendForEvent,
  type AdditionalSpendCategory,
} from "@/lib/db/additional-spend";
import { assertEventShareTokenWritable } from "@/lib/db/share-token-event-write-scope";

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

/**
 * GET/POST /api/events/by-share-token/[token]/additional-spend
 *
 * Token-scoped CRUD for additional spend — same validation as the
 * authenticated routes, but authorised by the event report share token.
 */
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

  const scope = await assertEventShareTokenWritable(token, supabase, {
    requireCanEdit: false,
  });
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
  }

  const entries = await listAdditionalSpendForEvent(supabase, scope.eventId);
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

  const scope = await assertEventShareTokenWritable(token, supabase);
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
  const date = typeof b.date === "string" ? b.date : null;
  const amount = typeof b.amount === "number" ? b.amount : Number(b.amount);
  const categoryRaw = typeof b.category === "string" ? b.category : "OTHER";
  const label = typeof b.label === "string" ? b.label : "";
  const notes =
    b.notes === null || b.notes === undefined
      ? null
      : String(b.notes);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "Invalid date" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ ok: false, error: "Invalid amount" }, { status: 400 });
  }
  const category = isCategory(categoryRaw) ? categoryRaw : "OTHER";

  try {
    const row = await insertAdditionalSpendEntry(supabase, {
      userId: scope.ownerUserId,
      eventId: scope.eventId,
      date,
      amount,
      category,
      label,
      notes,
    });
    return NextResponse.json({ ok: true, entry: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Insert failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
