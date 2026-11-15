import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, it } from "node:test";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import type { AdSetSuggestion, CampaignObjective } from "../../types.ts";

register(new URL("../../__tests__/support/alias-hooks.mjs", import.meta.url));

const { bindLaunchAdSetRecorder } = await import("../launch-recorder.ts");

const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "11111111-1111-4111-8111-111111111111";

const suggestion: AdSetSuggestion = {
  id: "sug-1",
  name: "Prospecting",
  sourceType: "blank",
  sourceId: "",
  sourceName: "Blank",
  ageMin: 18,
  ageMax: 65,
  budgetPerDay: 12,
  advantagePlus: true,
  enabled: true,
};

function fakeSession() {
  const upserts: Record<string, unknown>[] = [];
  const eventSelects: string[] = [];
  const session = {
    from(table: string) {
      if (table === "events") {
        return {
          select(columns: string) {
            eventSelects.push(columns);
            return {
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    client_id: CLIENT_ID,
                    presale_at: "2026-01-01T09:00:00Z",
                    general_sale_at: "2026-02-01T09:00:00Z",
                    sold_out_at: null,
                  },
                  error: null,
                }),
              }),
            };
          },
        };
      }
      return {
        upsert: async (payload: Record<string, unknown>) => {
          upserts.push(payload);
          return { error: null };
        },
      };
    },
  };
  return { session, upserts, eventSelects };
}

async function recordFor(objective: CampaignObjective | undefined) {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { session, upserts, eventSelects } = fakeSession();
  const draft = createDefaultDraft();
  draft.settings.eventId = EVENT_ID;
  draft.settings.objective = objective as CampaignObjective;
  const record = await bindLaunchAdSetRecorder({
    session: session as never,
    draft,
    userId: "44444444-4444-4444-8444-444444444444",
    adAccountId: "act_1",
    launchRunId: RUN_ID,
  });
  await record("camp-1", suggestion, "120399");
  return { row: upserts[0]!, eventSelects };
}

describe("bindLaunchAdSetRecorder phase_at_launch", () => {
  it("a registration draft is presale even when the event's general sale is already past", async () => {
    const { row } = await recordFor("registration");
    assert.equal(row.objective, "registration");
    assert.equal(row.phase_at_launch, "presale");
    assert.equal(row.client_id, CLIENT_ID);
  });

  it("every other objective is on_sale; no objective is null", async () => {
    for (const objective of ["purchase", "initiate_checkout", "traffic", "awareness", "engagement"] as const) {
      assert.equal((await recordFor(objective)).row.phase_at_launch, "on_sale", objective);
    }
    assert.equal((await recordFor(undefined)).row.phase_at_launch, null);
  });

  it("reads only the event's client, not its sale dates", async () => {
    const { eventSelects } = await recordFor("registration");
    assert.deepEqual(eventSelects, ["client_id"]);
  });
});
