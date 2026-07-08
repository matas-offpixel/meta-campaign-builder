import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";
import {
  getD2CConnectionById,
  getD2CConnectionCredentials,
  getD2CEventCopy,
  getD2CTemplateButtonInfo,
  getD2CTemplateById,
  getEventVariablesSource,
  getScheduledSendById,
  listEventHeadlinerNames,
} from "@/lib/db/d2c";
import {
  claimAutorespFire,
  finalizeAutorespFire,
  releaseAutorespFire,
} from "@/lib/db/d2c-autoresp";
import { resolveBirdTemplateInfo } from "@/lib/d2c/bird/provider";
import { getD2CProvider } from "@/lib/d2c/registry";
import { resolveEventVariables } from "@/lib/d2c/event-variables";
import {
  createMemberSegment,
  deleteSegment,
} from "@/lib/d2c/mailchimp/ephemeral-segment";
import { sendMailchimpCampaignLive } from "@/lib/d2c/mailchimp/provider";
import {
  buildTestEmailAudience,
  resolveTestSendContent,
} from "@/lib/d2c/test-send/resolve";
import type { D2CConnection, D2CMessage } from "@/lib/d2c/types";

/**
 * POST /api/d2c/scheduled-sends/{id}/test-send
 *
 * "Send test to me" — the ONLY live-fire path from this dashboard.
 * Operator-only (session owner or D2C approver); MUST NOT be reachable from
 * the public share view (no session there → 401). Sends a single copy of the
 * send to the operator's OWN address:
 *   - email → session user's email. Creates a FRESH Mailchimp campaign
 *     targeting an ephemeral member-of-1 static segment (same pattern as the
 *     webhook autoresponder — lib/d2c/mailchimp/ephemeral-segment.ts), using
 *     the send's REAL subject/body (prefixed "[TEST] "), then deletes the
 *     segment. Bypasses the 3-of-3 live gate — a test always fires live to
 *     self, regardless of FEATURE_D2C_LIVE / connection flags — via
 *     `sendMailchimpCampaignLive`, which skips the dry-run check
 *     `MailchimpProvider.send` applies to every other caller.
 *
 *     Fix for: prior implementation cloned an already-created Mailchimp
 *     campaign off `result_jsonb` via `/actions/test`, which only exists
 *     AFTER a real send — so testing any not-yet-fired send 422'd with
 *     "Email test requires an already-created Mailchimp campaign…".
 *   - whatsapp/sms → MATAS_TEST_WHATSAPP_NUMBER (E164); disabled if unset.
 *     Unaffected by the email branch's campaign-clone bug (Bird has no
 *     create-campaign-upfront model) and still honours the live gate. Content
 *     resolution mirrors the email branch (copy_jsonb → template fallback) —
 *     fixed 2026-07-08 (Bug A) after the prior implementation always sent an
 *     empty body via a `result_jsonb.bodyMarkdown` field that never existed.
 *     Bird template identity (Bug B) is resolved from both `audience` and
 *     `variables` via `resolveBirdTemplateInfo`, matching the provider.
 * Bypasses the per-send dry_run column + list/tag filters (targets self only).
 *
 * Every fire (live or failed) is audited in `d2c_autoresp_fires` with
 * `is_test = true` (migration 144) — visible for ops but excluded from the
 * dedup lock and from the AutorespFireSummary the dashboard shows, so testing
 * never blocks or pollutes a real per-member autoresponder fire.
 *
 * Rate limit: 1 test / send / 60s / session (in-memory).
 */

const RATE_LIMIT_MS = 60_000;
const lastTestByKey = new Map<string, number>();

function readStr(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export async function POST(
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

  // Rate limit — 1 test / send / 60s / session.
  const rlKey = `${user.id}:${send.id}`;
  const now = Date.now();
  const last = lastTestByKey.get(rlKey);
  if (last !== undefined && now - last < RATE_LIMIT_MS) {
    const wait = Math.ceil((RATE_LIMIT_MS - (now - last)) / 1000);
    return NextResponse.json(
      { ok: false, error: `Cooldown — try again in ${wait}s`, rateLimited: true },
      { status: 429 },
    );
  }

  const connection = await getD2CConnectionById(admin, send.connection_id);
  if (!connection) {
    return NextResponse.json({ ok: false, error: "Connection not found" }, { status: 404 });
  }
  let creds: Record<string, unknown>;
  try {
    const c = await getD2CConnectionCredentials(admin, send.connection_id);
    if (!c) throw new Error("no credentials");
    creds = c;
  } catch {
    return NextResponse.json({ ok: false, error: "Credentials unavailable" }, { status: 502 });
  }

  const idempotencyKey = `test:${send.id}:${Math.floor(now / 1000)}`;

  // ── Email → fresh Mailchimp campaign → ephemeral member-of-1 segment ──────
  if (send.channel === "email") {
    const email = user.email;
    if (!email) {
      return NextResponse.json({ ok: false, error: "No email on your account" }, { status: 400 });
    }
    const serverPrefix = readStr(creds, "server_prefix");
    const apiKey = readStr(creds, "api_key");
    if (!serverPrefix || !apiKey) {
      return NextResponse.json({ ok: false, error: "Mailchimp credentials unavailable" }, { status: 502 });
    }

    const audience = (send.audience ?? {}) as Record<string, unknown>;
    const listId = readStr(audience, "list_id", "audience_id");
    if (!listId) {
      return NextResponse.json(
        { ok: false, error: "Send audience has no Mailchimp list — configure the audience before testing." },
        { status: 422 },
      );
    }

    // Content: prefer the rendered per-milestone copy (matches what the
    // dashboard preview shows), fall back to the send's template.
    const [copy, template, buttonInfo] = await Promise.all([
      getD2CEventCopy(admin, send.event_id),
      getD2CTemplateById(admin, send.template_id),
      getD2CTemplateButtonInfo(admin, send.template_id),
    ]);
    const content = resolveTestSendContent({
      jobType: send.job_type,
      copyBundle: copy?.copy_jsonb,
      templateSubject: template?.subject ?? null,
      templateBodyMarkdown: template?.body_markdown ?? null,
    });
    if (!content) {
      return NextResponse.json(
        { ok: false, error: "This send has no content to test (template and copy are both empty)." },
        { status: 422 },
      );
    }

    // Variables: mirror the real cron's resolution (event fields + headliners
    // + community/artwork copy vars + the send's own variables override).
    const [eventRow, headliners] = await Promise.all([
      getEventVariablesSource(admin, send.event_id),
      listEventHeadlinerNames(admin, send.event_id),
    ]);
    const known = resolveEventVariables(
      {
        name: eventRow?.name ?? "",
        event_date: eventRow?.event_date ?? null,
        event_start_at: eventRow?.event_start_at ?? null,
        event_timezone: eventRow?.event_timezone ?? null,
        ticket_url: eventRow?.ticket_url ?? null,
        presale_at: eventRow?.presale_at ?? null,
        general_sale_at: eventRow?.general_sale_at ?? null,
        venue_name: eventRow?.venue_name ?? null,
        venue_city: eventRow?.venue_city ?? null,
      },
      { artistHeadliners: headliners.length ? headliners : undefined },
    );
    const variables: Record<string, string> = {
      ...Object.fromEntries(Object.entries(known).map(([k, v]) => [k, String(v)])),
    };
    if (copy?.whatsapp_community_url) variables.community_url = copy.whatsapp_community_url;
    if (copy?.artwork_url) variables.artwork_url = copy.artwork_url;
    for (const [k, v] of Object.entries(send.variables ?? {})) {
      variables[k] = v == null ? "" : String(v);
    }

    // Audit claim (best-effort, migration 144: is_test = true — excluded from
    // the dedup lock and from every real-fire aggregate). Never blocks the
    // send itself on an audit-write hiccup.
    const claim = await claimAutorespFire(admin, {
      eventId: send.event_id,
      sendId: send.id,
      provider: "mailchimp",
      memberIdentifier: email,
      dryRun: false,
      isTest: true,
    });
    if (claim.error) {
      console.warn("[d2c test-send] audit claim failed:", claim.error);
    }
    const fireId = claim.id;

    let segment: { id: number } | null = null;
    try {
      segment = await createMemberSegment(serverPrefix, apiKey, listId, email, {
        namePrefix: "d2c-test",
        nowMs: now,
      });
    } catch (e) {
      if (fireId) await releaseAutorespFire(admin, fireId);
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? `Could not prepare test segment: ${e.message}` : "Could not prepare test segment" },
        { status: 502 },
      );
    }

    const liveConnection: D2CConnection = { ...connection, credentials: creds };
    const message: D2CMessage = {
      channel: "email",
      subject: content.subject,
      bodyMarkdown: content.bodyMarkdown,
      audience: buildTestEmailAudience(audience, {
        listId,
        savedSegmentId: segment.id,
        sendId: send.id,
        nowMs: now,
      }),
      variables,
      correlationId: idempotencyKey,
      // Bug D fix (2026-07-08): test sends now render with the same branded
      // chassis (hero artwork, dark background, CTA button) the dashboard
      // preview shows, via sendMailchimpCampaignLive → renderD2CEmailHtml.
      artworkUrl: copy?.artwork_url ?? null,
      eventName: eventRow?.name ?? "",
      buttonLabel: buttonInfo.button_label,
      buttonUrl: buttonInfo.button_url,
    };

    let result;
    try {
      result = await sendMailchimpCampaignLive(liveConnection, message);
    } catch (e) {
      if (fireId) await releaseAutorespFire(admin, fireId);
      await deleteSegment(serverPrefix, apiKey, listId, segment.id);
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Mailchimp test send failed" },
        { status: 502 },
      );
    }
    await deleteSegment(serverPrefix, apiKey, listId, segment.id);

    if (!result.ok) {
      if (fireId) await releaseAutorespFire(admin, fireId);
      return NextResponse.json({ ok: false, error: result.error ?? "Mailchimp test send failed" }, { status: 502 });
    }
    if (fireId) {
      await finalizeAutorespFire(admin, fireId, {
        dryRun: false,
        providerResponse: result.details ?? null,
        error: null,
      });
    }
    lastTestByKey.set(rlKey, now);
    return NextResponse.json({ ok: true, target: email, live: true });
  }

  // ── WhatsApp / SMS → Bird direct message to the test number ───────────────
  const number = process.env.MATAS_TEST_WHATSAPP_NUMBER?.trim();
  if (!number) {
    return NextResponse.json(
      { ok: false, error: "Set MATAS_TEST_WHATSAPP_NUMBER in env to enable WhatsApp test sends." },
      { status: 422 },
    );
  }

  // Content: same resolution as the email branch + the dashboard preview —
  // prefer the rendered per-milestone copy, fall back to the send's template.
  // Bug A fix (2026-07-08): the prior implementation read
  // result_jsonb.bodyMarkdown, a field that has NEVER existed on this table
  // (WA scheduled_sends don't populate result_jsonb until after they fire) —
  // every WA test always sent an empty body, and Bird's body-text fallback
  // path rejects that with a 422 "minimum string length is 1".
  const [waCopy, waTemplate] = await Promise.all([
    getD2CEventCopy(admin, send.event_id),
    getD2CTemplateById(admin, send.template_id),
  ]);
  const waContent = resolveTestSendContent({
    jobType: send.job_type,
    copyBundle: waCopy?.copy_jsonb,
    templateSubject: waTemplate?.subject ?? null,
    templateBodyMarkdown: waTemplate?.body_markdown ?? null,
  });
  if (!waContent) {
    return NextResponse.json(
      { ok: false, error: "This send has no content to test (template and copy are both empty)." },
      { status: 422 },
    );
  }

  // Reuse the send's audience descriptor (channel_id, locale, community_url)
  // but override the recipients to self and drop the list target so the
  // provider takes the single-recipient path — bypassing list/tag filters.
  const waVariables = (send.variables ?? {}) as Record<string, unknown>;
  const audience: Record<string, unknown> = {
    ...(send.audience ?? {}),
    recipients: [number],
  };
  delete audience.list_id;

  // Bug B fix (2026-07-08): WA scheduled_sends persist Bird template
  // identity under variables.bird_template_project_id/version_id, not
  // audience.project_id/template_id — resolveBirdTemplateInfo checks both
  // conventions (BirdProvider does too, as defence-in-depth for the real
  // webhook/poll fire path in lib/d2c/autoresp/fire.ts), but copy the
  // resolved ids onto audience explicitly here so this route's own intent
  // is legible without relying solely on the provider's fallback.
  const templateInfo = resolveBirdTemplateInfo(audience, waVariables);
  if (templateInfo) {
    audience.project_id = templateInfo.projectId;
    audience.template_id = templateInfo.versionId;
    audience.locale = templateInfo.locale;
  }

  const message: D2CMessage = {
    channel: send.channel,
    subject: null,
    bodyMarkdown: waContent.bodyMarkdown,
    audience,
    variables: waVariables,
    correlationId: idempotencyKey,
  };

  let provider;
  try {
    provider = getD2CProvider(connection.provider);
  } catch {
    return NextResponse.json({ ok: false, error: "Unknown provider" }, { status: 500 });
  }

  const liveConnection: D2CConnection = { ...connection, credentials: creds };
  try {
    const result = await provider.send(liveConnection, message);
    lastTestByKey.set(rlKey, now);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error ?? "Send failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, target: number, live: !result.dryRun, dryRun: result.dryRun });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Test send failed" },
      { status: 502 },
    );
  }
}

/** Test-only: reset the per-session test rate-limit map. */
export function __clearTestSendRateLimitForTests(): void {
  lastTestByKey.clear();
}
