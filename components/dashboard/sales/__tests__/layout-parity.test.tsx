import { describe, expect, it } from "vitest";

import { anchoredDateIndexes, axisStep, dateStepDays, daySpan } from "@/components/dashboard/sales/chart-axes";
import { tileSubline } from "@/components/dashboard/sales/tile-copy";
import { barOutcome, trajectoryAxisMax, trajectorySums } from "@/components/dashboard/sales/trajectory-bars";
import { NX_SALES_FIXTURE } from "@/lib/dashboard/sales-vs-spend-fixture";
import type { AllShowBar } from "@/lib/dashboard/sales-vs-spend";

describe("N1 axes", () => {
  it("picks the round step that covers the peak", () => {
    expect(axisStep(600, 6)).toBe(100);
    expect(axisStep(8526, 6)).toBe(1500);
    expect(axisStep(8526, 3)).toBe(3000);
    expect(axisStep(600, 3)).toBe(200);
  });

  it("anchors date labels to the last day, every 7 days wide and every 21 at 393", () => {
    const days = Array.from({ length: 99 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 7, 6 + index));
      return date.toISOString().slice(0, 10);
    });
    expect(daySpan(days)).toBe(98);
    expect(dateStepDays(98, 1000)).toBe(7);
    expect(dateStepDays(98, 280)).toBe(21);
    const indexes = anchoredDateIndexes(days, 7);
    expect(days[indexes[indexes.length - 1]]).toBe(days[days.length - 1]);
    expect(indexes[0]).toBe(0);
  });
});

describe("N6 trajectory", () => {
  const bars = (NX_SALES_FIXTURE.views.all.trajectory.kind === "all"
    ? NX_SALES_FIXTURE.views.all.trajectory.bars
    : []) as AllShowBar[];

  it("caps a show at its own capacity and says when the pace sells out", () => {
    const dod = bars.find((bar) => bar.id === "dod");
    expect(barOutcome(dod!)).toEqual({ text: "915 → 1,280–1,500 ·", sellout: "if best" });
    expect(barOutcome({ id: "x", label: "x", sold: 1870, low: 2000, high: 2100, allocation: 2000, caption: "" })).toEqual({
      text: "1,870 →",
      sellout: "at this pace",
    });
    expect(barOutcome({ id: "y", label: "y", sold: null, low: null, high: null, allocation: 2000, caption: "" })).toEqual({
      text: "No ticket counts yet",
      sellout: null,
    });
    expect(barOutcome(bars.find((bar) => bar.sold == null)!)).toEqual({ text: "Set capacity on the event", sellout: null });
  });

  it("sums only the shows with a count, each projection capped", () => {
    expect(trajectoryAxisMax(bars)).toBe(1500);
    expect(trajectorySums(bars)).toEqual({ sold: 2327, capacity: 4500, holds: 3162, high: 4210, shows: 3 });
  });
});

describe("N7 tile sublines", () => {
  it("starts every subline with its span, and keeps sold as to date", () => {
    expect(tileSubline("sold", "since launch", "launch", "12 Nov")).toBe("to date · Internal Counts, 12 Nov");
    expect(tileSubline("sold", "Internal Counts, 12 Nov · plus 64 comps", "14", "12 Nov")).toBe(
      "to date · Internal Counts, 12 Nov · plus 64 comps",
    );
    expect(tileSubline("costPerTicket", "blended · complete windows", "launch", "12 Nov", { showsWithCounts: 3, shows: 4 })).toBe(
      "since launch · the 3 shows with counts",
    );
    expect(tileSubline("costPerTicket", "blended · complete windows", "launch", "12 Nov")).toBe("since launch · blended");
    expect(tileSubline("costPerTicket", "blended", "14", "12 Nov", { showsWithCounts: 3, shows: 3 })).toBe("in 14 days · blended");
    expect(tileSubline("tickets", "since launch", "launch", "12 Nov")).toBe("since launch, to 12 Nov");
    expect(tileSubline("checkoutActions", "£5.31 each", "launch", "12 Nov")).toBe(
      "since launch · actions, one person can do both",
    );
    expect(tileSubline("registrations", "since launch", "launch", "12 Nov")).toBe(
      "to date · signup pages close at on-sale",
    );
    expect(tileSubline("costPerRegistration", "—", "14", "12 Nov")).toBe(
      "in 14 days · show pages, inside their signup windows",
    );
    expect(tileSubline("spend", "in 14 days", "14", "12 Nov")).toBe("in 14 days");
  });
});
