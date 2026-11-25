import { test } from "node:test";
import assert from "node:assert/strict";
import { READ_TOOLS } from "../tools/index.ts";
import { listEventsTool, getEventTool } from "../tools/events.ts";
import { getDraftTool, getDraftsTool } from "../tools/drafts.ts";
import { getLearningsTool } from "../tools/learnings.ts";
import { getCampaignTreeTool, runLaunchChecksTool } from "../tools/pending.ts";
import { londonLabel, morningToplineTool, toplinePhase } from "../tools/topline.ts";
import { DRAFT_1, EV_DOD, ctx, tables } from "./fixtures.ts";
import { fakeDb } from "./fake-db.ts";

const keys = (o: unknown) => Object.keys(o as object).sort();

test("eight read tools, each read-only with a one-example description", () => {
  assert.deepEqual(READ_TOOLS.map((t) => t.name).sort(), [
    "get_campaign_tree",
    "get_draft",
    "get_drafts",
    "get_event",
    "get_learnings",
    "list_events",
    "morning_topline",
    "run_launch_checks",
  ]);
  for (const t of READ_TOOLS) {
    assert.equal(t.kind, "read", t.name);
    assert.match(t.description, /Example: /, t.name);
    assert.ok(t.name.length <= 64);
    assert.ok(t.title.length > 0);
  }
});

test("list_events: upcoming, live clients only, with phase", async () => {
  const c = ctx();
  const out = await listEventsTool.run(c, {});
  const data = out.data as { count: number; events: Array<Record<string, unknown>> };
  assert.deepEqual(
    data.events.map((e) => e.code),
    ["NX26-DOD", "NX26-SOON"],
  );
  assert.deepEqual(keys(data.events[0]), ["client", "code", "date", "name", "phase", "status", "venue"]);
  assert.equal(data.events[0]!.phase, "general_sale");
  assert.equal(data.events[1]!.phase, "teaser");
  const presale = await listEventsTool.run(c, { stage: "general_sale", client: "nx" });
  assert.equal((presale.data as { count: number }).count, 1);
  const all = await listEventsTool.run(c, { upcoming: false });
  assert.ok((all.data as { events: Array<{ code: string }> }).events.some((e) => e.code === "NX25-OLD"));
  assert.ok(!(all.data as { events: Array<{ code: string }> }).events.some((e) => e.code === "OLD26-X"), "archived client left out");
});

test("get_event: dates, spend, signups, tickets, campaigns, drafts", async () => {
  const out = await getEventTool.run(ctx(), { code: "NX26-DOD" });
  const d = out.data as Record<string, Record<string, unknown> & Array<unknown>>;
  assert.deepEqual(keys(d), ["campaigns", "drafts", "event", "signups", "spend", "tickets"]);
  assert.equal(out.eventId, EV_DOD);
  assert.equal(d.spend.yesterday, 35);
  assert.equal(d.spend.dailyAverage7Days, 3);
  assert.equal(d.spend.checkoutsYesterday, 4);
  assert.equal(d.spend.misnamedCampaigns, "[NX26-D0D] Typo");
  assert.equal(d.signups.yesterday, 12);
  assert.equal(d.signups.dailyAverage7Days, 1.3);
  assert.equal(d.signups.total, 845);
  assert.equal(d.tickets.latest, 431);
  assert.equal(d.tickets.sincePrevious, 31);
  assert.deepEqual(d.campaigns.metaCampaignIds, ["120001", "120002"]);
  assert.equal(d.campaigns.launchedAdSets, 2);
  assert.equal((d.drafts as unknown as Array<{ id: string }>)[0]!.id, DRAFT_1);
  await assert.rejects(() => getEventTool.run(ctx(), { code: "NOPE-1" }), /No event with code NOPE-1/);
  await assert.rejects(() => getEventTool.run(ctx(), { code: "x; drop" }), /event code/);
});

test("get_drafts / get_draft: the summary's fields", async () => {
  const list = await getDraftsTool.run(ctx(), { code: "NX26-DOD" });
  const drafts = (list.data as { drafts: Array<Record<string, unknown>> }).drafts;
  assert.equal(drafts.length, 1);
  const one = await getDraftTool.run(ctx(), { id: DRAFT_1 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading a nested summary in a test
  const d = (one.data as { draft: Record<string, any> }).draft;
  assert.deepEqual(keys(d), [
    "account",
    "adSets",
    "audiences",
    "budget",
    "campaignCode",
    "creatives",
    "id",
    "instagram",
    "launchedCampaignId",
    "links",
    "locations",
    "name",
    "objective",
    "optimisationGoal",
    "page",
    "pixel",
    "schedule",
    "status",
    "updatedAt",
  ]);
  assert.equal(d.account, "act_606252931141334");
  assert.equal(d.pixel, "2763");
  assert.deepEqual(d.links, ["www.skiddle.com/e/123"]);
  assert.deepEqual(d.audiences.pageGroups, ["Fans"]);
  assert.equal(d.creatives.count, 1);
  assert.equal(d.budget.adSetDailyTotal, 20);
  assert.equal(d.schedule.end, "2026-12-20");
  assert.equal(d.locations.groups[0].label, "Newcastle +40");
  assert.equal(d.adSets.items[0].location, "Newcastle +40");
  await assert.rejects(() => getDraftTool.run(ctx(), { id: "d0000000-0000-4000-8000-00000000ffff" }), /No draft/);
});

test("get_learnings: rows with words; archived out; client ids only for Matas", async () => {
  const forMatas = await getLearningsTool.run(ctx(), {});
  const m = forMatas.data as { findings: Array<Record<string, unknown>> };
  assert.equal(m.findings.length, 2, "archived client's show_week dropped");
  const verdict = m.findings.find((f) => f.kind === "test_verdict")!;
  assert.equal(verdict.words, "NX26-DOD · AB copy test: B wins at £1.20 per signup");
  const rollup = m.findings.find((f) => f.kind === "axis_rollup")!;
  assert.match(String(rollup.words), /3 winners in 5 tests/);
  assert.equal(verdict.clientId !== null, true);

  const forStaff = await getLearningsTool.run(ctx({ seesClientNames: false }), {});
  for (const f of (forStaff.data as { findings: Array<Record<string, unknown>> }).findings) assert.equal(f.clientId, null);

  const byCode = await getLearningsTool.run(ctx(), { code: "NX26-DOD", kind: "test_verdict" });
  assert.equal((byCode.data as { count: number }).count, 1);
});

test("get_campaign_tree says not available yet and reads nothing; run_launch_checks runs the real check", async () => {
  const c = ctx();
  const tree = await getCampaignTreeTool.run(c, { code: "NX26-DOD" });
  assert.deepEqual(tree.data, { available: false, status: "not available yet", waitingOn: "PR #1364 (campaign tree)", code: "NX26-DOD" });
  assert.deepEqual(c.db.reads, []);
  const checks = await runLaunchChecksTool.run(c, { draft_id: DRAFT_1 });
  const out = (checks.data as { launchChecks: { ran: boolean } }).launchChecks;
  assert.equal(typeof out.ran, "boolean");
  assert.ok((c.db.reads as string[]).includes("campaign_drafts"));
  assert.deepEqual(c.db.writes, []);
});

test("morning_topline: the query's columns, phases, misnamed line and next 72 hours", async () => {
  const out = await morningToplineTool.run(ctx(), {});
  const d = out.data as { yesterday: string; rows: Array<Record<string, unknown>>; next72Hours: Array<Record<string, unknown>> };
  assert.equal(d.yesterday, "2026-11-23");
  assert.deepEqual(
    d.rows.map((r) => r.event_code),
    ["NX26-DOD", "NX26-SOON"],
  );
  const dod = d.rows[0]!;
  assert.deepEqual(keys(dod), [
    "announce",
    "chk_7d",
    "chk_y",
    "event_code",
    "event_date",
    "gen_sale",
    "misnamed",
    "phase",
    "presale",
    "sig_7d",
    "sig_total",
    "sig_y",
    "spend_7d",
    "spend_y",
    "tix_date",
    "tix_prev_date",
    "tix_since_prev",
    "tix_total",
  ]);
  assert.equal(dod.phase, "on sale");
  assert.equal(dod.spend_y, 35);
  assert.equal(dod.spend_7d, 3);
  assert.equal(dod.chk_y, 4);
  assert.equal(dod.chk_7d, 1);
  assert.equal(dod.sig_y, 12);
  assert.equal(dod.sig_7d, 1.3);
  assert.equal(dod.sig_total, 845);
  assert.equal(dod.tix_total, 431);
  assert.equal(dod.tix_since_prev, 31);
  assert.equal(dod.tix_date, "2026-11-23");
  assert.equal(dod.misnamed, "[NX26-D0D] Typo");
  assert.equal(dod.announce, "01 Oct 18:00");
  assert.deepEqual(d.next72Hours, [{ event_code: "NX26-SOON", moment: "announce", at: "2026-11-25T17:00:00Z", london: "25 Nov 17:00", hoursFromNow: 32 }]);
});

test("topline phase follows the query's CASE", () => {
  const y = "2026-11-23";
  const now = new Date("2026-11-24T09:00:00Z");
  const none = { announcement_at: null, presale_at: null, general_sale_at: null };
  assert.equal(toplinePhase({ ...none, event_date: "2026-11-30" }, y, now), "show week");
  assert.equal(toplinePhase({ ...none, event_date: "2026-12-30", presale_at: "2026-11-20T09:00:00Z" }, y, now), "presale");
  assert.equal(toplinePhase({ ...none, event_date: "2026-12-30" }, y, now), "teaser");
  assert.equal(londonLabel("2026-07-01T17:00:00Z"), "01 Jul 18:00");
});

test("get_event and morning_topline agree on spend and signups for the same show and day", async () => {
  const c = ctx();
  const top = (await morningToplineTool.run(c, {})).data as { rows: Array<Record<string, unknown>> };
  for (const row of top.rows) {
    const ev = (await getEventTool.run(c, { code: row.event_code })).data as { spend: Record<string, unknown>; signups: Record<string, unknown> };
    assert.deepEqual(
      [ev.spend.yesterday, ev.spend.dailyAverage7Days, ev.spend.checkoutsYesterday, ev.spend.checkoutsDailyAverage7Days, ev.spend.misnamedCampaigns],
      [row.spend_y, row.spend_7d, row.chk_y, row.chk_7d, row.misnamed],
      String(row.event_code),
    );
    assert.deepEqual([ev.signups.yesterday, ev.signups.dailyAverage7Days, ev.signups.total], [row.sig_y, row.sig_7d, row.sig_total], String(row.event_code));
  }
});

test("a day with no CIRQLIN snapshot falls back to the page-audience difference in both tools", async () => {
  const t = tables();
  t.signup_source_snapshots = t.signup_source_snapshots.filter((s) => s.day !== "2026-11-23");
  t.cirqlin_page_audience = [
    { ...t.cirqlin_page_audience[0]!, fetch_day: "2026-11-22", signups: 830 },
    { ...t.cirqlin_page_audience[0]!, fetch_day: "2026-11-23", signups: 845 },
  ];
  const c = ctx({ db: fakeDb(t) as never });
  const ev = (await getEventTool.run(c, { code: "NX26-DOD" })).data as { signups: Record<string, unknown> };
  const top = (await morningToplineTool.run(c, {})).data as { rows: Array<Record<string, unknown>> };
  assert.equal(ev.signups.yesterday, 15);
  assert.equal(top.rows.find((r) => r.event_code === "NX26-DOD")!.sig_y, 15);
});
