import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventWithClient } from "./events";
import type {
  D2CChannel,
  D2CEventCopy,
  D2CEventCopyBundle,
  D2CScheduledSend,
} from "@/lib/d2c/types";
import { getD2CEventCopy, listScheduledSendsForEvent } from "./d2c";

/**
 * lib/db/d2c-dashboard.ts
 *
 * Service-role read layer for the D2C event dashboard (operator page + public
 * share). The events table is RLS-scoped `auth.uid() = user_id`, but the
 * orchestration dashboard is a cross-operator surface: the Throwback event is
 * owned by the operator who ran the brief ingest (matt@) while the approver
 * (matas@) — and the public share viewer — must both see it. So the reads run
 * under the service-role client here and authorisation is enforced by the
 * CALLER (owner-or-approver on the operator page; token match on the share
 * page). This is the root-cause fix for the /d2c/event/[id] 404: the previous
 * `getEventByIdServer` ran under the viewer's RLS session and returned null for
 * any non-owner.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

const EVENT_SELECT =
  "*, client:clients ( id, name, slug, primary_type, meta_business_id, meta_ad_account_id, meta_pixel_id, tiktok_account_id, google_ads_account_id )";

/** Preview-oriented template shape: keeps the raw `variables_jsonb` object
 *  (button_label / button_url) that `mapD2CTemplate` collapses to a string[]. */
export interface D2CPreviewTemplate {
  id: string;
  channel: D2CChannel;
  subject: string | null;
  body_markdown: string;
  button_label: string | null;
  button_url: string | null;
}

export interface D2CEventDashboardData {
  event: EventWithClient;
  copy: D2CEventCopy | null;
  sends: D2CScheduledSend[];
  /** template_id → preview template. */
  templates: Record<string, D2CPreviewTemplate>;
  copyBundle: D2CEventCopyBundle;
}

function mapPreviewTemplate(raw: Record<string, unknown>): D2CPreviewTemplate {
  const vars =
    raw.variables_jsonb && typeof raw.variables_jsonb === "object" && !Array.isArray(raw.variables_jsonb)
      ? (raw.variables_jsonb as Record<string, unknown>)
      : {};
  const btnLabel = typeof vars.button_label === "string" ? vars.button_label : null;
  const btnUrl = typeof vars.button_url === "string" ? vars.button_url : null;
  return {
    id: raw.id as string,
    channel: raw.channel as D2CChannel,
    subject: (raw.subject as string | null) ?? null,
    body_markdown: (raw.body_markdown as string | null) ?? "",
    button_label: btnLabel,
    button_url: btnUrl,
  };
}

/**
 * Load the full dashboard payload for an event via the service-role client.
 * Returns null only when the event row itself is missing (→ 404 upstream).
 */
export async function loadD2CEventDashboard(
  admin: AnySupabaseClient,
  eventId: string,
): Promise<D2CEventDashboardData | null> {
  const { data: eventRow, error } = await admin
    .from("events")
    .select(EVENT_SELECT)
    .eq("id", eventId)
    .maybeSingle();
  if (error) {
    console.warn("[d2c-dashboard] event lookup failed:", error.message);
    return null;
  }
  if (!eventRow) return null;
  const event = eventRow as unknown as EventWithClient;

  const [copy, sends] = await Promise.all([
    getD2CEventCopy(admin, eventId),
    listScheduledSendsForEvent(admin, eventId),
  ]);

  const templateIds = [...new Set(sends.map((s) => s.template_id).filter(Boolean))];
  const templates: Record<string, D2CPreviewTemplate> = {};
  if (templateIds.length > 0) {
    const { data: tplRows, error: tplErr } = await admin
      .from("d2c_templates")
      .select("id, channel, subject, body_markdown, variables_jsonb")
      .in("id", templateIds);
    if (tplErr) {
      console.warn("[d2c-dashboard] template lookup failed:", tplErr.message);
    } else {
      for (const raw of (tplRows ?? []) as Array<Record<string, unknown>>) {
        const tpl = mapPreviewTemplate(raw);
        templates[tpl.id] = tpl;
      }
    }
  }

  return {
    event,
    copy,
    sends,
    templates,
    copyBundle: copy?.copy_jsonb ?? {},
  };
}
