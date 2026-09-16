/**
 * PATCH /api/tiktok/drafts/[id] extracted so event attach can be
 * driven without mocking `createClient`. Ownership is checked
 * against the *stored* draft's clientId — a body that also changes
 * clientId is rejected rather than validated against the incoming one.
 */

import {
  getTikTokDraft,
  upsertTikTokDraft,
} from "../db/tiktok-drafts.ts";
import {
  TIKTOK_IMPORT_EVENT_ID_CLIENT_MISMATCH,
  attachTikTokImportEvent,
  eventBelongsToClient,
  loadTikTokImportEvent,
  parseTikTokImportEventId,
  type TikTokImportEventRow,
} from "../tiktok/import/event.ts";
import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";

type DraftSupabase = Parameters<typeof getTikTokDraft>[0];

export type TikTokDraftPatchResult = {
  status: number;
  body: Record<string, unknown>;
};

export const TIKTOK_DRAFT_EVENT_CLIENT_PAIR =
  "event_id is checked against the stored client; do not change clientId in the same request";

export type TikTokDraftPatchDeps = {
  getDraft?: typeof getTikTokDraft;
  loadEvent?: (
    supabase: DraftSupabase,
    args: { eventId: string; userId: string },
  ) => Promise<TikTokImportEventRow | null>;
  upsertDraft?: typeof upsertTikTokDraft;
};

export async function handleTikTokDraftPatch(input: {
  userId: string | null;
  draftId: string;
  body: Partial<TikTokCampaignDraft> | null;
  supabase: DraftSupabase;
  deps?: TikTokDraftPatchDeps;
}): Promise<TikTokDraftPatchResult> {
  if (!input.userId) {
    return { status: 401, body: { ok: false, error: "Not signed in" } };
  }
  if (!input.body || typeof input.body !== "object") {
    return { status: 400, body: { ok: false, error: "Invalid draft payload" } };
  }

  const deps = input.deps ?? {};
  const getDraft = deps.getDraft ?? getTikTokDraft;
  const loadEvent = deps.loadEvent ?? loadTikTokImportEvent;
  const upsertDraft = deps.upsertDraft ?? upsertTikTokDraft;

  const current = await getDraft(input.supabase, input.draftId);
  if (!current) {
    return { status: 404, body: { ok: false, error: "Draft not found" } };
  }

  const requestedEventId = parseTikTokImportEventId({
    eventId: input.body.eventId,
  });
  if (requestedEventId) {
    if (
      Object.prototype.hasOwnProperty.call(input.body, "clientId") &&
      input.body.clientId !== current.clientId
    ) {
      return {
        status: 400,
        body: { ok: false, error: TIKTOK_DRAFT_EVENT_CLIENT_PAIR },
      };
    }
    const event = await loadEvent(input.supabase, {
      eventId: requestedEventId,
      userId: input.userId,
    });
    if (!eventBelongsToClient(event, current.clientId)) {
      return {
        status: 400,
        body: { ok: false, error: TIKTOK_IMPORT_EVENT_ID_CLIENT_MISMATCH },
      };
    }
    const nextDraft = attachTikTokImportEvent(
      mergeTikTokDraft(current, input.body),
      event,
    );
    const saved = await upsertDraft(input.supabase, input.draftId, {
      ...nextDraft,
      userId: input.userId,
    });
    return { status: 200, body: { ok: true, draft: saved } };
  }

  const nextDraft = mergeTikTokDraft(current, input.body);
  const saved = await upsertDraft(input.supabase, input.draftId, {
    ...nextDraft,
    userId: input.userId,
  });
  return { status: 200, body: { ok: true, draft: saved } };
}

export function mergeTikTokDraft(
  current: TikTokCampaignDraft,
  patch: Partial<TikTokCampaignDraft>,
): TikTokCampaignDraft {
  return {
    ...current,
    ...patch,
    accountSetup: {
      ...current.accountSetup,
      ...(patch.accountSetup ?? {}),
    },
    campaignSetup: {
      ...current.campaignSetup,
      ...(patch.campaignSetup ?? {}),
    },
    optimisation: {
      ...current.optimisation,
      ...(patch.optimisation ?? {}),
    },
    audiences: {
      ...current.audiences,
      ...(patch.audiences ?? {}),
    },
    creatives: {
      ...current.creatives,
      ...(patch.creatives ?? {}),
    },
    budgetSchedule: {
      ...current.budgetSchedule,
      ...(patch.budgetSchedule ?? {}),
    },
    creativeAssignments: {
      ...current.creativeAssignments,
      ...(patch.creativeAssignments ?? {}),
    },
  };
}
