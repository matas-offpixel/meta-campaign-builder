import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  NO_CAMPAIGN_BUDGET_YET,
  NO_TICKET_TARGET_YET,
  adPlanForEvent,
  campaignBudgetLines,
  campaignTicketTargetLine,
  eventPlanTabHref,
  existingPhaseOffer,
  findExistingPhasePlan,
  phaseWord,
} from "../ad-plan-read.ts";
import { shouldPersistPlanOnChange } from "../persist-policy.ts";

const FOLAMOUR_EVENT = "565600ea-folamour";
const FOLAMOUR_AD = {
  eventId: FOLAMOUR_EVENT,
  totalBudget: 3000,
  startDate: "2026-08-26",
  endDate: "2026-10-23",
  ticketTarget: null as number | null,
};
const FOLAMOUR_PHASE = {
  totalDailyBudget: 0,
  startDate: "2026-09-07",
  endDate: "2026-10-23",
};

describe("campaignBudgetLines — Folamour and D.O.D", () => {
  it("Folamour: campaign £3,000 across 59 days, this phase £0 across 47, £3,000 unallocated", () => {
    const lines = campaignBudgetLines({
      eventId: FOLAMOUR_EVENT,
      adPlan: FOLAMOUR_AD,
      thisPhase: FOLAMOUR_PHASE,
      siblingPhases: [
        { totalDailyBudget: 0, startDate: "2026-09-07", endDate: "2026-10-23" },
        { totalDailyBudget: 0, startDate: "2026-09-07", endDate: "2026-10-23" },
      ],
    });
    assert.equal(lines.campaign.kind, "measured");
    if (lines.campaign.kind !== "measured") throw new Error("expected measured");
    assert.equal(lines.campaign.amount, 3000);
    assert.equal(lines.campaign.days, 59);
    assert.equal(lines.campaign.text, "campaign £3,000 across 59 days");
    assert.equal(lines.thisPhase.kind, "measured");
    assert.equal(lines.thisPhase.amount, 0);
    assert.equal(lines.thisPhase.days, 47);
    assert.equal(lines.thisPhase.text, "this phase £0 across 47 days");
    assert.deepEqual(lines.unallocated, {
      amount: 3000,
      text: "£3,000 unallocated",
    });
  });

  it("D.O.D: campaign 100 days, this phase daily × 1, signed remainder", () => {
    const lines = campaignBudgetLines({
      eventId: "dod",
      adPlan: {
        eventId: "dod",
        totalBudget: 3000,
        startDate: "2026-08-27",
        endDate: "2026-12-04",
        ticketTarget: null,
      },
      thisPhase: {
        totalDailyBudget: 35,
        startDate: "2026-08-27",
        endDate: "2026-08-27",
      },
      siblingPhases: [],
    });
    assert.equal(lines.campaign.kind, "measured");
    if (lines.campaign.kind !== "measured") throw new Error("expected measured");
    assert.equal(lines.campaign.days, 100);
    assert.equal(lines.campaign.text, "campaign £3,000 across 100 days");
    assert.equal(lines.thisPhase.amount, 35);
    assert.equal(lines.thisPhase.days, 1);
    assert.equal(lines.thisPhase.text, "this phase £35 across 1 day");
    assert.deepEqual(lines.unallocated, {
      amount: 2965,
      text: "£2,965 unallocated",
    });
  });

  it("draws a signed over-commit — neither state is an error", () => {
    const lines = campaignBudgetLines({
      eventId: "over",
      adPlan: {
        eventId: "over",
        totalBudget: 100,
        startDate: "2026-09-01",
        endDate: "2026-09-02",
        ticketTarget: null,
      },
      thisPhase: {
        totalDailyBudget: 80,
        startDate: "2026-09-01",
        endDate: "2026-09-02",
      },
      siblingPhases: [
        { totalDailyBudget: 50, startDate: "2026-09-01", endDate: "2026-09-02" },
      ],
    });
    assert.ok(lines.unallocated);
    assert.equal(lines.unallocated.amount, -160);
    assert.equal(lines.unallocated.text, "£-160 unallocated");
  });

  it("missing ad_plans is not-yet and never falls back to the phase figure", () => {
    const lines = campaignBudgetLines({
      eventId: FOLAMOUR_EVENT,
      adPlan: null,
      thisPhase: FOLAMOUR_PHASE,
      siblingPhases: [],
    });
    assert.deepEqual(lines.campaign, {
      kind: "not-yet",
      sentence: NO_CAMPAIGN_BUDGET_YET,
      href: eventPlanTabHref(FOLAMOUR_EVENT),
    });
    assert.equal(lines.thisPhase.amount, 0);
    assert.equal(lines.unallocated, null);
    assert.notEqual(lines.campaign.kind, "measured");
  });

  it("ad_plans row with a null total is not-yet, not £0", () => {
    const lines = campaignBudgetLines({
      eventId: FOLAMOUR_EVENT,
      adPlan: { ...FOLAMOUR_AD, totalBudget: null },
      thisPhase: FOLAMOUR_PHASE,
      siblingPhases: [],
    });
    assert.equal(lines.campaign.kind, "not-yet");
    assert.equal(lines.unallocated, null);
  });
});

describe("campaignTicketTargetLine — never a shortfall", () => {
  it("null is the common case: not-yet with the Plan tab remedy", () => {
    const line = campaignTicketTargetLine({
      eventId: FOLAMOUR_EVENT,
      ticketTarget: null,
    });
    assert.equal(line.kind, "not-yet");
    assert.equal(line.value, null);
    assert.equal(line.sentence, NO_TICKET_TARGET_YET);
    assert.equal(line.href, `/events/${FOLAMOUR_EVENT}?tab=plan`);
    assert.equal("shortfall" in line, false);
  });

  it("a set target is measured tickets, not a cost-per, and has no difference field", () => {
    const line = campaignTicketTargetLine({
      eventId: FOLAMOUR_EVENT,
      ticketTarget: 400,
    });
    assert.equal(line.kind, "measured");
    assert.equal(line.value, 400);
    assert.equal(line.display, "400 tickets");
    assert.equal(line.sentence, null);
    assert.equal("shortfall" in line, false);
    assert.equal("projection" in line, false);
  });
});

describe("existing phase offer", () => {
  it("uses their words: on-sale / presale / waiting-list", () => {
    assert.equal(phaseWord("on_sale"), "on-sale");
    assert.equal(phaseWord("presale"), "presale");
    assert.equal(phaseWord("waiting_list"), "waiting-list");
    assert.equal(
      existingPhaseOffer("on_sale"),
      "this show already has an on-sale plan — open it ▸",
    );
    assert.equal(
      existingPhaseOffer("presale"),
      "this show already has a presale plan — open it ▸",
    );
  });

  it("finds a sibling on the same event+phase and ignores a null phase", () => {
    const siblings = [
      {
        id: "existing",
        eventId: FOLAMOUR_EVENT,
        phase: "on_sale" as const,
        totalDailyBudget: 0,
        startDate: "2026-09-07",
        endDate: "2026-10-23",
      },
    ];
    assert.deepEqual(
      findExistingPhasePlan(siblings, FOLAMOUR_EVENT, "on_sale", "draft-new"),
      { id: "existing", phase: "on_sale" },
    );
    assert.equal(
      findExistingPhasePlan(siblings, FOLAMOUR_EVENT, "on_sale", "existing"),
      null,
    );
    assert.equal(findExistingPhasePlan(siblings, FOLAMOUR_EVENT, null), null);
    assert.equal(adPlanForEvent([FOLAMOUR_AD], "other"), null);
    assert.equal(adPlanForEvent([FOLAMOUR_AD], FOLAMOUR_EVENT)?.totalBudget, 3000);
  });
});

describe("new plan persist gates", () => {
  it("does not persist a new plan without a phase or over an existing one", () => {
    assert.equal(
      shouldPersistPlanOnChange({
        hasUserEdit: true,
        eventId: "e1",
        requirePhase: true,
        phase: null,
      }),
      false,
    );
    assert.equal(
      shouldPersistPlanOnChange({
        hasUserEdit: true,
        eventId: "e1",
        requirePhase: true,
        phase: "on_sale",
        blockedByExisting: true,
      }),
      false,
    );
    assert.equal(
      shouldPersistPlanOnChange({
        hasUserEdit: true,
        eventId: "e1",
        requirePhase: true,
        phase: "on_sale",
      }),
      true,
    );
    assert.equal(
      shouldPersistPlanOnChange({ hasUserEdit: true, eventId: "e1" }),
      true,
    );
  });
});

describe("read-across does not write ad_plans", () => {
  it("ad-plan-read and canvas budget/target never import the ad-plans writer", () => {
    const files = [
      "lib/plan/ad-plan-read.ts",
      "components/plan/canvas-budget.tsx",
      "components/plan/canvas-target.tsx",
      "components/plan/plan-workspace.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /updatePlan\b|from "@\/lib\/db\/ad-plans"/);
      assert.doesNotMatch(source, /short by/i);
    }
  });
});
