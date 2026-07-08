import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getD2CConnectionById,
  getD2CConnectionCredentials,
  getD2CEventCopy,
} from "../../db/d2c.ts";
import {
  claimAutorespFire,
  finalizeAutorespFire,
  releaseAutorespFire,
  type AutorespFireProvider,
} from "../../db/d2c-autoresp.ts";
import { resolveEventVariables } from "../event-variables.ts";
import { mailchimpProvider } from "../mailchimp/provider.ts";
import { birdProvider } from "../bird/provider.ts";
import { resolveBirdTemplateVariables } from "../bird/template-variables.ts";
import {
  createMemberSegment,
  deleteSegment,
} from "../mailchimp/ephemeral-segment.ts";
import { readAutorespConfig, shouldFireAutoresp } from "./helpers.ts";
import {
  shouldD2CDryRun,
  type D2CConnection,
  type D2CMessage,
  type D2CScheduledSend,
} from "../types.ts";

/**
 * lib/d2c/autoresp/fire.ts
 *
 * Shared fire+dedup+audit path for the webhook-driven autoresponder. Consumed by
 * the Mailchimp webhook (email), the Bird poll cron (WhatsApp) and the backfill
 * tick. Every fire:
 *   1. CLAIMS a d2c_autoresp_fires row (unique index = dedup lock).
 *   2. Honours the 3-of-3 live gate — if any gate is off it records a dry-run
 *      audit row and sends nothing.
 *   3. Live email → ephemeral member-of-1 static segment → campaign send now →
 *      delete segment. Live WhatsApp → single-recipient Bird template message.
 *   4. Finalises the audit row (or releases it on a hard failure so a later poll
 *      can retry).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

export interface AutorespContext {
  send: D2CScheduledSend;
  connection: D2CConnection; // credentials decrypted
  provider: AutorespFireProvider;
  eventId: string;
  /** Raw (pre-substitution) subject + body for the send. */
  subject: string | null;
  bodyMarkdown: string;
  /** Resolved {{token}} → value map. */
  variables: Record<string, string>;
  /** Base audience descriptor carried by the send (channel_id, list ids, tag…). */
  audience: Record<string, unknown>;
  /** Mailchimp list id (email) — resolved across both key conventions. */
  listId: string | null;
}

export type FireOutcome =
  | { outcome: "fired"; dryRun: boolean }
  | { outcome: "skipped_dedup" }
  | { outcome: "skipped_disabled" }
  | { outcome: "error"; error: string };

function readStr(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Build the fire context for a send: decrypt credentials, resolve event
 * variables + copy, and normalise the audience descriptor. Returns null when
 * the send can't be fired (missing connection / disabled config handled by the
 * caller via the returned context).
 */
export async function resolveAutorespContext(
  admin: AnySupabaseClient,
  send: D2CScheduledSend,
): Promise<AutorespContext | null> {
  const provider: AutorespFireProvider =
    send.channel === "email" ? "mailchimp" : "bird";

  const meta = await getD2CConnectionById(admin, send.connection_id);
  if (!meta) return null;
  let creds: Record<string, unknown> = {};
  try {
    creds = (await getD2CConnectionCredentials(admin, send.connection_id)) ?? {};
  } catch {
    return null;
  }
  const connection: D2CConnection = { ...meta, credentials: creds };

  // Event + copy for variable resolution (mirrors the cron's resolver).
  const { data: ev } = await admin
    .from("events")
    .select(
      "name, event_date, event_start_at, event_timezone, ticket_url, presale_at, general_sale_at, venue_name, venue_city",
    )
    .eq("id", send.event_id)
    .maybeSingle();
  const eventRow = (ev ?? {}) as Record<string, unknown>;

  const base = resolveEventVariables({
    name: (eventRow.name as string) ?? "",
    event_date: (eventRow.event_date as string | null) ?? null,
    event_start_at: (eventRow.event_start_at as string | null) ?? null,
    event_timezone: (eventRow.event_timezone as string | null) ?? null,
    ticket_url: (eventRow.ticket_url as string | null) ?? null,
    presale_at: (eventRow.presale_at as string | null) ?? null,
    general_sale_at: (eventRow.general_sale_at as string | null) ?? null,
    venue_name: (eventRow.venue_name as string | null) ?? null,
    venue_city: (eventRow.venue_city as string | null) ?? null,
  });

  const copy = await getD2CEventCopy(admin, send.event_id);
  const variables: Record<string, string> = {
    ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, String(v)])),
  };
  if (copy?.whatsapp_community_url) variables.community_url = copy.whatsapp_community_url;
  if (copy?.artwork_url) variables.artwork_url = copy.artwork_url;
  for (const [k, v] of Object.entries(send.variables ?? {})) {
    variables[k] = v == null ? "" : String(v);
  }

  // Bird template variables (2026-07-08 fix): d2c_scheduled_sends.variables
  // never carries the Bird-template-shaped keys (event_date, presale_day,
  // presale_time, event_artwork_url, wa_community_invite, event_url_suffix —
  // see lib/d2c/bird/template-variables.ts's doc for the full union across
  // every registered template) — only locale/artwork_url/bird_template_*.
  // Resolved fresh from source-of-truth (event + event_copy) and merged LAST
  // so it wins over any stale/partial value on the send row — recommended +
  // documented choice from the ask; a manual override belongs on the event/
  // copy row, not the scheduled_send. No-op for the email channel (distinct
  // key names from the {{token}} set resolveEventVariables produces above).
  Object.assign(
    variables,
    resolveBirdTemplateVariables({
      event: {
        name: (eventRow.name as string) ?? "",
        event_start_at: (eventRow.event_start_at as string | null) ?? null,
        presale_at: (eventRow.presale_at as string | null) ?? null,
        ticket_url: (eventRow.ticket_url as string | null) ?? null,
      },
      copy: {
        artwork_url: copy?.artwork_url ?? null,
        whatsapp_community_url: copy?.whatsapp_community_url ?? null,
      },
      timezone: (eventRow.event_timezone as string | null) ?? "Europe/London",
    }),
  );

  // Prefer the per-milestone rendered copy, then the send's own template.
  const copyBlock = copy?.copy_jsonb?.autoresp_setup ?? null;

  let subject: string | null = copyBlock?.subject ?? null;
  let bodyMarkdown = copyBlock?.body_markdown ?? "";
  if (!bodyMarkdown) {
    const { data: tpl } = await admin
      .from("d2c_templates")
      .select("subject, body_markdown")
      .eq("id", send.template_id)
      .maybeSingle();
    const t = (tpl ?? {}) as Record<string, unknown>;
    subject = subject ?? ((t.subject as string | null) ?? null);
    bodyMarkdown = (t.body_markdown as string | null) ?? "";
  }

  const audience = (send.audience ?? {}) as Record<string, unknown>;
  const listId = readStr(audience, "list_id", "audience_id");

  return {
    send,
    connection,
    provider,
    eventId: send.event_id,
    subject,
    bodyMarkdown,
    variables,
    audience,
    listId,
  };
}

/**
 * Fire the autoresponder for a single member. Claims the dedup row first, honours
 * the live gate, sends via the provider, and finalises the audit row. Safe to
 * call concurrently — the unique index guarantees at-most-once per member.
 */
export async function fireAutorespToMember(
  admin: AnySupabaseClient,
  ctx: AutorespContext,
  recipient: string,
): Promise<FireOutcome> {
  const config = readAutorespConfig(ctx.send.result_jsonb);
  if (!shouldFireAutoresp({ config, alreadyFired: false })) {
    return { outcome: "skipped_disabled" };
  }

  const dryRun = shouldD2CDryRun(ctx.connection);

  // Claim the dedup row before doing anything with side effects.
  const claim = await claimAutorespFire(admin, {
    eventId: ctx.eventId,
    sendId: ctx.send.id,
    provider: ctx.provider,
    memberIdentifier: recipient,
    dryRun,
  });
  if (claim.alreadyFired) return { outcome: "skipped_dedup" };
  if (!claim.claimed || !claim.id) {
    return { outcome: "error", error: claim.error ?? "claim failed" };
  }
  const fireId = claim.id;

  try {
    if (ctx.provider === "mailchimp") {
      const result = await fireEmail(ctx, recipient, dryRun);
      if (!result.ok && !result.dryRun) {
        await releaseAutorespFire(admin, fireId);
        return { outcome: "error", error: result.error ?? "email send failed" };
      }
      await finalizeAutorespFire(admin, fireId, {
        dryRun: result.dryRun,
        providerResponse: result.details ?? null,
        error: result.error ?? null,
      });
      return { outcome: "fired", dryRun: result.dryRun };
    }

    const result = await fireWhatsApp(ctx, recipient);
    if (!result.ok && !result.dryRun) {
      await releaseAutorespFire(admin, fireId);
      return { outcome: "error", error: result.error ?? "whatsapp send failed" };
    }
    await finalizeAutorespFire(admin, fireId, {
      dryRun: result.dryRun,
      providerResponse: result.details ?? null,
      error: result.error ?? null,
    });
    return { outcome: "fired", dryRun: result.dryRun };
  } catch (e) {
    await releaseAutorespFire(admin, fireId);
    return { outcome: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

async function fireEmail(
  ctx: AutorespContext,
  email: string,
  dryRun: boolean,
) {
  const creds = ctx.connection.credentials as Record<string, unknown>;
  const apiKey = readStr(creds, "api_key");
  const serverPrefix = readStr(creds, "server_prefix");
  const listId = ctx.listId;

  // Under the dry-run gate we never touch Mailchimp — the provider short-
  // circuits to a dry run. No ephemeral segment is created.
  if (dryRun || !apiKey || !serverPrefix || !listId) {
    const message = buildEmailMessage(ctx, listId, null);
    return mailchimpProvider.send(ctx.connection, message);
  }

  const segment = await createMemberSegment(serverPrefix, apiKey, listId, email);
  try {
    const message = buildEmailMessage(ctx, listId, segment.id);
    return await mailchimpProvider.send(ctx.connection, message);
  } finally {
    await deleteSegment(serverPrefix, apiKey, listId, segment.id);
  }
}

function buildEmailMessage(
  ctx: AutorespContext,
  listId: string | null,
  savedSegmentId: number | null,
): D2CMessage {
  const audience: Record<string, unknown> = {
    ...ctx.audience,
    list_id: listId ?? ctx.audience.list_id ?? ctx.audience.audience_id,
    send_now: true,
    campaign_title: `autoresp-${ctx.send.id}`,
  };
  if (savedSegmentId != null) audience.saved_segment_id = savedSegmentId;
  // Never target the whole tag on an autoresp fire.
  delete audience.tags;
  delete audience.tag;
  return {
    channel: "email",
    subject: ctx.subject,
    bodyMarkdown: ctx.bodyMarkdown,
    audience,
    variables: ctx.variables,
    correlationId: `autoresp:${ctx.send.id}`,
  };
}

function fireWhatsApp(ctx: AutorespContext, phone: string) {
  const audience: Record<string, unknown> = {
    ...ctx.audience,
    recipients: [phone],
  };
  // Single-recipient send bypasses any list targeting.
  delete audience.list_id;
  delete audience.tag;
  delete audience.tags;
  const message: D2CMessage = {
    channel: "whatsapp",
    subject: null,
    bodyMarkdown: ctx.bodyMarkdown,
    audience,
    variables: ctx.variables,
    correlationId: `autoresp:${ctx.send.id}`,
  };
  return birdProvider.send(ctx.connection, message);
}
