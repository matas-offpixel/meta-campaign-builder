import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  getD2CConnectionById,
  getD2CConnectionCredentials,
  setD2CConnectionStatus,
  updateScheduledSendStatus,
} from "@/lib/db/d2c";
import { MailchimpHttpError, isMailchimpAuthErrorStatus } from "@/lib/d2c/mailchimp/client";
import { getD2CProvider } from "@/lib/d2c/registry";
import { resolveEventVariables } from "@/lib/d2c/event-variables";
import type { D2CChannel, D2CConnection, D2CMessage, D2CTemplate } from "@/lib/d2c/types";

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
      "id, user_id, event_id, template_id, connection_id, channel, audience, variables, scheduled_for",
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

      const mergedVars: Record<string, string> = {
        ...Object.fromEntries(
          Object.entries(known).map(([k, v]) => [k, String(v)]),
        ),
        ...Object.fromEntries(
          Object.entries((row.variables as Record<string, unknown>) ?? {}).map(
            ([k, v]) => [k, v === null || v === undefined ? "" : String(v)],
          ),
        ),
      };

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

      await updateScheduledSendStatus(supabase, sendId, {
        status: "sent",
        resultJsonb: providerResult,
        dryRun: false,
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
