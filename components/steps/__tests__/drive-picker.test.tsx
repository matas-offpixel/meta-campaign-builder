/** The From Drive picker (G2, G6, G7) on the frame fixture: Retry buttons, the end screen's breadcrumb, the static sentence. No Drive, no Meta. */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DrivePicker, type DrivePickerProps, type PickerBatchRow } from "@/components/steps/drive-picker";
import { FIXTURE_FIELDS, FIXTURE_VIEW } from "@/components/steps/drive-picker-frame-mount";
import type { PickerView } from "@/lib/drive/picker-model";

afterEach(() => {
  cleanup();
});

function mount(overrides: Partial<DrivePickerProps> = {}) {
  const calls: string[] = [];
  const props: DrivePickerProps = {
    open: true,
    onClose: () => {},
    eventId: "e1",
    eventCode: "P26-BDAY",
    fields: FIXTURE_FIELDS,
    onFieldsChange: () => {},
    onClearFields: () => {},
    ctaOptions: [{ value: "buy_tickets", label: "Buy tickets" }],
    pages: [{ id: "puzzle", name: "Puzzle" }],
    instagramFor: () => [],
    existingNames: [],
    existingDriveIds: new Set(),
    onPrepare: () => {},
    batch: null,
    onRetryFailed: vi.fn(() => calls.push("retryFailed")),
    onRetryRow: vi.fn((rowId: string) => calls.push(`retryRow:${rowId}`)),
    onDismissBatch: vi.fn(() => calls.push("dismiss")),
    loadView: vi.fn(async (q: { folderId?: string | null }) => {
      calls.push(`load:${q.folderId ?? ""}`);
      return FIXTURE_VIEW as PickerView;
    }),
    thumbnailUrl: () => null,
    ...overrides,
  };
  render(<DrivePicker {...props} />);
  return { props, calls };
}

const failedRow: PickerBatchRow = { rowId: "r4", name: "enzo-crowd-pov.mp4", state: { kind: "copy_failed" } };
const readyRow: PickerBatchRow = { rowId: "r1", name: "P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16", state: { kind: "ready" } };

describe("Retry (G6)", () => {
  it("a row's Retry is a button that retries that row", async () => {
    const { calls } = mount({ batch: [readyRow, { rowId: "r2", name: "two", state: { kind: "sending" } }, failedRow] });
    const row = (await screen.findByText("enzo-crowd-pov")).closest("li")!;
    expect(row.textContent).toContain("Couldn't copy from Drive — Retry");
    await userEvent.click(within(row).getByRole("button", { name: "Retry" }));
    expect(calls).toContain("retryRow:r4");
    expect(calls).not.toContain("retryFailed");
  });

  it("the end line's Retry is a button that calls Retry failed", async () => {
    const { calls } = mount({ batch: [readyRow, failedRow] });
    const line = await screen.findByText(/1 ads prepared · 0 skipped \(already in this draft\) · 1 failed/);
    expect(line.textContent).toBe("1 ads prepared · 0 skipped (already in this draft) · 1 failed — Retry");
    await userEvent.click(within(line).getByRole("button", { name: "Retry" }));
    expect(calls).toContain("retryFailed");
  });

  it("a static's ratio failure reads the static sentence", async () => {
    mount({ batch: [{ rowId: "s", name: "x_r1_9x16", state: { kind: "not_916", static: true } }, readyRow, { rowId: "w", name: "w", state: { kind: "sending" } }] });
    expect(await screen.findByText("Not 9:16 — pairs with its 9:16 in Dual or Full")).toBeTruthy();
    expect(screen.queryByText("Not 9:16 — video runs as 9:16 only")).toBeNull();
  });
});

describe("a not-9:16 row is not retryable (R5)", () => {
  it("DL3's batch reads Retry failed (1); the not-9:16 row has no Retry of its own", async () => {
    const { calls } = mount({
      batch: [
        readyRow,
        { rowId: "r2", name: "b_r1_9x16", state: { kind: "sending" } },
        failedRow,
        { rowId: "r6", name: "P26-BDAY_enzo-siragusa-6_quote-on-sale_r1_4x5.png", state: { kind: "not_916", static: true } },
      ],
    });
    await userEvent.click(await screen.findByRole("button", { name: "Retry failed (1)" }));
    expect(calls).toContain("retryFailed");
    const row = screen.getByText("Not 9:16 — pairs with its 9:16 in Dual or Full").closest("li")!;
    expect(within(row).queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Retry" }).length).toBe(1);
  });

  it("with only a not-9:16 failure, the end line has no Retry and there is no Retry failed", async () => {
    mount({ batch: [readyRow, { rowId: "r6", name: "x_r1_4x5.png", state: { kind: "not_916", static: true } }] });
    expect(await screen.findByText(/1 failed/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry failed/ })).toBeNull();
  });
});

describe("the end screen (G7)", () => {
  it("a breadcrumb click leaves the batch first, then opens the folder", async () => {
    const { calls } = mount({ batch: [readyRow, failedRow] });
    const nav = await screen.findByRole("navigation", { name: "Folder" });
    await userEvent.click(within(nav).getByRole("button", { name: "Videos" }));
    await waitFor(() => expect(calls).toContain("load:f-enzo-videos"));
    expect(calls.indexOf("dismiss")).toBeGreaterThan(-1);
    expect(calls.indexOf("dismiss")).toBeLessThan(calls.indexOf("load:f-enzo-videos"));
  });
});

describe("tiles (G2, N1)", () => {
  // jsdom lays nothing out: give each name box the record's 205 px and the canvas a 6 px-a-character font.
  function withLayout() {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(206);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (text: string) => ({ width: text.length * 6 }),
    } as unknown as CanvasRenderingContext2D);
  }
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a tile's name is whole on two lines, breaking after _ or -; typed glyphs; the box is two lines tall", async () => {
    withLayout();
    mount();
    const box = await screen.findByTitle("P26-BDAY_enzo-siragusa-5_caption-artist-on-sale_r1_9x16.mp4");
    const lines = [...box.children].map((line) => line.textContent);
    expect(lines).toEqual(["P26-BDAY_enzo-siragusa-5_caption-", "artist-on-sale_r1_9x16.mp4"]);
    expect(box.style.fontFeatureSettings).toBe('"calt" 0');
    expect(box.className).toContain("h-[28px]");
    for (const [name, part] of [
      ["P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16.mp4", "siragusa-1_quote"],
      ["P26-BDAY_enzo-siragusa-4_quote-on-sale_r1_9x16.mp4", "siragusa-4_quote"],
      ["P26-BDAY_enzo-siragusa-2_caption-artist-on-sale_r1_9x16.mp4", "siragusa-2_caption"],
    ] as const) {
      const text = screen.getByTitle(name).textContent!;
      expect(text).toBe(name);
      expect(text).toContain(part);
    }
  });

  it("a batch row's name keeps its ratio token and extension in a fixed tail, typed glyphs", async () => {
    mount({ batch: [readyRow, { ...failedRow, state: { kind: "copying", pct: 40 } }] });
    const tail = await screen.findByText("_9x16");
    const name = tail.parentElement!;
    expect(name.getAttribute("title")).toBe(readyRow.name);
    expect(name.style.fontFeatureSettings).toBe('"calt" 0');
    expect(tail.className).toContain("shrink-0");
  });

  it("video tiles say Video runs as 9:16 only in Dual or Full, not in Single", async () => {
    mount();
    await screen.findByTitle("P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16.mp4");
    expect(screen.queryByText("Video runs as 9:16 only")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Mode"), "dual");
    expect(screen.getAllByText("Video runs as 9:16 only").length).toBe(4);
  });
});
