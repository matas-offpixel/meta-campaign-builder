import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFanQueryPlan,
  buildFansCsv,
  classifySearch,
  csvField,
  fanFiltersToQueryString,
  fansCsvFilename,
  FANS_EXPORT_MAX_ROWS,
  FANS_PER_PAGE,
  parseFanFilters,
  type FanCsvRow,
  type FanFilters,
} from "../fans-query.ts";

const EVENT_ID = "160fbb1c-a4be-4435-a53d-a690c9edf895";

function filters(overrides: Partial<FanFilters> = {}): FanFilters {
  return {
    eventId: null,
    country: null,
    consent: "all",
    from: null,
    to: null,
    search: null,
    page: 1,
    ...overrides,
  };
}

describe("parseFanFilters", () => {
  it("defaults everything on an empty query", () => {
    assert.deepEqual(parseFanFilters({}), filters());
  });

  it("accepts valid values", () => {
    assert.deepEqual(
      parseFanFilters({
        event: EVENT_ID,
        country: "gb",
        consent: "wa-opted-in",
        from: "2026-06-01",
        to: "2026-07-01",
        q: "ana@example.com",
        page: "3",
      }),
      filters({
        eventId: EVENT_ID,
        country: "GB",
        consent: "wa-opted-in",
        from: "2026-06-01",
        to: "2026-07-01",
        search: "ana@example.com",
        page: 3,
      }),
    );
  });

  it("rejects junk back to defaults (no exceptions)", () => {
    assert.deepEqual(
      parseFanFilters({
        event: "not-a-uuid",
        country: "GBR",
        consent: "yes-please",
        from: "01/06/2026",
        to: "junk",
        page: "-4",
      }),
      filters(),
    );
  });

  it("takes the first value of repeated params and clamps page", () => {
    const parsed = parseFanFilters({ page: ["2", "9"], q: "x".repeat(500) });
    assert.equal(parsed.page, 2);
    assert.equal(parsed.search?.length, 100);
  });
});

describe("fanFiltersToQueryString", () => {
  it("round-trips through parseFanFilters", () => {
    const original = filters({
      eventId: EVENT_ID,
      country: "ES",
      consent: "no-wa",
      from: "2026-06-01",
      search: "@jackie",
      page: 2,
    });
    const qs = fanFiltersToQueryString(original);
    const reparsed = parseFanFilters(
      Object.fromEntries(new URLSearchParams(qs.slice(1))),
    );
    assert.deepEqual(reparsed, original);
  });

  it("omits defaults entirely", () => {
    assert.equal(fanFiltersToQueryString(filters()), "");
  });

  it("applies overrides (pagination links)", () => {
    assert.equal(
      fanFiltersToQueryString(filters({ page: 2 }), { page: 3 }),
      "?page=3",
    );
  });
});

describe("classifySearch", () => {
  it("routes @-bearing input to email", () => {
    assert.deepEqual(classifySearch("  Ana@Example.COM "), {
      kind: "email",
      normalised: "ana@example.com",
    });
  });

  it("routes handles (leading @ stripped, lowercased)", () => {
    assert.deepEqual(classifySearch("@JackieFan"), {
      kind: "handle",
      normalised: "jackiefan",
    });
  });

  it("a bare leading-@ string is a handle, not an email", () => {
    assert.equal(classifySearch("@abc").kind, "handle");
  });

  it("empty → none", () => {
    assert.deepEqual(classifySearch(null), { kind: "none" });
    assert.deepEqual(classifySearch("   "), { kind: "none" });
    assert.deepEqual(classifySearch("@@@"), { kind: "none" });
  });
});

describe("buildFanQueryPlan", () => {
  it("base plan: canonical + not-deleted + order + first page", () => {
    assert.deepEqual(buildFanQueryPlan(filters(), null), [
      { op: "is", column: "deduplicated_signup_id", value: null },
      { op: "is", column: "deleted_at", value: null },
      { op: "order", column: "created_at", ascending: false },
      { op: "range", fromIndex: 0, toIndex: FANS_PER_PAGE - 1 },
    ]);
  });

  it("all filters produce the full pinned plan", () => {
    const plan = buildFanQueryPlan(
      filters({
        eventId: EVENT_ID,
        country: "GB",
        consent: "wa-opted-in",
        from: "2026-06-01",
        to: "2026-06-30",
        search: "ana@example.com",
        page: 2,
      }),
      "hashed-email-value",
    );
    assert.deepEqual(plan, [
      { op: "is", column: "deduplicated_signup_id", value: null },
      { op: "is", column: "deleted_at", value: null },
      { op: "eq", column: "event_id", value: EVENT_ID },
      { op: "eq", column: "geo_country", value: "GB" },
      { op: "not", column: "consent_wa_opt_in_at", operator: "is", value: null },
      { op: "gte", column: "created_at", value: "2026-06-01T00:00:00Z" },
      { op: "lte", column: "created_at", value: "2026-06-30T23:59:59.999Z" },
      { op: "eq", column: "email_hash", value: "hashed-email-value" },
      { op: "order", column: "created_at", ascending: false },
      { op: "range", fromIndex: FANS_PER_PAGE, toIndex: FANS_PER_PAGE * 2 - 1 },
    ]);
  });

  it("handle search targets both handle columns with escaped pattern", () => {
    const plan = buildFanQueryPlan(filters({ search: "@50%_off" }), null);
    const or = plan.find((op) => op.op === "or");
    assert.deepEqual(or, {
      op: "or",
      conditions: "ig_handle.ilike.%50\\%\\_off%,tt_handle.ilike.%50\\%\\_off%",
    });
  });

  it("no-wa consent flips to an is-null filter", () => {
    const plan = buildFanQueryPlan(filters({ consent: "no-wa" }), null);
    assert.ok(
      plan.some(
        (op) =>
          op.op === "is" && op.column === "consent_wa_opt_in_at" && op.value === null,
      ),
    );
  });

  it("email search without a hash adds no PII filter", () => {
    const plan = buildFanQueryPlan(filters({ search: "a@b.com" }), null);
    assert.ok(!plan.some((op) => op.op === "eq" && op.column === "email_hash"));
    assert.ok(!plan.some((op) => op.op === "or"));
  });

  it("export swaps pagination for the row cap", () => {
    const plan = buildFanQueryPlan(filters({ page: 7 }), null, true);
    const range = plan.find((op) => op.op === "range");
    assert.deepEqual(range, {
      op: "range",
      fromIndex: 0,
      toIndex: FANS_EXPORT_MAX_ROWS - 1,
    });
  });
});

describe("csvField", () => {
  it("passes plain values through", () => {
    assert.equal(csvField("ana@example.com"), "ana@example.com");
  });

  it("quotes commas, quotes and newlines (RFC 4180)", () => {
    assert.equal(csvField('a,"b"\nc'), '"a,""b""\nc"');
  });

  it("guards spreadsheet formula injection", () => {
    assert.equal(csvField("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(csvField("+447700900123"), "'+447700900123");
    assert.equal(csvField("@handle"), "'@handle");
  });

  it("null/empty → empty field", () => {
    assert.equal(csvField(null), "");
    assert.equal(csvField(""), "");
  });
});

describe("buildFansCsv", () => {
  const row: FanCsvRow = {
    email: "ana@example.com",
    phone: "+447700900123",
    ig: "anafan",
    tt: null,
    country: "GB",
    region: "ENG",
    marketingConsentAt: "2026-07-01T10:00:00Z",
    waOptInAt: null,
    signupAt: "2026-07-01T10:00:00.000Z",
    pageSlug: "jackies-mallorca",
    pageTitle: "Jackies, Mallorca",
  };

  it("byte-exact output (header + escaping + CRLF)", () => {
    assert.equal(
      buildFansCsv([row]),
      "email,phone,ig,tt,country,region,consent,wa_opt_in,signup_at,page_slug,page_title\r\n" +
        "ana@example.com,'+447700900123,anafan,,GB,ENG,yes,no," +
        '2026-07-01T10:00:00.000Z,jackies-mallorca,"Jackies, Mallorca"\r\n',
    );
  });

  it("empty rows → header only", () => {
    assert.equal(
      buildFansCsv([]),
      "email,phone,ig,tt,country,region,consent,wa_opt_in,signup_at,page_slug,page_title\r\n",
    );
  });
});

describe("fansCsvFilename", () => {
  it("client slug + UTC day", () => {
    assert.equal(
      fansCsvFilename("gmc-worldwide-productions", new Date("2026-07-05T01:30:00Z")),
      "gmc-worldwide-productions-fans-2026-07-05.csv",
    );
  });
});
