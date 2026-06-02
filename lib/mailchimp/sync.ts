import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  getAudience,
  MailchimpApiError,
  type MailchimpAudience,
} from "@/lib/mailchimp/client";
import { getMailchimpCredentials } from "@/lib/mailchimp/credentials";

export interface MailchimpSyncEventRow {
  id: string;
  user_id: string;
  kind: string | null;
  mailchimp_audience_id: string | null;
  client: { mailchimp_account_id: string | null; mailchimp_audience_id: string | null } | null;
}

/** Resolves the effective mailchimp_audience_id: event override → client default. */
export function resolveMailchimpAudienceId(
  event: MailchimpSyncEventRow,
): string | null {
  if (event.mailchimp_audience_id) return event.mailchimp_audience_id;
  const client = Array.isArray(event.client) ? event.client[0] : event.client;
  return client?.mailchimp_audience_id ?? null;
}

export interface SyncMailchimpAudienceResult {
  eventId: string;
  ok: boolean;
  snapshotId?: string;
  error?: string;
}

/**
 * Syncs the Mailchimp audience snapshot for one event.
 *
 * Shared by the daily cron and the manual-refresh endpoint so the logic
 * stays in one place and the cron tests exercise the same code.
 */
export async function syncMailchimpAudienceForEvent(
  supabase: ReturnType<typeof createServiceRoleClient>,
  event: MailchimpSyncEventRow,
): Promise<SyncMailchimpAudienceResult> {
  const audienceId = resolveMailchimpAudienceId(event);
  if (!audienceId) {
    return { eventId: event.id, ok: false, error: "no_audience_id" };
  }

  // Resolve the Mailchimp account for this event (via client).
  const client = Array.isArray(event.client) ? event.client[0] : event.client;
  const accountId = client?.mailchimp_account_id ?? null;
  if (!accountId) {
    return { eventId: event.id, ok: false, error: "no_account_id" };
  }

  let credentials;
  try {
    credentials = await getMailchimpCredentials(supabase, accountId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { eventId: event.id, ok: false, error: `credentials: ${message}` };
  }
  if (!credentials) {
    return { eventId: event.id, ok: false, error: "no_credentials" };
  }

  let audience: MailchimpAudience;
  try {
    audience = await getAudience(credentials.dc, audienceId, credentials.apiKey);
  } catch (err) {
    const message =
      err instanceof MailchimpApiError ? err.message : String(err);
    return { eventId: event.id, ok: false, error: `api: ${message}` };
  }

  const stats = audience.stats;
  // Determine client_id from the first client col returned (may be null for events without client).
  const clientId = (event as { client_id?: string | null }).client_id ?? null;

  const snapshotRow = {
    user_id: event.user_id,
    event_id: event.id,
    client_id: clientId,
    mailchimp_audience_id: audienceId,
    total_contacts: stats.member_count,
    email_subscribers:
      stats.member_count -
      (stats.unsubscribe_count ?? 0) -
      (stats.cleaned_count ?? 0),
    pending: null as number | null,
    unsubscribed: stats.unsubscribe_count ?? null,
    cleaned: stats.cleaned_count ?? null,
    member_count_since_send: stats.member_count_since_send ?? null,
    avg_open_rate: stats.open_rate ?? null,
    avg_click_rate: stats.click_rate ?? null,
    snapshot_at: new Date().toISOString(),
    raw_json: JSON.parse(JSON.stringify(audience)) as object,
  };

  // Upsert — unique on (event_id, snapshot_at::date).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data: upserted, error: upsertError } = await sb
    .from("mailchimp_audience_snapshots")
    .upsert(snapshotRow, {
      onConflict: "event_id,snapshot_at",
      ignoreDuplicates: false,
    })
    .select("id")
    .maybeSingle();

  if (upsertError) {
    return {
      eventId: event.id,
      ok: false,
      error: `upsert: ${upsertError.message}`,
    };
  }

  return {
    eventId: event.id,
    ok: true,
    snapshotId: (upserted as { id?: string } | null)?.id,
  };
}
