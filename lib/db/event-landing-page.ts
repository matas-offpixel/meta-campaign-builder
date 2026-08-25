import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  assembleEventLandingPageRecord,
  type EventLandingPageRecord,
} from "@/lib/landing-pages/event-lookup";
import {
  assessWizardLandingPage,
  MINIMAL_CLIENT_LANDING_PAGE,
  planRenderableEnsure,
  type WizardLpAssessment,
} from "@/lib/landing-pages/wizard-renderability";
import type { LandingPageProvider, PageEventStatus } from "@/lib/landing-pages/types";

/**
 * lib/db/event-landing-page.ts
 *
 * Wizard-facing event ↔ LP lookup / ensure (by events.id). Public /l
 * resolution stays slug-chain (`getLandingPageContext`). Ownership is RLS
 * on the cookie-bound client — operators only see their own events.
 *
 * Ensure writes a page the public renderer will serve: client_landing_pages
 * with theme defaults (no pixel/CAPI), page_events status "live". The
 * admin editor's create-as-draft path is unchanged.
 */

function firstEmbed<T extends Record<string, unknown>>(
  value: unknown,
): T | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object"
      ? (first as T)
      : null;
  }
  if (typeof value === "object") return value as T;
  return null;
}

function asStatus(value: unknown): PageEventStatus | null {
  return value === "draft" || value === "live" || value === "archived"
    ? value
    : null;
}

function asProvider(value: unknown): LandingPageProvider | null {
  return value === "internal" || value === "evntree" ? value : null;
}

function recordFromEventRow(row: {
  id: string;
  slug: string | null;
  client_id?: string | null;
  clients: unknown;
  page_events: unknown;
}): EventLandingPageRecord | null {
  const client = firstEmbed<{
    id?: string | null;
    slug?: string | null;
    client_landing_pages?: unknown;
  }>(row.clients);
  const page = firstEmbed<{
    id?: string | null;
    status?: unknown;
    provider?: unknown;
  }>(row.page_events);
  const clp = firstEmbed<{ id?: string | null }>(client?.client_landing_pages);
  return assembleEventLandingPageRecord({
    eventId: row.id,
    eventSlug: row.slug,
    clientId: row.client_id ?? client?.id ?? null,
    clientSlug: client?.slug ?? null,
    pageEventId: page?.id ?? null,
    pageStatus: asStatus(page?.status),
    hasClientConfig: clp?.id != null,
    provider: asProvider(page?.provider),
    customHost: null,
  });
}

const EVENT_SELECT =
  "id, slug, client_id, clients ( id, slug, client_landing_pages ( id ) ), page_events ( id, status, provider )";

export function assessRecord(
  record: EventLandingPageRecord | null,
): WizardLpAssessment {
  if (!record) return { state: "none", offerUrl: false };
  return assessWizardLandingPage({
    hasPage: record.hasPage,
    pageStatus: record.pageStatus,
    hasClientConfig: record.hasClientConfig,
    provider: record.provider,
    clientSlug: record.clientSlug,
    eventSlug: record.eventSlug,
  });
}

export async function lookupEventLandingPage(
  eventId: string,
): Promise<EventLandingPageRecord | null> {
  if (!eventId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .eq("id", eventId)
    .maybeSingle();
  if (error) {
    throw new Error(`[event-landing-page] lookup failed: ${error.message}`);
  }
  if (!data) return null;
  return recordFromEventRow(
    data as {
      id: string;
      slug: string | null;
      client_id?: string | null;
      clients: unknown;
      page_events: unknown;
    },
  );
}

/**
 * Make the event's landing page publicly serveable, or say why not.
 * Creates missing client_landing_pages (theme defaults, no pixel/CAPI)
 * and a live internal page_events row. Publishes an existing internal
 * draft. Never unarchives. Never flips evntree → internal.
 */
export async function ensureRenderablePageForOwnedEvent(
  eventId: string,
): Promise<
  | { record: EventLandingPageRecord; renderability: WizardLpAssessment }
  | { error: string }
> {
  const existing = await lookupEventLandingPage(eventId);
  if (!existing) return { error: "Event not found." };

  const plan = planRenderableEnsure({
    hasClientConfig: existing.hasClientConfig,
    page:
      existing.hasPage && existing.pageStatus && existing.provider
        ? { status: existing.pageStatus, provider: existing.provider }
        : null,
  });

  const supabase = await createClient();

  if (plan.createClientConfig) {
    const clientId = existing.clientId;
    if (!clientId) return { error: "Event has no client — cannot create landing-page config." };
    const { error: clpError } = await supabase.from("client_landing_pages").insert({
      client_id: clientId,
      theme: MINIMAL_CLIENT_LANDING_PAGE.theme,
      default_provider: MINIMAL_CLIENT_LANDING_PAGE.default_provider,
    });
    if (clpError) {
      const raced = await lookupEventLandingPage(eventId);
      if (!raced?.hasClientConfig) {
        return { error: `Create client config failed: ${clpError.message}` };
      }
    }
  }

  if (plan.createPage) {
    const { error: insertError } = await supabase
      .from("page_events")
      .insert({
        event_id: eventId,
        provider: "internal",
        status: "live",
        content: { template_key: "mvp_v1" },
      })
      .select("id")
      .single();
    if (insertError) {
      const raced = await lookupEventLandingPage(eventId);
      if (!raced?.hasPage) {
        return { error: `Create failed: ${insertError.message}` };
      }
    }
  } else if (plan.publishPage) {
    const { error: publishError } = await supabase
      .from("page_events")
      .update({ status: "live" })
      .eq("event_id", eventId)
      .eq("status", "draft")
      .eq("provider", "internal");
    if (publishError) {
      return { error: `Publish failed: ${publishError.message}` };
    }
  }

  const created = await lookupEventLandingPage(eventId);
  if (!created) return { error: "Ensure succeeded but lookup returned nothing." };
  const renderability = assessRecord(created);
  if (!renderability.offerUrl) {
    if (created.provider === "evntree") {
      return {
        error:
          "This event already uses an Evntr.ee page. Flip it to the internal renderer in the page editor before using it as a destination.",
      };
    }
    if (created.pageStatus === "archived") {
      return {
        error:
          "This event page is archived. Restore it in the page editor before using it as a destination.",
      };
    }
    return {
      error:
        "The event page is not publicly serveable yet. Publish it before using the URL.",
    };
  }
  return { record: created, renderability };
}
