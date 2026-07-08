import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";
import {
  getD2CConnectionCredentials,
  getScheduledSendById,
  updateScheduledSendAudience,
} from "@/lib/db/d2c";
import {
  getAudienceTags,
  recommendTagsForEvent,
  resolveAudienceTags,
} from "@/lib/d2c/audience/tag-registry";

/**
 * PATCH /api/d2c/scheduled-sends/{id}/audience-tags
 *
 * Update the multi-tag audience selection for an announce/gen_sale email send
 * (Goal 5). Body: { tags: string[] } — canonical tag NAMES. Writes
 * `audience.tags` (jsonb, no schema change). Auth: session + (send owner OR
 * D2C approver). Validation guards prevent editing a fired or approved send.
 */

interface Body {
  tags?: unknown;
}

const MULTITAG_JOB_TYPES = new Set(["announce", "gen_sale"]);

function readCred(creds: Record<string, unknown> | null, key: string): string {
  const v = creds?.[key];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * GET → the tag universe for a multi-tag send's audience, split into
 * recommended (event-relevant, pre-selected on first render) and other, plus
 * the currently persisted selection. Owner-or-approver only.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Send id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
  }

  const send = await getScheduledSendById(admin, id);
  if (!send) {
    return NextResponse.json({ ok: false, error: "Send not found" }, { status: 404 });
  }
  if (send.user_id !== user.id && !isD2CApprover(user.id)) {
    return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
  }
  if (!send.job_type || !MULTITAG_JOB_TYPES.has(send.job_type) || send.channel !== "email") {
    return NextResponse.json(
      { ok: false, error: "Not a multi-tag-capable send" },
      { status: 422 },
    );
  }

  const audience = (send.audience ?? {}) as Record<string, unknown>;
  const listId = typeof audience.list_id === "string" ? audience.list_id.trim() : "";
  if (!listId) {
    return NextResponse.json(
      { ok: false, error: "Send audience has no list_id" },
      { status: 422 },
    );
  }

  let creds: Record<string, unknown> | null = null;
  try {
    creds = await getD2CConnectionCredentials(admin, send.connection_id);
  } catch {
    creds = null;
  }
  const apiKey = readCred(creds, "api_key");
  const serverPrefix = readCred(creds, "server_prefix");
  if (!apiKey || !serverPrefix) {
    return NextResponse.json(
      { ok: false, error: "Mailchimp credentials unavailable" },
      { status: 502 },
    );
  }

  let allTags;
  try {
    allTags = await getAudienceTags(serverPrefix, apiKey, listId);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Tag fetch failed" },
      { status: 502 },
    );
  }

  const { data: eventRow } = await admin
    .from("events")
    .select("venue_city, venue_country, event_code")
    .eq("id", send.event_id)
    .maybeSingle();
  const ev = (eventRow ?? {}) as Record<string, unknown>;

  const { recommended, other } = recommendTagsForEvent(
    {
      ownTag: typeof audience.tag === "string" ? audience.tag : null,
      venue_city: typeof ev.venue_city === "string" ? ev.venue_city : null,
      venue_country: typeof ev.venue_country === "string" ? ev.venue_country : null,
      event_code: typeof ev.event_code === "string" ? ev.event_code : null,
    },
    allTags,
  );

  const selected = resolveAudienceTags(audience);
  const effectiveSelected =
    selected.length > 0 ? selected : recommended.map((t) => t.name);

  return NextResponse.json({
    ok: true,
    recommended,
    other,
    selected: effectiveSelected,
    persisted: selected,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Send id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !Array.isArray(body.tags) ||
    !body.tags.every((t) => typeof t === "string" && t.trim().length > 0)
  ) {
    return NextResponse.json(
      { ok: false, error: "tags must be a non-empty array of strings" },
      { status: 400 },
    );
  }
  const tags = [...new Set((body.tags as string[]).map((t) => t.trim()))];
  if (tags.length === 0) {
    return NextResponse.json(
      { ok: false, error: "At least one tag is required" },
      { status: 400 },
    );
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
  }

  const send = await getScheduledSendById(admin, id);
  if (!send) {
    return NextResponse.json({ ok: false, error: "Send not found" }, { status: 404 });
  }

  // Owner OR approver may edit.
  if (send.user_id !== user.id && !isD2CApprover(user.id)) {
    return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
  }

  if (!send.job_type || !MULTITAG_JOB_TYPES.has(send.job_type)) {
    return NextResponse.json(
      { ok: false, error: "Multi-tag editing is only allowed for announce / gen_sale sends" },
      { status: 422 },
    );
  }
  if (send.channel !== "email") {
    return NextResponse.json(
      { ok: false, error: "Multi-tag editing is only allowed for email sends" },
      { status: 422 },
    );
  }
  if (send.status !== "scheduled") {
    return NextResponse.json(
      { ok: false, error: `Cannot edit a send in status '${send.status}'` },
      { status: 422 },
    );
  }
  if (send.approval_status === "approved") {
    return NextResponse.json(
      { ok: false, error: "Send is approved — re-open for approval before editing tags" },
      { status: 422 },
    );
  }

  const nextAudience = { ...(send.audience ?? {}), tags };
  const updated = await updateScheduledSendAudience(admin, id, nextAudience);
  if (!updated) {
    return NextResponse.json({ ok: false, error: "Could not update audience" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, audience: updated.audience });
}
