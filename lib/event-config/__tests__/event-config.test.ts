import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isCompTier, sellableAllocation } from "../allocation.ts";
import { getEventIdForCountAlias, loadCountAliasMap, parseAliasLines, planAliasChange } from "../aliases.ts";
import { allowedReferenceIds, parseCapacity, parseCirqlinPageId } from "../form.ts";
import { buildEventConfigs, NO_CAPACITY, NO_CIRQLIN_PAGE } from "../read.ts";

const row = (tier_name: string, allocation_count: number) => ({ tier_name, allocation_count });

describe("sellableAllocation", () => {
  it("sums the paid tiers' allocations across channels when tiers are present", () => {
    const s = sellableAllocation({
      capacity: 2000,
      allocations: [row("Early Bird", 300), row("Tier 1", 700), row("Tier 1", 200), row("Final Release", 600)],
    });
    assert.equal(s.allocation, 1800);
    assert.equal(s.source, "tiers");
    assert.equal(s.paidTierAllocation, 1800);
    assert.equal(s.capacity, 2000);
  });

  it("falls back to capacity when no tier allocations are stored", () => {
    const s = sellableAllocation({ capacity: 2000, allocations: [] });
    assert.deepEqual([s.allocation, s.source, s.paidTierAllocation], [2000, "capacity", null]);
  });

  it("has no default: no capacity and no tiers is null", () => {
    for (const capacity of [null, undefined, 0, -5]) {
      const s = sellableAllocation({ capacity, allocations: [] });
      assert.equal(s.allocation, null);
      assert.equal(s.source, null);
    }
  });

  it("leaves comps out, by name and by a price of zero or below", () => {
    const prices = new Map<string, number | null>([
      ["VIP Free", -1],
      ["Artist", 0],
      ["Tier 1", 12.5],
      ["Tier 2", null],
    ]);
    const s = sellableAllocation({
      capacity: 2000,
      allocations: [
        row("Tier 1", 900),
        row("Tier 2", 500),
        row("Guest List", 129),
        row("COMPS", 40),
        row("VIP Free", 89),
        row("Artist", 20),
      ],
      tierPrices: prices,
    });
    assert.equal(s.allocation, 1400);
    assert.equal(s.compAllocation, 129 + 40 + 89 + 20);
  });

  it("uses capacity when only comp tiers carry an allocation", () => {
    const s = sellableAllocation({ capacity: 1500, allocations: [row("Guest List", 100)] });
    assert.deepEqual([s.allocation, s.source, s.compAllocation], [1500, "capacity", 100]);
  });

  it("uses capacity when the paid tiers' allocations are all zero", () => {
    const s = sellableAllocation({ capacity: 1500, allocations: [row("Tier 1", 0)] });
    assert.deepEqual([s.allocation, s.source], [1500, "capacity"]);
  });

  it("names comps the way Internal Counts writes them", () => {
    for (const name of ["Guest List", "GUESTLIST", "GL", "Comps", "Complimentary", "VIP Free", "guests"]) {
      assert.equal(isCompTier(name, 10), true, name);
    }
    for (const name of ["Early Bird", "Tier 3", "VIP", "Freedom Pass Tier"]) {
      assert.equal(isCompTier(name, 10), false, name);
    }
  });
});

describe("count aliases", () => {
  it("keeps case and inner spacing, trims line edges, drops blanks and exact repeats", () => {
    assert.deepEqual(parseAliasLines("Folamour\n  FOLAMOUR \n\nFolamour\nEAST END  DUBS\r\n"), ["Folamour", "FOLAMOUR", "EAST END  DUBS"]);
  });

  it("refuses an alias stored on another event and writes nothing for it", () => {
    const stored = [
      { alias: "IPC", event_id: "ipc" },
      { alias: "D.O.D", event_id: "dod" },
    ];
    const plan = planAliasChange(stored, "dod", ["D.O.D", "IPC", "DOD"]);
    assert.deepEqual(plan.conflicts, [{ alias: "IPC", event_id: "ipc" }]);
    assert.deepEqual(plan.add, ["DOD"]);
    assert.deepEqual(plan.remove, []);
  });

  it("adds new aliases and removes dropped ones on the same event", () => {
    const stored = [
      { alias: "Folamour", event_id: "fol" },
      { alias: "FOLAMOUR", event_id: "fol" },
    ];
    const plan = planAliasChange(stored, "fol", ["FOLAMOUR", "FOLAMOUR B2B"]);
    assert.deepEqual(plan, { add: ["FOLAMOUR B2B"], remove: ["Folamour"], conflicts: [] });
  });

  it("treats a case variant as a different alias", () => {
    const plan = planAliasChange([{ alias: "Folamour", event_id: "fol" }], "other", ["FOLAMOUR"]);
    assert.deepEqual(plan.conflicts, []);
    assert.deepEqual(plan.add, ["FOLAMOUR"]);
  });

  it("migration 235 makes alias unique, so one sheet name maps to one event", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/235_event_config.sql", import.meta.url), "utf8");
    assert.match(sql, /create table if not exists public\.event_count_aliases[\s\S]*?constraint event_count_aliases_alias_unique unique \(alias\)/);
    assert.match(sql, /constraint event_reference_shows_not_self check \(event_id <> reference_event_id\)/);
    assert.match(sql, /set is_umbrella = true\s+where event_code = 'NX26-GLOBAL'/);
    assert.doesNotMatch(sql, /insert into public\.event_count_aliases/);
  });

  it("getEventIdForCountAlias matches exactly", async () => {
    const calls: unknown[] = [];
    const sb = fakeDb([{ alias: "IPC", event_id: "ipc" }], calls);
    assert.equal(await getEventIdForCountAlias(sb, "IPC"), "ipc");
    assert.equal(await getEventIdForCountAlias(sb, "ipc"), null);
    assert.deepEqual(calls.slice(0, 3), ["from:event_count_aliases", "select:alias,event_id", "eq:alias=IPC"]);
  });

  it("loadCountAliasMap pages in alias order and dedupes", async () => {
    const calls: unknown[] = [];
    const rows = [
      { alias: "D.O.D", event_id: "dod" },
      { alias: "IPC", event_id: "ipc" },
    ];
    const map = await loadCountAliasMap(fakeDb(rows, calls));
    assert.deepEqual([...map], [["D.O.D", "dod"], ["IPC", "ipc"]]);
    assert.ok(calls.includes("order:alias"));
    assert.ok(calls.includes("range:0-999"));
  });
});

describe("form inputs", () => {
  it("capacity: blank is none, never a default", () => {
    assert.deepEqual(parseCapacity(""), { ok: true, value: null });
    assert.deepEqual(parseCapacity(" 2,000 "), { ok: true, value: 2000 });
    assert.equal(parseCapacity("0").ok, false);
    assert.equal(parseCapacity("1500.5").ok, false);
  });

  it("CIRQLIN page: the page id only", () => {
    assert.deepEqual(parseCirqlinPageId(" 5F3C2A10-0000-4000-8000-00000000AB12 "), {
      ok: true,
      value: "5f3c2a10-0000-4000-8000-00000000ab12",
    });
    assert.deepEqual(parseCirqlinPageId(""), { ok: true, value: null });
    assert.equal(parseCirqlinPageId("nx-loves-aw26").ok, false);
    assert.equal(parseCirqlinPageId("https://crqln.com/l/nx-loves-aw26").ok, false);
  });

  it("reference shows: never the event itself or an umbrella", () => {
    const candidates = [
      { id: "djez", isUmbrella: false },
      { id: "global", isUmbrella: true },
      { id: "ipc", isUmbrella: false },
    ];
    assert.deepEqual(allowedReferenceIds(["ipc", "djez", "global", "ipc", "stranger"], "ipc", candidates), ["djez"]);
  });
});

describe("buildEventConfigs", () => {
  it("exposes the umbrella flag, page link, reference set and aliases", () => {
    const configs = buildEventConfigs({
      events: [
        { id: "global", client_id: "nx", capacity: null, is_umbrella: true, cirqlin_page_id: null },
        { id: "ipc", client_id: "nx", capacity: 2000, is_umbrella: false, cirqlin_page_id: "5f3c2a10-0000-4000-8000-00000000ab12" },
      ],
      allocations: [],
      tiers: [],
      references: [{ event_id: "ipc", reference_event_id: "djez" }],
      aliases: [{ event_id: "ipc", alias: "IPC" }],
    });
    const global = configs.get("global")!;
    assert.equal(global.isUmbrella, true);
    assert.equal(global.sellable.allocation, null);
    const ipc = configs.get("ipc")!;
    assert.equal(ipc.isUmbrella, false);
    assert.equal(ipc.sellable.allocation, 2000);
    assert.deepEqual(ipc.referenceEventIds, ["djez"]);
    assert.deepEqual(ipc.countAliases, ["IPC"]);
  });

  it("says missing values in D9's words", () => {
    assert.equal(NO_CAPACITY, "Set capacity on the event to see the sell-out line");
    assert.equal(NO_CIRQLIN_PAGE, "No CIRQLIN page");
  });
});

/** A just-enough PostgREST query builder over `rows`. */
function fakeDb(rows: { alias: string; event_id: string }[], calls: unknown[]) {
  return {
    from(table: string) {
      calls.push(`from:${table}`);
      let filtered = rows;
      const q = {
        select(cols: string) {
          calls.push(`select:${cols}`);
          return q;
        },
        eq(col: string, value: unknown) {
          calls.push(`eq:${col}=${String(value)}`);
          filtered = filtered.filter((r) => (r as Record<string, unknown>)[col] === value);
          return q;
        },
        order(col: string) {
          calls.push(`order:${col}`);
          filtered = [...filtered].sort((a, b) => a.alias.localeCompare(b.alias));
          return q;
        },
        range(from: number, to: number) {
          calls.push(`range:${from}-${to}`);
          return Promise.resolve({ data: filtered.slice(from, to + 1), error: null });
        },
        maybeSingle() {
          return Promise.resolve({ data: filtered[0] ?? null, error: null });
        },
      };
      return q;
    },
  };
}
