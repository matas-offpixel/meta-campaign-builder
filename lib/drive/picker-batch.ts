/**
 * G6's batch: each picked file goes Drive → Storage (the picker's copy route)
 * → Meta (the step's existing draft upload), one at a time, each row in its
 * own state. One failure never stops the batch; Retry failed reruns only the
 * failed rows. Client-safe: the network calls come in as deps.
 */

import type { AssetModeName, PickerKind, PickerOwner, RatioName, RowState, Tile } from "./picker-model.ts";
import { adNames, folderLabel, isFailed, ownerShortName } from "./picker-model.ts";

/** One file into one slot of the row's ad: the 9:16, or (Dual / Full statics) its 4:5 or 1:1. */
export type BatchPart = { fileId: string; fileName: string; role: RatioName; slotAssetId: string | null };

/** One row per ad (G6): its 9:16 file first, then any paired siblings. */
export type BatchRow = {
  rowId: string;
  /** The row's name: the ad's name. */
  name: string;
  /** The ad the files fill; null for a skipped row (already in this draft). */
  adId: string | null;
  variationId: string | null;
  kind: PickerKind;
  parts: BatchPart[];
};

export type CopyOk = {
  ok: true;
  storagePath: string;
  storageBucket: string;
  registryAssetId: string;
  mediaType: PickerKind;
  fileName: string;
  fromRegistry: boolean;
};
export type CopyFail = { ok: false; code: "not_in_tree" | "too_large" | "not_916" | "copy_failed"; reason: string };
export type CopyOutcome = CopyOk | CopyFail;

export type MetaResult = { url: string; previewUrl?: string; hash?: string; videoId?: string; registryAssetId?: string };

export type BatchDeps = {
  copy: (row: BatchRow, part: BatchPart, onProgress: (p: { type: "progress"; pct: number } | { type: "registry" }) => void) => Promise<CopyOutcome>;
  sendToMeta: (row: BatchRow, part: BatchPart, copy: CopyOk) => Promise<MetaResult>;
  onRow: (rowId: string, state: RowState) => void;
  /** Writes one uploaded file into its slot of the row's ad. */
  onUploaded: (row: BatchRow, part: BatchPart, copy: CopyOk, meta: MetaResult) => void;
  /** Marks the row's unfinished slots failed with the row's words. */
  onSlotFailed: (row: BatchRow, part: BatchPart, line: string) => void;
};

/** Reads the copy route's NDJSON: progress lines, then the done line. */
export async function readCopyStream(res: Response, onProgress: (p: { type: "progress"; pct: number } | { type: "registry" }) => void): Promise<CopyOutcome> {
  if (!res.body) return { ok: false, code: "copy_failed", reason: "Couldn't copy from Drive" };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let done: CopyOutcome | null = null;
  const take = (line: string) => {
    if (!line.trim()) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (parsed.type === "progress") onProgress({ type: "progress", pct: Number(parsed.pct) || 0 });
    else if (parsed.type === "registry") onProgress({ type: "registry" });
    else if (parsed.type === "done") {
      const rest: Record<string, unknown> = { ...parsed };
      delete rest.type;
      done = rest as unknown as CopyOutcome;
    }
  };
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffered += decoder.decode(chunk.value, { stream: true });
    let at = buffered.indexOf("\n");
    while (at >= 0) {
      take(buffered.slice(0, at));
      buffered = buffered.slice(at + 1);
      at = buffered.indexOf("\n");
    }
  }
  take(buffered);
  return done ?? { ok: false, code: "copy_failed", reason: "Couldn't copy from Drive" };
}

/** Runs the rows in order, each row's parts in order. Returns each row's final state, keyed by rowId. */
export async function runBatch(rows: readonly BatchRow[], deps: BatchDeps): Promise<Map<string, RowState>> {
  const final = new Map<string, RowState>();
  const set = (row: BatchRow, state: RowState) => {
    final.set(row.rowId, state);
    deps.onRow(row.rowId, state);
  };
  for (const row of rows) {
    if (!row.adId) {
      set(row, { kind: "skipped" });
      continue;
    }
    let failed = false;
    for (const part of row.parts) {
      set(row, { kind: "copying", pct: 0 });
      let fromRegistry = false;
      let copy: CopyOutcome;
      try {
        copy = await deps.copy(row, part, (p) => {
          if (p.type === "registry") fromRegistry = true;
          set(row, p.type === "registry" ? { kind: "in_registry" } : { kind: "copying", pct: p.pct });
        });
      } catch {
        copy = { ok: false, code: "copy_failed", reason: "Couldn't copy from Drive" };
      }
      if (!copy.ok) {
        const notNineSixteen = copy.code === "not_916";
        set(row, notNineSixteen ? { kind: "not_916" } : { kind: "copy_failed" });
        deps.onSlotFailed(row, part, notNineSixteen ? "Not 9:16 — video runs as 9:16 only" : "Couldn't copy from Drive — Retry");
        failed = true;
        break;
      }
      if (!fromRegistry) set(row, { kind: "sending" });
      try {
        const meta = await deps.sendToMeta(row, part, copy);
        deps.onUploaded(row, part, copy, meta);
      } catch (err) {
        const reason = err instanceof Error && err.message ? err.message : "Upload failed";
        set(row, { kind: "meta_failed", reason });
        deps.onSlotFailed(row, part, `Meta didn't take this file — ${reason}`);
        failed = true;
        break;
      }
    }
    if (!failed) set(row, { kind: "ready" });
  }
  return final;
}

/** Retry failed: only the rows whose state failed. */
export function failedRows(rows: readonly BatchRow[], states: ReadonlyMap<string, RowState>): BatchRow[] {
  return rows.filter((row) => {
    const state = states.get(row.rowId);
    return state ? isFailed(state) : false;
  });
}

// ─── Prepare (G5) ───────────────────────────────────────────────────────────

export type PlannedAd = {
  name: string;
  kind: PickerKind;
  /** Video is always Single; statics take the batch's mode. */
  assetMode: AssetModeName;
  parts: Omit<BatchPart, "slotAssetId">[];
};

/**
 * One ad per selected tile (one per set in Dual / Full), named by S14 or
 * "{short} - {folder} {n}". A tile whose Drive file is already an ad in this
 * draft is skipped with G5's words.
 */
export function planPrepare(input: {
  tiles: readonly Tile[];
  mode: AssetModeName;
  owner: PickerOwner | null;
  owners: readonly PickerOwner[];
  folderName: string;
  existingNames: readonly string[];
  existingDriveIds: ReadonlySet<string>;
}): { ads: PlannedAd[]; skipped: { name: string; fileId: string }[] } {
  const fresh = input.tiles.filter((t) => !input.existingDriveIds.has(t.file.id));
  const skipped = input.tiles.filter((t) => input.existingDriveIds.has(t.file.id)).map((t) => ({ name: t.file.name.replace(/\.[^.]+$/, ""), fileId: t.file.id }));
  const short = input.owner ? ownerShortName(input.owner, input.owners) : input.folderName;
  const names = adNames(fresh.map((t) => t.file), short, folderLabel(input.folderName), input.existingNames);
  const ads = fresh.map((tile, i): PlannedAd => {
    const assetMode: AssetModeName = tile.kind === "video" ? "single" : input.mode;
    const parts: Omit<BatchPart, "slotAssetId">[] = [{ fileId: tile.file.id, fileName: tile.file.name, role: "9:16" }];
    if (tile.kind === "image" && assetMode !== "single") {
      for (const r of assetMode === "full" ? (["4:5", "1:1"] as const) : (["4:5"] as const)) {
        const sib = tile.pairs[r];
        if (sib) parts.push({ fileId: sib.id, fileName: sib.name, role: r });
      }
    }
    return { name: names[i]!, kind: tile.kind, assetMode, parts };
  });
  return { ads, skipped };
}
