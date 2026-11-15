import { test } from "node:test";
import assert from "node:assert/strict";

import { buildShowIndex } from "../attribution.ts";
import { birdWindows, fetchBirdListNames, fetchBirdMetrics, mapBirdSummary } from "../bird.ts";
import { fetchMailchimpReports, mailchimpAudience, mapMailchimpReport } from "../mailchimp.ts";
import { StatsReadError, type StatsReader } from "../reader.ts";

/** A GET-only fake keyed by path prefix; records every path asked. */
function fakeReader(routes: Array<[RegExp, (path: string) => unknown]>): StatsReader & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    get calls() {
      return paths.length;
    },
    async get<T>(path: string): Promise<T> {
      paths.push(path);
      for (const [re, fn] of routes) if (re.test(path)) return fn(path) as T;
      throw new StatsReadError(404, `no route for ${path}`);
    },
  };
}

const index = buildShowIndex([
  { eventId: "ev-moonlit", clientId: "client-harbour", tag: "CQ-moonlit-harbour", code: null, slug: "moonlit-harbour", mailchimpAudienceId: "list-a" },
]);

test("Bird windows are at most 28 days and cover the range", () => {
  const since = Date.parse("2026-07-01T00:00:00Z");
  const until = Date.parse("2026-09-15T00:00:00Z");
  const w = birdWindows(since, until);
  assert.equal(w[0]![0], "2026-07-01T00:00:00.000Z");
  assert.equal(w.at(-1)![1], "2026-09-15T00:00:00.000Z");
  for (const [a, b] of w) assert.ok(Date.parse(b) - Date.parse(a) <= 28 * 86_400_000);
  for (let i = 1; i < w.length; i++) assert.equal(w[i]![0], w[i - 1]![1]);
});

test("Bird metrics are read per window and deduped on campaign id", async () => {
  const reader = fakeReader([
    [/reporting\/campaigns\/metrics/, () => [{ summary: { campaignId: "c1", sent: 10 } }, { summary: { campaignId: "c2", sent: 5 } }]],
  ]);
  const rows = await fetchBirdMetrics(reader, "ws-1", [["a", "b"], ["b", "c"]]);
  assert.equal(rows.length, 2);
  assert.equal(reader.calls, 2);
  assert.ok(reader.paths.every((p) => p.includes("periodStart=") && p.includes("periodEnd=")));
});

test("list names: /lists first, /groups only after a 403", async () => {
  const reader = fakeReader([
    [/\/lists\/l-ok$/, () => ({ name: "CQ-moonlit-harbour" })],
    [/\/lists\/l-denied$/, () => {
      throw new StatsReadError(403, "forbidden");
    }],
    [/\/groups\/l-denied$/, () => ({ name: "Harbour Loves" })],
  ]);
  const notes: string[] = [];
  const names = await fetchBirdListNames(reader, "ws-1", ["l-ok", "l-denied"], notes);
  assert.equal(names.get("l-ok"), "CQ-moonlit-harbour");
  assert.equal(names.get("l-denied"), "Harbour Loves");
  assert.equal(notes.length, 1);
});

test("a Bird summary maps sent / delivered / read / clicked onto the show", () => {
  const row = mapBirdSummary(
    { campaignId: "c1", campaignName: "Moonlit announce", campaignActivatedDate: "2026-11-01T17:00:00Z", platformId: "whatsapp", sent: 600, delivered: 540, readOrOpened: 300, clicked: 45, bounced: 2, unsubscribed: 1 },
    {
      id: "c1",
      currentVersion: {
        recipients: { include: [{ type: "group", id: "l1" }] },
        channels: { platforms: [{ platformId: "whatsapp", channels: [{ id: "chan-1" }] }] },
      },
    },
    new Map([["l1", "CQ-moonlit-harbour"]]),
    { workspaceId: "ws-1", accountClientIds: ["client-harbour"], index, nowIso: "2026-11-15T04:00:00Z" },
  );
  assert.ok(row);
  assert.equal(row.channel, "whatsapp");
  assert.equal(row.event_id, "ev-moonlit");
  assert.equal(row.attribution, "show");
  assert.deepEqual([row.sent, row.delivered, row.read, row.clicked], [600, 540, 300, 45]);
  assert.deepEqual(row.channel_ids, ["chan-1"]);
  assert.equal(row.opens_unique_raw, null);
});

test("a Bird summary on an unknown platform is skipped", () => {
  assert.equal(
    mapBirdSummary({ campaignId: "c1", platformId: "telegram" }, undefined, new Map(), {
      workspaceId: "ws-1",
      accountClientIds: ["client-harbour"],
      index,
      nowIso: "x",
    }),
    null,
  );
});

test("Mailchimp audience: conditions → refs, match:any static_not widens", () => {
  const names = new Map([["11", "CQ-moonlit-harbour"]]);
  const tagged = mailchimpAudience(
    { recipients: { list_id: "list-a", segment_opts: { match: "any", conditions: [{ condition_type: "StaticSegment", op: "static_is", value: 11 }] } } },
    names,
  );
  assert.equal(tagged.wholeList, false);
  assert.equal(tagged.refs[0]!.name, "CQ-moonlit-harbour");
  const allBut = mailchimpAudience(
    { recipients: { list_id: "list-a", segment_opts: { match: "any", conditions: [{ condition_type: "StaticSegment", op: "static_not", value: 11 }] } } },
    names,
  );
  assert.equal(allBut.otherConditions, 1);
  assert.equal(mailchimpAudience({ recipients: { list_id: "list-a", segment_opts: null } }, names).wholeList, true);
  assert.equal(mailchimpAudience({ recipients: { list_id: "list-a", segment_opts: { match: "all" } } }, names).wholeList, true);
});

const ctx = {
  accountId: "acct-1",
  accountClientIds: ["client-harbour"],
  listClientIds: new Map<string, string>(),
  index,
  nowIso: "2026-11-15T04:00:00Z",
};

test("a Mailchimp report keeps raw and bot-filtered opens apart", () => {
  const row = mapMailchimpReport(
    {
      id: "mc1",
      campaign_title: "Moonlit lineup",
      list_id: "list-a",
      emails_sent: 500,
      send_time: "2026-11-02T17:00:00Z",
      bounces: { hard_bounces: 2, soft_bounces: 3, syntax_errors: 0 },
      opens: { unique_opens: 160, open_rate: 0.32, proxy_excluded_unique_opens: 20, proxy_excluded_open_rate: 0.0404 },
      clicks: { unique_clicks: 12, unique_subscriber_clicks: 11 },
      unsubscribed: 1,
    },
    { recipients: { list_id: "list-a", segment_opts: { match: "any", conditions: [{ condition_type: "StaticSegment", op: "static_is", value: 11 }] } } },
    new Map([["11", "CQ-moonlit-harbour"]]),
    ctx,
  );
  assert.ok(row);
  assert.equal(row.delivered, 495);
  assert.equal(row.opens_unique_raw, 160);
  assert.equal(row.opens_unique_filtered, 20);
  assert.equal(row.open_rate_filtered, 0.0404);
  assert.equal(row.clicked, 11);
  assert.equal(row.event_id, "ev-moonlit");
});

test("a Mailchimp report without the filtered fields stores null, not the raw count", () => {
  const row = mapMailchimpReport({ id: "mc2", list_id: "list-a", emails_sent: 100, opens: { unique_opens: 40, open_rate: 0.4 } }, undefined, new Map(), ctx);
  assert.equal(row!.opens_unique_filtered, null);
  assert.equal(row!.open_rate_filtered, null);
  // No campaign read, so no audience to match positively.
  assert.equal(row!.attribution, "not_tied");
});

test("Mailchimp reports page by offset until total_items", async () => {
  const reader = fakeReader([
    [/\/3\.0\/reports/, (p) => {
      const offset = Number(new URL(`https://x${p}`).searchParams.get("offset"));
      const n = offset === 0 ? 1000 : 3;
      return { total_items: 1003, reports: Array.from({ length: n }, (_, i) => ({ id: `r${offset + i}` })) };
    }],
  ]);
  const rows = await fetchMailchimpReports(reader, "2026-09-20T00:00:00Z");
  assert.equal(rows.length, 1003);
  assert.equal(reader.calls, 2);
  assert.ok(reader.paths[0]!.includes("since_send_time="));
});
