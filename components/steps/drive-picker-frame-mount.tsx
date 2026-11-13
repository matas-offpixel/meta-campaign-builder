"use client";

/**
 * DL frames for the launcher's From Drive picker (HG8): the real DrivePicker
 * on a fixture tree — no live Drive, no Meta. DL1 at 1280 and 393, DL3 and
 * DL4 at 1280. DL0 and DL5 are the creatives step itself
 * (drive-creatives-frame-mount.tsx). File names are the record's (12 Nov held finals plus two
 * samples); the primary text and headline are the record's sample words.
 */

import { useState } from "react";

import type { BatchFields, PickerFile, PickerView, RowState } from "@/lib/drive/picker-model";

import { DriveCreativesFrameMount } from "./drive-creatives-frame-mount";
import { DrivePicker, type PickerBatchRow } from "./drive-picker";

const MB = 1024 * 1024;
const STAGE = "03/3/wc/2026-11-09";

const owners = [
  { key: `${STAGE}/owner/artist:enzo`, name: "Enzo Siragusa", folderId: "f-enzo" },
  { key: `${STAGE}/owner/artist:luke`, name: "Luke Dean", folderId: "f-luke" },
  { key: `${STAGE}/owner/artist:reeshy`, name: "Reeshy", folderId: "f-reeshy" },
  { key: `${STAGE}/owner/promoter`, name: "Puzzle", folderId: "f-puzzle" },
];

function video(id: string, name: string, seconds: number, mb: number, landscape = false): PickerFile {
  return { id, name, mimeType: "video/mp4", size: Math.round(mb * MB), hasThumbnail: true, width: landscape ? 1920 : 1080, height: landscape ? 1080 : 1920, rotation: null, durationMs: seconds * 1000 };
}

const FILES: PickerFile[] = [
  video("d1", "P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16.mp4", 21.8, 26.8),
  video("d4", "P26-BDAY_enzo-siragusa-4_quote-on-sale_r1_9x16.mp4", 21.8, 34.2),
  video("d5", "P26-BDAY_enzo-siragusa-5_caption-artist-on-sale_r1_9x16.mp4", 6.0, 10.4),
  video("d2", "P26-BDAY_enzo-siragusa-2_caption-artist-on-sale_r1_9x16.mp4", 14.2, 18.1),
  { ...video("terrace", "enzo-ibiza-terrace.mov", 31.0, 88.4, true), mimeType: "video/quicktime" },
  video("fullset", "enzo-full-set-4k.mp4", 252, 1.2 * 1024),
];

export const FIXTURE_VIEW: PickerView = {
  state: "ok",
  eventCode: "P26-BDAY",
  stageKey: STAGE,
  crumbs: [
    { label: "03 Creatives", folderId: "f-03" },
    { label: "3 On sale", folderId: "f-033" },
    { label: "w/c 9 Nov", folderId: "f-wc", menu: "cycle" },
    { label: "Enzo Siragusa", folderId: "f-enzo" },
    { label: "Videos", folderId: "f-enzo-videos" },
    { label: "UGC", folderId: "f-enzo-ugc" },
  ],
  cycles: [{ key: STAGE, label: "w/c 9 Nov", folderId: "f-wc" }],
  owner: owners[0]!,
  owners,
  below: ["Videos", "UGC"],
  folder: { id: "f-enzo-ugc", name: "UGC" },
  folders: [],
  otherFolders: [],
  files: FILES,
  sameFor: [
    { owner: owners[1]!, folderId: "f-luke-ugc" },
    { owner: owners[3]!, folderId: "f-puzzle-ugc" },
    { owner: owners[2]!, folderId: null },
  ],
};

export const FIXTURE_FIELDS: BatchFields = {
  primaryText: "Enzo Siragusa closes out the year with Puzzle…",
  headline: "Puzzle 4th Birthday",
  url: "https://… the event's ticket URL",
  cta: "buy_tickets",
  identity: { pageId: "puzzle", instagramAccountId: "puzzle-ig" },
};

const HUES: Record<string, number> = { d1: 12, d4: 210, d5: 280, d2: 150, terrace: 40, fullset: 330 };

/** A flat poster per file, so the frames never depend on Drive. */
function thumb(fileId: string): string {
  const hue = HUES[fileId] ?? 200;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,38%)"/><stop offset="1" stop-color="hsl(${hue},55%,14%)"/></linearGradient></defs><rect width="90" height="160" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const DL3_ROWS: PickerBatchRow[] = [
  { rowId: "r1", name: "P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16", state: { kind: "ready" } },
  { rowId: "r2", name: "P26-BDAY_enzo-siragusa-4_quote-on-sale_r1_9x16", state: { kind: "sending" } },
  { rowId: "r3", name: "P26-BDAY_enzo-siragusa-5_caption-artist-on-sale_r1_9x16", state: { kind: "copying", pct: 40 } },
  { rowId: "r4", name: "enzo-crowd-pov.mp4", state: { kind: "copy_failed" } },
  { rowId: "r5", name: "P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16 (again)", state: { kind: "skipped" } },
  // R5: a 4:5 static outside Dual / Full reads the static sentence.
  { rowId: "r6", name: "P26-BDAY_enzo-siragusa-6_quote-on-sale_r1_4x5.png", state: { kind: "not_916", static: true } },
];

// DL4 is the batch design passed (without R5's static row), every copy settled.
const DL4_ROWS: PickerBatchRow[] = DL3_ROWS.filter((row) => row.rowId !== "r6").map((row) => ({
  ...row,
  state: (row.rowId === "r2" || row.rowId === "r3" ? { kind: "ready" } : row.state) as RowState,
}));

export const DRIVE_PICKER_FRAMES: Record<string, { rows: PickerBatchRow[] | null; selected: string[] }> = {
  DL1: { rows: null, selected: ["d1", "d4", "d5"] },
  DL3: { rows: DL3_ROWS, selected: [] },
  DL4: { rows: DL4_ROWS, selected: [] },
};

export function DrivePickerFrameMount({ id }: { id: string }) {
  const frameId = id.replace(/-\d+$/, "");
  if (frameId === "DL0" || frameId === "DL5") return <DriveCreativesFrameMount frameId={frameId} />;
  return <PickerFrame frameId={frameId} />;
}

function PickerFrame({ frameId }: { frameId: string }) {
  const frame = DRIVE_PICKER_FRAMES[frameId] ?? DRIVE_PICKER_FRAMES.DL1!;
  const [fields, setFields] = useState(FIXTURE_FIELDS);
  // R4: a crumb or Next: click dismisses the batch here as it does in the step.
  const [rows, setRows] = useState(frame.rows);
  const [ready, setReady] = useState(false);
  return (
    <div className="min-h-screen bg-background" {...(ready ? { "data-frame-ready": frameId } : {})}>
      <DrivePicker
        open
        onClose={() => {}}
        eventId="frame-event"
        eventCode="P26-BDAY"
        fields={fields}
        onFieldsChange={setFields}
        onClearFields={() => setFields({ ...FIXTURE_FIELDS, primaryText: "", headline: "" })}
        ctaOptions={[{ value: "buy_tickets", label: "Buy tickets" }]}
        pages={[{ id: "puzzle", name: "Puzzle" }]}
        instagramFor={() => [{ id: "puzzle-ig", username: "puzzleofficialuk" }]}
        existingNames={["Enzo - UGC 3"]}
        existingDriveIds={new Set()}
        onPrepare={() => {}}
        batch={rows}
        onRetryFailed={() => {}}
        onDismissBatch={() => setRows(null)}
        loadView={async () => {
          // Ready once the fixture view is in and painted.
          requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
          return FIXTURE_VIEW;
        }}
        thumbnailUrl={thumb}
        initialSelected={frame.selected}
      />
    </div>
  );
}
