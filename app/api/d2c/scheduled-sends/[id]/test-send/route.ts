import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";
import {
  getD2CConnectionById,
  getD2CConnectionCredentials,
  getScheduledSendById,
} from "@/lib/db/d2c";
import { getD2CProvider } from "@/lib/d2c/registry";
import { mailchimpJson } from "@/lib/d2c/mailchimp/client";
import { readMailchimpCampaignId } from "@/lib/d2c/metrics/types";
import type { D2CConnection, D2CMessage } from "@/lib/d2c/types";

/**
 * POST /api/d2c/scheduled-sends/{id}/test-send
 *
 * "Send test to me" (Goal 7) — the ONLY live-fire path from this dashboard.
 * Operator-only (session owner or D2C approver); MUST NOT be reachable from
 * the public share view (no session there → 401). Sends a single copy of the
 * send to the operator's OWN address:
 *   - email → session user's email (via Mailchimp campaign test-email action,
 *     which requires an already-created campaign on this send)
 *   - whatsapp/sms → MATAS_TEST_WHATSAPP_NUMBER (E164); disabled if unset
 * Bypasses the per-send dry_run column + list/tag filters (targets self only).
 * The FEATURE_D2C_LIVE master kill-switch is still honoured by the provider —
 * a deliberate safety carve-out (see PR notes), so with the flag off this
 * returns a dry-run result rather than firing.
 *
 * Rate limit: 1 test / send / 60s / session (in-memory).
 */

const RATE_LIMIT_MS = 60_000;
const lastTestByKey = new Map<string, number>();

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
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

  // ── Email → Mailchimp campaign test-email action ──────────────────────────
  if (send.channel === "email") {
    const email = user.email;
    if (!email) {
      return NextResponse.json({ ok: false, error: "No email on your account" }, { status: 400 });
    }
    const serverPrefix = readString(creds, "server_prefix");
    const apiKey = readString(creds, "api_key");
    const campaignId = readMailchimpCampaignId(send.result_jsonb);
    if (!serverPrefix || !apiKey) {
      return NextResponse.json({ ok: false, error: "Mailchimp credentials unavailable" }, { status: 502 });
    }
    if (!campaignId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Email test requires an already-created Mailchimp campaign for this send (none yet — the campaign is created at real send time).",
        },
        { status: 422 },
      );
    }
    try {
      await mailchimpJson<unknown>(
        serverPrefix,
        apiKey,
        `/3.0/campaigns/${encodeURIComponent(campaignId)}/actions/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ test_emails: [email], send_type: "html" }),
        },
      );
      lastTestByKey.set(rlKey, now);
      return NextResponse.json({ ok: true, target: email, live: true });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Mailchimp test failed" },
        { status: 502 },
      );
    }
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
