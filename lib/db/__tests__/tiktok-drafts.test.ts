import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  deleteTikTokDraft,
  getTikTokDraft,
  listTikTokDrafts,
  upsertTikTokDraft,
} from "../tiktok-drafts.ts";

function makeQueryClient(result: { data: unknown; error: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const builder = {
    select(...args: unknown[]) {
      calls.push({ method: "select", args });
      return builder;
    },
    eq(...args: unknown[]) {
      calls.push({ method: "eq", args });
      return builder;
    },
    order(...args: unknown[]) {
      calls.push({ method: "order", args });
      return builder;
    },
    maybeSingle() {
      calls.push({ method: "maybeSingle", args: [] });
      return Promise.resolve(result);
    },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve(resolve(result));
    },
  };
  const client = {
    from(table: string) {
      calls.push({ method: "from", args: [table] });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("tiktok-drafts db helpers", () => {
  it("maps a loaded row into the typed TikTok draft shape", async () => {
    const { client } = makeQueryClient({
      data: {
        id: "draft-1",
        client_id: "client-1",
        event_id: "event-1",
        status: "draft",
        state: { campaignSetup: { campaignName: "[EVT] Name" } },
        created_at: "2026-04-29T00:00:00Z",
        updated_at: "2026-04-29T01:00:00Z",
      },
      error: null,
    });

    const draft = await getTikTokDraft(client, "draft-1");
    assert.equal(draft?.id, "draft-1");
    assert.equal(draft?.clientId, "client-1");
    assert.equal(draft?.campaignSetup.campaignName, "[EVT] Name");
  });

  it("upserts full state without requiring generated Supabase types", async () => {
    const upserts: unknown[] = [];
    const client = {
      from() {
        return {
          upsert(payload: unknown) {
            upserts.push(payload);
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    } as unknown as SupabaseClient;

    const draft = await upsertTikTokDraft(client, "draft-1", {
      userId: "user-1",
      clientId: "client-1",
      campaignSetup: {
        campaignName: "[EVT] Name",
        eventCode: "EVT",
        objective: "TRAFFIC",
        optimisationGoal: "CLICK",
      },
    });

    assert.equal(draft.id, "draft-1");
    const payload = upserts[0] as Record<string, unknown>;
    assert.equal(payload.user_id, "user-1");
    assert.equal(payload.name, "[EVT] Name");
    assert.equal(payload.client_id, "client-1");
  });

  it("applies list filters and archives deletes", async () => {
    const { client, calls } = makeQueryClient({ data: [], error: null });
    await listTikTokDrafts(client, {
      userId: "user-1",
      status: "draft",
      clientId: "client-1",
      eventId: "event-1",
    });
    assert.ok(calls.some((call) => call.method === "eq" && call.args[0] === "user_id"));

    const updates: unknown[] = [];
    const updateClient = {
      from() {
        const builder = {
          update(payload: unknown) {
            updates.push(payload);
            return builder;
          },
          eq() {
            return Promise.resolve({ data: null, error: null });
          },
        };
        return builder;
      },
    } as unknown as SupabaseClient;
    await deleteTikTokDraft(updateClient, "draft-1");
    assert.equal((updates[0] as Record<string, unknown>).status, "archived");
  });
});
