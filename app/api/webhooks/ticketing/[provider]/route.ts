import { type NextRequest, NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFourthefansWebhookSecret } from "@/lib/attribution/feature-flags";
import {
  parseFourthefansPayload,
  verifyFourthefansSignature,
  type FourthefansRawPayload,
} from "@/lib/attribution/webhook-parser";

/**
 * app/api/webhooks/ticketing/[provider]/route.ts
 *
 * Provider-keyed webhook ingest for real-purchase events. Writes
 * directly into `ticketing_purchase_events` (migration 094). The
 * matcher cron (`/api/internal/match-attribution`) joins these rows
 * to `meta_click_touchpoints` to populate
 * `attribution_order_matches` — that's the dark-built moat.
 *
 * Provider routing
 *   `[provider]` is the URL slug. Today only `fourthefans` is
 *   supported; other providers return 404 so we don't accidentally
 *   accept a payload we can't validate.
 *
 * Auth model — fail-closed
 *   Each provider has a dedicated webhook secret env var. If the
 *   secret is unset for a given provider, the endpoint returns 503
 *   `{ ok: false, reason: "webhook_secret_unset" }` rather than
 *   silently accepting unsigned payloads. Mismatched signatures
 *   return 401. Replays of the same `(provider, external_order_id)`
 *   are 200-OK no-ops via the unique constraint on
 *   `ticketing_purchase_events`.
 *
 * Body parsing — minimum-viable contract
 *   Joe's spec hasn't been finalised yet (5-fix email 2026-05-18).
 *   For now we accept the shape outlined in the prompt:
 *     { order_id, event_id, email, _fbc, _fbp, purchased_at,
 *       tickets, amount, external_id?, ua?, ip?, currency? }
 *   Any unknown fields land in `raw_payload` so a future schema
 *   tightening doesn't lose data.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ provider: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { provider } = await ctx.params;
  const slug = provider.toLowerCase();

  if (slug !== "fourthefans") {
    return NextResponse.json(
      { ok: false, reason: "provider_not_supported" },
      { status: 404 },
    );
  }

  const secret = getFourthefansWebhookSecret();
  if (!secret) {
    // We deliberately do NOT echo the env var name back to the
    // caller — if the upstream sender is misconfigured the diagnosis
    // happens off-platform via deploy logs.
    return NextResponse.json(
      { ok: false, reason: "webhook_secret_unset" },
      { status: 503 },
    );
  }

  // Read body as raw text so the HMAC is computed over the exact
  // bytes the upstream signed. JSON parse only after signature pass.
  const rawBody = await req.text();
  const sig = verifyFourthefansSignature(rawBody, secret, {
    "x-fourthefans-signature": req.headers.get("x-fourthefans-signature"),
    "x-webhook-signature": req.headers.get("x-webhook-signature"),
  });
  if (!sig.ok) {
    return NextResponse.json(
      { ok: false, reason: sig.reason },
      { status: 401 },
    );
  }

  let raw: FourthefansRawPayload;
  try {
    raw = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = parseFourthefansPayload(raw);
  if (!parsed.ok) {
    if (parsed.reason === "missing_required_field") {
      return NextResponse.json(
        {
          ok: false,
          reason: "missing_required_field",
          missing: parsed.missing,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: false, reason: parsed.reason },
      { status: 400 },
    );
  }
  const payload = parsed.payload;

  const supabase = createServiceRoleClient();

  // Resolve `client_id` from the supplied `event_id`. We look it up
  // server-side rather than trusting the webhook payload to avoid
  // cross-client poisoning — a compromised webhook secret on one
  // tenant can't insert rows scoped to a different client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data: eventRow, error: eventErr } = await sb
    .from("events")
    .select("id, client_id")
    .eq("id", payload.eventId)
    .maybeSingle();

  if (eventErr) {
    console.error(
      "[webhooks/ticketing/fourthefans] event lookup failed",
      eventErr.message,
    );
    return NextResponse.json(
      { ok: false, reason: "event_lookup_failed" },
      { status: 500 },
    );
  }
  if (!eventRow) {
    return NextResponse.json(
      { ok: false, reason: "event_not_found" },
      { status: 404 },
    );
  }

  // `onConflict` on the unique constraint makes replays idempotent.
  const { error: upsertErr } = await sb
    .from("ticketing_purchase_events")
    .upsert(
      {
        client_id: eventRow.client_id,
        event_id: eventRow.id,
        external_order_id: payload.externalOrderId,
        provider: "fourthefans",
        purchased_at: payload.purchasedAt,
        ticket_count: payload.ticketCount,
        amount_minor: payload.amountMinor,
        currency: payload.currency,
        email_hash: payload.emailHash,
        external_id_hash: payload.externalIdHash,
        fbc: payload.fbc,
        fbp: payload.fbp,
        ua: payload.ua,
        ip_hash: payload.ipHash,
        raw_payload: raw,
      },
      { onConflict: "provider,external_order_id" },
    );

  if (upsertErr) {
    console.error(
      "[webhooks/ticketing/fourthefans] upsert failed",
      upsertErr.message,
    );
    return NextResponse.json(
      { ok: false, reason: "upsert_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, order_id: payload.externalOrderId },
    { status: 200 },
  );
}
