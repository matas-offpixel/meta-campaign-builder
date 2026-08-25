import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  assembleEventLandingPageRecord,
  type EventLandingPageRecord,
} from "@/lib/landing-pages/event-lookup";
import {
  assessWizardLandingPage,
  type WizardLpAssessment,
} from "@/lib/landing-pages/wizard-renderability";
import type { LandingPageProvider, PageEventStatus } from "@/lib/landing-pages/types";

/**
 * lib/db/event-landing-page.ts
 *
 * Wizard-facing event ↔ LP lookup (by events.id). Read-only: the launch
 * wizards consume destination URLs; they do not create pages. Public /l
 * resolution stays slug-chain (`getLandingPageContext`). Ownership is RLS
 * on the cookie-bound client.
 *
 * Page create/publish lives in the LP product
 * (`createPageForExistingEvent` in lib/actions/update-page-event.ts).
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
