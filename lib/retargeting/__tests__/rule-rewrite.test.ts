/**
 * RT13's daily rule rewrite, as ops ruled (17 Nov): the on-sale refresh's
 * token and write path, behind its gates; no new token path, never a
 * client's own token.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { memoryDb } from "../../onsale-refresh/__tests__/memory-db.ts";
import { linkKey, pixelRules, ruleChanges, tierSpecs, type SourceSet } from "../audiences.ts";
import { linksFromPages } from "../links.ts";
import { refreshTokenFor, rewriteRules, ruleFor, ruleRewriteGates } from "../rule-rewrite.ts";

const PAGE = {
  page_id: "0c8e8daa-b2e3-49c0-8804-9f1c3453ff3b",
  slug: "robbiedoherty-newcastle",
  crm_base_tag: "CQ-robbiedoherty-newcastle",
  title: "Robbie Doherty Newcastle",
  landing_url: "https://robbiedoherty-newcastle.com",
  ticket_links: [
    { platform: "skiddle", url: "https://www.skiddle.com/whats-on/Newcastle-on-Tyne/NX-Newcastle/Robbie-Doherty/42832766/", label: "SKIDDLE", shop_name: "SKIDDLE", shown_first: true },
    { platform: "ra", url: "https://ra.co/events/2556925", label: "RA", shop_name: "RA", shown_first: false },
    { platform: "fatsoma", url: "https://www.fatsoma.com/e/hv0nhal3/robbie-doherty", label: "FATSOMA", shop_name: "FATSOMA", shown_first: false },
  ],
};

const set = (pages: (typeof PAGE)[]): SourceSet => ({ pixelId: "123456789", links: linksFromPages(pages), videos: [], pages: [], lists: [] });

describe("RT13 rule rewrite: gates", () => {
  it("off unless the apply gate and the audience-write gate are both on (no per-event arm, RT16)", () => {
    assert.deepEqual(ruleRewriteGates({}), { ok: false, reason: "the apply gate is off" });
    assert.deepEqual(ruleRewriteGates({ ONSALE_REFRESH_APPLY_ENABLED: "1" }), { ok: false, reason: "the audience-write gate is off" });
    assert.deepEqual(ruleRewriteGates({ ONSALE_REFRESH_APPLY_ENABLED: "1", OFFPIXEL_META_AUDIENCE_WRITES_ENABLED: "true" }), { ok: true, reason: null });
  });
});

describe("RT13 rule rewrite: the write", () => {
  it("an outlet switched off: each combined audience's rule is rewritten through the ledger; the dropped link's own audience is a rebuild", async () => {
    const before = tierSpecs(set([PAGE]));
    const stored = pixelRules(before);
    const after = tierSpecs(set([{ ...PAGE, ticket_links: PAGE.ticket_links.filter((link) => link.platform !== "fatsoma") }]));
    const changed = ruleChanges(stored, pixelRules(after));
    const fatsoma = linkKey("www.fatsoma.com/e/hv0nhal3/robbie-doherty");
    assert.ok(changed.includes(`bottom:ticket:30:${fatsoma}`));
    const audienceIds = Object.fromEntries(Object.keys(stored).map((key) => [key, `aud-${key}`]));
    const mem = memoryDb({ meta_write_idempotency: [] });
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    const done = await rewriteRules(
      { post: async (path, body) => void posts.push({ path, body }), ledger: { supabase: mem.db as never, userId: "u1", draftId: "d1", eventId: "e1" } },
      { code: "RD", adAccountId: "act_1", lineId: "l1", specs: after, audienceIds, changed, stored },
    );
    assert.deepEqual(done.written.sort(), changed.filter((key) => key !== `bottom:ticket:30:${fatsoma}`).sort());
    assert.deepEqual(done.rebuild, [`bottom:ticket:30:${fatsoma}`]);
    assert.deepEqual(done.failed, []);
    // POST /{audience} { rule }: the same rule the builder makes, with the two links left.
    const checkout = posts.find((row) => row.path === "/aud-bottom:checkout:7")!;
    const rule = JSON.parse(String(checkout.body.rule)) as { inclusions: { rules: { filter: { filters: { filters?: { value: string }[] }[] } }[] } };
    const urls = rule.inclusions.rules[0]!.filter.filters[0]!.filters!.map((row) => row.value);
    assert.deepEqual(urls, ["www.skiddle.com/whats-on/Newcastle-on-Tyne/NX-Newcastle/Robbie-Doherty/42832766/", "ra.co/events/2556925"]);
    assert.ok(String(checkout.body.rule).includes('"InitiateCheckout"'));
    // Every write on the ledger, op kind retargeting_audience_rule_update, keyed on the line.
    assert.equal(mem.tables.meta_write_idempotency!.length, done.written.length);
    assert.ok(mem.tables.meta_write_idempotency!.every((row) => row.op_kind === "retargeting_audience_rule_update" && row.draft_id === "d1"));
    assert.deepEqual(done.rules["bottom:checkout:7"], urls);
  });

  it("a new link's own audience isn't on the campaign: reported as a rebuild, never created here", async () => {
    const before = tierSpecs(set([{ ...PAGE, ticket_links: PAGE.ticket_links.slice(0, 2) }]));
    const stored = pixelRules(before);
    const after = tierSpecs(set([PAGE]));
    const changed = ruleChanges(stored, pixelRules(after));
    const audienceIds = Object.fromEntries(Object.keys(stored).map((key) => [key, `aud-${key}`]));
    const posts: string[] = [];
    const done = await rewriteRules(
      { post: async (path) => void posts.push(path), ledger: { supabase: memoryDb({ meta_write_idempotency: [] }).db as never, userId: "u1", draftId: "d1", eventId: "e1" } },
      { code: "RD", adAccountId: "act_1", lineId: "l1", specs: after, audienceIds, changed, stored },
    );
    assert.deepEqual(done.rebuild, [`bottom:ticket:30:${linkKey("www.fatsoma.com/e/hv0nhal3/robbie-doherty")}`]);
    assert.ok(posts.every((path) => !path.includes(linkKey("www.fatsoma.com/e/hv0nhal3/robbie-doherty"))));
  });

  it("the rule is the builder's own payload for that audience", () => {
    const spec = tierSpecs(set([PAGE]))[0]!;
    const aud = spec.includes.find((row) => row.key === "bottom:registrations:90")!;
    const rule = ruleFor("RD", aud as never, "act_1");
    assert.ok(rule.includes('"CompleteRegistration"'));
    assert.ok(rule.includes("robbiedoherty-newcastle.com"));
    assert.ok(rule.includes(`"retention_seconds":${90 * 86_400}`));
  });
});

describe("RT13 rule rewrite: the refresh's token, never a client's", () => {
  it("the operator's own Facebook token over the agency token, as the refresh Apply resolves it", async () => {
    const mem = memoryDb({ user_facebook_tokens: [{ user_id: "u1", provider_token: "own-token" }] });
    assert.equal(await refreshTokenFor(mem.db as never, "u1"), "own-token");
    assert.equal(await refreshTokenFor(memoryDb({ user_facebook_tokens: [] }).db as never, "not-an-operator"), null);
  });

  it("the same resolution as the refresh Apply route, and no client-token path anywhere in the rewrite", () => {
    const route = readFileSync("app/api/events/[id]/onsale-refresh/apply/route.ts", "utf8");
    assert.match(route, /let token = agencyMetaToken\(who\.userId\) \?\? ""/);
    assert.match(route, /from\("user_facebook_tokens"\)\.select\("provider_token"\)\.eq\("user_id", who\.userId\)/);
    const rewrite = readFileSync("lib/retargeting/rule-rewrite.ts", "utf8");
    assert.match(rewrite, /let token = agencyMetaToken\(userId\) \?\? ""/);
    assert.match(rewrite, /from\("user_facebook_tokens"\)\.select\("provider_token"\)\.eq\("user_id", userId\)/);
    const cron = readFileSync("app/api/cron/retargeting-read/route.ts", "utf8");
    const runner = readFileSync("lib/retargeting/runner.ts", "utf8");
    for (const [name, source] of [["rule-rewrite.ts", rewrite], ["retargeting-read cron", cron], ["runner.ts", runner]] as const) {
      for (const client of [/client_users/, /client_business_managers/, /get_bm_access_token/, /client_meta_tokens/, /page_access_token/, /client_tokens/]) assert.doesNotMatch(source, client, `${name}: ${client}`);
    }
    // The cron writes only through the refresh's POST with the owner's token, and only behind the gates.
    assert.match(cron, /graphPost: \(path, body, ownerToken\) => graphPostWithToken\(path, body, ownerToken\)/);
    assert.match(runner, /const gates = ruleRewriteGates\(input\.env\);/);
    assert.match(runner, /const token = await refreshTokenFor\(input\.db as never, owner\);/);
  });
});
