/**
 * Archived clients are hidden from default dashboard loaders and every
 * cron loader; rows with no client stay; share links still resolve.
 *
 * Fixture: client `c-arch` is archived and owns event `e-arch`; client
 * `c-act` is active and owns `e-act`; `e-none` has no client.
 */

import { strict as assert } from "node:assert";
import { register } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";

import { fakeDb, type FakeCall } from "../../launched-ads/__tests__/fake-db.ts";

register(new URL("../../__tests__/support/alias-hooks.mjs", import.meta.url));

const { setSupabaseStub } = await import("../../__tests__/support/supabase-stub.ts");
const { listClientsServer } = await import("../clients-server.ts");
const { listClients } = await import("../clients.ts");
const { listEventsServer } = await import("../events-server.ts");
const { listEvents } = await import("../events.ts");
const { listOverviewEvents } = await import("../overview-server.ts");
const { loadCampaignList } = await import("../drafts.ts");
const { countArmedCampaigns, loadArmedCampaignRows } = await import("../armed-campaigns.ts");
const { refreshDerivedFunnelPacingTargets } = await import("../../reporting/funnel-pacing.ts");
const { refreshAllClientPortalSnapshots } = await import("../../reporting/client-portal-snapshot-runner.ts");
const { loadRollupSyncCronEligibility, loadActiveCreativesCronEligibility } = await import(
  "../../dashboard/cron-eligibility.ts"
);
const { listEligibleAccountPairs } = await import("../creative-insight-snapshots.ts");
const { loadPublishedCampaignsForBudgetPacing } = await import("../budget-pacing-campaigns.ts");
const { loadOptedInCampaignsForAutomation } = await import("../campaign-automation-decisions.ts");
const { loadClientAdAccounts } = await import("../../ad-daily-insights/runner.ts");
const { resolveShareByToken } = await import("../report-shares.ts");

const ARCH = "c-arch";
const ACT = "c-act";

function has(call: FakeCall, name: string, ...args: unknown[]): boolean {
  return call.ops.some(
    ([n, a]) => n === name && args.every((arg, i) => JSON.stringify(a[i]) === JSON.stringify(arg)),
  );
}

const isArchivedIdsRead = (c: FakeCall) => c.table === "clients" && has(c, "eq", "status", "archived");
const isArchivedEventsRead = (c: FakeCall) => c.table === "events" && has(c, "in", "client_id", [ARCH]);

/** Answers the two client-status reads; everything else goes to `rest`. */
function archivedAware(rest: (call: FakeCall) => unknown) {
  return fakeDb((call) => {
    if (isArchivedIdsRead(call)) return { data: [{ id: ARCH }], error: null };
    if (isArchivedEventsRead(call)) return { data: [{ id: "e-arch" }], error: null };
    return rest(call);
  });
}

const EVENT_ROWS = [
  { id: "e-arch", client_id: ARCH, name: "Arch", client: { id: ARCH, name: "Arch" } },
  { id: "e-act", client_id: ACT, name: "Act", client: { id: ACT, name: "Act" } },
  { id: "e-none", client_id: null, name: "None", client: null },
];

function draftJson(id: string, eventId: string | null) {
  return {
    id,
    status: "published",
    metaCampaignId: `1202500000000${id.length}`,
    settings: {
      eventId,
      campaignName: id,
      adAccountId: "act_1234567",
      objective: "registration",
    },
    budgetSchedule: { currency: "GBP", startDate: "2026-10-01", endDate: "2026-10-31" },
    adSetSuggestions: [],
    optimisationStrategy: { rules: [], guardrails: { baseAdSetBudget: 0, baseCampaignBudget: 0, hardBudgetCeiling: 0 } },
    audiences: {},
    creatives: [],
  };
}

const DRAFT_ROWS = [
  { id: "d-arch-client", client_id: ARCH, event_id: null, ad_account_id: "act_1234567" },
  { id: "d-arch-event", client_id: null, event_id: "e-arch", ad_account_id: "act_1234567" },
  { id: "d-act", client_id: ACT, event_id: "e-act", ad_account_id: "act_1234567" },
  { id: "d-import", client_id: null, event_id: null, ad_account_id: "act_1234567" },
].map((row) => ({
  ...row,
  name: row.id,
  objective: "registration",
  status: "published",
  user_id: "u1",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  optimisation_automation_enabled: true,
  optimisation_automation_live: false,
  draft_json: draftJson(row.id, row.event_id),
}));

const silenced = { log: console.log, warn: console.warn };
beforeEach(() => {
  console.log = () => undefined;
  console.warn = () => undefined;
});
afterEach(() => {
  console.log = silenced.log;
  console.warn = silenced.warn;
});

describe("clients list", () => {
  it("listClientsServer hides archived by default, 'all' includes them, explicit status filters", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    setSupabaseStub(db);
    await listClientsServer("u1");
    await listClientsServer("u1", { status: "all" });
    await listClientsServer("u1", { status: "archived" });
    const reads = calls.filter((c) => c.table === "clients");
    assert.equal(has(reads[0], "neq", "status", "archived"), true);
    assert.equal(reads[1].ops.some(([n, a]) => (n === "neq" || n === "eq") && a[0] === "status"), false);
    assert.equal(has(reads[2], "eq", "status", "archived"), true);
  });

  it("listClients hides archived only when asked", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    setSupabaseStub(db);
    await listClients("u1");
    await listClients("u1", { excludeArchived: true });
    assert.equal(has(calls[0], "neq", "status", "archived"), false);
    assert.equal(has(calls[1], "neq", "status", "archived"), true);
  });
});

describe("today / events / overview", () => {
  const events = () => archivedAware((c) => (c.table === "events" ? { data: EVENT_ROWS, error: null } : { data: [], error: null }));

  it("listEventsServer drops archived clients' events and keeps no-client events", async () => {
    setSupabaseStub(events().db);
    assert.deepEqual((await listEventsServer("u1")).map((e) => e.id), ["e-act", "e-none"]);
  });

  it("listEventsServer with an explicit clientId does not filter", async () => {
    setSupabaseStub(events().db);
    assert.equal((await listEventsServer("u1", { clientId: ARCH })).length, 3);
  });

  it("listEvents (Today) drops archived clients' events when asked", async () => {
    setSupabaseStub(events().db);
    assert.deepEqual((await listEvents("u1", { excludeArchivedClients: true })).map((e) => e.id), ["e-act", "e-none"]);
    setSupabaseStub(events().db);
    assert.equal((await listEvents("u1")).length, 3);
  });

  it("listOverviewEvents drops archived clients' events", async () => {
    setSupabaseStub(events().db);
    const rows = await listOverviewEvents("u1", "past");
    assert.deepEqual(rows.map((r) => r.event_id).sort(), ["e-act", "e-none"]);
  });
});

describe("library and armed", () => {
  it("loadCampaignList flags drafts of archived clients (column or event) and not imports", async () => {
    const { db } = archivedAware((c) => {
      if (c.table === "campaign_drafts") return { data: DRAFT_ROWS, error: null };
      if (c.table === "events") {
        return { data: [{ id: "e-arch", client_id: ARCH }, { id: "e-act", client_id: ACT }], error: null };
      }
      return { data: [], error: null };
    });
    setSupabaseStub(db);
    const list = await loadCampaignList("u1");
    const flags = Object.fromEntries(list.map((c) => [c.id, Boolean(c.clientArchived)]));
    assert.deepEqual(flags, { "d-arch-client": true, "d-arch-event": true, "d-act": false, "d-import": false });
  });

  it("Armed tab and badge count hide drafts of archived clients, keep imports", async () => {
    const { db } = archivedAware((c) => {
      if (c.table === "campaign_drafts" && has(c, "eq", "optimisation_automation_enabled", true)) {
        return { data: DRAFT_ROWS.map((r) => ({ ...r, json_event_id: r.event_id })), error: null };
      }
      return { data: [], error: null };
    });
    const viewer = { userId: "u1", isOperator: true };
    const armed = await loadArmedCampaignRows(db, { kind: "armed" }, viewer);
    assert.deepEqual(armed.campaigns.map((c) => c.id).sort(), ["d-act", "d-import"]);
    assert.equal(await countArmedCampaigns(db, viewer), 2);
  });
});

describe("funnel pacing + portal snapshot client loops", () => {
  it("refreshDerivedFunnelPacingTargets and refreshAllClientPortalSnapshots read active clients only", async () => {
    const { db, calls } = archivedAware(() => ({ data: [], error: null }));
    setSupabaseStub(db);
    const funnel = await refreshDerivedFunnelPacingTargets();
    await refreshAllClientPortalSnapshots();
    const loops = calls.filter((c) => c.table === "clients" && !isArchivedIdsRead(c));
    assert.equal(loops.length, 2);
    for (const call of loops) assert.equal(has(call, "neq", "status", "archived"), true);
    assert.equal(funnel.skippedArchivedClients, 1);
  });
});

describe("crons", () => {
  it("cron eligibility drops archived clients' events from every set", async () => {
    const { db } = archivedAware((c) => {
      if (c.table === "event_ticketing_links") {
        return { data: [{ event_id: "e-arch" }, { event_id: "e-act" }, { event_id: "e-none" }], error: null };
      }
      if (c.table === "events" && has(c, "eq", "kind", "brand_campaign")) return { data: [{ id: "e-arch" }], error: null };
      return { data: [], error: null };
    });
    const rollup = await loadRollupSyncCronEligibility(db);
    assert.deepEqual(rollup.eligibleIds.sort(), ["e-act", "e-none"]);
    assert.equal(rollup.skippedArchivedClients, 1);
    assert.equal(rollup.skippedArchivedEvents, 1);
    const creatives = await loadActiveCreativesCronEligibility(db);
    assert.equal(creatives.ticketingIds.includes("e-arch"), false);
  });

  it("listEligibleAccountPairs skips archived clients and their event overrides", async () => {
    const { db, calls } = archivedAware((c) => {
      if (c.table === "clients") return { data: [{ user_id: "u1", meta_ad_account_id: "1111111" }], error: null };
      if (c.table === "events") {
        return {
          data: [
            { user_id: "u1", client_id: ARCH, meta_ad_account_id: "2222222" },
            { user_id: "u1", client_id: null, meta_ad_account_id: "3333333" },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });
    const pairs = await listEligibleAccountPairs(db);
    assert.deepEqual(pairs.map((p) => p.adAccountId), ["act_1111111", "act_3333333"]);
    const clientsRead = calls.find((c) => c.table === "clients" && !isArchivedIdsRead(c));
    assert.equal(has(clientsRead!, "neq", "status", "archived"), true);
  });

  it("budget pacing skips published drafts of archived clients, keeps imports", async () => {
    const { db } = archivedAware((c) => (c.table === "campaign_drafts" ? { data: DRAFT_ROWS, error: null } : { data: [], error: null }));
    const campaigns = await loadPublishedCampaignsForBudgetPacing(db);
    assert.deepEqual(campaigns.map((c) => c.campaignName).sort(), ["d-act", "d-import"]);
  });

  it("optimisation-tick skips opted-in drafts of archived clients, keeps imports", async () => {
    const { db } = archivedAware((c) => (c.table === "campaign_drafts" ? { data: DRAFT_ROWS, error: null } : { data: [], error: null }));
    const campaigns = await loadOptedInCampaignsForAutomation(db);
    assert.deepEqual(campaigns.map((c) => c.draftId).sort(), ["d-act", "d-import"]);
  });

  it("ad-daily-insights drops archived-only accounts, keeps shared and no-client accounts", async () => {
    const { db } = archivedAware((c) => {
      if (c.table === "clients") {
        return {
          data: [
            { id: ARCH, meta_ad_account_id: "4444444" },
            { id: ARCH, meta_ad_account_id: "5555555" },
            { id: ACT, meta_ad_account_id: "6666666" },
          ],
          error: null,
        };
      }
      if (c.table === "events") return { data: [{ client_id: ACT, meta_ad_account_id: "5555555" }], error: null };
      if (c.table === "launched_ad_sets") return { data: [{ client_id: null, ad_account_id: "7777777" }], error: null };
      return { data: [], error: null };
    });
    const loaded = await loadClientAdAccounts(db);
    assert.deepEqual(loaded.accounts, ["act_5555555", "act_6666666", "act_7777777"]);
    assert.equal(loaded.skippedArchivedAccounts, 1);
  });
});

describe("share links keep working for archived clients", () => {
  it("resolveShareByToken resolves a client-scope share without reading client status", async () => {
    const { db, calls } = fakeDb((c) =>
      c.table === "report_shares"
        ? {
            data: {
              token: "tok-arch",
              event_id: null,
              client_id: ARCH,
              event_code: null,
              scope: "client",
              can_edit: false,
              show_creative_insights: true,
              show_funnel_pacing: true,
              user_id: "u1",
              enabled: true,
              expires_at: null,
              view_count: 0,
              last_viewed_at: null,
              created_at: "2026-01-01T00:00:00Z",
            },
            error: null,
          }
        : { data: null, error: null },
    );
    const result = await resolveShareByToken("tok-arch", db);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.share.scope === "client" && result.share.client_id, ARCH);
    assert.equal(calls.some((c) => c.table === "clients"), false);
  });
});
