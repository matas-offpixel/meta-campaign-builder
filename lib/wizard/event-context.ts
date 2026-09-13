import "server-only";

import { createClient } from "@/lib/supabase/server";
import { eventCarriersDisagree, resolveDraftEventId } from "@/lib/campaign-event";
import { getEventByIdServer } from "@/lib/db/events-server";
import { getClientByIdServer } from "@/lib/db/clients-server";
import type { EventWithClient } from "@/lib/db/events";
import type { ClientRow } from "@/lib/db/clients";
import { migrateDraft } from "@/lib/autosave";

/**
 * lib/wizard/event-context.ts
 *
 * Server-side resolver: given a draftId, return the event + client that
 * the draft is linked to via `campaign_drafts.event_id` /
 * `campaign_drafts.client_id`. Both can be null and we return both-null
 * gracefully — the wizard renders normally and just doesn't pre-fill.
 *
 * `draft_json.settings.eventId` is the source of truth. The column
 * follows on save (`saveDraftToDb`). Readers prefer JSON and fall back
 * to the column for drafts that predate the picker.
 */

export interface WizardEventContext {
  event: EventWithClient | null;
  client: ClientRow | null;
  jsonEventId: string | null;
  columnEventId: string | null;
  resolvedEventId: string | null;
  carriersDisagree: boolean;
}

export const EMPTY_WIZARD_CONTEXT: WizardEventContext = {
  event: null,
  client: null,
  jsonEventId: null,
  columnEventId: null,
  resolvedEventId: null,
  carriersDisagree: false,
};

/**
 * Look up the event_id + client_id columns on campaign_drafts for the
 * given draftId, then fetch the related rows. Returns both-null when
 * the draft isn't linked yet, when the user doesn't own the draft, or
 * on any read failure (caller should always handle null gracefully).
 */
export async function loadEventContextForDraft(
  draftId: string,
): Promise<WizardEventContext> {
  if (!draftId) return EMPTY_WIZARD_CONTEXT;

  const supabase = await createClient();
  const { data: draftRow, error: draftErr } = await supabase
    .from("campaign_drafts")
    .select("id, event_id, client_id, draft_json")
    .eq("id", draftId)
    .maybeSingle();

  if (draftErr || !draftRow) {
    if (draftErr) {
      console.warn("[loadEventContextForDraft] draft read:", draftErr.message);
    }
    return EMPTY_WIZARD_CONTEXT;
  }

  const columnEventId = (draftRow as { event_id: string | null }).event_id ?? null;
  const explicitClientId =
    (draftRow as { client_id: string | null }).client_id ?? null;
  let jsonEventId: string | null = null;
  try {
    const draft = migrateDraft(
      (draftRow as { draft_json: Record<string, unknown> }).draft_json,
    );
    jsonEventId = draft.settings.eventId?.trim() || null;
  } catch {
    jsonEventId = null;
  }
  const eventId = resolveDraftEventId(jsonEventId, columnEventId);
  const carriersDisagree = eventCarriersDisagree(jsonEventId, columnEventId);

  // Fetch event and the explicitly-linked client in parallel. The
  // event helper joins clients already so we'll prefer that nested row
  // when no explicit client_id is set on the draft.
  const [event, explicitClient] = await Promise.all([
    eventId
      ? getEventByIdServer(eventId).catch((err) => {
          console.warn(
            "[loadEventContextForDraft] event fetch:",
            err instanceof Error ? err.message : String(err),
          );
          return null;
        })
      : Promise.resolve(null),
    explicitClientId
      ? getClientByIdServer(explicitClientId).catch((err) => {
          console.warn(
            "[loadEventContextForDraft] client fetch:",
            err instanceof Error ? err.message : String(err),
          );
          return null;
        })
      : Promise.resolve(null),
  ]);

  // Resolve the client: explicit FK on the draft wins; falls back to
  // the event's client. The event helper only selects a subset of
  // client columns, so when we need the full ClientRow (for default_*
  // fields the wizard pre-fills from) we fetch it again here.
  let client: ClientRow | null = explicitClient;
  if (!client && event?.client?.id) {
    client = await getClientByIdServer(event.client.id).catch((err) => {
      console.warn(
        "[loadEventContextForDraft] event.client fetch:",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    });
  }

  return {
    event,
    client,
    jsonEventId,
    columnEventId,
    resolvedEventId: eventId,
    carriersDisagree,
  };
}
