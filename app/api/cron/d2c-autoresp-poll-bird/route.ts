import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { birdJson } from "@/lib/d2c/bird/client";
import { findGroupByName } from "@/lib/d2c/bird/groups/client";
import {
  listAutorespSendsByChannel,
  updateScheduledSendStatus,
} from "@/lib/db/d2c";
import {
  resolveAutorespContext,
  fireAutorespToMember,
} from "@/lib/d2c/autoresp/fire";
import {
  isAutorespArmed,
  readAutorespLastPollAt,
  mergeAutorespResultJsonb,
} from "@/lib/d2c/autoresp/helpers";
import {
  parseBirdContacts,
  contactsCreatedAfter,
} from "@/lib/d2c/autoresp/bird-contacts";

/**
 * GET /api/cron/d2c-autoresp-poll-bird
 *
 * WhatsApp autoresponder driver (Goal 3). Bird has no verified contact-created
 * webhook, so we poll every minute (per the user's decision to skip the Bird
 * webhook sub-arc). For each armed autoresp_setup WhatsApp send we resolve its
 * Bird list, read the contacts added since the last poll, and fire a
 * single-recipient template send per NEW contact (deduped via
 * d2c_autoresp_fires). Idempotent + safe to re-run: dedup guards double-fires
 * and unparseable contacts are dropped.
 *
 * NOTE: the Bird list-contacts response shape is UNVERIFIED for this PR — see
 * lib/d2c/autoresp/bird-contacts.ts. Live-capture + tighten before relying on
 * `createdAt`-based windowing.
 */
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ ok: false, error: "Service client unavailable" }, { status: 500 });
  }

  const sends = await listAutorespSendsByChannel(admin, "whatsapp");
  const nowIso = new Date().toISOString();
  const results: Array<{ sendId: string; outcome: string; fired?: number; skipped?: number }> = [];

  for (const send of sends) {
    if (!isAutorespArmed(send.result_jsonb)) {
      results.push({ sendId: send.id, outcome: "not_armed" });
      continue;
    }
    try {
      const ctx = await resolveAutorespContext(admin, send);
      if (!ctx) {
        results.push({ sendId: send.id, outcome: "no_context" });
        continue;
      }
      const creds = ctx.connection.credentials as Record<string, unknown>;
      const apiKey = typeof creds.api_key === "string" ? creds.api_key.trim() : "";
      const wsId =
        (typeof creds.workspace_id === "string" ? creds.workspace_id.trim() : "") ||
        ctx.connection.external_account_id ||
        "";
      const tag = typeof ctx.audience.tag === "string" ? ctx.audience.tag.trim() : "";
      if (!apiKey || !wsId || !tag) {
        results.push({ sendId: send.id, outcome: "missing_creds_or_tag" });
        continue;
      }

      // Resolve the Bird group/list by name (== signup tag). Shared with the
      // Journey trigger-group resolver (lib/d2c/bird/groups/client.ts) — one
      // impl, both callers, per the groups===lists resource-duality finding.
      const match = await findGroupByName({ apiKey, workspaceId: wsId }, tag);
      if (!match?.id) {
        results.push({ sendId: send.id, outcome: "list_not_found" });
        continue;
      }

      const contactsEnv = await birdJson<unknown>(
        apiKey,
        `/workspaces/${wsId}/lists/${match.id}/contacts?limit=200&include_total=true`,
        { method: "GET" },
      );
      const lastPollMs = (() => {
        const iso = readAutorespLastPollAt(send.result_jsonb);
        const t = iso ? Date.parse(iso) : NaN;
        return Number.isFinite(t) ? t : null;
      })();

      const fresh = contactsCreatedAfter(parseBirdContacts(contactsEnv), lastPollMs);

      let fired = 0;
      let skipped = 0;
      for (const contact of fresh) {
        const res = await fireAutorespToMember(admin, ctx, contact.phone);
        if (res.outcome === "fired") fired += 1;
        else skipped += 1;
      }

      // Advance the poll cursor regardless of individual outcomes — dedup
      // prevents re-firing anyone we already attempted.
      await updateScheduledSendStatus(admin, send.id, {
        resultJsonb: mergeAutorespResultJsonb(send.result_jsonb, { lastPollAt: nowIso }),
      });

      results.push({ sendId: send.id, outcome: "polled", fired, skipped });
    } catch (e) {
      results.push({
        sendId: send.id,
        outcome: `error:${e instanceof Error ? e.message : "unknown"}`,
      });
    }
  }

  return NextResponse.json({ ok: true, scanned: sends.length, results });
}
