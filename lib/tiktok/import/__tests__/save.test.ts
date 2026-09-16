import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { upsertTikTokDraft } from "../../../db/tiktok-drafts.ts";
import { collectTikTokLaunchPreflight } from "../../write/preflight.ts";
import { bundleFromRawCapture } from "../capture.ts";
import {
  TIKTOK_IMPORT_EVENT_ID_CLIENT_MISMATCH,
  TIKTOK_IMPORT_EVENT_ID_REQUIRED,
  type TikTokImportEventRow,
} from "../event.ts";
import { buildTikTokImportPicker } from "../map.ts";
import { defaultCarryKeys } from "../picker.ts";
import { handleTikTokImport } from "../save.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANUAL_PATH = join(
  HERE,
  "../__fixtures__/captured/tiktok-import-capture-1874142286754113.json",
);

const CLIENT_ID = "client-ironworks";
const OTHER_CLIENT_ID = "client-other";
const EVENT: TikTokImportEventRow = {
  id: "2d5a5485-bfec-4812-9fcc-2f6f89262f6c",
  name: "Jamie Jones",
  event_code: "IRW0001",
  event_date: "2026-10-03",
  client_id: CLIENT_ID,
};

const unusedSupabase = {} as Parameters<typeof handleTikTokImport>[0]["supabase"];

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

function loadManualBundle() {
  return bundleFromRawCapture(JSON.parse(readFileSync(MANUAL_PATH, "utf8")));
}

describe("POST /api/tiktok/campaigns/import event_id", () => {
  it("returns 401 without a session and writes no row", async () => {
    let upserted = false;
    const result = await handleTikTokImport({
      userId: null,
      body: {
        advertiserId: "1",
        campaignId: "2",
        carry: ["v1"],
      },
      supabase: unusedSupabase,
      deps: {
        upsertDraft: async () => {
          upserted = true;
          throw new Error("should not upsert");
        },
      },
    });
    assert.equal(result.status, 401);
    assert.equal(upserted, false);
  });

  it("returns 400 naming event_id on carry without eventId and writes no row", async () => {
    let upserted = false;
    let read = false;
    const result = await handleTikTokImport({
      userId: "user-1",
      body: {
        advertiserId: "7639802149165301776",
        campaignId: "1874142286754113",
        carry: ["v1"],
      },
      supabase: unusedSupabase,
      deps: {
        readCampaign: async () => {
          read = true;
          throw new Error("should not read");
        },
        upsertDraft: async () => {
          upserted = true;
          throw new Error("should not upsert");
        },
      },
    });
    assert.equal(result.status, 400);
    assert.match(String(result.body.error), /event_id/);
    assert.equal(result.body.error, TIKTOK_IMPORT_EVENT_ID_REQUIRED);
    assert.equal(upserted, false);
    assert.equal(read, false);
  });

  it("returns 400 and writes no row when eventId belongs to another client", async () => {
    let upserted = false;
    let read = false;
    const result = await handleTikTokImport({
      userId: "user-1",
      body: {
        advertiserId: "7639802149165301776",
        campaignId: "1874142286754113",
        carry: ["v1"],
        eventId: EVENT.id,
      },
      supabase: unusedSupabase,
      deps: {
        credentialsForAdvertiser: async () => ({
          accountId: "acct-1",
          token: "token",
        }),
        clientIdForAccount: async () => CLIENT_ID,
        loadEvent: async () => ({ ...EVENT, client_id: OTHER_CLIENT_ID }),
        readCampaign: async () => {
          read = true;
          throw new Error("should not read");
        },
        upsertDraft: async () => {
          upserted = true;
          throw new Error("should not upsert");
        },
      },
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, TIKTOK_IMPORT_EVENT_ID_CLIENT_MISMATCH);
    assert.match(String(result.body.error), /event_id/);
    assert.equal(upserted, false);
    assert.equal(read, false);
  });

  it("saves eventId in state and event_id on the row; preflight has no event issue", async () => {
    const bundle = loadManualBundle();
    const keys = defaultCarryKeys(buildTikTokImportPicker(bundle));
    const { supabase, upserts } = recordingUpsert();
    const result = await handleTikTokImport({
      userId: "user-1",
      body: {
        advertiserId: "7639802149165301776",
        campaignId: "1874142286754113",
        carry: keys,
        eventId: EVENT.id,
      },
      supabase,
      deps: {
        credentialsForAdvertiser: async () => ({
          accountId: "acct-1",
          token: "token",
        }),
        clientIdForAccount: async () => CLIENT_ID,
        loadEvent: async () => EVENT,
        readCampaign: async () => bundle,
        fetchAdvertiser: async () => ({
          currency: "GBP",
          timezone: "Europe/London",
          displayTimezone: null,
        }),
        listDrafts: async () => [],
        upsertDraft: upsertTikTokDraft,
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.saved, true);
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
    const preflight = collectTikTokLaunchPreflight(
      result.body.draft as Parameters<typeof collectTikTokLaunchPreflight>[0],
      { now: new Date("2026-09-16T16:00:00.000Z") },
    );
    assert.equal(
      preflight.issues.some((issue) => issue.id === "event"),
      false,
    );
  });

  it("picker suggests the unique [IRW0001] event and does not require eventId", async () => {
    const bundle = loadManualBundle();
    const result = await handleTikTokImport({
      userId: "user-1",
      body: {
        advertiserId: "7639802149165301776",
        campaignId: "1874142286754113",
      },
      supabase: unusedSupabase,
      deps: {
        credentialsForAdvertiser: async () => ({
          accountId: "acct-1",
          token: "token",
        }),
        clientIdForAccount: async () => CLIENT_ID,
        listEvents: async () => [EVENT],
        readCampaign: async () => bundle,
        fetchAdvertiser: async () => ({
          currency: "GBP",
          timezone: "Europe/London",
          displayTimezone: null,
        }),
        hydrateThumbnails: async ({ rows }) => rows,
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.saved, false);
    assert.equal(result.body.suggestedEventId, EVENT.id);
    assert.equal(
      result.body.suggestedEventLabel,
      "matched [IRW0001] in the campaign name — change if wrong",
    );
  });
});
