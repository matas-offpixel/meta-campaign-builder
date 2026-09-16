import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { upsertTikTokDraft } from "../../db/tiktok-drafts.ts";
import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import {
  TIKTOK_IMPORT_EVENT_ID_CLIENT_MISMATCH,
  type TikTokImportEventRow,
} from "../../tiktok/import/event.ts";
import { handleTikTokDraftPatch } from "../patch-draft.ts";

const CLIENT_ID = "client-ironworks";
const OTHER_CLIENT_ID = "client-other";
const EVENT: TikTokImportEventRow = {
  id: "2d5a5485-bfec-4812-9fcc-2f6f89262f6c",
  name: "Jamie Jones",
  event_code: "IRW0001",
  event_date: "2026-10-03",
  client_id: CLIENT_ID,
};

const unusedSupabase = {} as Parameters<typeof handleTikTokDraftPatch>[0]["supabase"];

function recordingUpsert() {
  const upserts: unknown[] = [];
  const supabase = {
    from() {
      return {
        upsert(payload: unknown) {
          upserts.push(payload);
          return Promise.resolve({ error: null });
        },
      };
    },
  } as Parameters<typeof upsertTikTokDraft>[0];
  return { supabase, upserts };
}

function storedDraft() {
  const draft = createDefaultTikTokDraft("7f93de68-be46-4cc7-bfe4-b239f59a80fb");
  draft.clientId = CLIENT_ID;
  draft.eventId = null;
  draft.campaignSetup.campaignName = "[IRW0001] Jamie Jones -signup 13 — relaunch";
  return draft;
}

describe("PATCH /api/tiktok/drafts/[id] event attach", () => {
  it("with no eventId leaves the draft's event untouched", async () => {
    const current = storedDraft();
    current.eventId = "already-set";
    current.campaignSetup.eventCode = "KEEP";
    const { supabase, upserts } = recordingUpsert();
    const result = await handleTikTokDraftPatch({
      userId: "user-1",
      draftId: current.id,
      body: { campaignSetup: { ...current.campaignSetup, campaignName: "renamed" } },
      supabase,
      deps: {
        getDraft: async () => current,
        loadEvent: async () => {
          throw new Error("should not load event");
        },
        upsertDraft: upsertTikTokDraft,
      },
    });
    assert.equal(result.status, 200);
    const draft = result.body.draft as { eventId?: string };
    assert.equal(draft.eventId, "already-set");
    assert.equal(upserts.length, 1);
    const payload = upserts[0] as { event_id?: string; state?: { eventId?: string } };
    assert.equal(payload.event_id, "already-set");
    assert.equal(payload.state?.eventId, "already-set");
  });

  it("with another client's event returns 400 and writes nothing", async () => {
    let upserted = false;
    const result = await handleTikTokDraftPatch({
      userId: "user-1",
      draftId: "draft-1",
      body: { eventId: EVENT.id },
      supabase: unusedSupabase,
      deps: {
        getDraft: async () => storedDraft(),
        loadEvent: async () => ({ ...EVENT, client_id: OTHER_CLIENT_ID }),
        upsertDraft: async () => {
          upserted = true;
          throw new Error("should not upsert");
        },
      },
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, TIKTOK_IMPORT_EVENT_ID_CLIENT_MISMATCH);
    assert.equal(upserted, false);
  });

  it("with a valid event writes state.eventId and event_id", async () => {
    const current = storedDraft();
    const { supabase, upserts } = recordingUpsert();
    const result = await handleTikTokDraftPatch({
      userId: "user-1",
      draftId: current.id,
      body: { eventId: EVENT.id },
      supabase,
      deps: {
        getDraft: async () => current,
        loadEvent: async () => EVENT,
        upsertDraft: upsertTikTokDraft,
      },
    });
    assert.equal(result.status, 200);
    const draft = result.body.draft as {
      eventId?: string;
      campaignSetup?: { eventCode?: string | null };
    };
    assert.equal(draft.eventId, EVENT.id);
    assert.equal(draft.campaignSetup?.eventCode, "IRW0001");
    assert.equal(upserts.length, 1);
    const payload = upserts[0] as {
      event_id?: string;
      state?: { eventId?: string };
    };
    assert.equal(payload.event_id, EVENT.id);
    assert.equal(payload.state?.eventId, EVENT.id);
  });

  it("rejects a body that changes clientId and eventId together", async () => {
    let upserted = false;
    const result = await handleTikTokDraftPatch({
      userId: "user-1",
      draftId: "draft-1",
      body: { eventId: EVENT.id, clientId: OTHER_CLIENT_ID },
      supabase: unusedSupabase,
      deps: {
        getDraft: async () => storedDraft(),
        loadEvent: async () => {
          throw new Error("should not load event against the incoming client");
        },
        upsertDraft: async () => {
          upserted = true;
          throw new Error("should not upsert");
        },
      },
    });
    assert.equal(result.status, 400);
    assert.match(String(result.body.error), /stored client/);
    assert.equal(upserted, false);
  });
});
