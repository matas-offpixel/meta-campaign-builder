/**
 * POST /api/internal-counts/items/[id] — one action on a review-list item
 * (R1). Operator session only; the item must be the operator's own (RLS).
 * Form fields: action, and event_id / figure / date / total where the
 * action needs one. Redirects back to /internal-counts.
 */

import { NextResponse, type NextRequest } from "next/server";

import { resolveItem, resolverName, type ResolveAction } from "@/lib/internal-counts/resolve";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

function parseAction(form: FormData): ResolveAction | null {
  const kind = String(form.get("action") ?? "");
  const eventId = String(form.get("event_id") ?? "");
  const figure = Number(form.get("figure"));
  const total = Number(form.get("total"));
  const date = String(form.get("date") ?? "");
  switch (kind) {
    case "add_manual":
      return eventId && Number.isFinite(figure) ? { kind, eventId, figure } : null;
    case "match":
      return eventId ? { kind, eventId } : null;
    case "use_date":
      return date ? { kind, date } : null;
    case "use_total":
      return Number.isInteger(total) ? { kind, total } : null;
    case "revenue_right":
    case "keep_holding":
    case "not_a_sale":
    case "not_ours":
    case "read_as_count":
    case "not_a_count":
    case "undo":
    case "keep":
    case "checked":
      return { kind };
    default:
      return null;
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  // RLS: an operator only sees their own items.
  const { data: own } = await supabase.from("internal_count_review_items").select("id").eq("id", id).maybeSingle();
  if (!own) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  const action = parseAction(await req.formData());
  const back = new URL("/internal-counts", req.nextUrl.origin);
  if (!action) {
    back.searchParams.set("action", "incomplete");
    return NextResponse.redirect(back, 303);
  }
  try {
    await resolveItem(createServiceRoleClient(), id, action, { userId: user.id, name: resolverName(user.email) });
    back.searchParams.set("action", "done");
  } catch (err) {
    console.error(`[internal-counts-item] ${err instanceof Error ? err.message : "failed"}`);
    back.searchParams.set("action", "failed");
  }
  return NextResponse.redirect(back, 303);
}
