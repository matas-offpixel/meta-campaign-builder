import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  getD2CConnectionById,
  getD2CConnectionCredentials,
  getD2CEventCopy,
  setD2CConnectionStatus,
  updateScheduledSendStatus,
} from "@/lib/db/d2c";
import { MailchimpHttpError, isMailchimpAuthErrorStatus } from "@/lib/d2c/mailchimp/client";
import { BirdHttpError, isBirdAuthErrorStatus } from "@/lib/d2c/bird/client";
import { getD2CProvider } from "@/lib/d2c/registry";
import { resolveEventVariables } from "@/lib/d2c/event-variables";
import { orchestrateJob, type OrchestrationInput } from "@/lib/d2c/orchestration";
import { logDraftReady } from "@/lib/d2c/notifications/draft-ready";
import type { D2CChannel, D2CConnection, D2CJobType, D2CMessage, D2CTemplate } from "@/lib/d2c/types";

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

interface EventVarsRow {
  name: string;
  event_date: string | null;
  event_start_at: string | null;
  event_timezone: string | null;
  ticket_url: string | null;
  presale_at: string | null;
  general_sale_at: string | null;
  venue_name: string | null;
  venue_city: string | null;
  user_id: string;
}

async function fetchEventForCron(
  supabase: ReturnType<typeof createServiceRoleClient>,
  eventId: string,
): Promise<EventVarsRow | null> {
  const { data, error } = await supabase
    .from("events")
    .select(
      "name, event_date, event_start_at, event_timezone, ticket_url, presale_at, general_sale_at, venue_name, venue_city, user_id",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (error) {
    console.warn("[cron d2c-send] event", error.message);
    return null;
  }
  return data as EventVarsRow | null;
}

async function fetchTemplateForCron(
  supabase: ReturnType<typeof createServiceRoleClient>,
  templateId: string,
  userId: string,
): Promise<D2CTemplate | null> {
  const { data, error } = await supabase
    .from("d2c_templates")
    .select("*")
    .eq("id", templateId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[cron d2c-send] template", error.message);
    return null;
  }
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    client_id: (r.client_id as string | null) ?? null,
    name: r.name as string,
    channel: r.channel as D2CChannel,
    subject: (r.subject as string | null) ?? null,
    body_markdown: r.body_markdown as string,
    variables_jsonb: (r.variables_jsonb as string[]) ?? [],
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}

async function listHeadlinerNamesForCron(
  supabase: ReturnType<typeof createServiceRoleClient>,
  eventId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("event_artists")
    .select("is_headliner, artist:artists ( name )")
    .eq("event_id", eventId)
    .order("billing_order", { ascending: true });
  if (error || !data) return [];
  const names: string[] = [];
  for (const row of data as { is_headliner: boolean; artist: { name: string } | { name: string }[] | null }[]) {
    if (!row.is_headliner) continue;
    const rel = row.artist;
    const a = Array.isArray(rel) ? rel[0] : rel;
    if (a?.name) names.push(a.name);
  }
  return names;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Service client unavailable" },
      { status: 500 },
    );
  }

  const { data: batch, error: qErr } = await supabase
    .from("d2c_scheduled_sends")
    .select(
      "id, user_id, event_id, template_id, connection_id, channel, audience, variables, scheduled_for, job_type",
    )
    .eq("status", "scheduled")
    .eq("approval_status", "approved")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(20);

  if (qErr) {
    return NextResponse.json(
      { ok: false, error: qErr.message },
      { status: 500 },
    );
  }

  const results: { id: string; outcome: string }[] = [];

  for (const row of batch ?? []) {
    const sendId = row.id as string;
    const userId = row.user_id as string;

    // autoresp_setup is no longer time-fired (PR: webhook-driven autoresponder).
    // Approval arms a persistent trigger (result_jsonb.autoresp_config); the
    // Mailchimp webhook + Bird poll cron fire per new signup. Leave the row
    // scheduled+approved and skip it here — never fire a one-off broadcast.
    if ((row.job_type as string | null) === "autoresp_setup") {
      results.push({ id: sendId, outcome: "skipped_autoresp_armed" });
      continue;
    }

    try {
      const event = await fetchEventForCron(supabase, row.event_id as string);
      if (!event || event.user_id !== userId) {
        await updateScheduledSendStatus(supabase, sendId, {
          status: "failed",
          resultJsonb: { error: "event_not_found" },
        });
        results.push({ id: sendId, outcome: "failed_no_event" });
        continue;
      }

      const template = await fetchTemplateForCron(
        supabase,
        row.template_id as string,
        userId,
      );
      if (!template) {
        await updateScheduledSendStatus(supabase, sendId, {
          status: "failed",
          resultJsonb: { error: "template_not_found" },
        });
        results.push({ id: sendId, outcome: "failed_no_template" });
        continue;
      }

      const meta = await getD2CConnectionById(supabase, row.connection_id as string);
      if (!meta || meta.user_id !== userId) {
        await updateScheduledSendStatus(supabase, sendId, {
          status: "failed",
          resultJsonb: { error: "connection_not_found" },
        });
        results.push({ id: sendId, outcome: "failed_no_connection" });
        continue;
      }

      let creds: Record<string, unknown>;
      try {
        const decrypted = await getD2CConnectionCredentials(
          supabase,
          row.connection_id as string,
        );
        creds = decrypted ?? {};
      } catch (e) {
        const msg = e instanceof Error ? e.message : "decrypt_failed";
        await updateScheduledSendStatus(supabase, sendId, {
          status: "failed",
          resultJsonb: { error: msg },
        });
        results.push({ id: sendId, outcome: "failed_decrypt" });
        continue;
      }

      const connection: D2CConnection = {
        ...meta,
        credentials: creds,
      };

      const headliners = await listHeadlinerNamesForCron(
        supabase,
        row.event_id as string,
      );

      const known = resolveEventVariables(
        {
          name: event.name,
          event_date: event.event_date,
          event_start_at: event.event_start_at,
          event_timezone: event.event_timezone,
          ticket_url: event.ticket_url,
          presale_at: event.presale_at,
          general_sale_at: event.general_sale_at,
          venue_name: event.venue_name,
          venue_city: event.venue_city,
        },
        { artistHeadliners: headliners.length ? headliners : undefined },
      );

      // The single human runtime input lives on d2c_event_copy. Inject the
      // WhatsApp community URL + resolved artwork so brief-generated copy
      // (which references {{community_url}} / {{artwork_url}}) renders.
      const eventCopy = await getD2CEventCopy(supabase, row.event_id as string);
      const copyVars: Record<string, string> = {};
      if (eventCopy?.whatsapp_community_url) {
        copyVars.community_url = eventCopy.whatsapp_community_url;
      }
      if (eventCopy?.artwork_url) {
        copyVars.artwork_url = eventCopy.artwork_url;
      }

      const mergedVars: Record<string, string> = {
        ...Object.fromEntries(
          Object.entries(known).map(([k, v]) => [k, String(v)]),
        ),
        ...copyVars,
        ...Object.fromEntries(
          Object.entries((row.variables as Record<string, unknown>) ?? {}).map(
            ([k, v]) => [k, v === null || v === undefined ? "" : String(v)],
          ),
        ),
      };

      // ── Job-type-aware orchestration ────────────────────────────────────
      // When the scheduling layer stamped a job_type AND supplied brand +
      // event_code (in variables) we dispatch through the richer orchestration
      // planner/executor. Rows without those refs fall back to the generic
      // provider.send path below (legacy / template-only sends).
      const jobType = (row.job_type as D2CJobType | null) ?? null;
      const brand = mergedVars.brand ?? mergedVars.BRAND ?? "";
      const eventCode = mergedVars.event_code ?? mergedVars.EVENT_CODE ?? "";
      if (jobType && brand && eventCode) {
        const rowAudience = (row.audience as Record<string, unknown>) ?? {};
        const str = (v: unknown): string | undefined =>
          typeof v === "string" && v.trim() ? v.trim() : undefined;
        const orchInput: OrchestrationInput = {
          jobType,
          channel: template.channel,
          brand,
          eventCode,
          connection: {
            id: connection.id,
            live_enabled: connection.live_enabled,
            approved_by_matas: connection.approved_by_matas,
          },
          variables: mergedVars,
          scheduleTimeIso: row.scheduled_for as string,
          mailchimp: {
            templateName: str(rowAudience.template_name) ?? template.name,
            audienceName: str(rowAudience.audience_name),
            listId: str(rowAudience.list_id),
            fromName: str(rowAudience.from_name),
            replyTo: str(rowAudience.reply_to),
            subject: template.subject ?? undefined,
          },
          bird: {
            projectId: str(rowAudience.project_id) ?? "",
            templateId: str(rowAudience.template_id) ?? "",
            templateStatus: str(rowAudience.template_status),
            channelId: str(rowAudience.channel_id),
            locale: str(rowAudience.locale),
          },
        };

        const mcApiKey = typeof creds.api_key === "string" ? creds.api_key : "";
        const mcPrefix = typeof creds.server_prefix === "string" ? creds.server_prefix : "";
        const birdKey = process.env.BIRD_API_KEY?.trim();
        const birdWs = process.env.BIRD_WORKSPACE_ID?.trim() || "9c308f77-c5ed-44d3-9714-9da017c7536c";
        const orch = await orchestrateJob(orchInput, {
          mailchimp: mcApiKey && mcPrefix ? { serverPrefix: mcPrefix, apiKey: mcApiKey } : undefined,
          bird: birdKey ? { apiKey: birdKey, workspaceId: birdWs } : undefined,
        });

        if (orch.dryRun) {
          await updateScheduledSendStatus(supabase, sendId, {
            status: "failed",
            resultJsonb: {
              orchestration: orch.plan,
              dryRun: true,
              draftReady: orch.draftReady ?? false,
              error: "dry_run_invariant",
              hint: "FEATURE_D2C_LIVE and per-connection live flags must be on for cron sends.",
            },
          });
          results.push({
            id: sendId,
            outcome: orch.draftReady ? "dry_run_draft" : "dry_run",
          });
          continue;
        }
        if (!orch.ok) {
          await updateScheduledSendStatus(supabase, sendId, {
            status: "failed",
            resultJsonb: { orchestration: orch.plan, error: orch.error ?? "orchestration_failed" },
          });
          results.push({ id: sendId, outcome: "failed_orchestration" });
          continue;
        }
        // Review-first Bird broadcast: draft created, do NOT fire. Matas reviews.
        if (orch.draftReady) {
          await updateScheduledSendStatus(supabase, sendId, {
            status: "draft_ready",
            resultJsonb: {
              orchestration: orch.plan,
              birdCampaignId: orch.birdCampaignId,
              birdBroadcastId: orch.birdBroadcastId,
              editUrl: orch.birdCampaignEditUrl,
            },
            birdCampaignId: orch.birdCampaignId ?? null,
            birdBroadcastId: orch.birdBroadcastId ?? null,
            birdCampaignEditUrl: orch.birdCampaignEditUrl ?? null,
            dryRun: false,
          });
          logDraftReady({
            event_id: row.event_id as string,
            job_type: jobType,
            bird_campaign_id: orch.birdCampaignId ?? "",
            edit_url: orch.birdCampaignEditUrl ?? "",
          });
          results.push({ id: sendId, outcome: "draft_ready" });
          continue;
        }
        await updateScheduledSendStatus(supabase, sendId, {
          status: "sent",
          resultJsonb: { orchestration: orch.plan, providerJobId: orch.providerJobId },
          dryRun: false,
        });
        results.push({ id: sendId, outcome: "sent" });
        continue;
      }

      const audience = {
        ...(row.audience as Record<string, unknown>),
        schedule_time: row.scheduled_for as string,
      };

      const message: D2CMessage = {
        channel: template.channel,
        subject: template.subject,
        bodyMarkdown: template.body_markdown,
        audience,
        variables: mergedVars,
        correlationId: sendId,
      };

      const provider = getD2CProvider(connection.provider);
      let providerResult;
      try {
        providerResult = await provider.send(connection, message);
      } catch (err) {
        if (err instanceof MailchimpHttpError && isMailchimpAuthErrorStatus(err.status)) {
          await setD2CConnectionStatus(
            supabase,
            connection.id,
            "error",
            err.message,
          );
        }
        if (err instanceof BirdHttpError && isBirdAuthErrorStatus(err.status)) {
          await setD2CConnectionStatus(
            supabase,
            connection.id,
            "error",
            err.message,
          );
        }
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        await updateScheduledSendStatus(supabase, sendId, {
          status: "failed",
          resultJsonb: { error: errorMsg },
        });
        results.push({ id: sendId, outcome: "failed_provider" });
        continue;
      }

      if (!providerResult.ok) {
        await updateScheduledSendStatus(supabase, sendId, {
          status: "failed",
          resultJsonb: providerResult,
        });
        results.push({ id: sendId, outcome: "failed_not_ok" });
        continue;
      }

      if (providerResult.dryRun) {
        await updateScheduledSendStatus(supabase, sendId, {
          status: "failed",
          resultJsonb: {
            ...providerResult,
            error: "dry_run_invariant",
            hint: "FEATURE_D2C_LIVE and per-connection live flags must be on for cron sends.",
          },
        });
        results.push({ id: sendId, outcome: "failed_dry_run" });
        continue;
      }

      // 2026-07-14 tag→list_id fix: BirdProvider (and any future provider
      // following the same convention) surfaces a resolved-from-tag
      // identifier as `details.resolvedAudiencePatch` when the row's
      // `audience` lacked one. Cache it back onto the row so a future
      // resend/retry of this send doesn't repeat the group lookup, and so
      // it's visible on the row for audit (not just buried in result_jsonb).
      const resolvedAudiencePatch =
        providerResult.details &&
        typeof providerResult.details === "object" &&
        "resolvedAudiencePatch" in providerResult.details &&
        typeof (providerResult.details as Record<string, unknown>)
          .resolvedAudiencePatch === "object"
          ? ((providerResult.details as Record<string, unknown>)
              .resolvedAudiencePatch as Record<string, unknown>)
          : undefined;

      await updateScheduledSendStatus(supabase, sendId, {
        status: "sent",
        resultJsonb: providerResult,
        dryRun: false,
        ...(resolvedAudiencePatch ? { audiencePatch: resolvedAudiencePatch } : {}),
      });
      results.push({ id: sendId, outcome: "sent" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "batch_error";
      await updateScheduledSendStatus(supabase, sendId, {
        status: "failed",
        resultJsonb: { error: msg },
      });
      results.push({ id: sendId, outcome: "failed_exception" });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
  });
}
