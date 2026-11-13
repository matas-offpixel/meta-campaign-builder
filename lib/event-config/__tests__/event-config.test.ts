import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isCompTier, sellableAllocation } from "../allocation.ts";
import { getEventIdForCountAlias, loadCountAliasMap, parseAliasLines, planAliasChange } from "../aliases.ts";
import type { CirqlinPageLookup, CirqlinPageQuery } from "../../cirqlin/page.ts";
import {
  CIRQLIN_PAGE_LABEL,
  CIRQLIN_PAGE_NOT_FOUND,
  CIRQLIN_PAGE_PLACEHOLDER,
  CIRQLIN_PAGE_CHECK_FAILED,
  CIRQLIN_PAGE_NOT_A_LINK,
  cirqlinFailureMessage,
  cirqlinFieldIntent,
  cirqlinFieldValue,
  cirqlinNotLiveLine,
  cirqlinPageLine,
  looksLikeLink,
  resolveCirqlinField,
} from "../cirqlin.ts";
import { refreshCirqlinPageCache } from "../cirqlin-refresh.ts";
import { allowedReferenceIds, canBeReferenceShow, eventConfigUpdate, londonToday, parseCapacity } from "../form.ts";
import { lookupCirqlinPage } from "../../cirqlin/page.ts";
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

  it("the events row never carries a page id the caller sent, only CIRQLIN's answer", () => {
    const sent = { capacity: 2000, isUmbrella: false, cirqlinPageId: "5f3c2a10-0000-4000-8000-00000000ab12", cirqlin_page_id: "x" };
    const untouched = eventConfigUpdate(sent as Parameters<typeof eventConfigUpdate>[0]);
    assert.deepEqual(untouched, { capacity: 2000, is_umbrella: false });

    const now = new Date("2026-11-13T19:00:00Z");
    const page = { id: "5f3c2a10-8b7e-4d21-9c64-0e1a2b3c4d5e", slug: "ipc-newcastle-nov", title: "IPC · Newcastle", customDomain: "example-promoter.co.uk" };
    assert.deepEqual(eventConfigUpdate({ ...sent, cirqlin: { page, now } }), {
      capacity: 2000,
      is_umbrella: false,
      cirqlin_page_id: page.id,
      cirqlin_page_title: "IPC · Newcastle",
      cirqlin_page_slug: "ipc-newcastle-nov",
      cirqlin_page_checked_at: "2026-11-13T19:00:00.000Z",
    });
    assert.deepEqual(eventConfigUpdate({ ...sent, cirqlin: { page: null, now } }), {
      capacity: 2000,
      is_umbrella: false,
      cirqlin_page_id: null,
      cirqlin_page_title: null,
      cirqlin_page_slug: null,
      cirqlin_page_checked_at: null,
    });
  });

  it("reference shows: finished shows of the client's only, never the event itself or an umbrella", () => {
    const candidates = [
      { id: "djez", isUmbrella: false, eventDate: "2026-10-02" },
      { id: "global", isUmbrella: true, eventDate: "2026-10-01" },
      { id: "ipc", isUmbrella: false, eventDate: "2026-10-09" },
      { id: "fijma", isUmbrella: false, eventDate: "2027-03-19" },
      { id: "tonight", isUmbrella: false, eventDate: "2026-11-13" },
      { id: "undated", isUmbrella: false, eventDate: null },
    ];
    assert.deepEqual(
      allowedReferenceIds(["ipc", "djez", "global", "ipc", "stranger", "fijma", "tonight", "undated"], "ipc", candidates, "2026-11-13"),
      ["djez"],
    );
  });

  it("canBeReferenceShow: the date has passed (stand-in for a final count until #1217's alias switch)", () => {
    const today = "2026-11-13";
    assert.equal(canBeReferenceShow({ eventDate: "2026-11-12", isUmbrella: false }, today), true);
    assert.equal(canBeReferenceShow({ eventDate: "2026-11-12T21:00:00Z", isUmbrella: false }, today), true);
    assert.equal(canBeReferenceShow({ eventDate: "2026-11-13", isUmbrella: false }, today), false);
    assert.equal(canBeReferenceShow({ eventDate: "2027-03-19", isUmbrella: false }, today), false);
    assert.equal(canBeReferenceShow({ eventDate: null, isUmbrella: false }, today), false);
    assert.equal(canBeReferenceShow({ eventDate: "2026-10-01", isUmbrella: true }, today), false);
  });

  it("londonToday is the London calendar day", () => {
    assert.equal(londonToday(new Date("2026-07-01T23:30:00Z")), "2026-07-02");
    assert.equal(londonToday(new Date("2026-11-13T23:30:00Z")), "2026-11-13");
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

  it("exposes the cached page title and slug, never calling CIRQLIN", () => {
    const configs = buildEventConfigs({
      events: [
        {
          id: "ipc",
          client_id: "nx",
          capacity: 2000,
          is_umbrella: false,
          cirqlin_page_id: "5f3c2a10-8b7e-4d21-9c64-0e1a2b3c4d5e",
          cirqlin_page_title: "IPC · Newcastle",
          cirqlin_page_slug: "ipc-newcastle-nov",
          cirqlin_page_checked_at: "2026-11-13T18:00:00.000Z",
        },
      ],
      allocations: [],
      tiers: [],
      references: [],
      aliases: [],
    });
    assert.deepEqual(configs.get("ipc")!.cirqlinPage, {
      id: "5f3c2a10-8b7e-4d21-9c64-0e1a2b3c4d5e",
      title: "IPC · Newcastle",
      slug: "ipc-newcastle-nov",
      checkedAt: "2026-11-13T18:00:00.000Z",
    });
  });

  it("reads the page link as null when none is stored: the dashboard says No CIRQLIN page", () => {
    const configs = buildEventConfigs({
      events: [{ id: "ipc", client_id: "nx", capacity: 2000, is_umbrella: false, cirqlin_page_id: null }],
      allocations: [],
      tiers: [],
      references: [],
      aliases: [],
    });
    assert.equal(configs.get("ipc")!.cirqlinPageId, null);
    assert.equal(configs.get("ipc")!.cirqlinPage, null);
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

describe("CIRQLIN page field (design's ruling)", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  it("pins the words exactly", () => {
    assert.equal(CIRQLIN_PAGE_LABEL, "CIRQLIN page");
    assert.equal(CIRQLIN_PAGE_PLACEHOLDER, "crqln.com/…");
    assert.equal(CIRQLIN_PAGE_NOT_FOUND, "That link isn't a live CIRQLIN page. Publish it first, or check the link.");
    assert.equal(NO_CIRQLIN_PAGE, "No CIRQLIN page");
    assert.equal(CIRQLIN_PAGE_CHECK_FAILED, "Couldn't check the link with CIRQLIN just now. Try again.");
    assert.equal(CIRQLIN_PAGE_NOT_A_LINK, "Paste the page's link.");
    assert.equal(cirqlinNotLiveLine({ title: "East End Dubs · Newcastle", slug: "eed" }), "East End Dubs · Newcastle · not live now");
  });

  it("resolved: '{page title} · crqln.com/{slug}', crqln.com even with a custom domain", () => {
    assert.equal(cirqlinPageLine({ title: "IPC · Newcastle", slug: "ipc-newcastle-nov" }), "IPC · Newcastle · crqln.com/ipc-newcastle-nov");
    assert.equal(cirqlinPageLine({ title: null, slug: "ipc-newcastle-nov" }), "crqln.com/ipc-newcastle-nov");
    assert.equal(cirqlinPageLine(null), null);
    assert.equal(cirqlinFieldValue({ id: "p", title: "T", slug: "ipc-newcastle-nov", checkedAt: null }), "crqln.com/ipc-newcastle-nov");
    assert.equal(cirqlinFieldValue(null), "");
  });

  it("each failure has its line; a 404 is design's words", () => {
    assert.equal(cirqlinFailureMessage("no_page"), CIRQLIN_PAGE_NOT_FOUND);
    assert.equal(cirqlinFailureMessage("unauthorized"), CIRQLIN_PAGE_CHECK_FAILED);
    assert.equal(cirqlinFailureMessage("rate_limited"), CIRQLIN_PAGE_CHECK_FAILED);
    assert.equal(cirqlinFailureMessage("read_failed"), CIRQLIN_PAGE_CHECK_FAILED);
  });

  it("an untouched field keeps the stored page and calls nothing; blank removes it; text is resolved", () => {
    assert.deepEqual(cirqlinFieldIntent(null), { kind: "keep" });
    assert.deepEqual(cirqlinFieldIntent(undefined), { kind: "keep" });
    assert.deepEqual(cirqlinFieldIntent("   "), { kind: "clear" });
    assert.deepEqual(cirqlinFieldIntent(" crqln.com/ipc "), { kind: "resolve", url: "crqln.com/ipc" });
    assert.deepEqual(cirqlinFieldIntent("Locklead December"), { kind: "not_a_link" });
  });

  it("looksLikeLink: a host with a dot, with or without https://", () => {
    for (const ok of ["crqln.com/ipc", "https://app.cirqlin.com/l/ipc", "https://app.cirqlin.com/pages/5f3c2a10-8b7e-4d21-9c64-0e1a2b3c4d5e", "www.example-promoter.co.uk", "tickets.example.com/lineup?x=1"]) {
      assert.equal(looksLikeLink(ok), true, ok);
    }
    for (const no of ["", "ipc-newcastle-nov", "Locklead December", "5f3c2a10-8b7e-4d21-9c64-0e1a2b3c4d5e", "mailto:a@b.com", "ftp://crqln.com/x", "crqln", "javascript:alert(1)"]) {
      assert.equal(looksLikeLink(no), false, no);
    }
  });

  it("input that isn't a link says so, and CIRQLIN is never fetched", async () => {
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const lookup = (q: { url: string }) => lookupCirqlinPage(q, { fetchImpl, secret: "s", base: "https://cirqlin.example" });
    for (const text of ["Locklead December", "ipc-newcastle-nov", "5f3c2a10-8b7e-4d21-9c64-0e1a2b3c4d5e"]) {
      assert.deepEqual(await resolveCirqlinField(text, { lookup }), { ok: false, error: CIRQLIN_PAGE_NOT_A_LINK, field: "cirqlinPage" });
    }
    assert.equal(fetches, 0);
    // Untouched and blank never fetch either.
    assert.deepEqual(await resolveCirqlinField(null, { lookup }), { ok: true });
    assert.equal((await resolveCirqlinField("  ", { lookup })).ok, true);
    assert.equal(fetches, 0);
  });

  it("a link is resolved once; 404 and the other failures save nothing", async () => {
    const now = () => new Date("2026-11-13T19:00:00Z");
    const page = { id: "5f3c2a10-8b7e-4d21-9c64-0e1a2b3c4d5e", slug: "ipc", title: "IPC", customDomain: null };
    const calls: string[] = [];
    const ok = await resolveCirqlinField("crqln.com/ipc", { lookup: async (q) => (calls.push(q.url), { ok: true, page }), now });
    assert.deepEqual(ok, { ok: true, cirqlin: { page, now: now() } });
    assert.deepEqual(calls, ["crqln.com/ipc"]);
    assert.deepEqual(await resolveCirqlinField("crqln.com/x", { lookup: async () => ({ ok: false, reason: "no_page" }) }), {
      ok: false,
      error: CIRQLIN_PAGE_NOT_FOUND,
      field: "cirqlinPage",
    });
    for (const reason of ["unauthorized", "rate_limited", "read_failed"] as const) {
      assert.deepEqual(await resolveCirqlinField("crqln.com/x", { lookup: async () => ({ ok: false, reason }) }), {
        ok: false,
        error: CIRQLIN_PAGE_CHECK_FAILED,
        field: "cirqlinPage",
      });
    }
  });

  it("the panel shows the field with the ruling's label and placeholder, and never calls CIRQLIN itself", () => {
    const panel = read("../../../components/dashboard/events/event-config-panel.tsx");
    assert.match(panel, /label=\{CIRQLIN_PAGE_LABEL\}/);
    assert.match(panel, /placeholder=\{CIRQLIN_PAGE_PLACEHOLDER\}/);
    assert.match(panel, /cirqlinPageLink: linkTouched \? link : null/);
    assert.doesNotMatch(panel, /lookupCirqlinPage|cirqlin\/page/);
  });

  it("the save action resolves before it writes, and never stores the pasted link", () => {
    const action = read("../../actions/event-config.ts");
    assert.ok(action.indexOf("resolveCirqlinField(input.cirqlinPageLink") < action.indexOf('.from("events")\n      .update('));
    assert.doesNotMatch(action, /cirqlin_page_id:\s*input/);
    assert.doesNotMatch(action, /cirqlinPageLink[^\n]*\.update|cirqlin_page_link|pasted_link/);
    assert.match(action, /\.update\(eventConfigUpdate\(\{ capacity: capacity\.value, isUmbrella: input\.isUmbrella, cirqlin: page\.cirqlin \}\)\)/);
  });

  it("migration 235 adds the cache columns beside the page id", () => {
    const sql = read("../../../supabase/migrations/235_event_config.sql");
    for (const col of ["cirqlin_page_title text", "cirqlin_page_slug text", "cirqlin_page_checked_at timestamptz"]) assert.match(sql, new RegExp(`add column if not exists ${col}`));
  });
});

describe("refreshCirqlinPageCache (edit page only)", () => {
  const now = new Date("2026-11-13T19:00:00Z");
  const cached = { id: "5f3c2a10-8b7e-4d21-9c64-0e1a2b3c4d5e", title: "Old title", slug: "old-slug", checkedAt: "2026-11-13T16:00:00.000Z" };
  const fresh = { ...cached, checkedAt: "2026-11-13T18:30:00.000Z" };

  function db(error: { message: string } | null = null) {
    const writes: { row: Record<string, unknown>; eq: [string, unknown][] }[] = [];
    return {
      writes,
      from(table: string) {
        assert.equal(table, "events");
        return {
          update(row: Record<string, unknown>) {
            const w = { row, eq: [] as [string, unknown][] };
            writes.push(w);
            const chain = {
              eq(col: string, val: unknown) {
                w.eq.push([col, val]);
                return w.eq.length >= 2 ? Promise.resolve({ error }) : chain;
              },
            };
            return chain;
          },
        };
      },
    };
  }

  const lookupWith = (result: CirqlinPageLookup, calls: CirqlinPageQuery[]) => async (q: CirqlinPageQuery) => {
    calls.push(q);
    return result;
  };

  it("no page linked: no call", async () => {
    const calls: CirqlinPageQuery[] = [];
    const d = db();
    assert.equal(await refreshCirqlinPageCache(d as never, "ev", null, { lookup: lookupWith({ ok: false, reason: "read_failed" }, calls), now }), null);
    assert.equal(calls.length, 0);
  });

  it("confirmed in the last hour: no call", async () => {
    const calls: CirqlinPageQuery[] = [];
    assert.deepEqual(await refreshCirqlinPageCache(db() as never, "ev", fresh, { lookup: lookupWith({ ok: false, reason: "read_failed" }, calls), now }), fresh);
    assert.equal(calls.length, 0);
  });

  it("stale: one call by ?id=, and the new title and slug are written for that event", async () => {
    const calls: CirqlinPageQuery[] = [];
    const d = db();
    const page = { id: cached.id, slug: "ipc-newcastle-nov", title: "IPC · Newcastle", customDomain: null };
    const out = await refreshCirqlinPageCache(d as never, "ev-ipc", cached, { lookup: lookupWith({ ok: true, page }, calls), now });
    assert.deepEqual(calls, [{ id: cached.id }]);
    assert.deepEqual(out, { id: cached.id, title: "IPC · Newcastle", slug: "ipc-newcastle-nov", checkedAt: now.toISOString() });
    assert.equal(d.writes.length, 1);
    assert.deepEqual(d.writes[0]!.row, { cirqlin_page_title: "IPC · Newcastle", cirqlin_page_slug: "ipc-newcastle-nov", cirqlin_page_checked_at: now.toISOString() });
    assert.deepEqual(d.writes[0]!.eq, [["id", "ev-ipc"], ["cirqlin_page_id", cached.id]]);
  });

  it("a 404 refresh keeps the stored id and cache, marks it not live, and writes nothing", async () => {
    const d = db();
    const out = await refreshCirqlinPageCache(d as never, "ev", cached, { lookup: lookupWith({ ok: false, reason: "no_page" }, []), now });
    assert.deepEqual(out, { ...cached, notLive: true });
    assert.equal(d.writes.length, 0);
  });

  for (const reason of ["unauthorized", "rate_limited", "read_failed"] as const) {
    it(`a failed refresh (${reason}) shows the cached title and writes nothing`, async () => {
      const d = db();
      assert.deepEqual(await refreshCirqlinPageCache(d as never, "ev", cached, { lookup: lookupWith({ ok: false, reason }, []), now }), cached);
      assert.equal(d.writes.length, 0);
    });
  }
});
