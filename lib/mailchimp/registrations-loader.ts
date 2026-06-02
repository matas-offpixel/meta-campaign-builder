import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeRegistrationsData,
  type MailchimpRegistrationsData,
  type SnapshotRow,
} from "./compute-registrations";

export type { MailchimpRegistrationsData };
export { computeRegistrationsData };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any>;

/**
 * Loads Mailchimp registration data for a brand-campaign event.
 *
 * Resolves the effective audience id (event override → client default),
 * queries `mailchimp_audience_snapshots` ordered oldest → newest, and
 * computes the derived metrics via `computeRegistrationsData`.
 *
 * Returns `null` on any DB error so callers can soft-fail.
 */
export async function loadEventRegistrations(
  supabase: AnySupabase,
  eventId: string,
): Promise<MailchimpRegistrationsData | null> {
  try {
    const { data: eventRow, error: eventError } = await supabase
      .from("events")
      .select(
        "mailchimp_audience_id, client:clients ( mailchimp_audience_id )",
      )
      .eq("id", eventId)
      .maybeSingle();

    if (eventError || !eventRow) return null;

    const ev = eventRow as {
      mailchimp_audience_id: string | null;
      client:
        | { mailchimp_audience_id: string | null }
        | { mailchimp_audience_id: string | null }[]
        | null;
    };

    const clientRow = Array.isArray(ev.client) ? ev.client[0] : ev.client;
    const audienceId =
      ev.mailchimp_audience_id ??
      clientRow?.mailchimp_audience_id ??
      null;
    const hasAudience = audienceId != null;

    if (!hasAudience) {
      return computeRegistrationsData([], false);
    }

    const { data: rows, error: snapError } = await supabase
      .from("mailchimp_audience_snapshots")
      .select("email_subscribers, snapshot_at")
      .eq("event_id", eventId)
      .eq("mailchimp_audience_id", audienceId)
      .order("snapshot_at", { ascending: true });

    if (snapError) return null;

    return computeRegistrationsData(
      (rows ?? []) as SnapshotRow[],
      hasAudience,
    );
  } catch {
    return null;
  }
}
