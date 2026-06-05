/**
 * Tests for bulk-attach-drafts route logic.
 *
 * Because the routes require Next.js server primitives (NextRequest,
 * createClient), we test the pure serialisation / deserialisation helpers
 * and the state-validation logic that underpins the draft feature.
 *
 * Integration-level tests (actual Supabase DB calls, RLS isolation) are
 * covered by manual QA per the prerequisites listed in the PR description.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  serialiseDraftState,
  deserialiseDraftState,
  hasMeaningfulState,
  defaultDraftName,
  DRAFT_STATE_VERSION,
} from "../../../../lib/bulk-attach/draft-state.ts";
import type { LiveBulkAttachState } from "../../../../lib/bulk-attach/draft-state.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function emptyState(): LiveBulkAttachState {
  return {
    adAccountId: "act_123456",
    step: 0,
    selectedCampaigns: new Map(),
    campaignAdSets: new Map(),
    creatives: [],
  };
}

function stateWithCampaigns(): LiveBulkAttachState {
  return {
    adAccountId: "act_789",
    step: 1,
    selectedCampaigns: new Map([
      ["cam_1", { id: "cam_1", name: "Summer Sale", status: "ACTIVE", effectiveStatus: "ACTIVE", objective: "OUTCOME_SALES", compatible: true }],
      ["cam_2", { id: "cam_2", name: "Awareness", status: "PAUSED", effectiveStatus: "PAUSED", objective: "OUTCOME_AWARENESS", compatible: true }],
    ]),
    campaignAdSets: new Map([
      ["cam_1", new Set(["as_1", "as_2"])],
      ["cam_2", new Set(["as_3"])],
    ]),
    creatives: [],
  };
}

// ─── Round-trip: serialise → deserialise ──────────────────────────────────────

describe("serialiseDraftState → deserialiseDraftState round-trip", () => {
  it("preserves adAccountId and step", () => {
    const state = emptyState();
    const json = serialiseDraftState(state);
    const restored = deserialiseDraftState(json);
    assert.ok(restored, "should deserialise without error");
    assert.equal(restored.adAccountId, "act_123456");
    assert.equal(restored.step, 0);
  });

  it("preserves selectedCampaigns Map entries", () => {
    const state = stateWithCampaigns();
    const json = serialiseDraftState(state);
    const restored = deserialiseDraftState(json);
    assert.ok(restored);
    assert.equal(restored.selectedCampaigns.size, 2);
    assert.ok(restored.selectedCampaigns.has("cam_1"));
    assert.equal(restored.selectedCampaigns.get("cam_1")?.name, "Summer Sale");
  });

  it("preserves campaignAdSets Map<string, Set<string>>", () => {
    const state = stateWithCampaigns();
    const json = serialiseDraftState(state);
    const restored = deserialiseDraftState(json);
    assert.ok(restored);
    assert.ok(restored.campaignAdSets.get("cam_1") instanceof Set);
    assert.ok(restored.campaignAdSets.get("cam_1")!.has("as_1"));
    assert.ok(restored.campaignAdSets.get("cam_1")!.has("as_2"));
    assert.equal(restored.campaignAdSets.get("cam_2")!.size, 1);
  });

  it("serialises step 0–3 correctly", () => {
    for (const s of [0, 1, 2, 3] as const) {
      const state = { ...emptyState(), step: s };
      const restored = deserialiseDraftState(serialiseDraftState(state));
      assert.equal(restored?.step, s, `step ${s} not preserved`);
    }
  });

  it("round-trips through JSON.stringify/parse (simulates localStorage)", () => {
    const state = stateWithCampaigns();
    const json = serialiseDraftState(state);
    const jsonString = JSON.stringify(json);
    const parsed = JSON.parse(jsonString);
    const restored = deserialiseDraftState(parsed);
    assert.ok(restored);
    assert.equal(restored.selectedCampaigns.size, 2);
    assert.ok(restored.campaignAdSets.get("cam_1")!.has("as_2"));
  });

  it("stamps the correct version", () => {
    const json = serialiseDraftState(emptyState());
    assert.equal(json.v, DRAFT_STATE_VERSION);
  });
});

// ─── deserialiseDraftState error handling ─────────────────────────────────────

describe("deserialiseDraftState — graceful failure", () => {
  it("returns null for null input", () => {
    assert.equal(deserialiseDraftState(null), null);
  });

  it("returns null for empty string", () => {
    assert.equal(deserialiseDraftState(""), null);
  });

  it("returns null for array", () => {
    assert.equal(deserialiseDraftState([]), null);
  });

  it("returns null for future version", () => {
    assert.equal(deserialiseDraftState({ v: 9999, adAccountId: "x" }), null);
  });

  it("returns a default-safe state for partial input (missing maps)", () => {
    const partial = { v: 1, adAccountId: "act_partial", step: 2 };
    const restored = deserialiseDraftState(partial);
    assert.ok(restored, "should not return null for partial input");
    assert.equal(restored.adAccountId, "act_partial");
    assert.equal(restored.selectedCampaigns.size, 0);
    assert.equal(restored.campaignAdSets.size, 0);
  });
});

// ─── hasMeaningfulState ───────────────────────────────────────────────────────

describe("hasMeaningfulState", () => {
  it("returns false for an empty state", () => {
    assert.equal(hasMeaningfulState(emptyState()), false);
  });

  it("returns true when campaigns are selected", () => {
    assert.equal(hasMeaningfulState(stateWithCampaigns()), true);
  });

  it("returns true when a creative has an uploaded asset", () => {
    const state: LiveBulkAttachState = {
      ...emptyState(),
      creatives: [
        {
          id: "cr_1",
          name: "Test",
          sourceType: "new",
          mediaType: "image",
          assetMode: "single",
          identity: { pageId: "pg_1", instagramAccountId: "" },
          assetVariations: [
            {
              id: "var_1",
              name: "V1",
              assets: [
                {
                  id: "a_1",
                  aspectRatio: "9:16",
                  uploadStatus: "uploaded",
                  uploadedUrl: "https://cdn.example.com/img.jpg",
                },
              ],
            },
          ],
          captions: [],
          headline: "",
          description: "",
          destinationUrl: "https://example.com",
          cta: "book_now",
          enhancements: {
            enabled: false,
            textOptimizations: false,
            visualEnhancements: false,
            musicEnhancements: false,
            autoVariations: false,
          },
        },
      ],
    };
    assert.equal(hasMeaningfulState(state), true);
  });
});

// ─── defaultDraftName ─────────────────────────────────────────────────────────

describe("defaultDraftName", () => {
  it("returns a non-empty string", () => {
    const name = defaultDraftName("event_abc");
    assert.ok(name.length > 0);
    assert.ok(name.includes("Bulk attach"));
  });

  it("includes the event ID prefix", () => {
    const name = defaultDraftName("event_abc123456");
    assert.ok(name.includes("event_ab"), "should include truncated event ID");
  });

  it("returns a valid string without event ID", () => {
    const name = defaultDraftName();
    assert.ok(name.startsWith("Bulk attach"));
  });
});
