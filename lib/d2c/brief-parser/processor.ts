/**
 * lib/d2c/brief-parser/processor.ts
 *
 * Background processor for a d2c_brief_ingest_jobs row. Parses the brief,
 * inserts the event + rendered copy snapshot + the six scheduled sends, then
 * stamps the job succeeded (or failed with a message). Designed to run inside
 * Next.js `after()` so the ingest route can respond immediately.
 *
 * All writes use the service-role client (RLS bypass) but every row is stamped
 * with the job's user_id so RLS reads remain correct afterwards.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildD2CIdempotencyKey,
  type BriefParseResult,
  type D2CChannel,
  type D2CJobType,
} from "../types.ts";
import { parseBrief, type ParseBriefDeps } from "./index.ts";
import {
  getBriefIngestJob,
  updateBriefIngestJob,
  upsertD2CEventCopy,
  upsertScheduledSendByIdempotencyKey,
} from "@/lib/db/d2c";
import { resolveEventArtwork } from "@/lib/d2c/assets/resolver";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

const PROVIDER_BY_CHANNEL: Record<D2CChannel, string> = {
  email: "mailchimp",
  sms: "firetext",
  whatsapp: "bird",
};

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || "event"}-${suffix}`;
}

interface ConnectionLite {
  id: string;
  provider: string;
}

async function listClientConnections(
  supabase: AnySupabaseClient,
  clientId: string,
): Promise<ConnectionLite[]> {
  const { data, error } = await supabase
    .from("d2c_connections")
    .select("id, provider")
    .eq("client_id", clientId);
  if (error) {
    console.warn("[brief processor] listClientConnections", error.message);
    return [];
  }
  return (data ?? []) as ConnectionLite[];
}

function pickConnectionForChannel(
  connections: ConnectionLite[],
  channel: D2CChannel,
): ConnectionLite | null {
  const preferred = PROVIDER_BY_CHANNEL[channel];
  return (
    connections.find((c) => c.provider === preferred) ??
    connections[0] ??
    null
  );
}

async function insertEvent(
  supabase: AnySupabaseClient,
  userId: string,
  clientId: string,
  result: BriefParseResult,
): Promise<string> {
  const ev = result.event;
  const row = {
    user_id: userId,
    client_id: clientId,
    name: ev.name,
    slug: slugify(ev.name),
    event_code: ev.event_code ?? null,
    capacity: ev.capacity ?? null,
    venue_name: ev.venue_name,
    venue_city: ev.venue_city,
    venue_country: ev.venue_country ?? null,
    event_timezone: ev.event_timezone,
    event_date: ev.event_date ?? null,
    event_start_at: ev.event_start_at ?? null,
    announcement_at: ev.announcement_at ?? ev.signup_launch_at ?? null,
    presale_at: ev.presale_at,
    general_sale_at: ev.general_sale_at,
    ticket_url: ev.ticket_url,
    signup_url: ev.signup_url ?? null,
    status: "upcoming",
  };
  const { data, error } = await supabase
    .from("events")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (error || !data?.id) {
    throw new Error(`Failed to insert event: ${error?.message ?? "no id"}`);
  }
  return data.id as string;
}

async function ensureTemplate(
  supabase: AnySupabaseClient,
  userId: string,
  clientId: string,
  eventName: string,
  jobType: D2CJobType,
  channel: D2CChannel,
  subject: string | null,
  bodyMarkdown: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("d2c_templates")
    .insert({
      user_id: userId,
      client_id: clientId,
      name: `${eventName} — ${jobType}`,
      channel,
      subject,
      body_markdown: bodyMarkdown,
      variables_jsonb: [],
    })
    .select("id")
    .maybeSingle();
  if (error || !data?.id) {
    console.warn("[brief processor] ensureTemplate", error?.message);
    return null;
  }
  return data.id as string;
}

export interface ProcessBriefDeps extends ParseBriefDeps {
  pdfBuffer?: Buffer | null;
}

export interface ProcessBriefOutcome {
  ok: boolean;
  eventId?: string;
  sendsCreated: number;
  skipped: { job_type: D2CJobType; reason: string }[];
  error?: string;
}

/**
 * Process one brief ingest job end-to-end. Idempotent on scheduled sends via
 * the `${event_id}:${job_type}` key, but inserts a fresh event each run — the
 * route guards against double-processing by only invoking for pending jobs.
 */
export async function processBriefIngestJob(
  supabase: AnySupabaseClient,
  jobId: string,
  deps: ProcessBriefDeps = {},
): Promise<ProcessBriefOutcome> {
  const job = await getBriefIngestJob(supabase, jobId);
  if (!job) {
    return { ok: false, sendsCreated: 0, skipped: [], error: "job_not_found" };
  }
  if (job.status !== "pending") {
    return {
      ok: false,
      sendsCreated: 0,
      skipped: [],
      error: `job_not_pending (${job.status})`,
    };
  }

  await updateBriefIngestJob(supabase, jobId, { status: "processing" });

  try {
    const result = await parseBrief(deps.pdfBuffer ?? null, {
      anthropic: deps.anthropic,
      model: deps.model,
      briefText: deps.briefText,
    });

    const eventId = await insertEvent(
      supabase,
      job.user_id,
      job.client_id,
      result,
    );

    // Best-effort artwork resolution — never blocks ingest.
    let artworkUrl: string | null = null;
    try {
      artworkUrl = await resolveEventArtwork(supabase, eventId, {
        clientId: job.client_id,
        brandHint: result.event.name,
        eventCode: result.event.event_code ?? null,
      });
    } catch {
      artworkUrl = null;
    }

    await upsertD2CEventCopy(supabase, {
      userId: job.user_id,
      eventId,
      clientId: job.client_id,
      artworkUrl,
      copyJsonb: result.copy.copy_jsonb,
      sourceBriefJobId: jobId,
    });

    const connections = await listClientConnections(supabase, job.client_id);
    const skipped: { job_type: D2CJobType; reason: string }[] = [];
    let sendsCreated = 0;

    for (const send of result.scheduled_sends) {
      const connection = pickConnectionForChannel(connections, send.channel);
      if (!connection) {
        skipped.push({ job_type: send.job_type, reason: "no_connection_for_client" });
        continue;
      }
      const templateId = await ensureTemplate(
        supabase,
        job.user_id,
        job.client_id,
        result.event.name,
        send.job_type,
        send.channel,
        send.subject ?? null,
        send.body_markdown,
      );
      if (!templateId) {
        skipped.push({ job_type: send.job_type, reason: "template_insert_failed" });
        continue;
      }
      const created = await upsertScheduledSendByIdempotencyKey(supabase, {
        userId: job.user_id,
        eventId,
        templateId,
        connectionId: connection.id,
        channel: send.channel,
        audience: {},
        variables: {},
        scheduledFor: send.scheduled_for,
        status: "scheduled",
        dryRun: true,
        approvalStatus: "pending_approval",
        jobType: send.job_type,
        idempotencyKey: buildD2CIdempotencyKey(eventId, send.job_type),
      });
      if (created) sendsCreated += 1;
      else skipped.push({ job_type: send.job_type, reason: "send_insert_failed" });
    }

    await updateBriefIngestJob(supabase, jobId, {
      status: "succeeded",
      resultEventId: eventId,
      error: skipped.length
        ? `Created ${sendsCreated} sends; skipped ${skipped.length} (${skipped
            .map((s) => `${s.job_type}:${s.reason}`)
            .join(", ")})`
        : null,
    });

    return { ok: true, eventId, sendsCreated, skipped };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await updateBriefIngestJob(supabase, jobId, {
      status: "failed",
      error: message,
    });
    return { ok: false, sendsCreated: 0, skipped: [], error: message };
  }
}
