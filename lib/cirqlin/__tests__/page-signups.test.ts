import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyPageResponse, fallsBackToTag, fetchCirqlinSignupsByPage, pageSnapshotRows } from "../page-signups.ts";
import { syncCirqlinSignupsForEventByPage } from "../sync.ts";

const PAGE = "00000000-0000-4000-8000-000000000001";
const payload = { page_id: PAGE, daily_timezone: "Europe/London", days: [{ date: "2026-09-03", signups: 297 }, { date: "2026-09-04", signups: 107 }], total: 404 };

function respond(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

function fakeSb() {
  const upserts: { table: string; rows: unknown[] }[] = [];
  return {
    upserts,
    sb: {
      from(table: string) {
        return {
          upsert(rows: unknown) {
            upserts.push({ table, rows: Array.isArray(rows) ? rows : [rows] });
            return Promise.resolve({ error: null });
          },
        };
      },
    } as never,
  };
}

describe("CIRQLIN signups by page id (HN2)", () => {
  it("reads the contract's answers", () => {
    assert.deepEqual(classifyPageResponse(200, payload), { ok: true, payload });
    const r = (status: number, body: unknown) => {
      const out = classifyPageResponse(status, body);
      return out.ok ? "ok" : out.reason;
    };
    assert.equal(r(400, { error: "missing_tag" }), "unsupported");
    assert.equal(r(400, { error: "ambiguous_key" }), "ambiguous_key");
    assert.equal(r(400, { error: "bad_range" }), "bad_range");
    assert.equal(r(404, { error: "no_page" }), "no_page");
    assert.equal(r(401, {}), "unauthorized");
    assert.equal(r(429, {}), "rate_limited");
    assert.equal(r(200, { ok: true }), "error");
    assert.equal(fallsBackToTag("unsupported"), true);
    assert.equal(fallsBackToTag("rate_limited"), false);
    assert.equal(fallsBackToTag("unauthorized"), false);
  });

  it("sends page_id and the range, with the bearer", async () => {
    let seen = "";
    let auth = "";
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = url;
      auth = String((init?.headers as Record<string, string>).Authorization);
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await fetchCirqlinSignupsByPage(PAGE, { from: "2026-09-01", to: "2026-11-12", base: "https://cirqlin.test", secret: "s", fetchImpl });
    assert.ok(out.ok);
    assert.equal(seen, `https://cirqlin.test/api/partner/signups?page_id=${PAGE}&from=2026-09-01&to=2026-11-12`);
    assert.equal(auth, "Bearer s");
  });

  it("caches each day as a signup_source_snapshots row", () => {
    const rows = pageSnapshotRows("ev", payload, "2026-11-14T00:00:00Z");
    assert.deepEqual(rows.map((r) => [r.day, r.signups_day, r.signups_total, r.source]), [["2026-09-03", 297, 404, "cirqlin"], ["2026-09-04", 107, 404, "cirqlin"]]);
  });

  it("page first: writes the page's days and never calls the tag path", async () => {
    const { sb, upserts } = fakeSb();
    const out = await syncCirqlinSignupsForEventByPage(sb, { eventId: "ev", pageId: PAGE, tag: "CQ-schak-newcastle" }, { secret: "s", base: "https://cirqlin.test", fetchImpl: respond(200, payload) });
    assert.equal(out.ok, true);
    assert.equal(out.via, "page_id");
    assert.equal(out.counted, 404);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].rows.length, 2);
  });

  it("until the page endpoint ships (400 missing_tag), it falls back to the tag", async () => {
    const { sb } = fakeSb();
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return url.includes("page_id=")
        ? new Response(JSON.stringify({ error: "missing_tag" }), { status: 400 })
        : new Response(JSON.stringify({ ok: false, error: "no page for tag" }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await syncCirqlinSignupsForEventByPage(sb, { eventId: "ev", pageId: PAGE, tag: "CQ-dod-newcastle" }, { secret: "s", base: "https://cirqlin.test", fetchImpl });
    assert.equal(out.via, "tag");
    assert.equal(out.pageReason, "unsupported");
    assert.equal(calls.length, 2);
    assert.match(calls[1], /tag=CQ-dod-newcastle/);
  });

  it("a failed lookup with no tag writes nothing: never a 0", async () => {
    const { sb, upserts } = fakeSb();
    const out = await syncCirqlinSignupsForEventByPage(sb, { eventId: "ev", pageId: PAGE, tag: null }, { secret: "s", base: "https://cirqlin.test", fetchImpl: respond(400, { error: "missing_tag" }) });
    assert.equal(out.ok, false);
    assert.equal(out.via, null);
    assert.equal(upserts.length, 0);
  });

  it("a 429 doesn't spend a second call on the tag", async () => {
    const { sb, upserts } = fakeSb();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("{}", { status: 429 });
    }) as unknown as typeof fetch;
    const out = await syncCirqlinSignupsForEventByPage(sb, { eventId: "ev", pageId: PAGE, tag: "CQ-x" }, { secret: "s", base: "https://cirqlin.test", fetchImpl });
    assert.equal(out.ok, false);
    assert.equal(out.pageReason, "rate_limited");
    assert.equal(calls, 1);
    assert.equal(upserts.length, 0);
  });
});
