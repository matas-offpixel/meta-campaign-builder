/**
 * HE3 panel: E5 / EV4 as amended by PI4–PI7
 * (docs/design-record/2026-11-15-dashboard-v2-phase-2-ingest.html).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { D2CShowVenue } from "../../d2c/stats-ingest/read.ts";
import type { StoredStatsRow } from "../../d2c/stats-ingest/summary.ts";
import { electric } from "../audience-panels-fixture.ts";
import {
  BOT_FILTER_FOOTNOTE,
  NOT_TIED,
  RATE_NOT_SET,
  WHOLE_LIST,
  buildDirectToFan,
  includesClause,
  londonYear,
  scopeRows,
  sendDate,
  sendSpan,
  venueAudiences,
  type D2CScope,
} from "../direct-to-fan.ts";

let seq = 0;
function row(over: Partial<StoredStatsRow>): StoredStatsRow {
  seq += 1;
  return {
    id: `r${seq}`,
    provider: "bird",
    account_id: "ws1",
    external_id: `x${seq}`,
    channel: "whatsapp",
    client_id: "c1",
    event_id: null,
    attribution: "client",
    audience_kind: "marketing",
    name: `Send ${seq}`,
    sent_at: "2026-11-01T12:00:00Z",
    list_id: null,
    sent: 100,
    delivered: 100,
    read: 50,
    clicked: 10,
    opens_unique_raw: null,
    opens_unique_filtered: null,
    open_rate_filtered: null,
    fetched_at: null,
    ...over,
  };
}

const SHOWS: D2CShowVenue[] = [
  { id: "e1", venue_key: "newcastle", mailchimp_audience_id: "aud-nc" },
  { id: "e2", venue_key: "newcastle", mailchimp_audience_id: "aud-nc" },
  { id: "e3", venue_key: "brixton", mailchimp_audience_id: "aud-bx" },
  { id: "e4", venue_key: "bristol", mailchimp_audience_id: "aud-bx" },
];

const NAMES: Record<string, string> = { e1: "Locklead", e2: "AZYR", e3: "Kream", e4: "Bristol show" };
// A fixed "now" (15 Nov 2026), so no assertion moves with the machine clock.
const opts = (surface: "internal" | "share") => ({ surface, showName: (id: string) => NAMES[id] ?? "—", rateHref: "/clients/c1?tab=d2c", nowMs: Date.parse("2026-11-15T12:00:00Z") });
const client: D2CScope = { kind: "client", label: "Electric Group" };

describe("Direct-to-fan · raw open rate (PI4)", () => {
  it("never shows the raw open rate, and footnotes the bot filter", () => {
    const rows = [
      row({ provider: "mailchimp", channel: "email", delivered: 572, read: null, clicked: 0, opens_unique_raw: 164, opens_unique_filtered: 17, open_rate_filtered: 17 / 572 }),
    ];
    const m = buildDirectToFan({ rows, rate: { rate: null, currency: "GBP" }, shows: SHOWS, unattributed: 0 }, client, opts("internal"));
    const text = JSON.stringify(m);
    assert.equal(m.channels[0]!.readOpenedText, "3.0 %");
    assert.equal(m.sends[0]!.readOpenedText, "3.0 %");
    assert.doesNotMatch(text, /28\.7/);
    assert.equal(m.footnote, BOT_FILTER_FOOTNOTE);
    assert.equal(m.channels[0]!.label, "Email · marketing · bot-filtered");
  });

  it("marks estimated opens '(est.)' and nothing else", () => {
    const rows = [
      row({ provider: "mailchimp", channel: "email", delivered: 1000, read: null, opens_unique_raw: 400, opens_unique_filtered: 100 }),
      row({ provider: "mailchimp", channel: "email", delivered: 1000, read: null, opens_unique_raw: 400, opens_unique_filtered: null }),
    ];
    const m = buildDirectToFan({ rows, rate: { rate: null, currency: "GBP" }, shows: SHOWS, unattributed: 0 }, client, opts("internal"));
    assert.equal(m.channels[0]!.label, "Email · marketing · bot-filtered (est.)");
    assert.deepEqual(m.sends.map((s) => s.readOpenedText).sort(), ["10.0 %", "10.0 % (est.)"]);
  });
});

describe("Direct-to-fan · WhatsApp cost (PI5)", () => {
  const rows = [row({ delivered: 1000, clicked: 50 })];
  it("reads 'Rate not set' internally, linked, and '—' on the share link, never £0", () => {
    const internal = buildDirectToFan({ rows, rate: { rate: null, currency: "GBP" }, shows: SHOWS, unattributed: 0 }, client, opts("internal"));
    assert.equal(internal.channels[0]!.costText, RATE_NOT_SET);
    assert.equal(internal.channels[0]!.rateNotSet, true);
    assert.equal(internal.channels[0]!.costPerClickText, "—");
    assert.equal(internal.rateHref, "/clients/c1?tab=d2c");
    const share = buildDirectToFan({ rows, rate: { rate: null, currency: "GBP" }, shows: SHOWS, unattributed: 0 }, client, opts("share"));
    assert.equal(share.channels[0]!.costText, "—");
    assert.equal(share.channels[0]!.rateNotSet, false);
    assert.equal(share.rateHref, null);
    assert.doesNotMatch(JSON.stringify(share), /Rate not set|£0\b/);
  });

  it("is delivered × the client's rate when set", () => {
    const m = buildDirectToFan({ rows, rate: { rate: 0.05, currency: "GBP" }, shows: SHOWS, unattributed: 0 }, client, opts("share"));
    assert.equal(m.channels[0]!.costText, "£50");
    assert.equal(m.channels[0]!.costPerClickText, "£1.00");
    assert.equal(m.channels[0]!.clickRateText, "5.0 %");
  });
});

describe("Direct-to-fan · whole-list and unattributed sends (PI6)", () => {
  const rows = [
    row({ attribution: "show", event_id: "e1" }),
    row({ attribution: "show", event_id: "e3" }),
    row({ attribution: "client", provider: "mailchimp", channel: "email", list_id: "aud-nc", read: null }),
    row({ attribution: "client", provider: "mailchimp", channel: "email", list_id: "aud-bx", read: null }),
    row({ attribution: "client" }),
    row({ attribution: "unattributed", client_id: null }),
  ];
  const input = { rows, rate: { rate: null, currency: "GBP" }, shows: SHOWS, unattributed: 3 };

  it("never puts a whole-list send in a show's figures", () => {
    const show = scopeRows(rows, SHOWS, { kind: "show", label: "Locklead", eventId: "e1" });
    assert.deepEqual(show.map((r) => r.attribution), ["show"]);
    const m = buildDirectToFan(input, { kind: "show", label: "Locklead", eventId: "e1" }, opts("internal"));
    assert.equal(m.totalsLine, "Locklead · 1 send · 1 Nov");
    assert.equal(m.showColumn, false);
  });

  it("draws the Send column only when some send has a name, keeping '—' for the ones that don't", () => {
    const named = buildDirectToFan({ ...input, rows: [row({ attribution: "show", event_id: "e1" }), row({ attribution: "show", event_id: "e1", name: null })] }, client, opts("internal"));
    assert.equal(named.nameColumn, true);
    assert.deepEqual(named.sends.map((s) => s.name).sort(), ["—", named.sends.find((s) => s.name !== "—")!.name].sort());
    const unnamed = buildDirectToFan({ ...input, rows: [row({ attribution: "show", event_id: "e1", name: null })] }, client, opts("internal"));
    assert.equal(unnamed.nameColumn, false);
  });

  it("lists whole-list sends as 'Whole list' on the client view, and the totals line says how many", () => {
    const m = buildDirectToFan(input, client, opts("internal"));
    assert.equal(m.sends.filter((s) => s.showText === WHOLE_LIST).length, 3);
    assert.equal(m.totalsLine, "Electric Group · 5 sends · 1 Nov · includes 3 whole-list sends");
    assert.ok(!m.sends.some((s) => s.showText === "—"));
  });

  it("counts a whole-list send on a venue only when its audience is that venue's", () => {
    assert.deepEqual([...venueAudiences(SHOWS, "newcastle")], ["aud-nc"]);
    assert.deepEqual([...venueAudiences(SHOWS, "brixton")], []);
    const nc = scopeRows(rows, SHOWS, { kind: "venue", label: "NX Newcastle", venueKey: "newcastle" });
    assert.deepEqual(nc.map((r) => [r.attribution, r.event_id ?? r.list_id]), [["show", "e1"], ["client", "aud-nc"]]);
    const bx = scopeRows(rows, SHOWS, { kind: "venue", label: "Electric Brixton", venueKey: "brixton" });
    assert.deepEqual(bx.map((r) => r.event_id), ["e3"]);
  });

  it("shows unattributed sends as one internal review line only", () => {
    const internal = buildDirectToFan(input, client, opts("internal"));
    assert.equal(internal.reviewLine, "3 sends on a shared account couldn't be tied to a client.");
    const share = buildDirectToFan(input, client, opts("share"));
    assert.equal(share.reviewLine, null);
    assert.ok(!scopeRows(rows, SHOWS, client).some((r) => r.attribution === "unattributed"));
  });
});

describe("Direct-to-fan · EV4 on the Electric dry-run figures", () => {
  it("compares click rates, never open rates", () => {
    const m = electric("internal");
    assert.equal(m.channels[0]!.clickRateText, "1.9 %");
    assert.equal(m.channels[1]!.clickRateText, "0.52 %");
    assert.equal(m.channels[1]!.readOpenedText, "11.1 %");
    assert.equal(m.channels[0]!.readOpenedText, "57.9 % read");
    assert.match(m.headline!, /^WhatsApp's click rate is 3\.68× email's\. Clicks are the like-for-like figure/);
    // PT5: the span starts at the earliest of the 281 (1 Dec 2022), not the oldest row shown (Folamour, 10 Sep).
    assert.equal(m.totalsLine, "Electric Group · 281 sends · 1 Dec 2022 – 13 Nov 2026 · includes 196 whole-list sends and 32 sends not tied to a show");
  });

  it("orders the phone list by click rate and keeps 'Rate not set' internal", () => {
    const internal = electric("internal");
    assert.deepEqual(internal.phone.rates.map((r) => r.label), ["WhatsApp", "Email · tickets", "Email · marketing"]);
    assert.deepEqual(internal.phone.costs.map((c) => `${c.label} ${c.text}`), ["WhatsApp Rate not set", "email —"]);
    assert.deepEqual(electric("share").phone.costs.map((c) => `${c.label} ${c.text}`), ["WhatsApp —", "email —"]);
  });
});

describe("Direct-to-fan · sends not tied to a show (migration 248)", () => {
  const rows = [
    row({ attribution: "show", event_id: "e1" }),
    row({ attribution: "client", provider: "mailchimp", channel: "email", list_id: "aud-nc", read: null }),
    row({ attribution: "not_tied" }),
    row({ attribution: "not_tied", provider: "mailchimp", channel: "email", list_id: "aud-nc", read: null }),
    row({ attribution: "unattributed", client_id: null }),
  ];
  const input = { rows, rate: { rate: null, currency: "GBP" }, shows: SHOWS, unattributed: 1 };

  it("count in the client's totals, read 'Not tied to a show', and aren't whole-list sends", () => {
    const m = buildDirectToFan(input, client, opts("internal"));
    assert.equal(m.sends.length, 4);
    assert.equal(m.sends.filter((s) => s.showText === NOT_TIED).length, 2);
    assert.equal(m.sends.filter((s) => s.showText === WHOLE_LIST).length, 1);
    assert.match(m.totalsLine ?? "", /includes 1 whole-list send and 2 sends not tied to a show$/);
  });

  it("never count in a show; on a venue only when the Mailchimp audience is that venue's", () => {
    const show = scopeRows(rows, SHOWS, { kind: "show", label: "Locklead", eventId: "e1" });
    assert.deepEqual(show.map((r) => r.attribution), ["show"]);
    const nc = scopeRows(rows, SHOWS, { kind: "venue", label: "NX Newcastle", venueKey: "newcastle" });
    assert.deepEqual(nc.map((r) => r.attribution), ["show", "client", "not_tied"]);
  });

  it("DF1: Azyr's tier-list send is the show's, and the whole-list row is the NX Loves send", () => {
    const m = electric("internal");
    assert.equal(m.sends.find((s) => s.name === "Azyr - presale live v2")!.showText, "AZYR b2b Partiboi69");
    assert.equal(m.sends.find((s) => s.name === "Locklead- Announcement")!.showText, WHOLE_LIST);
    assert.match(m.totalsLine ?? "", /includes 196 whole-list sends and 32 sends not tied to a show$/);
    // PT5: Folamour's presale is the not-tied row.
    assert.equal(m.sends.find((s) => s.name === "Folamour - Presale")!.showText, NOT_TIED);
    assert.equal(m.unreadLine, null);
  });
});

describe("Direct-to-fan · totals line and review lines (PT1)", () => {
  it("drops a zero clause, and the whole clause when both are zero", () => {
    assert.equal(includesClause(3, 2), "includes 3 whole-list sends and 2 sends not tied to a show");
    assert.equal(includesClause(1, 1), "includes 1 whole-list send and 1 send not tied to a show");
    assert.equal(includesClause(0, 4), "includes 4 sends not tied to a show");
    assert.equal(includesClause(5, 0), "includes 5 whole-list sends");
    assert.equal(includesClause(0, 0), null);
    const m = buildDirectToFan({ rows: [row({ attribution: "show", event_id: "e1" })], rate: { rate: null, currency: "GBP" }, shows: SHOWS, unattributed: 0 }, client, opts("internal"));
    assert.equal(m.totalsLine, "Electric Group · 1 send · 1 Nov");
  });

  it("says, internally only, how many not-tied sends had an audience that couldn't be read, apart from the unattributed line", () => {
    const rows = [
      row({ attribution: "not_tied", audience_mode: null }),
      row({ attribution: "not_tied", audience_mode: null }),
      row({ attribution: "not_tied", audience_mode: "any" }),
      row({ attribution: "unattributed", client_id: null }),
    ];
    const input = { rows, rate: { rate: null, currency: "GBP" }, shows: SHOWS, unattributed: 1 };
    const internal = buildDirectToFan(input, client, opts("internal"));
    assert.equal(internal.unreadLine, "2 sends' audiences couldn't be read, so they aren't tied to a show.");
    assert.equal(internal.reviewLine, "1 send on a shared account couldn't be tied to a client.");
    assert.match(internal.totalsLine, /includes 3 sends not tied to a show$/);
    const share = buildDirectToFan(input, client, opts("share"));
    assert.equal(share.unreadLine, null);
    assert.equal(share.reviewLine, null);
    const one = buildDirectToFan({ ...input, rows: [row({ attribution: "not_tied", audience_mode: null })] }, client, opts("internal"));
    assert.equal(one.unreadLine, "1 send's audience couldn't be read, so it isn't tied to a show.");
  });
});

describe("Direct-to-fan · dates and the year rule", () => {
  // A fixed "now", never the machine clock: 15 Nov 2026, so 2026 is the current year in London.
  const NOW = Date.parse("2026-11-15T12:00:00Z");

  it("starts the span at the real first send when one is given", () => {
    assert.equal(sendSpan(["2026-11-13T12:00:00Z", "2026-09-10T12:00:00Z"], "2026-07-03T17:23:48Z", NOW), "3 Jul – 13 Nov");
    assert.equal(sendSpan([], null, NOW), null);
  });

  it("a span across years names both years", () => {
    assert.equal(sendSpan(["2026-11-13T12:00:00Z"], "2022-12-01T11:19:04+00:00", NOW), "1 Dec 2022 – 13 Nov 2026");
    assert.equal(sendSpan(["2024-02-01T12:00:00Z", "2025-03-01T12:00:00Z"], null, NOW), "1 Feb 2024 – 1 Mar 2025");
  });

  it("a span wholly inside an earlier year names the year once, at the end", () => {
    assert.equal(sendSpan(["2025-07-03T12:00:00Z", "2025-11-13T12:00:00Z"], null, NOW), "3 Jul – 13 Nov 2025");
    assert.equal(sendSpan(["2025-11-13T12:00:00Z"], null, NOW), "13 Nov 2025");
  });

  it("a span inside the current year has no year", () => {
    assert.equal(sendSpan(["2026-11-13T12:00:00Z", "2026-09-10T12:00:00Z"], null, NOW), "10 Sep – 13 Nov");
    assert.equal(sendSpan(["2026-11-13T12:00:00Z"], null, NOW), "13 Nov");
  });

  it("the year is London's: 31 Dec 23:30 GMT is still that year", () => {
    assert.equal(sendDate("2025-12-31T23:30:00Z", NOW), "31 Dec 2025");
    assert.equal(sendDate("2026-01-01T00:30:00Z", NOW), "1 Jan");
    assert.equal(londonYear(Date.parse("2026-12-31T23:30:00Z")), "2026");
  });

  it("a Sends row from an earlier year shows its year; a current-year row doesn't", () => {
    assert.equal(sendDate("2022-12-01T11:19:04+00:00", NOW), "1 Dec 2022");
    assert.equal(sendDate("2026-11-13T12:00:00Z", NOW), "13 Nov");
    assert.equal(sendDate(null, NOW), "—");
    const rows = [
      row({ sent_at: "2022-12-01T11:19:04+00:00", provider: "mailchimp", channel: "email", read: null }),
      row({ sent_at: "2026-11-13T12:00:00Z" }),
    ];
    const m = buildDirectToFan({ rows, rate: { rate: null, currency: "GBP" }, shows: SHOWS, unattributed: 0 }, client, { ...opts("internal"), nowMs: NOW });
    assert.deepEqual(m.sends.map((s) => s.dayText).sort(), ["1 Dec 2022", "13 Nov"]);
    assert.match(m.totalsLine, / · 1 Dec 2022 – 13 Nov 2026 · /);
    // The same rows a year on: both are earlier-year rows.
    const later = buildDirectToFan({ rows, rate: { rate: null, currency: "GBP" }, shows: SHOWS, unattributed: 0 }, client, { ...opts("internal"), nowMs: Date.parse("2027-06-01T12:00:00Z") });
    assert.deepEqual(later.sends.map((s) => s.dayText).sort(), ["1 Dec 2022", "13 Nov 2026"]);
  });

  it("DF1's rows are this year's, so none shows a year", () => {
    const m = electric("internal");
    assert.ok(m.sends.every((s) => !/\d{4}$/.test(s.dayText)));
  });
});

describe("Direct-to-fan · the umbrella page on a venue view (PT3)", () => {
  // NX26-GLOBAL: Electric's umbrella event, page nx-loves-aw26, at NX Newcastle, no audience of its own.
  const UMBRELLA_SHOWS: D2CShowVenue[] = [
    ...SHOWS,
    { id: "u1", venue_key: "newcastle", mailchimp_audience_id: null, is_umbrella: true, cirqlin_page_slug: "nx-loves-aw26" },
  ];
  const nc: D2CScope = { kind: "venue", label: "NX Newcastle", venueKey: "newcastle" };
  const bx: D2CScope = { kind: "venue", label: "Electric Brixton", venueKey: "brixton" };
  const umbrellaRef = (name: string) => [{ id: "l-u", name, include: true }];

  it("a Bird send to CQ-nx-loves-aw26 shows on NX Newcastle's venue view and in no show", () => {
    const bird = row({ attribution: "client", audience_refs: umbrellaRef("CQ-nx-loves-aw26") });
    const rows = [bird];
    assert.deepEqual(scopeRows(rows, UMBRELLA_SHOWS, nc).map((r) => r.id), [bird.id]);
    assert.deepEqual(scopeRows(rows, UMBRELLA_SHOWS, bx), []);
    for (const id of ["e1", "e2", "u1"]) assert.deepEqual(scopeRows(rows, UMBRELLA_SHOWS, { kind: "show", label: id, eventId: id }), []);
    const m = buildDirectToFan({ rows, rate: { rate: null, currency: "GBP" }, shows: UMBRELLA_SHOWS, unattributed: 0 }, nc, opts("internal"));
    assert.equal(m.sends[0]!.showText, WHOLE_LIST);
  });

  it("counts the umbrella's tiers and a Mailchimp send off the venue's audience, by name as stored", () => {
    const tier = row({ attribution: "client", audience_refs: umbrellaRef("CQ-nx-loves-aw26-opted-in") });
    const mc = row({ attribution: "client", provider: "mailchimp", channel: "email", list_id: "aud-other", read: null, audience_refs: umbrellaRef("CQ-nx-loves-aw26-Together") });
    const folded = row({ attribution: "client", audience_refs: umbrellaRef("cq-nx-loves-aw26") });
    const excluded = row({ attribution: "client", audience_refs: [{ id: "l-u", name: "CQ-nx-loves-aw26", include: false }] });
    const notTied = row({ attribution: "not_tied", audience_refs: umbrellaRef("CQ-nx-loves-aw26") });
    const plain = row({ attribution: "client" });
    const ids = scopeRows([tier, mc, folded, excluded, notTied, plain], UMBRELLA_SHOWS, nc).map((r) => r.id);
    assert.deepEqual(ids, [tier.id, mc.id]);
  });

  it("an umbrella event at another venue doesn't count there", () => {
    const shows: D2CShowVenue[] = [...SHOWS, { id: "u2", venue_key: "brixton", mailchimp_audience_id: null, is_umbrella: true, cirqlin_page_slug: "nx-loves-aw26" }];
    const bird = row({ attribution: "client", audience_refs: umbrellaRef("CQ-nx-loves-aw26") });
    assert.deepEqual(scopeRows([bird], shows, nc), []);
    assert.deepEqual(scopeRows([bird], shows, bx).map((r) => r.id), [bird.id]);
  });
});
