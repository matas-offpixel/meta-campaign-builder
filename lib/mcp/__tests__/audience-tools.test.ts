/**
 * M3c: list_audiences, audience_sources, create_audiences, request_page_access
 * and pending_access, on a fake database and spied deps (McpAudienceDeps is
 * the tools' only reach to Meta, so a spy that records nothing means nothing
 * was sent). Invented XMPL names only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fake-db.ts";
import { audienceSourcesTool, createAudiencesTool, listAudiencesTool } from "../tools/audiences.ts";
import { pendingAccessTool, requestPageAccessTool } from "../tools/page-access.ts";
import { AUD_WORDS } from "../audiences/words.ts";
import { MCP_WORDS } from "../meta/words.ts";
import { LIVE_ROWS } from "../live/words.ts";
import { ruleKey } from "../audiences/specs.ts";
import type { McpAudienceDeps, AccountAudience } from "../audiences/types.ts";
import type { McpTool, ToolContext } from "../tool-types.ts";

const MATAS = "b3ee4e5c-0000-4000-8000-000000000001";
const EV = "e0000000-0000-4000-8000-000000000001";
const CL = "c0000000-0000-4000-8000-000000000001";
const D1 = "d0000000-0000-4000-8000-000000000001";
const A1 = "a0000000-0000-4000-8000-000000000001";
const CODE = "XMPL26-SHOW";
const BM = "7770001";
const PROMO_PAGE = "5550001";
const PROMO_IG = "17840000001";
const ACT_PAGE = "5550002";
const PIXEL = "8880001";
const YES = { asked: "Make 2 audiences on XMPL26-SHOW's account, nothing spends. OK?", answer: "yes" };
const NOW = new Date("2026-11-26T12:00:00Z");

type Call = { method: string; input: unknown };

function tables(over: Record<string, Record<string, unknown>[]> = {}) {
  return {
    events: [
      { id: "e0000000-0000-4000-8000-000000000002", event_code: "XMPL26-OTHER", genre_family: "tech_house", client_id: CL, user_id: MATAS, name: "XMPL Other", event_date: "2027-01-01", client: { name: "XMPL Promoter" } },
      { id: EV, genre_family: "drum_and_bass", name: "XMPL Show", event_code: CODE, venue_name: null, venue_city: null, event_date: "2027-03-14", announcement_at: null, presale_at: null, general_sale_at: null, status: "on_sale", client_id: CL, meta_campaign_id: "9000001", client: { name: "XMPL Promoter" }, user_id: MATAS, meta_ad_account_id: "111111", venue_id: null, mailchimp_tag: null, ticket_url: "https://tix.example.com/e/1", signup_url: "https://xmpl-show.example.com" },
    ],
    clients: [{ id: CL, name: "XMPL Promoter", status: "active", user_id: MATAS, default_page_ids: [PROMO_PAGE] }],
    client_business_managers: [{ business_id: BM, business_name: "XMPL BM", client_id: CL }],
    campaign_drafts: [{ id: D1, event_id: EV, created_at: "2026-11-01T10:00:00Z", draft_json: { settings: { metaPageId: PROMO_PAGE }, creatives: [] } }],
    event_artists: [{ event_id: EV, artist_id: A1, billing_order: 1, is_headliner: true }, { event_id: "e0000000-0000-4000-8000-000000000002", artist_id: A1, billing_order: 1, is_headliner: true }, { event_id: "e0000000-0000-4000-8000-000000000003", artist_id: A1, billing_order: 1, is_headliner: true }],
    artists: [{ id: A1, name: "XMPL Act", meta_page_id: ACT_PAGE, meta_page_name: "XMPL Act", instagram_handle: "@xmplact" }],
    creative_lab_artists: [],
    ad_daily_insights: [{ meta_ad_id: "ad1", meta_adset_id: "as1", meta_campaign_id: "9000001", campaign_name: `[${CODE}] On sale`, date: "2026-11-25", spend: 40 }],
    meta_custom_audiences: [],
    meta_write_idempotency: [],
    venues: [],
    ...over,
  };
}

function spyDeps(over: Partial<McpAudienceDeps> & { accessible?: string[]; existing?: AccountAudience[] } = {}) {
  const calls: Call[] = [];
  const rec = <T>(method: string, input: unknown, out: T): T => {
    calls.push({ method, input });
    return out;
  };
  let made = 0;
  const accessible = new Set(over.accessible ?? [PROMO_PAGE]);
  const deps: McpAudienceDeps = {
    audienceWrites: () => true,
    listAudiences: async (_u, a) => rec("listAudiences", a, { audiences: over.existing ?? [], metaGets: 1, complete: true }),
    promotePages: async (_u, a) => rec("promotePages", a, { pages: [{ id: PROMO_PAGE, name: "XMPL Promoter", igId: PROMO_IG, igUsername: "xmplpromoter" }, { id: "5559999", name: "XMPL Other", igId: null, igUsername: null }], metaGets: 1 }),
    pageAccess: async (_u, ids, b) => rec("pageAccess", { ids, b }, { accessible: ids.filter((id) => accessible.has(id)), names: {}, metaGets: 1 }),
    adSetPixels: async (_u, ids) => rec("adSetPixels", ids, { pixels: new Map(ids.map((id) => [id, PIXEL])), metaGets: 1 }),
    pixelEvents: async (_u, p) => rec("pixelEvents", p, { name: "XMPL Pixel", events: { Purchase: 12, InitiateCheckout: 40, CompleteRegistration: 0 }, metaGets: 3 }),
    pageLinks: async (t) => rec("pageLinks", t, null),
    showVideos: async (_u, a, c) => rec("showVideos", { a, c }, [{ contextId: PROMO_PAGE, videoIds: ["600000001", "600000002"] }]),
    createAudience: async (input) => {
      made += 1;
      return rec("createAudience", input, { rowId: `row${made}`, metaAudienceId: `12000000000${made}`, reused: false, failed: false });
    },
    accountBusiness: async (_u, a) => rec("accountBusiness", a, { id: BM, name: "XMPL BM" }),
    tokenPermissions: async (u) => rec("tokenPermissions", u, new Set(["pages_manage_metadata", "pages_show_list", "business_management"])),
    businessRole: async (_u, b) => rec("businessRole", b, "ADMIN"),
    businessPages: async (_u, b) => rec("businessPages", b, new Set<string>()),
    pendingPages: async (_u, b) => rec("pendingPages", b, []),
    businessAssets: async (_u, b) => rec("businessAssets", b, { pages: [{ id: PROMO_PAGE, name: "XMPL Promoter", reach: "owned" as const }, { id: ACT_PAGE, name: "XMPL Act", reach: "client_shared" as const }], instagram: [{ id: PROMO_IG, name: "xmplpromoter", reach: "owned" as const }, { id: "17840000009", name: "xmplact", reach: "client_shared" as const }] }),
    requestPage: async (input) => {
      rec("requestPage", input, undefined);
    },
    ...over,
  };
  return { deps, calls };
}

function ctxOf(deps: McpAudienceDeps, opts: { tables?: Record<string, Record<string, unknown>[]>; liveShipped?: boolean; scope?: string; isMatas?: boolean } = {}) {
  const db = fakeDb(tables(opts.tables));
  const ctx: ToolContext = { db, readers: {} as never, userId: MATAS, scope: opts.scope ?? "mcp:read mcp:draft mcp:meta", isMatas: opts.isMatas ?? true, liveShipped: opts.liveShipped ?? true, seesClientNames: true, today: "2026-11-26", now: NOW, audiences: deps };
  return { ctx, db };
}

const run = (tool: McpTool, ctx: ToolContext, args: Record<string, unknown>) => tool.run(ctx, args) as Promise<{ data: Record<string, unknown>; summary: Record<string, unknown> }>;
async function refused(p: Promise<unknown>, re: RegExp | string) {
  await assert.rejects(p, (e: Error) => {
    if (typeof re === "string") assert.equal(e.message, re);
    else assert.match(e.message, re);
    return true;
  });
}
const sent = (calls: Call[], method: string) => calls.filter((c) => c.method === method);
const WRITES = ["createAudience", "requestPage"];
const noWrites = (calls: Call[]) => assert.deepEqual(calls.filter((c) => WRITES.includes(c.method)), []);

// ── scope, approval, switches ───────────────────────────────────────────────

test("every M3c tool needs mcp:meta and Matas; the reads too", async () => {
  for (const opts of [{ scope: "mcp:read mcp:draft" }, { isMatas: false }]) {
    for (const [tool, args] of [
      [listAudiencesTool, { event: CODE }],
      [audienceSourcesTool, { event: CODE }],
      [pendingAccessTool, { client: "XMPL Promoter" }],
      [createAudiencesTool, { event: CODE, specs: [{ kind: "page_engagers", page_id: PROMO_PAGE, retention_days: 30 }], approval: YES }],
      [requestPageAccessTool, { event: CODE, page_ids: [ACT_PAGE], approval: YES }],
    ] as Array<[McpTool, Record<string, unknown>]>) {
      const { deps, calls } = spyDeps();
      await refused(run(tool, ctxOf(deps, opts).ctx, args), MCP_WORDS.refusedScope);
      assert.deepEqual(calls, [], tool.name);
    }
  }
});

test("create_audiences and request_page_access refuse without approval, and send nothing", async () => {
  for (const approval of [undefined, { asked: "", answer: "yes" }, { asked: "q", answer: " " }]) {
    const a = spyDeps();
    await refused(run(createAudiencesTool, ctxOf(a.deps).ctx, { event: CODE, specs: [{ kind: "page_engagers", page_id: PROMO_PAGE, retention_days: 30 }], approval }), MCP_WORDS.refusedNoApproval);
    assert.deepEqual(a.calls, []);
    const b = spyDeps();
    await refused(run(requestPageAccessTool, ctxOf(b.deps).ctx, { event: CODE, page_ids: [ACT_PAGE], approval }), MCP_WORDS.refusedNoApproval);
    assert.deepEqual(b.calls, []);
  }
});

test("both writes are switched off with M3b until Today lists connector changes; create_audiences also keeps the builder's switch", async () => {
  const a = spyDeps();
  await refused(run(createAudiencesTool, ctxOf(a.deps, { liveShipped: false }).ctx, { event: CODE, specs: [{ kind: "page_engagers", page_id: PROMO_PAGE, retention_days: 30 }], approval: YES }), LIVE_ROWS.refusedSwitch);
  assert.deepEqual(a.calls, []);
  const b = spyDeps();
  await refused(run(requestPageAccessTool, ctxOf(b.deps, { liveShipped: false }).ctx, { event: CODE, page_ids: [ACT_PAGE], approval: YES }), LIVE_ROWS.refusedSwitch);
  assert.deepEqual(b.calls, []);
  const c = spyDeps({ audienceWrites: () => false });
  await refused(run(createAudiencesTool, ctxOf(c.deps).ctx, { event: CODE, specs: [{ kind: "page_engagers", page_id: PROMO_PAGE, retention_days: 30 }], approval: YES }), LIVE_ROWS.refusedSwitch);
  assert.deepEqual(c.calls, []);
});

// ── create_audiences ────────────────────────────────────────────────────────

test("create_audiences: each spec through the Audience Builder, filed on the event and client, named {code} · {source} · {n} days", async () => {
  const { deps, calls } = spyDeps();
  const out = await run(createAudiencesTool, ctxOf(deps).ctx, {
    event: CODE,
    approval: YES,
    specs: [
      { kind: "pixel_visitors", url_contains: ["https://tix.example.com/e/1"], retention_days: 30 },
      { kind: "pixel_event", event: "InitiateCheckout", url_contains: ["tix.example.com/e/1"], retention_days: 14 },
      { kind: "page_engagers", page_id: PROMO_PAGE, retention_days: 90 },
      { kind: "page_followers", page_id: PROMO_PAGE },
      { kind: "ig_followers", ig_id: PROMO_IG },
      { kind: "ig_engagers", ig_id: PROMO_IG, retention_days: 180 },
      { kind: "video_viewers", page_id: PROMO_PAGE, threshold: 95, retention_days: 365 },
    ],
  });
  const made = sent(calls, "createAudience").map((c) => (c.input as { insert: Record<string, unknown> }).insert);
  assert.deepEqual(made.map((m) => m.name), [
    `${CODE} · Visitors tix.example.com/e/1 · 30 days`,
    `${CODE} · Checkout starters tix.example.com/e/1 · 14 days`,
    `${CODE} · XMPL Promoter Page engagers · 90 days`,
    `${CODE} · XMPL Promoter Page followers · all time`,
    `${CODE} · @xmplpromoter followers · all time`,
    `${CODE} · @xmplpromoter engagers · 180 days`,
    `${CODE} · XMPL Promoter video 95 % · 365 days`,
  ]);
  for (const m of made) {
    assert.equal(m.eventId, EV);
    assert.equal(m.clientId, CL);
    assert.equal(m.userId, MATAS);
    assert.equal(m.metaAdAccountId, "act_111111");
  }
  assert.deepEqual(made.map((m) => m.audienceSubtype), ["website_pixel", "website_pixel", "page_engagement_fb", "page_followers_fb", "page_followers_ig", "page_engagement_ig", "video_views"]);
  assert.deepEqual(made[1]!.sourceMeta, { subtype: "website_pixel", pixelEvent: "InitiateCheckout", urlContains: ["tix.example.com/e/1"] });
  assert.equal(made[0]!.sourceId, PIXEL);
  // Followers are stored at the table's 365 and sent to Meta at 0 (the builder's rule).
  assert.equal(made[3]!.retentionDays, 365);
  assert.deepEqual(made[6]!.sourceMeta, { subtype: "video_views", threshold: 95, videoIds: ["600000001", "600000002"], contextId: PROMO_PAGE });
  assert.equal(out.data.message, "Done: 7 made, 0 already on the account, 0 not made. Nothing spends until an ad set uses them.");
  assert.equal(sent(calls, "requestPage").length, 0);
});

test("create_audiences: an app row with the same rule is used as it is, and one rule asked twice is made once", async () => {
  const insert = { audienceSubtype: "page_engagement_fb", retentionDays: 90, sourceId: PROMO_PAGE, sourceMeta: { subtype: "page_engagement_fb", pageIds: [PROMO_PAGE] }, name: "older name" };
  assert.ok(ruleKey(insert as never));
  const { deps, calls } = spyDeps();
  const out = await run(createAudiencesTool, ctxOf(deps, { tables: { meta_custom_audiences: [{ id: "r1", name: "XMPL older", audience_subtype: "page_engagement_fb", retention_days: 90, source_id: PROMO_PAGE, source_meta: { subtype: "page_engagement_fb", pageIds: [PROMO_PAGE] }, meta_audience_id: "120099", meta_ad_account_id: "act_111111", status: "ready" }] } }).ctx, {
    event: CODE,
    approval: YES,
    specs: [
      { kind: "page_engagers", page_id: PROMO_PAGE, retention_days: 90 },
      { kind: "pixel_visitors", url_contains: ["tix.example.com/e/1"], retention_days: 30 },
      { kind: "pixel_visitors", url_contains: ["https://tix.example.com/e/1"], retention_days: 30 },
    ],
  });
  assert.equal(sent(calls, "createAudience").length, 1, "the reused one and the repeat make nothing");
  assert.match(String((out.data.lines as string[])[0]), /^Already on the account: XMPL older \(120099\), used as it is\.$/);
  assert.equal(out.data.message, "Done: 1 made, 1 already on the account, 0 not made. Nothing spends until an ad set uses them.");
});

test("create_audiences: the builder's own reuse of a rule on Meta is reported as already there", async () => {
  const { deps, calls } = spyDeps({ createAudience: async () => ({ rowId: "r", metaAudienceId: "120777", reused: true, failed: false }) });
  const out = await run(createAudiencesTool, ctxOf(deps).ctx, { event: CODE, approval: YES, specs: [{ kind: "page_engagers", page_id: PROMO_PAGE, retention_days: 30 }] });
  assert.equal(sent(calls, "createAudience").length, 0); // the override doesn't record
  assert.equal(out.data.message, "Done: 0 made, 1 already on the account, 0 not made. Nothing spends until an ad set uses them.");
});

test("create_audiences: a source without access, or any spec that can't be built, refuses the call and makes nothing", async () => {
  const { deps, calls } = spyDeps();
  await refused(
    run(createAudiencesTool, ctxOf(deps).ctx, {
      event: CODE,
      approval: YES,
      specs: [
        { kind: "page_engagers", page_id: PROMO_PAGE, retention_days: 30 },
        { kind: "page_followers", page_id: ACT_PAGE },
        { kind: "page_engagers", page_id: "5550404", retention_days: 30 },
        { kind: "pixel_visitors", url_contains: [], retention_days: 30 },
        { kind: "pixel_visitors", url_contains: ["tix.example.com"], retention_days: 200 },
        { kind: "video_viewers", page_id: PROMO_PAGE, threshold: 50, retention_days: 30 },
      ],
    }),
    (msg => new RegExp(`^${msg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\nSpec 2: XMPL Act needs advertiser access first: ask with request_page_access\\.\\nSpec 3: 5550404 isn’t one of the Pages`))(AUD_WORDS.refusedSpecs(5)),
  );
  noWrites(calls);
});

test("create_audiences: 1 to 30 specs", async () => {
  for (const specs of [[], Array.from({ length: 31 }, () => ({ kind: "page_engagers", page_id: PROMO_PAGE, retention_days: 30 }))]) {
    const { deps, calls } = spyDeps();
    await refused(run(createAudiencesTool, ctxOf(deps).ctx, { event: CODE, approval: YES, specs }), AUD_WORDS.noSpecs);
    assert.deepEqual(calls, []);
  }
});

test("create_audiences: a failed create is said by name, never Meta's error", async () => {
  const { deps } = spyDeps({ createAudience: async () => { throw new Error("(#2654) secret Meta words"); } });
  // Nothing made: a refusal Today logs as "Failed · Meta didn’t take it, so nothing changed".
  await assert.rejects(run(createAudiencesTool, ctxOf(deps).ctx, { event: CODE, approval: YES, specs: [{ kind: "page_engagers", page_id: PROMO_PAGE, retention_days: 30 }] }), (e: Error & { summary?: Record<string, unknown> }) => {
    assert.doesNotMatch(e.message, /2654|secret/);
    assert.equal(e.message.split("\n")[0], "Done: 0 made, 0 already on the account, 1 not made. Nothing spends until an ad set uses them.");
    assert.equal(e.summary?.refused, "meta_failed");
    return true;
  });
});

// ── reads ───────────────────────────────────────────────────────────────────

test("audience_sources: the pixel, links, Pages and Instagram with access, followers, and the artist's next step from the client's BM", async () => {
  const { deps, calls } = spyDeps({ existing: [{ id: "120555", name: "XMPL Promoter FB Likes", subtype: "ENGAGEMENT", retentionDays: 0, lower: 1000, upper: 2000, delivery: "ready", operation: null, rule: `{"inclusions":{"rules":[{"event_sources":[{"type":"page","id":"${PROMO_PAGE}"}],"retention_seconds":0,"filter":{"filters":[{"field":"event","operator":"eq","value":"page_liked"}]}}]}}` }] });
  const out = await run(audienceSourcesTool, ctxOf(deps).ctx, { event: CODE });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = out.data as Record<string, any>;
  assert.equal(d.pixelLine, "Pixel XMPL Pixel (8880001): 100 % of the last 14 days’ spend. In 28 days it had Purchase yes, InitiateCheckout yes, CompleteRegistration no.");
  assert.deepEqual(d.links.map((l: { rule: string }) => l.rule), ["tix.example.com/e/1", "xmpl-show.example.com"]);
  assert.equal(d.clientBusinessManager.id, BM);
  const promo = d.pages.find((p: { id: string }) => p.id === PROMO_PAGE);
  assert.equal(promo.status, "accessible");
  assert.equal(promo.followers, "Page followers (XMPL Promoter, all time): already on the account as XMPL Promoter FB Likes (120555).");
  const act = d.pages.find((p: { id: string }) => p.id === ACT_PAGE);
  assert.equal(act.status, "needs advertiser access");
  assert.equal(act.followers, "Page followers (XMPL Act, all time): not offered until XMPL Act gives advertiser access.");
  assert.deepEqual(act.next.page_ids, [ACT_PAGE]);
  assert.equal(act.next.line, `Ask for access with request_page_access (Page ${ACT_PAGE}, from XMPL BM). It goes to XMPL Act’s Page admins to approve.`);
  assert.equal(act.next.email.subject, "Access request for XMPL Act’s Facebook Page, for XMPL Show");
  const ig = d.instagram.find((i: { id: string }) => i.id === PROMO_IG);
  assert.equal(ig.followers, "Instagram followers (@xmplpromoter, all time): offered.");
  const actIg = d.instagram.find((i: { username: string }) => i.username === "xmplact");
  assert.equal(actIg.manual, "In Business Suite for XMPL BM, request access to @xmplact under Settings › Accounts › Instagram accounts.");
  assert.equal(actIg.followers, "Instagram followers (@xmplact, all time): not offered, because it isn’t linked to a Page this ad account can use.");
  assert.match(act.next.email.body, /With it, XMPL BM can run ads as the Page and see how they do; it can’t post to the Page, message from it or change it\./);
  // No raw Meta event name reaches Claude.
  assert.doesNotMatch(JSON.stringify(out.data), /page_liked|INSTAGRAM_PROFILE_FOLLOW/);
  // The ad account's other Pages are counted, not listed.
  assert.ok(d.notes.includes("The ad account can also run from 1 other Page outside the promoter’s and this lineup’s; they aren’t listed."));
  // Access is checked against the client's Business Manager.
  assert.deepEqual((sent(calls, "pageAccess")[0]!.input as { b: string }).b, BM);
  noWrites(calls);
});

test("list_audiences: names, subtypes, retention, size band and delivery; which ones the app made", async () => {
  const { deps, calls } = spyDeps({ existing: [
    { id: "120001", name: "XMPL Pixel 30d", subtype: "WEBSITE", retentionDays: 30, lower: 12000, upper: 14000, delivery: "This audience is ready for use.", operation: null, rule: null },
    { id: "120002", name: "XMPL Likes", subtype: "ENGAGEMENT", retentionDays: 0, lower: 1000, upper: 1000, delivery: "too small", operation: null, rule: null },
  ] });
  const out = await run(listAudiencesTool, ctxOf(deps, { tables: { meta_custom_audiences: [{ id: "r", meta_audience_id: "120001", event_id: EV, status: "ready", meta_ad_account_id: "act_111111" }] } }).ctx, { event: CODE });
  assert.equal(out.data.message, "act_111111: 2 audiences on the account, 1 of them made in Off/Pixel.");
  assert.deepEqual(out.data.audiences, [
    { id: "120001", name: "XMPL Pixel 30d", subtype: "WEBSITE", retention: "30 days", size: "12,000–14,000 people", delivery: "This audience is ready for use.", madeInOffPixel: true },
    { id: "120002", name: "XMPL Likes", subtype: "ENGAGEMENT", retention: "all time", size: "under 1,000 people", delivery: "too small", madeInOffPixel: false },
  ]);
  noWrites(calls);
  const other = spyDeps();
  await refused(run(listAudiencesTool, ctxOf(other.deps).ctx, { ad_account: "act_999999" }), AUD_WORDS.accountNotYours("act_999999"));
  assert.deepEqual(other.calls, []);
});

// ── request_page_access ─────────────────────────────────────────────────────

const ask = (over: Record<string, unknown> = {}) => ({ event: CODE, page_ids: [ACT_PAGE], approval: YES, ...over });

test("request_page_access: from the client's own Business Manager, as Matas, ADVERTISE + ANALYZE, logged against the event's oldest draft", async () => {
  const { deps, calls } = spyDeps();
  const out = await run(requestPageAccessTool, ctxOf(deps).ctx, ask());
  const req = sent(calls, "requestPage");
  assert.equal(req.length, 1);
  const input = req[0]!.input as Record<string, unknown>;
  assert.equal(input.businessId, BM);
  assert.ok(!["944651277948334", "237857750137825"].includes(String(input.businessId)));
  assert.equal(input.pageId, ACT_PAGE);
  assert.deepEqual(input.tasks, ["ADVERTISE", "ANALYZE"]);
  assert.deepEqual(input.ledger, { draftId: D1, eventId: EV });
  assert.equal(out.data.message, "Done: 1 request sent from XMPL BM, 4 of today’s 5 left. Once approved, the Page is assigned to you in XMPL BM, so its audiences and identities work through the client’s Business Manager.");
  assert.deepEqual(out.data.lines, [`Asked XMPL Act (${ACT_PAGE}) for Advertise and Analyse access from XMPL BM. Its admins approve it in Business Suite; the request is open until they do.`]);
});

test("request_page_access: every refusal sends nothing", async () => {
  const cases: Array<[string, Parameters<typeof spyDeps>[0], Parameters<typeof ctxOf>[1], Record<string, unknown>, RegExp | string]> = [
    ["no BM linked", {}, { tables: { client_business_managers: [] } }, ask(), AUD_WORDS.noBusiness("XMPL Promoter")],
    ["Off/Pixel's BM 944651277948334 linked", {}, { tables: { client_business_managers: [{ business_id: "944651277948334", business_name: "Off / Pixel", client_id: CL }] } }, ask(), AUD_WORDS.offPixelBusiness],
    ["Off/Pixel's BM 237857750137825 linked", {}, { tables: { client_business_managers: [{ business_id: "237857750137825", business_name: "Off/Pixel", client_id: CL }] } }, ask(), AUD_WORDS.offPixelBusiness],
    ["Off/Pixel's BM 237857750137825 owns the account among two linked", { accountBusiness: async () => ({ id: "237857750137825", name: "Off/Pixel" }) }, { tables: { client_business_managers: [{ business_id: BM, business_name: "XMPL BM", client_id: CL }, { business_id: "237857750137825", business_name: "Off/Pixel", client_id: CL }] } }, ask(), AUD_WORDS.offPixelBusiness],
    ["two BMs, neither owns the account", { accountBusiness: async () => ({ id: "1234567", name: "Elsewhere" }) }, { tables: { client_business_managers: [{ business_id: BM, business_name: "XMPL BM", client_id: CL }, { business_id: "7770002", business_name: "XMPL BM 2", client_id: CL }] } }, ask(), AUD_WORDS.manyBusinesses("XMPL Promoter", 2)],
    ["no pages_manage_metadata", { tokenPermissions: async () => new Set(["pages_show_list"]) }, {}, ask(), "Reconnect Facebook in Off/Pixel to allow access requests."],
    ["no Facebook token", { tokenPermissions: async () => null }, {}, ask(), AUD_WORDS.noToken],
    ["not an admin", { businessRole: async () => "EMPLOYEE" }, {}, ask(), AUD_WORDS.notAdmin("XMPL BM")],
    ["already shared", { businessPages: async () => new Set([ACT_PAGE]) }, {}, ask(), AUD_WORDS.alreadyShared([ACT_PAGE], "XMPL BM")],
    ["already asked", { pendingPages: async () => [{ id: ACT_PAGE, pageId: ACT_PAGE, pageName: null }] }, {}, ask(), AUD_WORDS.alreadyPending([ACT_PAGE], "XMPL BM")],
    ["no draft to log against", {}, { tables: { campaign_drafts: [] } }, ask(), AUD_WORDS.noDraft(CODE)],
    ["six Pages", {}, {}, ask({ page_ids: ["5550010", "5550011", "5550012", "5550013", "5550014", "5550015"] }), AUD_WORDS.badPages],
    ["a task Meta doesn't take", {}, {}, ask({ tasks: ["ADVERTISE", "FULL_CONTROL"] }), AUD_WORDS.badTasks],
  ];
  for (const [label, depsOver, ctxOver, args, msg] of cases) {
    const { deps, calls } = spyDeps(depsOver);
    await refused(run(requestPageAccessTool, ctxOf(deps, ctxOver).ctx, args), msg);
    assert.deepEqual(sent(calls, "requestPage"), [], label);
  }
});

test("request_page_access: at most 5 a day from one Business Manager, counted over 24 hours on the ledger; failed requests and older ones don't count", async () => {
  const row = (i: number, at: string, status = "success") => ({ id: `l${i}`, event_id: EV, draft_id: D1, op_kind: "page_access_request", op_status: status, created_at: at });
  const recent = "2026-11-26T09:00:00Z";
  // 4 sent today: asking 2 more is over.
  const four = [row(1, recent), row(2, recent), row(3, recent), row(4, "2026-11-25T13:00:00Z")];
  const a = spyDeps();
  await refused(run(requestPageAccessTool, ctxOf(a.deps, { tables: { meta_write_idempotency: four } }).ctx, ask({ page_ids: [ACT_PAGE, "5550003"] })), AUD_WORDS.overCap("XMPL BM", 4, 2));
  assert.deepEqual(sent(a.calls, "requestPage"), []);
  assert.equal(AUD_WORDS.overCap("XMPL BM", 4, 2), "Refused: XMPL BM has sent 4 of its 5 access requests in the last 24 hours, so 2 more would go over. Meta locks a Business Manager whose requests are reported. Nothing was sent to Meta.");
  // 3 today, one failed, one 25 hours ago, another op kind: 2 more is fine.
  const three = [row(1, recent), row(2, recent), row(3, recent), row(4, recent, "failed"), row(5, "2026-11-25T11:00:00Z"), { ...row(6, recent), op_kind: "object_name_update" }];
  const b = spyDeps();
  const out = await run(requestPageAccessTool, ctxOf(b.deps, { tables: { meta_write_idempotency: three } }).ctx, ask({ page_ids: [ACT_PAGE, "5550003"] }));
  assert.equal(sent(b.calls, "requestPage").length, 2);
  assert.match(String(out.data.message), /^Done: 2 requests sent from XMPL BM, 0 of today’s 5 left\./);
});

test("pending_access: the client's Business Manager's open requests", async () => {
  const { deps, calls } = spyDeps({ pendingPages: async () => [{ id: "5550020", pageId: "5550020", pageName: null }] });
  const out = await run(pendingAccessTool, ctxOf(deps).ctx, { client: "xmpl promoter" });
  assert.equal(out.data.message, "XMPL BM has 1 request waiting on the Page’s admins.");
  noWrites(calls);
  const none = spyDeps();
  const empty = await run(pendingAccessTool, ctxOf(none.deps).ctx, { client: CL });
  assert.equal(empty.data.message, "Nothing is waiting: XMPL BM has no open Page access requests.");
});

test("count words: 1 and n", () => {
  assert.equal(AUD_WORDS.listed("act_1", 1, 0), "act_1: 1 audience on the account, 0 of them made in Off/Pixel.");
  assert.equal(AUD_WORDS.refusedSpecs(1), "Refused: 1 spec can’t be built, so none were made. Nothing was sent to Meta.");
  assert.equal(AUD_WORDS.sentDone(1, "B", 4).startsWith("Done: 1 request sent from B, 4 of today’s 5 left."), true);
  assert.equal(AUD_WORDS.alreadyShared(["1", "2"], "B"), "Refused: 1, 2 are already shared with B. Nothing was sent to Meta.");
  assert.equal(AUD_WORDS.overCap("B", 5, 1), "Refused: B has sent 5 of its 5 access requests in the last 24 hours, so 1 more would go over. Meta locks a Business Manager whose requests are reported. Nothing was sent to Meta.");
  assert.equal(AUD_WORDS.otherPages(1), "The ad account can also run from 1 other Page outside the promoter’s and this lineup’s; they aren’t listed.");
});

// ── 26 Nov additions: lookalikes, reuse from the full list, the client's buildable Pages ──

const seed = (id: string, name: string, over: Partial<AccountAudience> = {}): AccountAudience => ({ id, name, subtype: "IG_BUSINESS", retentionDays: 365, lower: 90000, upper: 110000, delivery: "ready", operation: null, rule: null, deliveryCode: 200, lookalike: null, ...over });

test("create_audiences lookalike: GB at 1 % from an audience on the account, named {code} · {source} lookalike · 1 % UK", async () => {
  const { deps, calls } = spyDeps({ existing: [seed("120100", "XMPL IG Engagement 365d")] });
  const out = await run(createAudiencesTool, ctxOf(deps).ctx, { event: CODE, approval: YES, specs: [{ kind: "lookalike", origin_audience_id: "120100" }] });
  const made = sent(calls, "createAudience").map((c) => (c.input as { insert: Record<string, unknown> }).insert);
  assert.equal(made.length, 1);
  assert.equal(made[0]!.name, `${CODE} · XMPL IG Engagement 365d lookalike · 1 % UK`);
  assert.equal(made[0]!.audienceSubtype, "lookalike");
  assert.equal(made[0]!.sourceId, "120100");
  assert.equal(made[0]!.retentionDays, 1);
  assert.deepEqual({ ...(made[0]!.sourceMeta as object) }, { subtype: "lookalike", originAudienceId: "120100", ratio: 0.01, country: "GB", seedName: "XMPL IG Engagement 365d", seedLocalAudienceId: null, seedSubtype: "IG_BUSINESS", type: "similarity" });
  assert.equal(out.data.message, "Done: 1 made, 0 already on the account, 0 not made. Nothing spends until an ad set uses them.");
});

test("create_audiences lookalike: one already on the account for that source at GB 1 % is reused, whatever its name or type; another ratio isn't", async () => {
  const lal = (id: string, ratio: number, country = "GB") => seed(id, "Lookalike (GB, 1%) - anything", { subtype: "LOOKALIKE", lookalike: { originId: "120100", country, ratio } });
  const { deps, calls } = spyDeps({ existing: [seed("120100", "XMPL IG Engagement 365d"), lal("120201", 0.02), lal("120202", 0.01, "IE"), lal("120203", 0.01)] });
  const out = await run(createAudiencesTool, ctxOf(deps).ctx, { event: CODE, approval: YES, specs: [{ kind: "lookalike", origin_audience_id: "120100" }, { kind: "lookalike", origin_audience_id: "120100" }] });
  assert.equal(sent(calls, "createAudience").length, 0);
  assert.deepEqual(out.data.lines, ["Already on the account: Lookalike (GB, 1%) - anything (120203), used as it is."]);
});

test("create_audiences lookalike: a source under Meta's minimum, a lookalike source or one not on the account is refused per source, nothing made", async () => {
  const { deps, calls } = spyDeps({ existing: [seed("120100", "XMPL Big"), seed("120101", "XMPL IG Followers", { deliveryCode: 300, lower: 1000, upper: 1000 }), seed("120102", "XMPL Tiny", { upper: 40 }), seed("120103", "XMPL LAL", { subtype: "LOOKALIKE" })] });
  await assert.rejects(run(createAudiencesTool, ctxOf(deps).ctx, { event: CODE, approval: YES, specs: [
    { kind: "lookalike", origin_audience_id: "120100" },
    { kind: "lookalike", origin_audience_id: "120101" },
    { kind: "lookalike", origin_audience_id: "120102" },
    { kind: "lookalike", origin_audience_id: "120103" },
    { kind: "lookalike", origin_audience_id: "120999" },
  ] }), (e: Error) => {
    assert.equal(e.message, [
      "Refused: 4 specs can’t be built, so none were made. Nothing was sent to Meta.",
      "Spec 2: XMPL IG Followers is under Meta’s minimum for a lookalike source, so no lookalike can be made from it yet.",
      "Spec 3: XMPL Tiny is under Meta’s minimum for a lookalike source, so no lookalike can be made from it yet.",
      "Spec 4: XMPL LAL is a lookalike already; give the audience it was made from.",
      "Spec 5: 120999 isn’t a custom audience on this ad account: give one from list_audiences.",
    ].join("\n"));
    return true;
  });
  noWrites(calls);
});

test("create_audiences: 30 a call counts lookalikes too", async () => {
  const { deps, calls } = spyDeps({ existing: [seed("120100", "XMPL Big")] });
  const specs = [...Array.from({ length: 30 }, () => ({ kind: "page_engagers", page_id: PROMO_PAGE, retention_days: 30 })), { kind: "lookalike", origin_audience_id: "120100" }];
  await refused(run(createAudiencesTool, ctxOf(deps).ctx, { event: CODE, approval: YES, specs }), AUD_WORDS.noSpecs);
  assert.deepEqual(calls, []);
});

test("create_audiences: an audience on Meta with the builder's rule is reused from the account's full list (the builder's own lookup can't read a big account)", async () => {
  const rule = JSON.stringify({ inclusions: { operator: "or", rules: [{ event_sources: [{ type: "ig_business", id: 17840000001 }], retention_seconds: 31536000, filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: "ig_business_profile_all" }] } }] } });
  const { deps, calls } = spyDeps({ existing: [seed("120300", "XMPL  IG Engagement 365d", { rule }), seed("120301", "XMPL  IG Followers", { rule: rule.replace("31536000", "0") })] });
  const out = await run(createAudiencesTool, ctxOf(deps).ctx, { event: CODE, approval: YES, specs: [{ kind: "ig_engagers", ig_id: PROMO_IG, retention_days: 365 }, { kind: "ig_followers", ig_id: PROMO_IG }] });
  // Engagers match; the account's "IG Followers" is an engagement rule at 0 seconds, not INSTAGRAM_PROFILE_FOLLOW, so followers are made.
  assert.deepEqual(out.data.lines, ["Already on the account: XMPL  IG Engagement 365d (120300), used as it is.", `Made ${CODE} · @xmplpromoter followers · all time (120000000001).`]);
  assert.equal(sent(calls, "createAudience").length, 1);
});

test("audience_sources: every Page and Instagram account the client's Business Manager can build from, with genre where known", async () => {
  const { deps, calls } = spyDeps();
  const { ctx } = ctxOf(deps, { tables: { creative_lab_artists: [{ artist_id: A1, meta_page_id: ACT_PAGE, instagram_actor_id: null, ig_username: "xmplact" }] } });
  const out = await run(audienceSourcesTool, ctx, { event: CODE });
  assert.deepEqual(out.data.clientSources, [
    { client_id: CL, kind: "facebook_page", id: ACT_PAGE, name: "XMPL Act", genre_family: "drum_and_bass", reach: "client_shared" },
    { client_id: CL, kind: "facebook_page", id: PROMO_PAGE, name: "XMPL Promoter", genre_family: null, reach: "owned" },
    { client_id: CL, kind: "instagram_account", id: "17840000009", name: "xmplact", genre_family: "drum_and_bass", reach: "client_shared" },
    { client_id: CL, kind: "instagram_account", id: PROMO_IG, name: "xmplpromoter", genre_family: null, reach: "owned" },
  ]);
  assert.deepEqual(sent(calls, "businessAssets").map((c) => c.input), [BM]);
  noWrites(calls);
});

test("pending_access: an Off/Pixel business linked to the client is refused like request_page_access, and not read", async () => {
  for (const id of ["944651277948334", "237857750137825"]) {
    const { deps, calls } = spyDeps();
    await refused(run(pendingAccessTool, ctxOf(deps, { tables: { client_business_managers: [{ business_id: id, business_name: "Off/Pixel", client_id: CL }] } }).ctx, { client: CL }), AUD_WORDS.offPixelBusiness);
    assert.deepEqual(sent(calls, "pendingPages"), [], id);
    noWrites(calls);
  }
});

test("design's 27 Nov rows for #1400, character for character", () => {
  assert.equal(AUD_WORDS.followersOffered("P"), "Page followers (P, all time): offered.");
  assert.equal(AUD_WORDS.followersNot("P", "N"), "Page followers (P, all time): not offered until N gives advertiser access.");
  assert.equal(AUD_WORDS.followersExisting("P", "A", "1"), "Page followers (P, all time): already on the account as A (1).");
  assert.equal(AUD_WORDS.igNoPage("u"), "Instagram followers (@u, all time): not offered, because it isn’t linked to a Page this ad account can use.");
  assert.equal(AUD_WORDS.readFailed, "Meta couldn’t be read, so nothing was listed. Try again.");
  assert.equal(AUD_WORDS.alreadyPending(["Pg"], "B"), "Refused: Pg was already asked for from B and is still waiting on its admins. Nothing was sent to Meta.");
  assert.equal(AUD_WORDS.alreadyPending(["P1", "P2"], "B"), "Refused: P1, P2 were already asked for from B and are still waiting on their admins. Nothing was sent to Meta.");
  assert.match(AUD_WORDS.email({ artist: "A", show: "S", business: "B" }).body, / With it, B can run ads as the Page and see how they do; it can’t post to the Page, message from it or change it\.\n/);
  assert.doesNotMatch(AUD_WORDS.email({ artist: "A", show: "S", business: "B" }).body, /It can’t post, message or change the Page/);
  assert.equal(AUD_WORDS.offerNoBusiness("C"), "There’s no Business Manager linked to C, so access can’t be asked for yet. Matas links it with scripts/link-client-business-managers.mts.");
  assert.equal(AUD_WORDS.igManual("B", "u"), "In Business Suite for B, request access to @u under Settings › Accounts › Instagram accounts.");
  assert.equal(AUD_WORDS.noMetadata, "Reconnect Facebook in Off/Pixel to allow access requests.");
});

// ── 276: one Business Manager serving several clients ───────────────────────

test("request_page_access: a Business Manager linked to two clients asks for each client's shows, and the daily cap counts per business across both", async () => {
  const CL2 = "c0000000-0000-4000-8000-000000000002";
  const EV2 = "e0000000-0000-4000-8000-000000000009";
  const D2 = "d0000000-0000-4000-8000-000000000009";
  const shared = {
    clients: [
      { id: CL, name: "XMPL Promoter", status: "active", user_id: MATAS, default_page_ids: [PROMO_PAGE] },
      { id: CL2, name: "XMPL Venue", status: "active", user_id: MATAS, default_page_ids: [] },
    ],
    // The BM's primary client is unset; both clients are link rows (migration 276).
    client_business_managers: [{ business_id: BM, business_name: "XMPL BM", client_id: null }],
    client_business_manager_links: [
      { business_id: BM, client_id: CL },
      { business_id: BM, client_id: CL2 },
    ],
    events: [
      ...tables().events,
      { id: EV2, name: "XMPL Venue Show", event_code: "XMPL26-VENUE", venue_name: null, venue_city: null, event_date: "2027-03-20", announcement_at: null, presale_at: null, general_sale_at: null, status: "on_sale", client_id: CL2, meta_campaign_id: null, client: { name: "XMPL Venue" }, user_id: MATAS, meta_ad_account_id: "111111", venue_id: null, mailchimp_tag: null, ticket_url: null, signup_url: null },
    ],
    campaign_drafts: [...tables().campaign_drafts, { id: D2, event_id: EV2, created_at: "2026-11-02T10:00:00Z", draft_json: {} }],
  };
  // Each client's show asks from the shared BM.
  for (const [code, ev, draft] of [[CODE, EV, D1], ["XMPL26-VENUE", EV2, D2]] as const) {
    const { deps, calls } = spyDeps();
    await run(requestPageAccessTool, ctxOf(deps, { tables: shared }).ctx, { event: code, page_ids: [ACT_PAGE], approval: YES });
    const sentTo = sent(calls, "requestPage").map((c) => c.input as { businessId: string; ledger: { eventId: string; draftId: string } });
    assert.deepEqual(sentTo.map((s) => [s.businessId, s.ledger.eventId, s.ledger.draftId]), [[BM, ev, draft]], code);
  }
  // 3 requests on the first client's show and 2 on the second's: the business is at 5, so one more is refused for either client.
  const row = (i: number, event_id: string, draft_id: string) => ({ id: `l${i}`, event_id, draft_id, op_kind: "page_access_request", op_status: "success", created_at: "2026-11-26T09:00:00Z" });
  const ledger = [row(1, EV, D1), row(2, EV, D1), row(3, EV, D1), row(4, EV2, D2), row(5, EV2, D2)];
  for (const code of [CODE, "XMPL26-VENUE"]) {
    const { deps, calls } = spyDeps();
    await refused(run(requestPageAccessTool, ctxOf(deps, { tables: { ...shared, meta_write_idempotency: ledger } }).ctx, { event: code, page_ids: [ACT_PAGE], approval: YES }), AUD_WORDS.overCap("XMPL BM", 5, 1));
    assert.deepEqual(sent(calls, "requestPage"), [], code);
  }
});

test("pending_access and the client listing read a Business Manager through its link rows", async () => {
  const CL2 = "c0000000-0000-4000-8000-000000000002";
  const t = {
    clients: [
      { id: CL, name: "XMPL Promoter", status: "active", user_id: MATAS },
      { id: CL2, name: "XMPL Venue", status: "active", user_id: MATAS },
    ],
    client_business_managers: [{ business_id: BM, business_name: "XMPL BM", client_id: CL }],
    client_business_manager_links: [{ business_id: BM, client_id: CL2 }],
  };
  const { deps, calls } = spyDeps({ pendingPages: async () => [{ id: "5550020", pageId: "5550020", pageName: null }] });
  const out = await run(pendingAccessTool, ctxOf(deps, { tables: t }).ctx, { client: "XMPL Venue" });
  assert.equal(out.data.message, "XMPL BM has 1 request waiting on the Page’s admins.");
  noWrites(calls);
  // Off/Pixel's businesses stay refused through a link row too.
  for (const id of ["944651277948334", "237857750137825"]) {
    const off = spyDeps();
    await refused(run(pendingAccessTool, ctxOf(off.deps, { tables: { ...t, client_business_managers: [{ business_id: id, business_name: "Off/Pixel", client_id: null }], client_business_manager_links: [{ business_id: id, client_id: CL2 }] } }).ctx, { client: "XMPL Venue" }), AUD_WORDS.offPixelBusiness);
    assert.deepEqual(sent(off.calls, "pendingPages"), [], id);
  }
});

// ── Time limits (27 Nov: audience_sources hung past Claude's 180 s) ──────────

const never = <T>() => new Promise<T>(() => {});
const FAST = { perReadMs: 40, budgetMs: 300 };

test("audience_sources: each outside read that never answers gives up at its limit, the tool answers within the budget, and the rest still shows", async () => {
  const { deps } = spyDeps({
    limits: FAST,
    pixelEvents: () => never(),
    pageAccess: () => never(),
    pageLinks: () => never(),
    listAudiences: () => never(),
    businessAssets: () => never(),
  });
  const t0 = Date.now();
  const out = await run(audienceSourcesTool, ctxOf(deps, { tables: { events: tables().events.map((e) => ({ ...e, mailchimp_tag: "XMPL-TAG" })) } }).ctx, { event: CODE });
  const took = Date.now() - t0;
  assert.ok(took < FAST.budgetMs + 1500, `answered in ${took} ms`);
  const d = out.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(d.pixelLine, "Not read in time, so not shown: the pixel and its events. Try again.");
  for (const line of [
    "Not read in time, so not shown: Page access. Try again.",
    "Not read in time, so not shown: the ad account’s audiences. Try again.",
    "XMPL BM’s Pages and Instagram accounts couldn’t be read, so they aren’t listed. Try again.",
  ]) assert.ok(d.notes.includes(line), line);
  // CIRQLIN timed out: the event's own links, said as such.
  assert.deepEqual(d.links.map((l: { rule: string }) => l.rule), ["tix.example.com/e/1", "xmpl-show.example.com"]);
  // The Pages themselves still come back (promote_pages answered), marked not checked.
  const promo = d.pages.find((p: { id: string }) => p.id === PROMO_PAGE);
  assert.equal(promo.status, "not checked: Page access couldn’t be read in time");
  assert.equal(promo.followers, "not checked: Page access couldn’t be read in time");
  assert.equal(promo.next, undefined);
});

test("audience_sources: one slow read never holds up the others (they run side by side)", async () => {
  const { deps, calls } = spyDeps({ limits: { perReadMs: 200, budgetMs: 1000 }, promotePages: () => never() });
  const t0 = Date.now();
  const out = await run(audienceSourcesTool, ctxOf(deps).ctx, { event: CODE });
  const took = Date.now() - t0;
  assert.ok(took < 900, `answered in ${took} ms, not one limit after another`);
  const d = out.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(d.notes.includes("Not read in time, so not shown: the ad account’s Pages. Try again."));
  assert.match(d.pixelLine, /^Pixel XMPL Pixel/);
  assert.ok(sent(calls, "listAudiences").length === 1 && sent(calls, "adSetPixels").length === 1);
});

test("audience_sources: an audience list stopped by the budget hands back what it read, said as partial", async () => {
  const { deps } = spyDeps({
    limits: { perReadMs: 40, budgetMs: 150 },
    listAudiences: (_u, _a, signal) =>
      new Promise((resolve) => signal?.addEventListener("abort", () => resolve({ audiences: [{ id: "120001", name: "XMPL Likes", subtype: "ENGAGEMENT", retentionDays: 0, lower: 1000, upper: 2000, delivery: null, operation: null, rule: null }], metaGets: 3, complete: false }), { once: true })),
  });
  const out = await run(audienceSourcesTool, ctxOf(deps).ctx, { event: CODE });
  const d = out.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(d.notes.includes("Meta stopped answering part way through the account’s audiences, so this lists the first 1. An audience past those isn’t checked for reuse here."));
});

test("audience_sources doesn't walk the show's ad videos; create_audiences does only for a video spec with no video_ids, and a walk that never answers refuses that spec with nothing made", async () => {
  const a = spyDeps();
  const out = await run(audienceSourcesTool, ctxOf(a.deps).ctx, { event: CODE });
  assert.deepEqual(sent(a.calls, "showVideos"), []);
  assert.ok((out.data as { notes: string[] }).notes.includes("Video viewers: the show’s ad videos aren’t read here, because that read is slow. create_audiences reads them for a video spec, or give video_ids."));
  const b = spyDeps();
  await run(createAudiencesTool, ctxOf(b.deps).ctx, { event: CODE, approval: YES, specs: [{ kind: "page_engagers", page_id: PROMO_PAGE, retention_days: 30 }, { kind: "video_viewers", page_id: PROMO_PAGE, threshold: 75, retention_days: 90, video_ids: ["600000009"] }] });
  assert.deepEqual(sent(b.calls, "showVideos"), [], "given video_ids: no walk");
  const c = spyDeps({ limits: FAST, showVideos: () => never() });
  await refused(
    run(createAudiencesTool, ctxOf(c.deps).ctx, { event: CODE, approval: YES, specs: [{ kind: "video_viewers", page_id: PROMO_PAGE, threshold: 95, retention_days: 90 }] }),
    "Refused: 1 spec can’t be built, so none were made. Nothing was sent to Meta.\nSpec 1: the show’s ad videos couldn’t be read in time: give video_ids, or try again.",
  );
  noWrites(c.calls);
});

test("create_audiences: a source whose access couldn't be checked in time is refused as such, nothing made", async () => {
  const { deps, calls } = spyDeps({ limits: FAST, pageAccess: () => never() });
  await refused(
    run(createAudiencesTool, ctxOf(deps).ctx, { event: CODE, approval: YES, specs: [{ kind: "page_engagers", page_id: PROMO_PAGE, retention_days: 30 }] }),
    "Refused: 1 spec can’t be built, so none were made. Nothing was sent to Meta.\nSpec 1: XMPL Promoter’s access couldn’t be checked in time. Try again.",
  );
  noWrites(calls);
});

test("the seam: every Graph read carries a 10 s per-request signal; the Graph client stops an aborted read and never retries it", async () => {
  const { readFileSync } = await import("node:fs");
  const seam = readFileSync(new URL("../audience-deps.ts", import.meta.url), "utf8");
  assert.match(seam, /export const REQUEST_TIMEOUT_MS = 10_000;/);
  const gets = seam.split("\n").filter((l) => /graphGetWithToken[<(]/.test(l) && !/^import/.test(l.trim()));
  const unboxed = gets.filter((l) => !/signal: reqSignal\(signal\)/.test(l));
  // The Business Manager reads for request_page_access (permissions, business users, pending) aren't audience_sources' and keep their own path.
  assert.deepEqual(unboxed.filter((l) => !/me\/permissions/.test(l)), []);
  const client = readFileSync(new URL("../../meta/client.ts", import.meta.url), "utf8");
  assert.match(client, /signal\?: AbortSignal;/);
  assert.match(client, /return executeGetWithRetry<T>\(url, path, options\?\.maxAttempts \?\? MAX_GET_ATTEMPTS, options\?\.signal\);/);
  assert.match(client, /if \(signal\?\.aborted\) throw aborted\(\);/);
  assert.match(client, /if \(!response && signal\?\.aborted\) throw aborted\(\);/);
});

test("design's 27 Nov rows for #1405, character for character", () => {
  assert.equal(AUD_WORDS.notRead("pixel"), "Not read in time, so not shown: the pixel and its events. Try again.");
  assert.equal(AUD_WORDS.notRead("pages"), "Not read in time, so not shown: the ad account’s Pages. Try again.");
  assert.equal(AUD_WORDS.notRead("access"), "Not read in time, so not shown: Page access. Try again.");
  assert.equal(AUD_WORDS.notRead("audiences"), "Not read in time, so not shown: the ad account’s audiences. Try again.");
  assert.equal(AUD_WORDS.notRead("videos"), "Not read in time, so not shown: the show’s ad videos. Try again.");
  assert.equal(AUD_WORDS.videosNote, "Video viewers: the show’s ad videos aren’t read here, because that read is slow. create_audiences reads them for a video spec, or give video_ids.");
  assert.equal(AUD_WORDS.whyUnchecked("N"), "N’s access couldn’t be checked in time. Try again.");
  assert.equal(AUD_WORDS.whyVideosUnread, "the show’s ad videos couldn’t be read in time: give video_ids, or try again.");
  assert.equal(AUD_WORDS.notChecked, "not checked: Page access couldn’t be read in time");
});
