import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeRegistrationsData,
  type MailchimpRegistrationsData,
  type MailchimpSnapshotRow,
} from "./compute-registrations";

export type { MailchimpRegistrationsData };
export { computeRegistrationsData };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any>;

/**
 * Loads Mailchimp registration data for an event.
 *
 * Priority:
 *   1. If `events.mailchimp_tag` is non-null, prefer rows from
 *      `mailchimp_tag_snapshots` (tag-scoped count for shared-audience events).
 *   2. Otherwise, fall back to `mailchimp_audience_snapshots` — the whole-
 *      audience count used by brand_campaign always-on events.
 *
 * Resolves the effective audience id (event override → client default),
 * queries the appropriate table ordered oldest → newest, and computes the
 * derived metrics via `computeRegistrationsData`.
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
        "mailchimp_audience_id, mailchimp_tag, client:clients ( mailchimp_audience_id, mailchimp_account_id )",
      )
      .eq("id", eventId)
      .maybeSingle();

    if (eventError || !eventRow) return null;

    const ev = eventRow as {
      mailchimp_audience_id: string | null;
      mailchimp_tag: string | null;
      client:
        | { mailchimp_audience_id: string | null; mailchimp_account_id: string | null }
        | { mailchimp_audience_id: string | null; mailchimp_account_id: string | null }[]
        | null;
    };

    const clientRow = Array.isArray(ev.client) ? ev.client[0] : ev.client;
    const audienceId =
      ev.mailchimp_audience_id ??
      clientRow?.mailchimp_audience_id ??
      null;
    const mailchimpTag = ev.mailchimp_tag ?? null;
    const hasAudience = audienceId != null || mailchimpTag != null;
    const mailchimpAccountConnected = !!(clientRow?.mailchimp_account_id);

    if (!hasAudience) {
      return computeRegistrationsData([], false, mailchimpAccountConnected);
    }

    // Path 1: tag-scoped snapshots (per-event with shared audience).
    if (mailchimpTag) {
      const { data: tagRows, error: tagError } = await supabase
        .from("mailchimp_tag_snapshots")
        .select("email_subscribers, snapshot_at")
        .eq("event_id", eventId)
        .order("snapshot_at", { ascending: true });

      if (!tagError && tagRows && tagRows.length > 0) {
        return computeRegistrationsData(
          tagRows as MailchimpSnapshotRow[],
          true,
          mailchimpAccountConnected,
        );
      }
      // If no tag snapshots yet, fall through to audience path (or empty state).
    }

    // Path 2: whole-audience snapshots (brand_campaign always-on).
    if (!audienceId) {
      return computeRegistrationsData([], hasAudience, mailchimpAccountConnected);
    }

    const { data: rows, error: snapError } = await supabase
      .from("mailchimp_audience_snapshots")
      .select("email_subscribers, snapshot_at")
      .eq("event_id", eventId)
      .eq("mailchimp_audience_id", audienceId)
      .order("snapshot_at", { ascending: true });

    if (snapError) return null;

    return computeRegistrationsData(
      (rows ?? []) as MailchimpSnapshotRow[],
      hasAudience,
      mailchimpAccountConnected,
    );
  } catch {
    return null;
  }
}
