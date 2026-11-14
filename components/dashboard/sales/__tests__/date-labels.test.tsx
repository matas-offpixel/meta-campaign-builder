/** Chart date labels, design-ruled 14 Nov: N1's 6 px rule on where labels really land. */

import { describe, expect, it } from "vitest";

import { anchoredDateIndexes, dateStepDays, daySpan, estimateDateLabelWidth, fitDateLabels } from "@/components/dashboard/sales/chart-axes";
import { phoneDateLabels } from "@/components/dashboard/sales/phone-chart";
import { salesChartDateLabels } from "@/components/dashboard/sales/sales-chart";

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) out.push(d);
  return out;
}

const LAUNCH = days("2026-08-14", "2026-11-13"); // 92 days: the phone scroller.
const D30 = days("2026-10-15", "2026-11-13");
const D14 = days("2026-10-31", "2026-11-13");
const WIDTHS = Array.from({ length: 12 }, (_, i) => 320 + i * 10);
// The phone page: 12 px gutters; the scroller's axis columns 40 + 36 px; the fitting chart's 56 + 56 px.
const scrollerFrame = (w: number) => w - 24 - 40 - 36;
const fittingPlot = (w: number) => w - 24 - 56 - 56;

function gapsOk(boxes: { left: number; right: number }[]): boolean {
  const sorted = [...boxes].sort((a, b) => a.left - b.left);
  return sorted.every((b, i) => i === 0 || b.left - sorted[i - 1].right >= 6);
}

describe("date labels: no two boxes within 6 px, the end label always there", () => {
  for (const w of WIDTHS) {
    it(`${w} px · Since launch (the 30-day scroller, as it opens)`, () => {
      const frame = scrollerFrame(w);
      const content = (frame * LAUNCH.length) / 30;
      const width = (l: string) => estimateDateLabelWidth(l, 11);
      // As it opens: the window at the right end.
      const atEnd = phoneDateLabels(LAUNCH, content, { left: content - frame, right: content }, width);
      expect(atEnd.at(-1)!.day).toBe("2026-11-13");
      expect(atEnd.at(-1)!.anchor).toBe("end");
      expect(gapsOk(atEnd)).toBe(true);
      // The whole content, every window position at once.
      expect(gapsOk(phoneDateLabels(LAUNCH, content, undefined, width))).toBe(true);
    });

    for (const [name, list] of [["30 days", D30], ["14 days", D14]] as const) {
      it(`${w} px · ${name} (no scroller)`, () => {
        const plot = fittingPlot(w);
        const width = (l: string) => estimateDateLabelWidth(l, 12);
        const labels = salesChartDateLabels(list, plot, width);
        expect(labels.at(-1)!.day).toBe("2026-11-13");
        expect(labels.at(-1)!.anchor).toBe("end");
        const boxes = labels.map((l) => {
          const x = (l.x / 1000) * plot;
          const wd = width(l.label);
          const left = l.anchor === "start" ? x : l.anchor === "end" ? x - wd : x - wd / 2;
          return { left, right: left + wd };
        });
        expect(gapsOk(boxes)).toBe(true);
        // The start label of a no-scroller period never hangs off the plot's left edge.
        expect(Math.min(...boxes.map((b) => b.left))).toBeGreaterThanOrEqual(0);
      });
    }
  }

  it("as live at 375: '6 Nov' comes within 6 px of the end label and goes: … 30 Oct · 13 Nov", () => {
    const frame = scrollerFrame(375);
    const content = (frame * LAUNCH.length) / 30;
    const labels = phoneDateLabels(LAUNCH, content, { left: content - frame, right: content }, (l) => estimateDateLabelWidth(l, 11));
    expect(labels.map((l) => l.label).slice(-2)).toEqual(["30 Oct", "13 Nov"]);
  });

  it("the step never varies and the end label is never stepped inward", () => {
    const frame = scrollerFrame(375);
    const content = (frame * LAUNCH.length) / 30;
    const labels = phoneDateLabels(LAUNCH, content, undefined, (l) => estimateDateLabelWidth(l, 11));
    const all = anchoredDateIndexes(LAUNCH, 7).map((i) => LAUNCH[i]);
    // Every label kept is on the 7-day step back from the last day; only drops, never moves.
    expect(labels.every((l) => all.includes(l.day))).toBe(true);
    expect(labels.at(-1)!.day).toBe(LAUNCH.at(-1));
  });

  it("the desktop chart: nothing changes at 1280 (every stepped label stays, centred)", () => {
    for (const list of [LAUNCH, D30, D14]) {
      const plot = 1280 - 48 - 112;
      const labels = salesChartDateLabels(list, plot, (l) => estimateDateLabelWidth(l, 12));
      const stepped = anchoredDateIndexes(list, dateStepDays(daySpan(list), plot));
      expect(labels.length).toBe(stepped.length);
      expect(labels.every((l) => l.anchor === "center")).toBe(true);
    }
  });

  it("fitDateLabels drops a label the scroll window's left edge would cut", () => {
    const kept = fitDateLabels(
      [
        { index: 0, x: 10, label: "1 Nov" },
        { index: 7, x: 100, label: "8 Nov" },
        { index: 14, x: 200, label: "15 Nov" },
      ],
      14,
      { rowWidth: 400, width: () => 30, viewLeft: 20 },
    );
    expect(kept.map((k) => k.label)).toEqual(["8 Nov", "15 Nov"]);
  });
});
