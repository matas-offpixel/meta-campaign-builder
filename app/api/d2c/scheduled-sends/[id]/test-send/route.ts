import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";
import {
  getD2CConnectionById,
  getD2CConnectionCredentials,
  getD2CEventCopy,
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
 *     Unaffected by the above — Bird has no create-campaign-upfront model, so
 *     this branch is untouched and still honours the live gate (deliberate
 *     asymmetry: WhatsApp test was never blocked by the campaign-clone bug).
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
    const [copy, template] = await Promise.all([
      getD2CEventCopy(admin, send.event_id),
      getD2CTemplateById(admin, send.template_id),
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

  // Reuse the send's audience descriptor (template project/version, channel_id,
  // locale) but override the recipients to self and drop the list target so the
  // provider takes the single-recipient path — bypassing list/tag filters.
  const audience: Record<string, unknown> = {
    ...(send.audience ?? {}),
    recipients: [number],
  };
  delete audience.list_id;

  const message: D2CMessage = {
    channel: send.channel,
    subject: null,
    bodyMarkdown:
      typeof (send.result_jsonb as Record<string, unknown>)?.bodyMarkdown === "string"
        ? ((send.result_jsonb as Record<string, unknown>).bodyMarkdown as string)
        : "",
    audience,
    variables: (send.variables ?? {}) as Record<string, unknown>,
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
