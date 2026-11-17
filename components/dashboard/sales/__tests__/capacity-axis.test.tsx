/**
 * N1 / N6 (design FAIL on #1283, BR1-1280): on Ironworks' 7,000 axis the
 * "6,500" tick sat under "7,000 capacity". A tick whose label would sit
 * under the capacity label is left out; the rest stay.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SalesDashboard } from "@/components/dashboard/sales/sales-dashboard";
import { capacityTickLabel, capacityTicks, ticksClearOfCapacity } from "@/components/dashboard/sales/trajectory-bars";
import { IRONWORKS_SALES, NX_SALES_FIXTURE } from "@/lib/dashboard/sales-vs-spend-fixture";

afterEach(() => {
  cleanup();
});

/** 10 px type, about 5 px a character, as the axis's labels. */
const width = (max: number) => (tick: number) => capacityTickLabel(tick, max).length * 5;

describe("ticksClearOfCapacity", () => {
  it("drops 6,500 under '7,000 capacity' on an 830 px axis, and keeps every other tick", () => {
    const ticks = capacityTicks(7000, 500);
    const kept = ticksClearOfCapacity(ticks, 7000, 830, capacityTickLabel(7000, 7000).length * 5, width(7000));
    expect(kept).toEqual(ticks.filter((t) => t !== 6500));
  });

  it("keeps every tick where none reaches the label (2,000 on an 830 px axis)", () => {
    const ticks = capacityTicks(2000, 500);
    expect(ticksClearOfCapacity(ticks, 2000, 830, 70, width(2000))).toEqual(ticks);
  });

  it("drops every tick the label covers on a narrow axis, never the first or the last", () => {
    const kept = ticksClearOfCapacity(capacityTicks(7000, 500), 7000, 300, 70, width(7000));
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(7000);
    for (const tick of kept.slice(1, -1)) expect((tick / 7000) * 300 + width(7000)(tick) / 2).toBeLessThanOrEqual(300 - 70 - 6);
  });

  it("with no width yet (server render, first paint) keeps every tick", () => {
    const ticks = capacityTicks(7000, 500);
    expect(ticksClearOfCapacity(ticks, 7000, 0, 0, width(7000))).toEqual(ticks);
  });
});

describe("the capacity axis on the page", () => {
  function withLayout(axis: number, perChar: number, run: () => void) {
    const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => axis });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return (this.textContent ?? "").length * perChar;
      },
    });
    try {
      run();
    } finally {
      if (client) Object.defineProperty(HTMLElement.prototype, "clientWidth", client);
      if (offset) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offset);
    }
  }
  const axisLabels = (container: HTMLElement) =>
    [...container.querySelectorAll(".sm\\:grid .relative.h-4 span")].map((s) => s.textContent);

  it("BR1: Ironworks' axis leaves out 6,500 and keeps '7,000 capacity'", () => {
    withLayout(830, 5, () => {
      const { container } = render(<SalesDashboard model={IRONWORKS_SALES} surface="internal" initialShowId="venue:ironworks" initialPeriod="launch" />);
      const labels = axisLabels(container);
      expect(labels).toContain("7,000 capacity");
      expect(labels).toContain("6,000");
      expect(labels).not.toContain("6,500");
    });
  });

  it("NX's 2,000 axis keeps every tick", () => {
    withLayout(830, 5, () => {
      const { container } = render(<SalesDashboard model={NX_SALES_FIXTURE} surface="internal" initialShowId="venue:nx newcastle" initialPeriod="launch" />);
      const labels = axisLabels(container);
      expect(labels.length).toBeGreaterThan(2);
      const max = labels[labels.length - 1]!;
      expect(max).toMatch(/capacity$/);
      expect(labels.length).toBe(capacityTicks(Number(max.replace(/\D/g, "")), 500).length);
    });
  });
});
