/**
 * The network rule: the only requests the MCP sends are graph-reads' GETs
 * (the location search, the interest search and the account's page list).
 * The real lib/mcp/graph-reads.ts runs behind a fetch spy that fails on any
 * other URL and on any method but GET, while every draft tool runs a
 * campaign build through it; the global fetch is spied too and must stay
 * untouched (no Graph client, no other call).
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { listPromotePages, searchInterests, searchLocations, type FetchLike } from "../graph-reads.ts";
import type { McpDraftDeps, McpTool, ToolContext } from "../tool-types.ts";
import { DRAFT_TOOLS } from "../tools/index.ts";
import { D_DRAFT, EL_PAGE, NX_ACCOUNT, draftCtx, fakeDraftDeps, newSpies, readRow } from "./draft-fixtures.ts";

const TOKEN = "EAAtest-token-never-logged";
const V = "v21.0";

let globalCalls: string[] = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalCalls = [];
  globalThis.fetch = (async (input: unknown) => {
    globalCalls.push(String(input));
    throw new Error("global fetch is off");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  assert.deepEqual(globalCalls, [], "nothing reaches the global fetch (no Graph client, no other call)");
});

interface Sent {
  method: string;
  path: string;
  params: Record<string, string>;
}

/** A Graph stand-in: answers the three GETs, fails the test on anything else. */
function spyGraph(sent: Sent[]): FetchLike {
  return async (raw, init) => {
    const url = new URL(raw);
    const params = Object.fromEntries(url.searchParams.entries());
    sent.push({ method: init.method, path: url.pathname, params });
    assert.equal(init.method, "GET", `only GETs leave the process (${url.pathname})`);
    assert.equal(url.origin, "https://graph.facebook.com");
    assert.equal(params.access_token, TOKEN);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.pathname === `/${V}/search` && params.type === "adinterest") {
      return ok({ data: params.q === "Tech house" ? [{ id: "6003000000001", name: "Tech house", audience_size: 9_000_000, path: ["Interests", "Tech house"] }] : [] });
    }
    if (url.pathname === `/${V}/search` && params.type === "adgeolocation") {
      return ok({ data: [{ key: "2513419", name: "Manchester", type: "city", country_code: "GB", country_name: "United Kingdom", region: "England" }] });
    }
    if (url.pathname === `/${V}/${NX_ACCOUNT}/promote_pages`) {
      if (!params.after) return ok({ data: [{ id: "100064000000001", name: "NX Newcastle" }], paging: { cursors: { after: "c2" }, next: "https://graph.facebook.com/next" } });
      return ok({ data: [{ id: EL_PAGE, name: "Electric Studios", instagram_business_account: { id: "17841400000000077" } }], paging: { cursors: { after: "c3" } } });
    }
    assert.fail(`unexpected request ${init.method} ${url.pathname}?type=${params.type ?? ""}`);
  };
}

/** The real deps' three reads (draft-deps.ts), through the spy instead of the global fetch. */
function depsThrough(sent: Sent[]): McpDraftDeps {
  const f = spyGraph(sent);
  return {
    ...fakeDraftDeps(newSpies()),
    geoSearch: ({ query, types }) => searchLocations(f, V, TOKEN, query, types),
    interestSearch: ({ query }) => searchInterests(f, V, TOKEN, query),
    pagesForAccount: ({ adAccountId }) => listPromotePages(f, V, TOKEN, adAccountId),
  };
}

test("graph-reads: each read is one GET of its own, cursors followed on the page list, the token never in an error", async () => {
  const sent: Sent[] = [];
  const f = spyGraph(sent);
  assert.deepEqual((await searchInterests(f, V, TOKEN, "Tech house")).hits.map((h) => h.id), ["6003000000001"]);
  assert.equal((await searchLocations(f, V, TOKEN, "Manchester", ["city"])).hits[0]!.key, "2513419");
  const pages = await listPromotePages(f, V, TOKEN, NX_ACCOUNT);
  assert.deepEqual(pages.pages.map((p) => [p.id, p.instagramId]), [["100064000000001", null], [EL_PAGE, "17841400000000077"]]);
  assert.equal(pages.metaGets, 2);
  assert.deepEqual(sent.map((s) => `${s.method} ${s.path} ${s.params.type ?? s.params.after ?? ""}`), [
    `GET /${V}/search adinterest`,
    `GET /${V}/search adgeolocation`,
    `GET /${V}/${NX_ACCOUNT}/promote_pages `,
    `GET /${V}/${NX_ACCOUNT}/promote_pages c2`,
  ]);
  const failing: FetchLike = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: `bad token ${TOKEN}` } }) });
  await assert.rejects(searchInterests(failing, V, TOKEN, "x"), (e: Error) => !e.message.includes(TOKEN) && /graph \/search 400/.test(e.message));
});

test("a whole build through every draft tool sends only graph-reads' GETs: interest search, page list, location search", async () => {
  const sent: Sent[] = [];
  const { ctx, db } = draftCtx({ draft: depsThrough(sent) });
  const step = async (tool: McpTool, args: Record<string, unknown>) => {
    const updated_at = String((await readRow(db, D_DRAFT))!.updated_at);
    return tool.run(ctx as ToolContext, { draft_id: D_DRAFT, updated_at, ...args });
  };
  const byName = (n: string) => DRAFT_TOOLS.find((t) => t.name === n)!;
  await step(byName("set_draft_objective"), { objective: "registration" });
  await step(byName("set_draft_identity"), { page_id: EL_PAGE });
  await step(byName("set_draft_audiences"), { changes: [{ add_interests: { new_group_name: "Tech house", interests: [{ search: "Tech house" }] } }] });
  await step(byName("set_draft_locations"), { add: [{ search: "Manchester", city_key: "2513419" }, { preset: "leeds" }], add_to_every_ad_set: true });
  await step(byName("set_draft_ad_sets"), { changes: [{ add_broad: {}, budget_per_day: 15 }], assign_all: true });
  await step(byName("set_draft_copy"), { primary_texts: ["Tech house at Electric."], cta: "sign_up" });
  await step(byName("set_draft_schedule"), { start: "2026-12-01", end: "2026-12-14" });
  await step(byName("set_draft_link"), { url: "https://crqln.com/l/glitterbox-newcastle" });
  await step(byName("set_draft_budget"), { type: "daily", amount_gbp: 60, start: "2026-12-01", end: "2026-12-14" });
  await step(byName("apply_audience_template"), { template: "Techno" }).catch(() => undefined);
  await step(byName("remove_draft_creatives"), { creative_ids: ["cr-2"] });
  await byName("duplicate_draft").run(ctx as ToolContext, { draft_id: D_DRAFT });
  await step(byName("archive_draft"), {});
  for (const s of sent) assert.equal(s.method, "GET");
  assert.deepEqual([...new Set(sent.map((s) => `${s.path}${s.params.type ? `?type=${s.params.type}` : ""}`))].sort(), [
    `/${V}/${NX_ACCOUNT}/promote_pages`,
    `/${V}/search?type=adgeolocation`,
    `/${V}/search?type=adinterest`,
  ]);
  // The app database is the only thing written: drafts (and the template read).
  assert.deepEqual([...new Set(db.writes.map((w) => w.table))], ["campaign_drafts"]);
});
