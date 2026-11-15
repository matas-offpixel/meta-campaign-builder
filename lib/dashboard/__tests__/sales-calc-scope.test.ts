/**
 * D11: the share computes on our server behind its token. These check the
 * loader reads one client's rows only, and that no cross-client source
 * (the learning tables, another client's library) is ever read.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { loadSalesCalcInput } from "../sales-calc/load.ts";

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const reads: { table: string; filters: [string, string, unknown][] }[] = [];
  const from = (table: string) => {
    const filters: [string, string, unknown][] = [];
    reads.push({ table, filters });
    const rows = () =>
      (tables[table] ?? []).filter((r) =>
        filters.every(([op, col, v]) => (op === "eq" ? r[col] === v : op === "in" ? (v as unknown[]).includes(r[col]) : true)),
      );
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => (filters.push(["eq", col, v]), q),
      in: (col: string, v: unknown[]) => (filters.push(["in", col, v]), q),
      gte: () => q,
      gt: () => q,
      lte: () => q,
      not: () => q,
      is: () => q,
      order: () => q,
      range: (a: number, b: number) => Promise.resolve({ data: rows().slice(a, b + 1), error: null }),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    };
    return q;
  };
  return { db: { from } as never, reads };
}

const events = [
  { id: "e1", user_id: "u", client_id: "mine", event_code: "M-1", name: "Mine", event_date: "2026-12-01", presale_at: null, general_sale_at: null, meta_campaign_id: "c1", meta_ad_account_id: "111", status: "on_sale", capacity: 100, is_umbrella: false, cirqlin_page_id: null },
  { id: "e2", user_id: "u", client_id: "other", event_code: "O-1", name: "Other", event_date: "2026-12-01", presale_at: null, general_sale_at: null, meta_campaign_id: "c2", meta_ad_account_id: "222", status: "on_sale", capacity: 100, is_umbrella: false, cirqlin_page_id: null },
];

describe("share scope (D11)", () => {
  it("reads only the token's client's events, rows and ad account, and no cross-client table", async () => {
    const { db, reads } = fakeDb({
      clients: [{ id: "mine", name: "Mine Ltd", meta_ad_account_id: "111" }],
      events,
      event_daily_rollups: [
        { id: "r1", event_id: "e1", date: "2026-11-10", ad_spend: 10 },
        { id: "r2", event_id: "e2", date: "2026-11-10", ad_spend: 99 },
      ],
      ad_daily_insights: [
        { id: "a1", ad_account_id: "act_111", meta_campaign_id: "c1", campaign_name: "[M-1]", date: "2026-11-10", spend: 5 },
        { id: "a2", ad_account_id: "act_222", meta_campaign_id: "c2", campaign_name: "[O-1] [M-1]", date: "2026-11-10", spend: 50 },
      ],
    });
    const input = await loadSalesCalcInput(db, "mine", { today: "2026-11-13" });
    assert.ok(input);
    assert.deepEqual(input.shows.map((s) => s.code), ["M-1"]);
    assert.deepEqual(input.rollups.map((r) => r.eventId), ["e1"]);
    assert.deepEqual(input.metaCampaignDays.map((r) => r.campaignId), ["c1"]);
    const tables = new Set(reads.map((r) => r.table));
    for (const t of ["tag_performance", "creative_scores", "client_funnel_benchmarks", "interest_clusters", "copy_performance", "copy_features"]) {
      assert.equal(tables.has(t), false, t);
    }
    const lib = reads.find((r) => r.table === "reference_lift_library");
    assert.deepEqual(lib?.filters, [["eq", "client_id", "mine"]]);
    for (const r of reads.filter((x) => x.table === "events")) {
      assert.ok(r.filters.some(([, col, v]) => (col === "client_id" && v === "mine") || (col === "id" && JSON.stringify(v) === '["e1"]')), JSON.stringify(r.filters));
    }
  });

  it("the share route resolves a client-scope token, strips internal lines, and never writes", () => {
    const server = readFileSync(new URL("../sales-calc/server.ts", import.meta.url), "utf8");
    const share = server.slice(server.indexOf("export async function loadShareSalesDashboard"));
    assert.match(share, /resolved\.share\.scope !== "client"/);
    assert.match(share, /loadSalesCalcInput\(createServiceRoleClient\(\), clientId\)/);
    assert.match(share, /salesForSurface\(build\.model, "share"\)/);
    assert.doesNotMatch(share, /storeLibraryEntries|upsert|insert/);
    assert.doesNotMatch(server, /lib\/learning|cross-client/);
    const page = readFileSync("app/share/client/[token]/sales/page.tsx", "utf8");
    assert.match(page, /surface="share"/);
    assert.doesNotMatch(page, /createClient|supabase/);
  });
});
