import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { anchoredDateIndexes, axisStep, dateStepDays, daySpan } from "@/components/dashboard/sales/chart-axes";
import { SalesDashboard } from "@/components/dashboard/sales/sales-dashboard";
import { spendScopeLine, tileSubline } from "@/components/dashboard/sales/tile-copy";
import { barOutcome, trajectoryAxisMax, trajectorySums } from "@/components/dashboard/sales/trajectory-bars";
import { NX_SALES_FIXTURE } from "@/lib/dashboard/sales-vs-spend-fixture";
import type { AllShowBar } from "@/lib/dashboard/sales-vs-spend";

afterEach(() => {
  cleanup();
});

describe("N2 venue row and N3 spend hover", () => {
  it("puts the venues above the chips and pins the All venues breakdown", () => {
    render(
      <SalesDashboard
        model={NX_SALES_FIXTURE}
        surface="internal"
        initialShowId="all"
        initialPeriod="launch"
        initialVenueKey="all"
        pinSpend
      />,
    );
    expect(screen.getByRole("button", { name: "All venues" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "NX Newcastle" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "All NX Newcastle" })).toBeTruthy();
    expect(screen.getByText("£9,840 since launch · to 12 Nov")).toBeTruthy();
    expect(screen.getByText("Not in this total: NX Newcastle umbrella £640. Finished shows (Include finished adds them).")).toBeTruthy();
    expect(screen.getByText(/NX Newcastle to date, 2 venues/)).toBeTruthy();
  });
});

describe("N8 umbrella", () => {
  it("puts the event name under the title and drops a channel line with no split", () => {
    render(
      <SalesDashboard model={NX_SALES_FIXTURE} surface="internal" initialShowId="umbrella" initialPeriod="launch" />,
    );
    const subtitle = screen.getByText("NX umbrella · not a show: no tickets and no trajectory");
    const sentence = screen.getByText(/NX Newcastle umbrella to date/);
    expect(subtitle.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("to 12 Nov")).toBeNull();
  });
});

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
      sellout: "at its recent pace",
    });
    expect(barOutcome({ id: "y", label: "y", sold: null, low: null, high: null, allocation: 2000, caption: "" })).toEqual({
      text: "No ticket counts yet",
      sellout: null,
    });
    expect(barOutcome(bars.find((bar) => bar.sold == null)!)).toEqual({ text: "Set capacity on the event", sellout: null });
    expect(barOutcome({ id: "z", label: "z", sold: 100, low: 200, high: 300, allocation: 1000, caption: "", sellsOut: "holds" })).toEqual({
      text: "100 →",
      sellout: "at its recent pace",
    });
  });

  it("reads the all-shows pace from the model's summary", () => {
    const trajectory = NX_SALES_FIXTURE.views["venue:nx newcastle"].trajectory;
    expect(trajectory.kind === "all" && trajectory.summary?.pace).toEqual({
      label: "Pace, last 7 days",
      value: "— a day",
      detail: "14-day — a day",
    });
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
    expect(tileSubline("costPerTicket", "blended · complete windows", "launch", "12 Nov", { showsWithCounts: 3, shows: 4 }, true)).toBe(
      "since launch · the 3 shows with counts",
    );
    expect(tileSubline("costPerTicket", "blended · complete windows", "launch", "12 Nov", null, true)).toBe("since launch · blended");
    // Period-calc ticket, "Keep D13, explain": no "complete windows"; wide names the cap in the header's words.
    expect(tileSubline("costPerTicket", "blended", "14", "12 Nov", null, true)).toBe("in 14 days · blended");
    expect(tileSubline("costPerTicket", "in 14 days · the 3 shows with counts · on spend to the 12 Nov count", "14", "12 Nov", { showsWithCounts: 3, shows: 4 }, true)).toBe(
      "in 14 days · the 3 shows with counts · on spend to the 12 Nov count",
    );
    expect(
      tileSubline("costPerTicket", "in 14 days · blended · on spend to each show's last count (latest 12 Nov)", "14", "12 Nov", null, true),
    ).toBe("in 14 days · blended · on spend to each show's last count (latest 12 Nov)");
    expect(tileSubline("costPerTicket", "in 14 days · blended · on spend to the 12 Nov count", "14", "12 Nov", { showsWithCounts: 3, shows: 4 })).toBe(
      "in 14 days · the 3 shows with counts",
    );
    expect(tileSubline("costPerTicket", "blended", "14", "12 Nov", { showsWithCounts: 3, shows: 4 })).toBe(
      "in 14 days · the 3 shows with counts",
    );
    const launch = NX_SALES_FIXTURE.views.all.spendTotal;
    const period = NX_SALES_FIXTURE.views.all.periods?.["14"]?.spendTotal;
    expect(launch && spendScopeLine(launch, "launch", launch)).toBe("All venues · Meta £4,210 · TikTok £520");
    expect(launch && period && spendScopeLine(period, "14", launch)).toBe(
      "All venues · Meta £4,210 · TikTok £520 · of £9,840 since launch",
    );
    expect(NX_SALES_FIXTURE.views["venue:nx newcastle"].header?.sentence).toBe(
      "NX Newcastle to date: £9,840 spend since launch, 2,327 tickets sold across 3 shows (Internal Counts, 12 Nov), so £4.23 of spend per ticket. Separate NX Newcastle umbrella spend: £640.",
    );
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
