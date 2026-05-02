import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { listCreativeTagAssignments } from "@/lib/db/creative-tags";
import { readActiveCreativesSnapshot } from "@/lib/db/active-creatives-snapshots";
import { buildCreativeTagBreakdowns } from "@/lib/reporting/creative-tag-breakdowns";
import {
  DATE_PRESETS,
  type CustomDateRange,
  type DatePreset,
} from "@/lib/insights/types";

export const runtime = "nodejs";

function parseDatePreset(value: string | null): DatePreset {
  if (value === "custom") return "custom";
  if (value && (DATE_PRESETS as readonly string[]).includes(value)) {
    return value as DatePreset;
  }
  return "maximum";
}

function parseCustomRange(
  preset: DatePreset,
  since: string | null,
  until: string | null,
): CustomDateRange | undefined {
  if (preset !== "custom" || !since || !until) return undefined;
  return { since, until };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const sp = req.nextUrl.searchParams;
  const datePreset = parseDatePreset(sp.get("datePreset"));
  const customRange = parseCustomRange(
    datePreset,
    sp.get("since"),
    sp.get("until"),
  );

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const { data: event, error } = await supabase
    .from("events")
    .select("id,user_id")
    .eq("id", eventId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !event) {
    return NextResponse.json(
      { error: "Event not found or not yours" },
      { status: 404 },
    );
  }

  const admin = createServiceRoleClient();
  const [snapshot, assignments] = await Promise.all([
    readActiveCreativesSnapshot(admin, {
      eventId,
      datePreset,
      customRange,
    }),
    listCreativeTagAssignments(supabase, eventId),
  ]);

  if (!snapshot || snapshot.payload.kind !== "ok") {
    return NextResponse.json({ ok: true, breakdowns: [] });
  }

  return NextResponse.json({
    ok: true,
    breakdowns: buildCreativeTagBreakdowns(
      snapshot.payload.groups,
      assignments,
    ),
  });
}
