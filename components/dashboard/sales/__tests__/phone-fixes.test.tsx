/** Design's fixes on #1233 at 989df33 (dashboard v2 on a phone). */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { readoutText } from "@/components/dashboard/sales/phone-chart";
import { SalesDashboard } from "@/components/dashboard/sales/sales-dashboard";
import { NX_SALES_LIVE_LIKE } from "@/lib/dashboard/sales-vs-spend-fixture";

afterEach(() => {
  cleanup();
});

const NBSP = " ";

describe("design's fixes on #1233 at 989df33", () => {
  it("1. below 640 px every tile value is ink, on or off; 'on' is the outline alone", () => {
    const { container } = render(<SalesDashboard model={NX_SALES_LIVE_LIKE} surface="share" initialShowId="venue:nx newcastle" initialPeriod="launch" />);
    const off = screen.getByRole("button", { name: /^Cost per ticket, / });
    expect(off.getAttribute("aria-pressed")).toBe("false");
    const value = off.querySelector("span[style]")!;
    expect(value.className).toContain("text-foreground");
    expect(value.className).toContain("sm:text-inherit");
    // Pace and Projected (phone only, no chart line) draw their values in ink too.
    for (const label of ["Pace · 7 days", "Projected"]) {
      const tile = [...container.querySelectorAll("li")].find((li) => li.textContent?.startsWith(label))!;
      expect(tile.querySelector(".text-foreground")).toBeTruthy();
    }
  });

  it("2. the titles row keeps two lines' height at rest and while held, so the plot never moves", () => {
    const rest = render(<SalesDashboard model={NX_SALES_LIVE_LIKE} surface="share" initialShowId="venue:nx newcastle" initialPeriod="launch" />);
    const restRow = rest.container.querySelector("[data-titles]")!;
    expect(restRow.className).toContain("h-7");
    expect(restRow.querySelector("[data-range]")).toBeTruthy();
    const restClass = restRow.className;
    cleanup();
    const held = render(
      <SalesDashboard model={NX_SALES_LIVE_LIKE} surface="share" initialShowId="venue:nx newcastle" initialPeriod="launch" phoneHoldDay="2026-10-03" />,
    );
    const heldRow = held.container.querySelector("[data-titles]")!;
    expect(heldRow.className).toBe(restClass);
    expect(heldRow.querySelector("[data-readout]")!.textContent).toContain(`Estimated between counts on 1${NBSP}Oct and 5${NBSP}Oct`);
  });

  it("no pace: the Pace tile reads '—' alone", () => {
    const model = structuredClone(NX_SALES_LIVE_LIKE);
    const t = model.views["venue:nx newcastle"].trajectory;
    if (t.kind !== "all" || !t.summary) throw new Error("all");
    t.summary.pace = { label: "Pace, last 7 days", value: "— a day", detail: "14-day — a day" };
    const { container } = render(<SalesDashboard model={model} surface="share" initialShowId="venue:nx newcastle" initialPeriod="launch" />);
    const pace = [...container.querySelectorAll("li")].find((li) => li.textContent?.startsWith("Pace · 7 days"))!;
    expect(pace.textContent).not.toContain("a day");
    expect(pace.textContent).toContain("—");
  });

  it("Total sold isn't drawn before the first count; the day after the last count says it carries over", () => {
    const points = NX_SALES_LIVE_LIKE.views["venue:nx newcastle"].points;
    const first = points.find((p) => p.count)!.day;
    expect(points.filter((p) => p.day < first).every((p) => p.values.sold == null)).toBe(true);
    const after = points.find((p) => p.day === "2026-11-13")!;
    expect(after.carryNote).toBe("carried over from the 12 Nov count");
    expect(readoutText(after, ["sold"])).toBe("13 Nov · Total sold 6,795 · carried over from the 12 Nov count");
  });
});
