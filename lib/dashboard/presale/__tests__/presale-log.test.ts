import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fakeDb } from "../../../audience-breakdowns/__tests__/fake-db.ts";
import {
  communityHeadline,
  communityHeadlineWords,
  enteredMemberCounts,
  latestMemberCount,
  pageAudienceWithEnteredCount,
  withEnteredMemberCount,
} from "../community-headline.ts";
import { parseCount, parseDay, parsePrice, parseWindowStart, presaleLogFieldUpdate } from "../form.ts";
import {
  ADD_WINDOW_FIGURES,
  buildPresaleLog,
  dayIn,
  enteredByWords,
  formatDay,
  META_SIGNUP_SPEND,
  presaleDayCount,
  signupsAtPresaleLabel,
  type Figure,
  type InternalCount,
  type PresaleInputs,
  type PresaleLogRow,
} from "../model.ts";
import { adminNameLookup, resolveEnteredNames } from "../names.ts";
import { isMissingPresaleTable, loadMailchimpDayCount, loadPresaleLog, loadRegistrationSpend } from "../read.ts";

// Fixtures: show names and figures only. The EV2 figures are Ironworks Season 1's
// Charlotte de Witte presale as the season report has them (5 Aug).
const PRESALE = "2026-08-05T09:00:00Z"; // 10:00 London (BST)
const USER = "00000000-0000-4000-8000-000000000001";
const asDb = (db: unknown) => db as SupabaseClient;

const val = <T>(f: Figure<T>): T => {
  assert.equal(f.kind, "value", `expected a value, got ${JSON.stringify(f)}`);
  return (f as Extract<Figure<T>, { kind: "value" }>).value;
};
const src = (f: Figure<unknown>) => (f.kind === "value" ? f.source : null);
const reason = (f: Figure<unknown>) => (f.kind === "missing" ? f.reason : null);

function emptyLog(): PresaleLogRow {
  return {
    window_start_at: null,
    window_start_entered_by: null,
    window_start_entered_at: null,
    sold_in_window: null,
    sold_in_window_entered_by: null,
    sold_in_window_entered_at: null,
    avg_ticket_price: null,
    avg_ticket_price_entered_by: null,
    avg_ticket_price_entered_at: null,
    presale_day_tickets: null,
    presale_day_tickets_entered_by: null,
    presale_day_tickets_entered_at: null,
  };
}

function inputs(over: Partial<PresaleInputs> = {}): PresaleInputs {
  return {
    eventId: "cdw",
    presaleAt: PRESALE,
    log: null,
    relaunches: [],
    memberCounts: [],
    signupDays: [
      { day: "2026-08-01", signups: 8000 },
      { day: "2026-08-04", signups: 6500 },
      { day: "2026-08-05", signups: 1300 },
      { day: "2026-08-06", signups: 3 },
    ],
    internalCounts: [],
    registrationSpend: 5771.82,
    ...over,
  };
}

const EV2_LOG: PresaleLogRow = {
  ...emptyLog(),
  sold_in_window: 4000,
  sold_in_window_entered_by: USER,
  sold_in_window_entered_at: "2026-08-06T10:00:00Z",
  presale_day_tickets: 6600,
  presale_day_tickets_entered_by: USER,
  presale_day_tickets_entered_at: "2026-08-06T10:00:00Z",
};
const EV2_COMMUNITY = [{ counted_on: "2026-08-05", members: 7100, entered_by: USER, entered_at: "2026-08-05T08:00:00Z" }];

describe("nothing entered: the counted half and \"Add the window figures\"", () => {
  it("is empty with the prompt, and still counts what it can", () => {
    const log = buildPresaleLog(inputs());
    assert.equal(log.state, "empty");
    assert.equal(log.prompt, ADD_WINDOW_FIGURES);
    assert.equal(ADD_WINDOW_FIGURES, "Add the window figures");
    assert.equal(val(log.signupsAtPresale), 14500);
    assert.equal(src(log.signupsAtPresale), "counted");
    assert.equal(val(log.registrationSpend), 5771.82);
    assert.equal(reason(log.soldInWindow), "not_entered");
    assert.equal(reason(log.communityAtPresale), "not_entered");
    assert.equal(reason(log.presaleDayTickets), "no_count_within_24h");
    assert.equal(reason(log.communityConversion), "needs_inputs");
  });

  it("an entered member count alone ends the empty state", () => {
    assert.equal(buildPresaleLog(inputs({ memberCounts: EV2_COMMUNITY })).state, "entered");
  });
});

describe("window start", () => {
  it("defaults to presale open − 30 min, derived", () => {
    const f = buildPresaleLog(inputs()).windowStart;
    assert.equal(val(f), "2026-08-05T08:30:00.000Z");
    assert.equal(src(f), "derived");
  });

  it("an entered start wins and carries who and when", () => {
    const f = buildPresaleLog(
      inputs({ log: { ...emptyLog(), window_start_at: "2026-08-05T08:15:00Z", window_start_entered_by: USER, window_start_entered_at: "2026-08-04T12:00:00Z" } }),
    ).windowStart;
    assert.equal(val(f), "2026-08-05T08:15:00Z");
    assert.equal(src(f), "entered");
    assert.deepEqual(f.kind === "value" && f.entered, { by: USER, at: "2026-08-04T12:00:00Z", name: null });
  });

  it("no presale time: nothing tied to the open", () => {
    const log = buildPresaleLog(inputs({ presaleAt: null }));
    assert.equal(reason(log.windowStart), "no_presale_time");
    assert.equal(reason(log.signupsAtPresale), "no_presale_time");
    assert.equal(reason(log.presaleDayTickets), "no_presale_time");
  });
});

describe("signups at presale (CIRQLIN)", () => {
  it("counts the days before the presale day, and says where it stops", () => {
    const f = buildPresaleLog(inputs()).signupsAtPresale;
    assert.equal(val(f), 14500);
    assert.deepEqual(f.kind === "value" && f.detail, { fromDay: "2026-08-01", throughDay: "2026-08-04" });
  });

  it("the presale day is London's: 00:30 BST on 5 Aug is 4 Aug in UTC", () => {
    assert.equal(dayIn("2026-08-04T23:30:00Z", "Europe/London"), "2026-08-05");
    const f = buildPresaleLog(inputs({ presaleAt: "2026-08-04T23:30:00Z" })).signupsAtPresale;
    assert.equal(val(f), 14500);
  });

  it("no CIRQLIN history, or none before presale", () => {
    assert.equal(reason(buildPresaleLog(inputs({ signupDays: null })).signupsAtPresale), "no_cirqlin_signups");
    assert.equal(reason(buildPresaleLog(inputs({ signupDays: [{ day: "2026-08-05", signups: 10 }] })).signupsAtPresale), "no_signups_before_presale");
  });

  it("names its last day, the weekday worked out from the date", () => {
    assert.equal(buildPresaleLog(inputs()).signupsAtPresaleLabel, "Signups at presale · to Tue 4 Aug");
    assert.equal(signupsAtPresaleLabel("2026-08-05"), "Signups at presale · to Tue 4 Aug");
    assert.equal(formatDay("2025-08-04"), "Mon 4 Aug", "a year earlier the same date was a Monday");
    assert.equal(signupsAtPresaleLabel("2026-03-01"), "Signups at presale · to Sat 28 Feb");
    assert.equal(buildPresaleLog(inputs({ presaleAt: null })).signupsAtPresaleLabel, null);
  });
});

describe("signups at presale: the Mailchimp fallback for a show without CIRQLIN", () => {
  const TAG = "Charlotte De Witte - October 2026";

  it("the tag's stored count for the day before presale, named as its source", () => {
    const f = buildPresaleLog(inputs({ signupDays: null, mailchimp: { tag: TAG, day: "2026-08-04", subscribers: 12868 } })).signupsAtPresale;
    assert.equal(val(f), 12868);
    assert.equal(src(f), "counted");
    assert.equal(f.kind === "value" && f.from, `Mailchimp · ${TAG} · Tue 4 Aug`);
    assert.deepEqual(f.kind === "value" && f.detail, { tag: TAG, throughDay: "2026-08-04" });
  });

  it("no row for that day: missing, never a nearer day", () => {
    assert.equal(reason(buildPresaleLog(inputs({ signupDays: null, mailchimp: { tag: TAG, day: "2026-08-04", subscribers: null } })).signupsAtPresale), "no_mailchimp_count_for_day");
    assert.equal(reason(buildPresaleLog(inputs({ signupDays: null, mailchimp: { tag: TAG, day: "2026-08-05", subscribers: 14206 } })).signupsAtPresale), "no_mailchimp_count_for_day");
  });

  it("CIRQLIN wins when it has history; no tag stays no_cirqlin_signups", () => {
    assert.equal(val(buildPresaleLog(inputs({ mailchimp: { tag: TAG, day: "2026-08-04", subscribers: 12868 } })).signupsAtPresale), 14500);
    assert.equal(reason(buildPresaleLog(inputs({ signupDays: null, mailchimp: null })).signupsAtPresale), "no_cirqlin_signups");
  });

  it("the wider conversion works from the Mailchimp figure", () => {
    const l = buildPresaleLog(inputs({ signupDays: null, mailchimp: { tag: TAG, day: "2026-08-04", subscribers: 12868 }, log: EV2_LOG, memberCounts: EV2_COMMUNITY }));
    assert.equal(val(l.widerConversion).toFixed(4), ((6600 - 4000) / (12868 - 7100)).toFixed(4));
  });
});

describe("Meta signup spend and entered-by names", () => {
  it("registration spend is named \"Meta signup spend\"", () => {
    const f = buildPresaleLog(inputs()).registrationSpend;
    assert.equal(META_SIGNUP_SPEND, "Meta signup spend");
    assert.equal(f.kind === "value" && f.from, "Meta signup spend");
  });

  it("an entered figure carries the person's name, and the words read it", () => {
    const l = buildPresaleLog(inputs({ log: EV2_LOG, memberCounts: EV2_COMMUNITY, names: new Map([[USER, "Ops"]]) }));
    const e = l.soldInWindow.kind === "value" ? l.soldInWindow.entered : null;
    assert.deepEqual(e, { by: USER, at: EV2_LOG.sold_in_window_entered_at, name: "Ops" });
    assert.equal(enteredByWords(e!), "entered by Ops, 6 Aug");
    assert.equal(enteredByWords({ ...e!, name: null }), "entered 6 Aug");
    assert.equal(l.communityAtPresale.kind === "value" && l.communityAtPresale.entered?.name, "Ops");
  });

  it("the admin lookup gives a first name, never an email; without the service role the name is unknown", async () => {
    const ok = adminNameLookup({ auth: { admin: { getUserById: async () => ({ data: { user: { email: "ops@example.com", user_metadata: { full_name: "Ops Team" } } }, error: null }) } } });
    assert.deepEqual([...(await resolveEnteredNames([USER, USER, null], ok))], [[USER, "Ops"]]);
    const local = adminNameLookup({ auth: { admin: { getUserById: async () => ({ data: { user: { email: "ops@example.com", user_metadata: {} } }, error: null }) } } });
    assert.equal((await resolveEnteredNames([USER], local)).get(USER), "ops");
    const denied = adminNameLookup({ auth: { admin: { getUserById: async () => { throw new Error("User not allowed"); } } } });
    assert.equal((await resolveEnteredNames([USER], denied)).size, 0);
    assert.equal(adminNameLookup({ from() {} }), null);
  });
});

describe("community at presale (entered, PB4)", () => {
  it("takes the entered count nearest before presale, never a later one", () => {
    const f = buildPresaleLog(
      inputs({
        memberCounts: [
          { counted_on: "2026-07-30", members: 5200, entered_by: USER, entered_at: "2026-07-30T09:00:00Z" },
          { counted_on: "2026-08-05", members: 7100, entered_by: USER, entered_at: "2026-08-05T08:00:00Z" },
          { counted_on: "2026-08-09", members: 9800, entered_by: USER, entered_at: "2026-08-09T09:00:00Z" },
        ],
      }),
    ).communityAtPresale;
    assert.equal(val(f), 7100);
    assert.equal(src(f), "entered");
    assert.deepEqual(f.kind === "value" && f.detail, { countedOn: "2026-08-05" });
  });

  it("without an entered count it's missing, not today's community_joined", () => {
    const f = buildPresaleLog(inputs({ memberCounts: [{ counted_on: "2026-08-09", members: 9800, entered_by: USER, entered_at: "2026-08-09T09:00:00Z" }] })).communityAtPresale;
    assert.equal(reason(f), "not_entered");
  });
});

describe("presale-day tickets (Internal Counts, the 24-hour rule)", () => {
  const count = (id: string, landedAt: string, paid: number, pence: number | null = null): InternalCount => ({ blockId: id, landedAt, countDate: landedAt.slice(0, 10), paid, paidRevenuePence: pence });

  it("counts the latest count within 24 h after the open, less the last count before it", () => {
    const counts = [count("a", "2026-08-04T17:00:00Z", 20), count("b", "2026-08-05T18:00:00Z", 6000), count("c", "2026-08-06T08:59:00Z", 6620), count("d", "2026-08-07T09:00:00Z", 7400)];
    const c = presaleDayCount(counts, PRESALE);
    assert.equal(c?.tickets, 6600);
    assert.equal(c?.used.blockId, "c");
    const f = buildPresaleLog(inputs({ internalCounts: counts, log: EV2_LOG })).presaleDayTickets;
    assert.equal(val(f), 6600);
    assert.equal(src(f), "counted");
    assert.equal(f.kind === "value" && f.from, "Internal Counts");
  });

  it("a count 25 h after the open doesn't count: the entered figure is used, marked entered", () => {
    const f = buildPresaleLog(inputs({ internalCounts: [count("late", "2026-08-06T10:00:00Z", 7000)], log: EV2_LOG })).presaleDayTickets;
    assert.equal(val(f), 6600);
    assert.equal(src(f), "entered");
  });

  it("exactly at the open isn't after it", () => {
    assert.equal(presaleDayCount([count("x", PRESALE, 50)], PRESALE), null);
  });
});

describe("derived figures, with EV2's numbers", () => {
  const log = buildPresaleLog(inputs({ log: EV2_LOG, memberCounts: EV2_COMMUNITY }));

  it("community conversion: window sales ÷ members (EV2: 56.3 %)", () => {
    assert.equal((val(log.communityConversion) * 100).toFixed(1), "56.3");
    assert.equal(src(log.communityConversion), "derived");
  });

  it("wider conversion: later presale-day sales ÷ (signups − members)", () => {
    assert.equal(val(log.widerConversion), 2600 / 7400);
  });

  it("signup spend per presale ticket (EV2: £0.87)", () => {
    assert.equal(val(log.signupSpendPerPresaleTicket).toFixed(2), "0.87");
  });

  it("no registration spend: no spend per ticket", () => {
    const l = buildPresaleLog(inputs({ log: EV2_LOG, registrationSpend: null }));
    assert.equal(reason(l.registrationSpend), "no_registration_spend");
    assert.equal(reason(l.signupSpendPerPresaleTicket), "needs_inputs");
  });

  it("community at or above signups isn't a conversion", () => {
    const l = buildPresaleLog(inputs({ log: EV2_LOG, memberCounts: [{ ...EV2_COMMUNITY[0]!, members: 15000 }] }));
    assert.equal(reason(l.widerConversion), "not_meaningful");
  });
});

describe("presale return (est.)", () => {
  it("needs an average price; is always est.", () => {
    const none = buildPresaleLog(inputs({ log: EV2_LOG }));
    assert.equal(reason(none.averageTicketPrice), "not_entered");
    assert.equal(reason(none.presaleReturn), "needs_inputs");
    const l = buildPresaleLog(inputs({ log: { ...EV2_LOG, avg_ticket_price: "30.00", avg_ticket_price_entered_by: USER, avg_ticket_price_entered_at: "2026-08-06T10:00:00Z" } }));
    assert.equal(val(l.averageTicketPrice), 30);
    assert.equal(val(l.presaleRevenue), 198000);
    assert.equal(src(l.presaleRevenue), "est.");
    assert.equal(val(l.presaleReturn), 198000 / 5771.82);
    assert.equal(src(l.presaleReturn), "est.");
  });

  it("without an entered price, the presale-day count's own revenue gives one, unless Internal Counts holds it", () => {
    const counts: InternalCount[] = [{ blockId: "c", landedAt: "2026-08-05T20:00:00Z", countDate: "2026-08-05", paid: 6600, paidRevenuePence: 19_800_000 }];
    const l = buildPresaleLog(inputs({ internalCounts: counts }));
    assert.equal(val(l.averageTicketPrice), 30);
    assert.equal(src(l.averageTicketPrice), "derived");
    const held = buildPresaleLog(inputs({ internalCounts: [{ ...counts[0]!, paidRevenuePence: null }] }));
    assert.equal(reason(held.averageTicketPrice), "not_entered");
  });
});

describe("relaunches", () => {
  it("counts signups since each date and keeps who entered what", () => {
    const l = buildPresaleLog(
      inputs({
        relaunches: [
          { id: "r1", relaunched_on: "2026-08-05", what_we_did: "Second presale on the waiting list", entered_by: USER, entered_at: "2026-08-05T12:00:00Z", result: null, result_entered_by: null, result_entered_at: null },
        ],
      }),
    );
    const r = l.relaunches[0]!;
    assert.equal(val(r.signupsSince), 1303);
    assert.equal(src(r.signupsSince), "counted");
    assert.equal(src(r.whatWeDid), "entered");
    assert.equal(reason(r.result), "not_entered");
    assert.equal(l.state, "entered");
  });
});

describe("form parsing", () => {
  it("counts and prices", () => {
    assert.deepEqual(parseCount("4,000", "x"), { ok: true, value: 4000 });
    assert.deepEqual(parseCount("  ", "x"), { ok: true, value: null });
    assert.equal(parseCount("4.5", "x").ok, false);
    assert.equal(parseCount("-1", "x").ok, false);
    assert.deepEqual(parsePrice("£27.50"), { ok: true, value: 27.5 });
    assert.equal(parsePrice("0").ok, false);
    assert.equal(parsePrice("27.555").ok, false);
    assert.deepEqual(parseDay("2026-08-05", "d"), { ok: true, value: "2026-08-05" });
    assert.equal(parseDay("2026-02-30", "d").ok, false);
  });

  it("a wall-clock window start is London time, either side of a clock change", () => {
    assert.deepEqual(parseWindowStart("2026-08-05T09:30"), { ok: true, value: "2026-08-05T08:30:00.000Z" });
    assert.deepEqual(parseWindowStart("2026-12-05 09:30"), { ok: true, value: "2026-12-05T09:30:00.000Z" });
    assert.deepEqual(parseWindowStart("2026-08-05T09:30:00+01:00"), { ok: true, value: "2026-08-05T08:30:00.000Z" });
    assert.deepEqual(parseWindowStart(""), { ok: true, value: null });
    assert.equal(parseWindowStart("tomorrow").ok, false);
  });

  it("a figure and its entered pair are set and cleared together; entered_by is the session user", () => {
    const set = presaleLogFieldUpdate("soldInWindow", "4,000", USER, "2026-08-06T10:00:00Z");
    assert.deepEqual(set, { ok: true, value: { sold_in_window: 4000, sold_in_window_entered_by: USER, sold_in_window_entered_at: "2026-08-06T10:00:00Z", updated_at: "2026-08-06T10:00:00Z" } });
    const clear = presaleLogFieldUpdate("windowStart", "", USER, "2026-08-06T10:00:00Z");
    assert.deepEqual(clear, { ok: true, value: { window_start_at: null, window_start_entered_by: null, window_start_entered_at: null, updated_at: "2026-08-06T10:00:00Z" } });
    assert.equal(presaleLogFieldUpdate("avgTicketPrice", "abc", USER, "t").ok, false);
  });
});

describe("HE2 adapter: enteredMemberCount and PA3's headline", () => {
  const fig = { eventId: "cdw", pageId: "p", communityJoined: 6200, communityLinkClicks: 8000, signups: 14500 };

  it("an entered count leads, with community_joined under it", () => {
    const out = withEnteredMemberCount(fig, EV2_COMMUNITY);
    assert.deepEqual(out.enteredMemberCount, { members: 7100, countedOn: "2026-08-05", entered: { by: USER, at: "2026-08-05T08:00:00Z", name: null } });
    assert.deepEqual(out.headline, { source: "entered", members: 7100, countedOn: "2026-08-05", entered: { by: USER, at: "2026-08-05T08:00:00Z", name: null }, joinedFromSignups: 6200 });
    assert.equal(out.signups, 14500, "HE2's own fields pass through");
  });

  it("without one: community_joined (0 included), and link clicks only when the read had none", () => {
    assert.deepEqual(communityHeadline(fig, null), { source: "community_joined", joined: 6200 });
    assert.deepEqual(communityHeadline({ ...fig, communityJoined: 0 }, null), { source: "community_joined", joined: 0 });
    assert.deepEqual(communityHeadline({ ...fig, communityJoined: null }, null), { source: "link_clicks_est", clicks: 8000 });
    assert.deepEqual(communityHeadline(null, null), { source: "none" });
  });

  it("the words: 0 reads \"0 joined from signups\"; link clicks only without community_joined", () => {
    assert.deepEqual(communityHeadlineWords(communityHeadline({ ...fig, communityJoined: 0 }, null)), { headline: "0 joined from signups", source: "CIRQLIN · exact", joinedLine: null });
    assert.deepEqual(communityHeadlineWords(communityHeadline(fig, null)), { headline: "6,200 joined from signups", source: "CIRQLIN · exact", joinedLine: null });
    assert.deepEqual(communityHeadlineWords(communityHeadline({ ...fig, communityJoined: null }, null)), { headline: "8,000 community link clicks", source: "est.", joinedLine: null });
    assert.equal(communityHeadlineWords(communityHeadline(null, null)), null);
    const entered = withEnteredMemberCount({ ...fig, communityJoined: 0 }, EV2_COMMUNITY, new Map([[USER, "Ops"]]));
    assert.deepEqual(communityHeadlineWords(entered.headline), { headline: "7,100 members", source: "entered by Ops, 5 Aug", joinedLine: "0 joined from signups · CIRQLIN" });
  });

  it("the latest count is the newest day, then the newest entry", () => {
    const latest = latestMemberCount([
      { counted_on: "2026-08-05", members: 7000, entered_by: USER, entered_at: "2026-08-05T08:00:00Z" },
      { counted_on: "2026-08-05", members: 7100, entered_by: USER, entered_at: "2026-08-05T09:00:00Z" },
      { counted_on: "2026-08-01", members: 9000, entered_by: USER, entered_at: "2026-08-10T09:00:00Z" },
    ]);
    assert.equal(latest?.members, 7100);
  });

  it("wraps the caller's pageAudienceForShow; null page stays null", async () => {
    const db = fakeDb({ community_member_counts: [{ event_id: "cdw", ...EV2_COMMUNITY[0]! }] });
    const out = await pageAudienceWithEnteredCount(asDb(db), "cdw", async () => fig);
    assert.equal(out?.enteredMemberCount?.members, 7100);
    assert.equal(await pageAudienceWithEnteredCount(asDb(db), "cdw", async () => null), null);
    assert.equal((await enteredMemberCounts(asDb(db), ["cdw", "other"])).size, 1);
    const named = await pageAudienceWithEnteredCount(asDb(db), "cdw", async () => fig, async () => "Ops");
    assert.equal(named?.enteredMemberCount?.entered.name, "Ops");
    assert.equal((await enteredMemberCounts(asDb(db), ["cdw"], async () => "Ops")).get("cdw")?.entered.name, "Ops");
  });

  it("before migration 249: no entered counts, no error", async () => {
    const db = fakeDb({}, { missing: ["community_member_counts"] });
    const out = await pageAudienceWithEnteredCount(asDb(db), "cdw", async () => fig);
    assert.equal(out?.enteredMemberCount, null);
    assert.deepEqual(out?.headline, { source: "community_joined", joined: 6200 });
  });
});

describe("the loader", () => {
  const EVENTS = [
    { id: "cdw", client_id: "irw", event_code: "IRW0006", event_date: "2026-11-01", presale_at: null, meta_campaign_id: "1001", meta_ad_account_id: null, status: "upcoming", user_id: USER },
    { id: "camel", client_id: "irw", event_code: "IRW0004", event_date: "2026-10-24", presale_at: null, meta_campaign_id: null, meta_ad_account_id: null, status: "upcoming", user_id: USER },
  ];
  const insight = (id: string, campaign: string, name: string, spend: number, event: string | null) => ({
    id,
    ad_account_id: "act_555",
    meta_campaign_id: campaign,
    campaign_name: name,
    spend,
    campaign_objective: "OUTCOME_SALES",
    optimization_goal: "OFFSITE_CONVERSIONS",
    promoted_event: event,
  });
  const tables = () => ({
    events: EVENTS,
    clients: [{ id: "irw", meta_ad_account_id: "555" }],
    ad_daily_insights: [
      insight("i1", "1001", "[IRW0006] CHARLOTTE DE WITTE - SIGNUP", 3000, "COMPLETE_REGISTRATION"),
      insight("i2", "1001", "[IRW0006] CHARLOTTE DE WITTE - SIGNUP", 2771.82, "COMPLETE_REGISTRATION"),
      insight("i3", "1002", "[IRW0006] CDW — Purchase Ads", 155.58, "PURCHASE"),
      insight("i4", "1003", "[IRW0004] CAMELPHAT - SIGNUP", 900, "COMPLETE_REGISTRATION"),
    ],
    signup_source_snapshots: [
      { id: "s0", event_id: "cdw", source: "cirqlin", day: "1970-01-01", signups_day: 0, raw_json: { reason: "no_page" } },
      { id: "s1", event_id: "cdw", source: "cirqlin", day: "2026-08-03", signups_day: 9000, raw_json: null },
      { id: "s2", event_id: "cdw", source: "cirqlin", day: "2026-08-04", signups_day: 5500, raw_json: null },
    ],
    internal_count_blocks: [
      { id: "b1", report_id: "r1", event_id: "cdw", status: "written", count_date: "2026-08-05", paid_tickets: 6600, paid_revenue_pence: null, revenue_held: true },
      { id: "b2", report_id: "r2", event_id: "cdw", status: "held", count_date: "2026-08-05", paid_tickets: 9999, paid_revenue_pence: null, revenue_held: false },
    ],
    internal_count_reports: [
      { id: "r1", sent_at: "2026-08-05T21:00:00Z", received_at: "2026-08-06T09:30:00Z" },
      { id: "r2", sent_at: "2026-08-05T21:00:00Z", received_at: "2026-08-05T21:00:00Z" },
    ],
  });

  it("before migration 249 is applied: the counted half and the prompt", async () => {
    const db = fakeDb(tables(), { missing: ["presale_logs", "presale_relaunches", "community_member_counts"] });
    const log = await loadPresaleLog(asDb(db), "cdw", { presaleAtWhenUnset: PRESALE });
    assert.ok(log);
    assert.equal(log.state, "empty");
    assert.equal(log.prompt, "Add the window figures");
    assert.equal(val(log.signupsAtPresale), 14500, "sentinel row dropped");
    assert.equal(val(log.registrationSpend), 5771.82, "signup campaign only: not the purchase campaign, not Camelphat's");
    assert.equal(val(log.presaleDayTickets), 6600, "written block, landed at the email's Date header");
    assert.equal(val(log.signupSpendPerPresaleTicket).toFixed(2), "0.87");
    for (const o of db.orders) assert.ok(o.columns.length > 0, `${o.table} is ordered for paging`);
  });

  it("no CIRQLIN page: the Mailchimp tag's 12:00Z row for the day before presale", async () => {
    const TAG = "Charlotte De Witte - October 2026";
    const snap = (id: string, at: string, n: number) => ({ id, event_id: "cdw", mailchimp_tag: TAG, snapshot_at: at, email_subscribers: n });
    const base = tables();
    const mc = [
      snap("m1", "2026-08-04T06:01:03Z", 12087),
      snap("m2", "2026-08-04T12:00:00Z", 12868),
      snap("m3", "2026-08-05T12:00:00Z", 14206),
    ];
    const events = EVENTS.map((e) => (e.id === "cdw" ? { ...e, mailchimp_tag: TAG } : e));
    const noPage = { ...base, events, signup_source_snapshots: base.signup_source_snapshots.slice(0, 1), mailchimp_tag_snapshots: mc };
    const db = fakeDb(noPage, { missing: ["presale_logs", "presale_relaunches", "community_member_counts"] });
    const log = await loadPresaleLog(asDb(db), "cdw", { presaleAtWhenUnset: PRESALE });
    assert.equal(val(log!.signupsAtPresale), 12868, "the 12:00Z row, not the 06:01 one or the presale day's");
    assert.equal(log!.signupsAtPresale.kind === "value" && log!.signupsAtPresale.from, `Mailchimp · ${TAG} · Tue 4 Aug`);
    assert.equal(log!.signupsAtPresaleLabel, "Signups at presale · to Tue 4 Aug");

    const gap = fakeDb({ ...noPage, mailchimp_tag_snapshots: [mc[0]!, mc[2]!] }, { missing: ["presale_logs", "presale_relaunches", "community_member_counts"] });
    const missingDay = await loadPresaleLog(asDb(gap), "cdw", { presaleAtWhenUnset: PRESALE });
    assert.equal(reason(missingDay!.signupsAtPresale), "no_mailchimp_count_for_day");
    assert.deepEqual(await loadMailchimpDayCount(asDb(gap), "cdw", TAG, "2026-08-04"), { tag: TAG, day: "2026-08-04", subscribers: null });

    const withPage = fakeDb({ ...base, events, mailchimp_tag_snapshots: mc }, { missing: ["presale_logs", "presale_relaunches", "community_member_counts"] });
    const cirqlin = await loadPresaleLog(asDb(withPage), "cdw", { presaleAtWhenUnset: PRESALE });
    assert.equal(val(cirqlin!.signupsAtPresale), 14500, "CIRQLIN history: Mailchimp isn't read");
    assert.ok(!withPage.orders.some((o) => o.table === "mailchimp_tag_snapshots"));
  });

  it("presale_at unset and nothing passed: no presale time", async () => {
    const log = await loadPresaleLog(asDb(fakeDb(tables())), "cdw");
    assert.equal(log?.presaleOpenAt, null);
    assert.equal(reason(log!.signupsAtPresale), "no_presale_time");
  });

  it("an event that isn't there reads null", async () => {
    assert.equal(await loadPresaleLog(asDb(fakeDb(tables())), "nope"), null);
  });

  it("registration spend: a show with no ad account reads null", async () => {
    const db = fakeDb({ ...tables(), clients: [{ id: "irw", meta_ad_account_id: null }] });
    assert.equal(await loadRegistrationSpend(asDb(db), EVENTS[0]! as never), null);
  });

  it("recognises a missing 249 table", () => {
    assert.equal(isMissingPresaleTable('relation "public.presale_logs" does not exist'), true);
    assert.equal(isMissingPresaleTable("Could not find the table 'public.community_member_counts' in the schema cache"), true);
    assert.equal(isMissingPresaleTable('relation "public.events" does not exist'), false);
  });
});
