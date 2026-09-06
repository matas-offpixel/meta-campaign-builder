import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { VIZ_STATE_WORD } from "../../viz/tokens.ts";
import type { PlanPreflightIssue } from "../preflight.ts";
import {
  PLAN_LIST_EMPTY,
  PLAN_LIST_JUNK,
  PLAN_LIST_NO_MATCH,
  PLAN_LIST_OPEN,
  chooseFold,
  momentIsWithin24h,
  planListEmptySentence,
  countPlanListTabs,
  drawerFixFromPreflight,
  filterPlanList,
  foldCostAboveBand,
  formatLaunchBlockedFold,
  formatMomentSoonFold,
  formatNextMomentLine,
  formatOverPaceFold,
  formatPaceSums,
  formatPassedMomentLine,
  formatPlanListTab,
  formatRowSecondLine,
  listPaceFillPercent,
  listPlannedByToday,
  nextListMoment,
  planListRowView,
  planListStateWord,
  planListTab,
  sortPlansByNextMoment,
  sumAllChannelSpend,
  type PlanListItemInput,
} from "../list.ts";

const NOW = new Date("2026-09-06T12:00:00+01:00");

function plan(partial: Partial<PlanListItemInput> & Pick<PlanListItemInput, "id">): PlanListItemInput {
  return {
    status: "draft",
    eventId: partial.eventId ?? partial.id,
    eventName: partial.eventName ?? partial.id,
    eventCode: null,
    venueName: null,
    eventDate: null,
    presaleAt: null,
    generalSaleAt: null,
    startDate: null,
    endDate: null,
    startTime: null,
    endTime: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    totalDaily: 0,
    spent: null,
    drawerFix: null,
    ...partial,
  };
}

describe("plan list sort — next moment", () => {
  it("sorts by earliest presale / gen sale / show still ahead, never by created", () => {
    const schak = plan({
      id: "schak",
      eventName: "Schak",
      eventDate: "2026-12-18",
      presaleAt: "2026-09-09T10:00:00+01:00",
    });
    const dod = plan({
      id: "dod",
      eventName: "D.O.D",
      eventDate: "2026-12-04",
      generalSaleAt: "2026-09-04T14:00:00+01:00",
    });
    const ez = plan({
      id: "ez",
      eventName: "DJ EZ",
      eventDate: "2026-10-02",
    });
    const none = plan({ id: "none", eventName: "No moment" });
    const sorted = sortPlansByNextMoment([none, dod, ez, schak], NOW).map((row) => row.id);
    assert.deepEqual(sorted, ["schak", "ez", "dod", "none"]);
  });

  it("plans with no moment ahead sort last", () => {
    const past = plan({ id: "past", eventName: "Past", eventDate: "2026-08-01" });
    const ahead = plan({ id: "ahead", eventName: "Ahead", eventDate: "2026-10-01" });
    assert.deepEqual(
      sortPlansByNextMoment([past, ahead], NOW).map((row) => row.id),
      ["ahead", "past"],
    );
  });
});

describe("plan list next-moment copy", () => {
  it("names the next moment and uses formatVizDay, never ISO", () => {
    const line = formatNextMomentLine({ eventDate: "2026-10-02" }, NOW);
    assert.equal(line, "show in 26 days · Fri 2 Oct");
    assert.doesNotMatch(line!, /\d{4}-\d{2}-\d{2}/);
    assert.equal(
      formatNextMomentLine({ presaleAt: "2026-09-09T10:00:00+01:00" }, NOW),
      "presale in 3 days · Wed 9 Sep",
    );
    assert.equal(
      formatNextMomentLine({ generalSaleAt: "2026-09-18T12:00:00+01:00" }, NOW),
      "gen sale in 12 days · Fri 18 Sep",
    );
  });

  it("L4 — passed gen sale yields to the show", () => {
    const dod = {
      eventDate: "2026-12-04",
      generalSaleAt: "2026-09-04T14:00:00+01:00",
    };
    const next = nextListMoment(dod, NOW);
    assert.equal(next?.kind, "show");
    assert.equal(formatPassedMomentLine(dod, NOW), "gen sale passed Fri 4 Sep");
    assert.match(formatNextMomentLine(dod, NOW)!, /^show in \d+ days · Fri 4 Dec$/);
  });

  it("planListRowView uses the passed-moment line when every moment is past", () => {
    const view = planListRowView(
      plan({
        id: "past",
        eventName: "Closed show",
        status: "live",
        eventDate: "2026-08-20",
        generalSaleAt: "2026-09-04T14:00:00+01:00",
        presaleAt: "2026-08-01T10:00:00+01:00",
      }),
      NOW,
    );
    assert.equal(formatNextMomentLine({
      eventDate: "2026-08-20",
      generalSaleAt: "2026-09-04T14:00:00+01:00",
      presaleAt: "2026-08-01T10:00:00+01:00",
    }, NOW), null);
    assert.equal(view.momentLine, "gen sale passed Fri 4 Sep");
    assert.match(readFileSync("lib/plan/list.ts", "utf8"), /formatNextMomentLine\(input, now\) \?\? formatPassedMomentLine/);
    assert.match(readFileSync("components/library/library-rows.tsx", "utf8"), /view\.momentLine/);
  });
});

describe("plan list tabs", () => {
  it("running · drafts · done · templates, no count when zero", () => {
    const plans = [
      plan({ id: "live", status: "live", eventDate: "2026-12-04" }),
      plan({ id: "draft-a", status: "draft" }),
      plan({ id: "draft-b", status: "failed" }),
      plan({ id: "draft-c", status: "launching" }),
      plan({ id: "archived", status: "archived" }),
      plan({ id: "closed", status: "live", eventDate: "2026-08-01" }),
    ];
    const counts = countPlanListTabs(plans, 0, NOW);
    assert.equal(counts.running, 1);
    assert.equal(counts.drafts, 3);
    assert.equal(counts.done, 2);
    assert.equal(counts.templates, 0);
    assert.equal(formatPlanListTab("running", 1), "running 1");
    assert.equal(formatPlanListTab("drafts", 3), "drafts 3");
    assert.equal(formatPlanListTab("done", 0), "done");
    assert.equal(formatPlanListTab("templates", 0), "templates");
    assert.equal(planListTab("live", "2026-12-04", NOW), "running");
    assert.equal(planListTab("live_partial", "2026-12-04", NOW), "running");
    assert.equal(planListTab("archived", null, NOW), "done");
    assert.equal(planListTab("live", "2026-08-01", NOW), "done");
    assert.deepEqual(
      filterPlanList(plans, "running", "", NOW).map((row) => row.id),
      ["live"],
    );
  });
});

describe("plan list fold", () => {
  const ez = plan({
    id: "ez",
    eventName: "DJ EZ",
    drawerFix: { count: 6, channel: "TikTok" },
  });
  const dod = plan({
    id: "dod",
    eventName: "D.O.D",
    status: "live",
    eventDate: "2026-12-04",
    startDate: "2026-08-27",
    endDate: "2026-12-04",
    totalDaily: 35,
    spent: 558,
  });
  const schak = plan({
    id: "schak",
    eventName: "Schak",
    presaleAt: "2026-09-07T10:00:00+01:00",
  });

  it("rule 1 — launch blocked with a drawer fix", () => {
    const fold = chooseFold([ez], NOW);
    assert.equal(fold?.kind, "launch-blocked");
    assert.equal(fold?.sentence, "DJ EZ: 6 things to fix before TikTok can run");
    assert.equal(formatLaunchBlockedFold("DJ EZ", { count: 6, channel: "TikTok" }), fold?.sentence);
  });

  it("rule 2 — live over pace by more than the day's budget; row stays running", () => {
    assert.equal(listPlannedByToday(35, "2026-08-27", NOW), 350);
    const fold = chooseFold([dod], NOW);
    assert.equal(fold?.kind, "over-pace");
    assert.equal(fold?.sentence, "D.O.D: £558 spent, plan said £350 — over by more than a day");
    assert.equal(formatOverPaceFold("D.O.D", 558, 350), fold?.sentence);
    assert.equal(planListStateWord(dod, NOW), VIZ_STATE_WORD.running);
  });

  it("rule 4 — 18:00 today folds", () => {
    const at = new Date("2026-09-06T18:00:00+01:00");
    assert.equal(momentIsWithin24h(at, NOW), true);
    const fold = chooseFold(
      [plan({ id: "today", eventName: "Schak", eventId: "evt-today", presaleAt: "2026-09-06T18:00:00+01:00" })],
      NOW,
    );
    assert.equal(fold?.kind, "moment-soon");
    assert.equal(fold?.sentence, "Schak: presale is tomorrow and nothing is running");
  });

  it("rule 4 — 09:00 tomorrow folds", () => {
    const at = new Date("2026-09-07T09:00:00+01:00");
    assert.equal(momentIsWithin24h(at, NOW), true);
    const fold = chooseFold(
      [plan({ id: "morning", eventName: "Schak", presaleAt: "2026-09-07T09:00:00+01:00" })],
      NOW,
    );
    assert.equal(fold?.kind, "moment-soon");
    assert.equal(fold?.sentence, "Schak: presale is tomorrow and nothing is running");
    assert.equal(formatMomentSoonFold("Schak", "presale"), fold?.sentence);
  });

  it("rule 4 — 26 hours ahead does not fold", () => {
    const at = new Date(NOW.getTime() + 26 * 60 * 60 * 1000);
    assert.equal(momentIsWithin24h(at, NOW), false);
    const fold = chooseFold(
      [plan({ id: "later", eventName: "Later", presaleAt: at.toISOString() })],
      NOW,
    );
    assert.equal(fold, null);
  });

  it("rule 4 — a draft beside a live sibling on the same event does not fold", () => {
    const live = plan({
      id: "live",
      eventId: "evt-schak",
      eventName: "Schak",
      status: "live",
      eventDate: "2026-12-18",
    });
    const draft = plan({
      id: "draft",
      eventId: "evt-schak",
      eventName: "Schak",
      presaleAt: "2026-09-06T18:00:00+01:00",
    });
    assert.equal(chooseFold([draft, live], NOW), null);
  });

  it("precedence: launch blocked beats over pace beats moment soon", () => {
    const fold = chooseFold([schak, dod, ez], NOW);
    assert.equal(fold?.kind, "launch-blocked");
    assert.equal(fold?.planId, "ez");
    assert.equal(chooseFold([schak, dod], NOW)?.kind, "over-pace");
  });

  it("search with plans but no matches uses the not-yet empty", () => {
    assert.equal(
      planListEmptySentence({ hasPlans: true, search: "zzzz" }),
      PLAN_LIST_NO_MATCH,
    );
    assert.equal(planListEmptySentence({ hasPlans: false, search: "" }), PLAN_LIST_EMPTY.sentence);
  });

  it("L6 — no fold when nothing matches, and no all-good banner", () => {
    const ready = plan({ id: "ready", eventName: "Modern Funktion", eventDate: "2026-11-13" });
    assert.equal(chooseFold([ready], NOW), null);
    assert.equal(PLAN_LIST_EMPTY.sentence, "no plans yet");
    assert.doesNotMatch(JSON.stringify(PLAN_LIST_EMPTY), /all good/i);
  });

  it.skip("TODO(plan-v2-benchmarks) fold rule 3: cost per result above the client's band for 3 consecutive days", () => {
    const folamour = plan({ id: "folamour", eventName: "Folamour" });
    const fold = foldCostAboveBand(folamour);
    assert.equal(fold?.sentence, "Folamour: cost per signup above your usual for 3 days");
  });
});

describe("plan list state words", () => {
  it("L2 draft without a blocker is ready", () => {
    const row = planListRowView(plan({ id: "l2", eventName: "Modern Funktion" }), NOW);
    assert.equal(row.stateWord, VIZ_STATE_WORD.ready);
    assert.equal(row.name, "Modern Funktion");
    assert.equal(row.openLabel, PLAN_LIST_OPEN);
    assert.equal(row.dashedTrack, true);
  });

  it("L4 over-pace live stays running", () => {
    assert.equal(
      planListStateWord(
        plan({
          id: "dod",
          eventName: "D.O.D",
          status: "live",
          eventDate: "2026-12-04",
          startDate: "2026-08-27",
          endDate: "2026-12-04",
          totalDaily: 35,
          spent: 558,
        }),
        NOW,
      ),
      VIZ_STATE_WORD.running,
    );
  });

  it("L5 junk window on a draft is needs you", () => {
    const junk = plan({
      id: "junk",
      eventName: "Jamie Jones",
      startDate: "2026-08-27",
      endDate: "2026-08-27",
    });
    const view = planListRowView(junk, NOW);
    assert.equal(view.stateWord, VIZ_STATE_WORD.needsYou);
    assert.equal(view.junk, true);
    assert.equal(view.junkLabel, PLAN_LIST_JUNK);
    assert.equal(view.dashedTrack, true);
  });

  it("L7 no event is needs you · choose an event", () => {
    const untitled = plan({ id: "untitled", eventId: "", eventName: null });
    assert.equal(planListStateWord(untitled, NOW), VIZ_STATE_WORD.needsYou);
    assert.equal(planListRowView(untitled, NOW).name, "choose an event");
  });

  it("archived and closed shows are done", () => {
    assert.equal(
      planListStateWord(plan({ id: "a", status: "archived", eventName: "East End Dubs" }), NOW),
      VIZ_STATE_WORD.done,
    );
    assert.equal(
      planListStateWord(
        plan({ id: "c", status: "live", eventName: "Closed", eventDate: "2026-08-01" }),
        NOW,
      ),
      VIZ_STATE_WORD.done,
    );
  });

  it("drawer fix makes a draft needs you", () => {
    assert.equal(
      planListStateWord(
        plan({ id: "ez", eventName: "DJ EZ", drawerFix: { count: 6, channel: "TikTok" } }),
        NOW,
      ),
      VIZ_STATE_WORD.needsYou,
    );
  });
});

describe("plan list pace ratio", () => {
  it("fill = min(spent ÷ planned, 1.5) × 60; caps at 1.5", () => {
    assert.equal(listPaceFillPercent(350, 350), 60);
    assert.equal(listPaceFillPercent(175, 350), 30);
    assert.equal(listPaceFillPercent(558, 350), 90);
    assert.equal(listPaceFillPercent(1000, 350), 90);
    assert.equal(listPaceFillPercent(0, 350), 0);
  });

  it("pace ⓘ is the two sums, never a percentage", () => {
    const sums = formatPaceSums(558, 350);
    assert.equal(sums, "£558 spent · plan said £350 by today");
    assert.doesNotMatch(sums, /%/);
  });
});

describe("plan list helpers", () => {
  it("second line is code · venue", () => {
    assert.equal(formatRowSecondLine("NX26-FOLAMOUR", "NX Newcastle"), "NX26-FOLAMOUR · NX Newcastle");
  });

  it("drawerFixFromPreflight counts every blocking issue, one source", () => {
    const issues: PlanPreflightIssue[] = [
      { adapter: "tiktok", id: "tiktok:identity", field: "identity", message: "x", blocking: true },
      { adapter: "tiktok", id: "tiktok:video", field: "video", message: "y", blocking: true },
      { adapter: "meta", id: "meta:page", field: "page", message: "z", blocking: true },
      { adapter: "tiktok", id: "tiktok:skipped_zero_budget", field: "budget", message: "skip", blocking: true },
    ];
    assert.deepEqual(drawerFixFromPreflight(issues), { count: 4, channel: "TikTok" });
  });

  it("a draft whose show has passed is done, not needs you", () => {
    const mall = plan({
      id: "mall",
      eventName: "Mall Grab - Sheffield",
      eventDate: "2026-09-04",
      drawerFix: { count: 2, channel: "Meta" },
    });
    assert.equal(planListTab("draft", "2026-09-04", NOW), "done");
    assert.equal(planListStateWord(mall, NOW), VIZ_STATE_WORD.done);
    assert.equal(planListRowView(mall, NOW).stateWord, VIZ_STATE_WORD.done);
  });

  it("a running plan with a junk end still draws a solid pace bar", () => {
    const dod = plan({
      id: "dod-junk",
      eventName: "D.O.D",
      status: "live",
      eventDate: "2026-12-04",
      startDate: "2026-08-27",
      endDate: "2026-08-27",
      totalDaily: 35,
      spent: 715,
    });
    const view = planListRowView(dod, NOW);
    assert.equal(view.dashedTrack, false);
    assert.equal(view.junk, true);
    assert.equal(listPaceFillPercent(715, 350), 90);
  });

  it("sumAllChannelSpend ignores days outside the window", () => {
    const total = sumAllChannelSpend(
      [
        { event_id: "e", date: "2026-08-26", ad_spend: 10, tiktok_spend: 0, google_ads_spend: 0 },
        { event_id: "e", date: "2026-08-27", ad_spend: 20, tiktok_spend: 5, google_ads_spend: 1 },
        { event_id: "e", date: "2026-09-07", ad_spend: 99, tiktok_spend: 0, google_ads_spend: 0 },
      ],
      "e",
      "2026-08-27",
      "2026-09-06",
    );
    assert.equal(total, 26);
  });
});

describe("plan list surfaces pin L1–L6 words and 768 classes", () => {
  it("library chrome uses the v2 tab words and the fold slot", () => {
    const library = readFileSync("components/library/plan-library.tsx", "utf8");
    assert.match(library, /running/);
    assert.match(library, /drafts/);
    assert.match(library, /done/);
    assert.match(library, /templates/);
    assert.match(library, /planListEmptySentence/);
    assert.match(library, /filteredPlans\.length === 0/);
    assert.match(library, /chooseFold|fold\./);
    assert.match(library, /max-md:/);
    assert.doesNotMatch(library, /Published/);
    assert.doesNotMatch(library, /Archived/);
    assert.doesNotMatch(library, /all good/i);
  });

  it("row is artwork · name · code/venue · next moment · pace · state · open", () => {
    const rows = readFileSync("components/library/library-rows.tsx", "utf8");
    const planRow = rows.slice(
      rows.indexOf("function PlanListThumb"),
      rows.indexOf("export function PlanTemplateRow"),
    );
    assert.match(planRow, /planListRowView/);
    assert.match(planRow, /PLAN_LIST_JUNK/);
    assert.match(planRow, /open ▸|PLAN_LIST_OPEN/);
    assert.match(planRow, /min-h-\[44px\]/);
    assert.match(planRow, /border-dashed/);
    assert.match(planRow, /max-md:/);
    assert.match(planRow, /listPaceFillPercent/);
    assert.doesNotMatch(planRow, /junk \|\| planned/);
    assert.doesNotMatch(planRow, /dashed \|\| junk/);
    assert.doesNotMatch(planRow, /eventInitials/);
    assert.doesNotMatch(planRow, /\d{4}-\d{2}-\d{2}/);
    assert.doesNotMatch(planRow, /VIZ_STATUS_LABEL|VIZ_ACTION_LABEL/);
  });
});
