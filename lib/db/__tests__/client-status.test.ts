import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { fakeDb } from "../../launched-ads/__tests__/fake-db.ts";
import {
  ARCHIVED,
  activeClientFilter,
  dropArchivedClientRows,
  dropArchivedEventRows,
  isArchivedClientDraft,
  isArchivedClientStatus,
  loadArchivedClientIds,
  loadArchivedClientScope,
} from "../client-status.ts";

describe("client-status helper", () => {
  it("activeClientFilter applies neq('status', 'archived')", () => {
    const seen: unknown[][] = [];
    const query = {
      neq(...args: unknown[]) {
        seen.push(args);
        return query;
      },
    };
    assert.equal(activeClientFilter(query), query);
    assert.deepEqual(seen, [["status", "archived"]]);
    assert.equal(ARCHIVED, "archived");
    assert.equal(isArchivedClientStatus("archived"), true);
    assert.equal(isArchivedClientStatus("paused"), false);
    assert.equal(isArchivedClientStatus(null), false);
  });

  it("loadArchivedClientIds reads once per client instance", async () => {
    const { db, calls } = fakeDb(() => ({ data: [{ id: "c1" }, { id: "c2" }], error: null }));
    const first = await loadArchivedClientIds(db);
    const second = await loadArchivedClientIds(db);
    assert.deepEqual([...first].sort(), ["c1", "c2"]);
    assert.equal(second, first);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].ops, [
      ["select", ["id"]],
      ["eq", ["status", "archived"]],
    ]);
  });

  it("a failed read hides nothing", async () => {
    const { db } = fakeDb(() => ({ data: null, error: { message: "boom" } }));
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      assert.equal((await loadArchivedClientIds(db)).size, 0);
    } finally {
      console.warn = warn;
    }
  });

  it("loadArchivedClientScope adds the archived clients' events", async () => {
    const { db, calls } = fakeDb((call) =>
      call.table === "clients" ? { data: [{ id: "c1" }], error: null } : { data: [{ id: "e1" }, { id: "e2" }], error: null },
    );
    const scope = await loadArchivedClientScope(db);
    assert.deepEqual([...scope.clientIds], ["c1"]);
    assert.deepEqual([...scope.eventIds].sort(), ["e1", "e2"]);
    assert.deepEqual(calls[1].ops.find(([n]) => n === "in"), ["in", ["client_id", ["c1"]]]);
  });

  it("no archived clients means no events read", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    const scope = await loadArchivedClientScope(db);
    assert.equal(scope.eventIds.size, 0);
    assert.equal(calls.length, 1);
  });

  it("row filters drop archived rows and keep rows with no client or event", () => {
    const archived = new Set(["c1"]);
    const rows = [{ client_id: "c1" }, { client_id: "c2" }, { client_id: null }, {}];
    assert.deepEqual(dropArchivedClientRows(rows, archived), [{ client_id: "c2" }, { client_id: null }, {}]);
    const nested = [{ client: { id: "c1" } }, { client: null }];
    assert.deepEqual(dropArchivedClientRows(nested, archived, (r) => r.client?.id), [{ client: null }]);
    const scope = { clientIds: archived, eventIds: new Set(["e1"]) };
    assert.deepEqual(dropArchivedEventRows([{ event_id: "e1" }, { event_id: "e2" }, { event_id: null }], scope), [
      { event_id: "e2" },
      { event_id: null },
    ]);
  });

  it("a draft is its client's, else its event's", () => {
    const scope = { clientIds: new Set(["c1"]), eventIds: new Set(["e1"]) };
    assert.equal(isArchivedClientDraft({ clientId: "c1", eventIds: [] }, scope), true);
    assert.equal(isArchivedClientDraft({ clientId: null, eventIds: [null, "e1"] }, scope), true);
    assert.equal(isArchivedClientDraft({ clientId: "c2", eventIds: ["e1"] }, scope), false);
    assert.equal(isArchivedClientDraft({ clientId: null, eventIds: [null, undefined] }, scope), false);
  });
});

describe("archived-client wiring in routes and pages", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("plans page drops plans and picker events of archived clients", () => {
    const src = read("app/(dashboard)/mml/page.tsx");
    assert.match(src, /loadArchivedClientScope\(supabase\)/);
    assert.match(src, /dropArchivedEventRows\(\(data \?\? \[\]\) as PlanListRow\[\], archivedScope\)/);
    assert.match(src, /archivedScope\.clientIds\)/);
  });

  it("show-week-burst drops archived clients' events and logs the skip", () => {
    const src = read("app/api/cron/show-week-burst/route.ts");
    assert.match(src, /dropArchivedClientRows\(windowEvents, archivedClientIds\)/);
    assert.match(src, /logSkippedArchivedClients\(/);
  });

  it("rollup-sync-events and refresh-active-creatives log skipped_archived_clients", () => {
    const rollup = read("app/api/cron/rollup-sync-events/route.ts");
    assert.equal((rollup.match(/skipped_archived_clients=\$\{eligibility\.skippedArchivedClients\}/g) ?? []).length, 2);
    // The unmatched-campaign scan only sees accounts of eligible events.
    assert.match(rollup, /\.in\("id", eligibility\.eligibleIds\)/);
    assert.match(read("app/api/cron/refresh-active-creatives/route.ts"), /eligibility\.skippedArchivedClients/);
  });

  it("scan-enhancement-flags cron loop reads active clients only", () => {
    const src = read("app/api/internal/scan-enhancement-flags/route.ts");
    assert.match(src, /activeClientFilter\(clientsQuery\)/);
    assert.match(src, /logSkippedArchivedClients\("scan-enhancement-flags"/);
  });

  it("mailchimp crons drop archived clients' events from every events read", () => {
    const eod = read("app/api/cron/mailchimp-eod-snapshot/route.ts");
    assert.equal((eod.match(/dropArchivedClientRows\(/g) ?? []).length, 2);
    assert.match(eod, /select\("id, client_id, mailchimp_tag"\)/);
    const sync = read("app/api/cron/sync-mailchimp-audiences/route.ts");
    assert.equal((sync.match(/dropArchivedClientRows\(/g) ?? []).length, 2);
  });

  it("share, portal login and portal load never consult client status", () => {
    for (const path of ["lib/db/report-shares.ts", "lib/auth/get-client-context.ts", "lib/db/client-portal-server.ts"]) {
      assert.doesNotMatch(read(path), /client-status|activeClientFilter|loadArchivedClient/, path);
    }
  });
});
