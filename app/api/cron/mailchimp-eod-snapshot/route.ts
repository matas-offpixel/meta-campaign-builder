import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { getMailchimpCredentials } from "@/lib/mailchimp/credentials";
import { getAudienceSegments } from "@/lib/mailchimp/client";
import { daySnapshotAt, isCronAuthorized, todayUtc } from "@/lib/mailchimp/tag-tracking";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Drift tolerance — webhook-maintained counts within this of the API truth
 * are considered fine and left untouched. */
const DRIFT_TOLERANCE = 5;

/**
 * GET /api/cron/mailchimp-eod-snapshot
 *
 * Daily 23:55 UTC backstop. For each tagged event, fetches the segment's
 * authoritative member_count (one cheap API call) and reconciles it against the
 * webhook-maintained per-day snapshot. If today's snapshot is missing or drifts
 * by more than DRIFT_TOLERANCE members, writes the true count at the
 * deterministic per-day timestamp. Otherwise leaves the webhook value in place.
 *
 * This guarantees correct end-of-day data even if webhooks were missed.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;

  const { data: events, error: eventsErr } = await sb
    .from("events")
    .select(
      "id, user_id, client_id, event_code, mailchimp_audience_id, mailchimp_tag, client:clients ( mailchimp_account_id )",
    )
    .not("mailchimp_tag", "is", null)
    .not("mailchimp_audience_id", "is", null);

  if (eventsErr) {
    return NextResponse.json({ ok: false, error: eventsErr.message }, { status: 500 });
  }

  const day = todayUtc();
  const dayStart = `${day}T00:00:00Z`;
  const dayEnd = `${day}T23:59:59.999Z`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any[] = [];

  // Per-run segment cache: many events share one Ironworks audience, so fetch
  // each audience's static segments at most once per cron run. Keyed by
  // `${dc}:${audienceId}`; stores the resolved segments array.
  type Segment = { id: number; name: string; member_count: number };
  const segmentCache = new Map<string, Promise<Segment[]>>();
  function getSegmentsCached(dc: string, audienceId: string, apiKey: string): Promise<Segment[]> {
    const key = `${dc}:${audienceId}`;
    let cached = segmentCache.get(key);
    if (!cached) {
      cached = getAudienceSegments(dc, audienceId, apiKey, { type: "static", count: 1000 }).then(
        (resp) => (resp.segments ?? []) as Segment[],
      );
      segmentCache.set(key, cached);
    }
    return cached;
  }

  for (const event of (events ?? [])) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ev = event as any;
    try {
      const clientRow = Array.isArray(ev.client) ? ev.client[0] : ev.client;
      const accountId = clientRow?.mailchimp_account_id ?? null;
      if (!accountId) {
        results.push({ eventId: ev.id, action: "skip", reason: "no_account" });
        continue;
      }

      const creds = await getMailchimpCredentials(supabase, accountId);
      if (!creds) {
        results.push({ eventId: ev.id, action: "skip", reason: "no_credentials" });
        continue;
      }

      const segments = await getSegmentsCached(creds.dc, ev.mailchimp_audience_id, creds.apiKey);
      const segment = segments.find((s) => s.name === ev.mailchimp_tag);
      if (!segment) {
        results.push({ eventId: ev.id, action: "skip", reason: "segment_not_found" });
        continue;
      }

      const apiCount = segment.member_count ?? 0;

      const { data: todaySnap } = await sb
        .from("mailchimp_tag_snapshots")
        .select("email_subscribers")
        .eq("event_id", ev.id)
        .gte("snapshot_at", dayStart)
        .lte("snapshot_at", dayEnd)
        .order("snapshot_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const ourCount = (todaySnap?.email_subscribers as number | undefined) ?? null;
      const drift = ourCount == null ? null : Math.abs(apiCount - ourCount);

      if (ourCount == null || (drift != null && drift > DRIFT_TOLERANCE)) {
        const { error: upsertErr } = await sb.from("mailchimp_tag_snapshots").upsert(
          {
            user_id: ev.user_id,
            event_id: ev.id,
            client_id: ev.client_id,
            mailchimp_audience_id: ev.mailchimp_audience_id,
            mailchimp_tag: ev.mailchimp_tag,
            total_contacts: apiCount,
            email_subscribers: apiCount,
            snapshot_at: daySnapshotAt(day),
            raw_json: {
              source: "mailchimp_eod_cron",
              method: "segment_member_count_eod",
              api_count: apiCount,
              our_count_before: ourCount,
              drift,
            },
          },
          { onConflict: "event_id,snapshot_at" },
        );
        if (upsertErr) {
          results.push({ eventId: ev.id, action: "error", error: upsertErr.message });
        } else {
          results.push({ eventId: ev.id, eventCode: ev.event_code, apiCount, drift, action: "corrected" });
        }
      } else {
        results.push({ eventId: ev.id, eventCode: ev.event_code, apiCount, drift, action: "ok" });
      }
    } catch (err) {
      results.push({
        eventId: ev.id,
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(
    `[mailchimp-eod-snapshot] processed=${results.length} corrected=${results.filter((r) => r.action === "corrected").length}`,
  );

  return NextResponse.json({ ok: true, eventsProcessed: results.length, results });
}
