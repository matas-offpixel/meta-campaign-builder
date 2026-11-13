/**
 * From Drive in the Meta launcher's creatives step: the rules and words of
 * docs/design-record/2026-11-12-launcher-drive-picker.html (G1–G8), with no
 * Node or React imports so the picker, the copy route and the tests share them.
 */

// ─── Words (verbatim from the record) ───────────────────────────────────────

function endHead(n: number, s: number, f: number): string {
  return `${n} ads prepared · ${s} skipped (already in this draft) · ${f} failed`;
}

export const PICKER_WORDS = {
  entry: "From Drive",
  noEvent: "Link this campaign to an event to pick from its Drive folder.",
  noTree: "This event has no Drive folder yet — make it from the event page's Drive panel.",
  openEvent: "Open event ↗",
  unreadable: "Off / Pixel can't read this event's folder — check the export account can see it.",
  emptyFolder: (folder: string) => `Nothing in ${folder} yet.`,
  otherFolders: "Other folders here",
  sizeChecked: "Size checked when copied",
  notNineSixteenVideo: "Not 9:16 — video runs as 9:16 only",
  notNineSixteenStatic: "Not 9:16 — pairs with its 9:16 in Dual or Full",
  overVideo: "Over 200 MB — too large to upload here",
  overImage: "Over 30 MB — too large to upload here",
  needs45: "Needs its 4:5",
  needs45and11: "Needs its 4:5 and 1:1",
  videoSingle: "Video runs as 9:16 only",
  selected: (n: number, m: number) => `${n} of ${m} selected`,
  selectedNarrow: (n: number, m: number) => `${n} of ${m}`,
  selectAll: (k: number) => `Select all 9:16 (${k})`,
  selectAllNarrow: "All 9:16",
  none: "None",
  filesLine: (m: number, cant: number) => (cant > 0 ? `${m} files · ${cant} can't be used here` : `${m} files`),
  sameFolderFor: "Same folder for:",
  next: "Next:",
  ownerEmpty: "— empty",
  footNote: "One ad per file. Nothing launches — the ads join this draft.",
  footNoteNarrow: "Nothing launches.",
  cancel: "Cancel",
  prepare: (n: number) => `Prepare ${n} ad${n === 1 ? "" : "s"}`,
  edit: "Edit",
  clearFields: "Clear fields",
  fieldsKept: "Batch fields: kept for the next folder",
  done: "Done",
  copying: (pct: number) => `Copying from Drive… ${Math.max(0, Math.min(100, Math.round(pct)))} %`,
  sending: "Sending to Meta…",
  ready: "Ready",
  inRegistry: "Already in Off / Pixel — sending to Meta…",
  copyFailed: "Couldn't copy from Drive",
  retry: "Retry",
  metaFailed: (reason: string) => `Meta didn't take this file — ${reason}`,
  alreadyInDraft: "Already in this draft — skipped",
  preparingHead: (n: number, k: number) => `Preparing ${n} ads · ${k} ready`,
  preparingTail: " — the others carry on if one fails.",
  closeNote: "You can close this; ads finish in the draft.",
  retryFailed: (f: number) => `Retry failed (${f})`,
  endLine: (n: number, s: number, f: number) => `${endHead(n, s, f)}${f > 0 ? " — Retry" : ""}`,
  /** The end line before its " — Retry" (the picker draws Retry as a button). */
  endLineHead: (n: number, s: number, f: number) => endHead(n, s, f),
  fromDrive: "From Drive",
  fromDrivePath: (path: string) => `From Drive · ${path}`,
  dialogTitle: (code: string) => `From Drive · ${code}`,
  primaryText: "Primary text",
  headline: "Headline",
  url: "URL · event ticket link",
  cta: "CTA",
  identity: "Page · Instagram",
} as const;

// ─── Limits (the step's own: lib/meta/upload MAX_VIDEO_BYTES / MAX_IMAGE_BYTES) ─

export const PICKER_MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const PICKER_MAX_IMAGE_BYTES = 30 * 1024 * 1024;
/** The crop's own tolerance (G2). */
export const RATIO_TOLERANCE = 0.02;

// ─── Files ──────────────────────────────────────────────────────────────────

/** A file in an open folder, from Drive's files.list (thumbnailLink, mimeType, size, video/imageMediaMetadata). */
export type PickerFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  hasThumbnail: boolean;
  width: number | null;
  height: number | null;
  rotation: number | null;
  durationMs: number | null;
};

export type PickerKind = "video" | "image";
export type AssetModeName = "single" | "dual" | "full";
export type RatioName = "9:16" | "4:5" | "1:1";

/** G3: media type from the MIME. Null for anything else (not shown as a tile). */
export function pickerKind(mimeType: string): PickerKind | null {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  return null;
}

/** Width and height as shown: a quarter turn (90 / 270) swaps them. */
export function displaySize(width: number, height: number, rotation: number | null | undefined): { width: number; height: number } {
  const quarter = Math.abs(Math.round((rotation ?? 0) / 90)) % 2 === 1;
  return quarter ? { width: height, height: width } : { width, height };
}

function near(ratio: number, target: number): boolean {
  return Math.abs(ratio - target) / target <= RATIO_TOLERANCE;
}

/** The ratio badge, or null when Drive hasn't measured the file yet. */
export function ratioOf(file: Pick<PickerFile, "width" | "height" | "rotation">): string | null {
  if (!file.width || !file.height) return null;
  const { width, height } = displaySize(file.width, file.height, file.rotation);
  const r = width / height;
  if (near(r, 9 / 16)) return "9:16";
  if (near(r, 4 / 5)) return "4:5";
  if (near(r, 1)) return "1:1";
  if (near(r, 16 / 9)) return "16:9";
  const g = gcd(width, height);
  return `${width / g}:${height / g}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function isNineSixteen(width: number, height: number, rotation?: number | null): boolean {
  const shown = displaySize(width, height, rotation);
  return near(shown.width / shown.height, 9 / 16);
}

/** "4:12" for 252 s, "21.8 s" under a minute. */
export function formatDuration(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** 26.8 MB, 1.2 GB. */
export function formatBytes(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** A long file name cut in the middle, keeping its end (the ratio token and extension). */
export function middleCut(name: string, max = 44): string {
  if (name.length <= max) return name;
  const tail = Math.ceil((max - 1) * 0.45);
  return `${name.slice(0, max - 1 - tail)}…${name.slice(name.length - tail)}`;
}

/**
 * A file name in two parts for a tile or row (G2): a head that may truncate,
 * and a tail that always shows — the ratio token and the extension (and a
 * row's " (again)"), else just the extension.
 */
export function splitFileName(name: string): { head: string; tail: string } {
  const m = /(_(?:9x16|4x5|1x1)(?:_winner)?(?:\.[a-z0-9]+)?(?: \(again\))?)$/i.exec(name) ?? /(\.[a-z0-9]{2,5}(?: \(again\))?)$/i.exec(name);
  if (!m || m.index === 0) return { head: name, tail: "" };
  return { head: name.slice(0, m.index), tail: m[1] };
}

/**
 * A tile's file name on at most two lines (N1, design fix round 2). Lines
 * break only after "_" or "-"; the tail (ratio token and extension, see
 * `splitFileName`) is glued to the last word, so it never splits or wraps on
 * its own. Only when the name still runs past line 2 is line 2 cut in the
 * middle with "…", keeping the tail attached to the end.
 *
 * `measure` returns a string's width in the box's font; `width` is the box.
 * A word wider than a whole line (no break inside it) is broken by
 * characters, so a line is never wider than the box.
 */
export function wrapFileName(name: string, width: number, measure: (text: string) => number): string[] {
  if (!name) return [""];
  if (measure(name) <= width) return [name];
  const { head, tail } = splitFileName(name);
  const words = head.match(/[^_-]*[_-]|[^_-]+$/g) ?? [head];
  if (tail) {
    if (words.length) words[words.length - 1] += tail;
    else words.push(tail);
  }
  const fits = (text: string) => measure(text) <= width;

  // Line 1: as many whole words as fit; else the longest run of characters that does.
  let line1 = "";
  let i = 0;
  while (i < words.length && fits(line1 + words[i])) line1 += words[i++];
  let rest = words.slice(i).join("");
  if (!line1) {
    let n = 1;
    while (n < rest.length && fits(rest.slice(0, n + 1))) n += 1;
    line1 = rest.slice(0, n);
    rest = rest.slice(n);
  }
  if (!rest) return [line1];
  if (fits(rest)) return [line1, rest];

  // Line 2 runs over: cut in the middle, the end kept whole from the tail on.
  const ellipsis = "…";
  const keep = tail && rest.endsWith(tail) ? tail : rest.slice(-Math.min(rest.length, 8));
  let end = keep;
  // Give the end up to ~45% of the line (the start reads first, so it gets the rest).
  while (end.length < rest.length && measure(rest.slice(rest.length - end.length - 1)) <= width * 0.45) {
    end = rest.slice(rest.length - end.length - 1);
  }
  let start = "";
  while (start.length < rest.length - end.length && fits(rest.slice(0, start.length + 1) + ellipsis + end)) {
    start = rest.slice(0, start.length + 1);
  }
  // A box too narrow even for the tail: keep the end, drop characters from its front.
  while (!fits(start + ellipsis + end) && end.length > 1) end = end.slice(1);
  return [line1, `${start}${ellipsis}${end}`];
}

// ─── S14 names (lib/drive/tree.ts renderFileName) ───────────────────────────

/** {code}_{artist}-{n}_{angle}{k}-{stage}_r{n}[_v{k}]_{format}[_winner].{ext}: the format token and the name around it. */
const S14 = /^(.+_r\d+(?:_v\d+)?)_(9x16|4x5|1x1)(_winner)?\.([a-z0-9]+)$/i;

export function parseS14(name: string): { stem: string; ratio: RatioName; winner: boolean; ext: string } | null {
  const m = S14.exec(name);
  if (!m) return null;
  return { stem: m[1], ratio: m[2].replace("x", ":") as RatioName, winner: Boolean(m[3]), ext: m[4] };
}

export function s14Sibling(name: string, ratio: RatioName): string | null {
  const parsed = parseS14(name);
  if (!parsed) return null;
  return `${parsed.stem}_${ratio.replace(":", "x")}${parsed.winner ? "_winner" : ""}.${parsed.ext}`;
}

// ─── Tiles (G2) ─────────────────────────────────────────────────────────────

export type Tile = {
  file: PickerFile;
  kind: PickerKind;
  ratio: string | null;
  selectable: boolean;
  /** Why it can't be picked (G2's words), or null. */
  reason: string | null;
  /** Shown on a selectable unmeasured file. */
  note: string | null;
  /** Dual / Full: the paired siblings, by ratio. */
  pairs: Partial<Record<"4:5" | "1:1", PickerFile>>;
};

/**
 * The tiles for an open folder in the batch's mode. In Dual or Full a
 * static's 4:5 and 1:1 siblings (by S14 name) ride on its 9:16 tile and are
 * not tiles of their own; a video is always a Single 9:16 ad.
 */
export function folderTiles(files: readonly PickerFile[], mode: AssetModeName): Tile[] {
  const byName = new Map(files.map((f) => [f.name, f]));
  const riding = new Set<string>();
  if (mode !== "single") {
    for (const f of files) {
      if (pickerKind(f.mimeType) !== "image") continue;
      const parsed = parseS14(f.name);
      if (!parsed || parsed.ratio !== "9:16") continue;
      for (const r of mode === "full" ? (["4:5", "1:1"] as const) : (["4:5"] as const)) {
        const sib = s14Sibling(f.name, r);
        if (sib && byName.has(sib)) riding.add(sib);
      }
    }
  }
  const tiles: Tile[] = [];
  for (const file of files) {
    const kind = pickerKind(file.mimeType);
    if (!kind || riding.has(file.name)) continue;
    const ratio = ratioOf(file);
    const tile: Tile = { file, kind, ratio, selectable: true, reason: null, note: null, pairs: {} };
    const limit = kind === "video" ? PICKER_MAX_VIDEO_BYTES : PICKER_MAX_IMAGE_BYTES;
    if (file.size != null && file.size > limit) {
      tile.selectable = false;
      tile.reason = kind === "video" ? PICKER_WORDS.overVideo : PICKER_WORDS.overImage;
    } else if (ratio && ratio !== "9:16") {
      tile.selectable = false;
      tile.reason = kind === "video" ? PICKER_WORDS.notNineSixteenVideo : PICKER_WORDS.notNineSixteenStatic;
    } else if (!ratio) {
      tile.note = PICKER_WORDS.sizeChecked;
    }
    if (tile.selectable && kind === "image" && mode !== "single") {
      const wanted = mode === "full" ? (["4:5", "1:1"] as const) : (["4:5"] as const);
      if (!parseS14(file.name)) {
        tile.selectable = false;
        tile.reason = mode === "full" ? PICKER_WORDS.needs45and11 : PICKER_WORDS.needs45;
      } else {
        for (const r of wanted) {
          const sib = byName.get(s14Sibling(file.name, r) ?? "");
          if (sib) tile.pairs[r] = sib;
        }
        if (wanted.some((r) => !tile.pairs[r])) {
          tile.selectable = false;
          tile.reason = mode === "full" ? PICKER_WORDS.needs45and11 : PICKER_WORDS.needs45;
        }
      }
    }
    tiles.push(tile);
  }
  return tiles;
}

// ─── Naming (G5) ────────────────────────────────────────────────────────────

export type PickerOwner = { key: string; name: string; folderId: string };

/** {folder} in "{first name} - {folder} {n}": the open folder's name, or Video / Static straight in Videos / Statics. */
export function folderLabel(folderName: string): string {
  const lower = folderName.trim().toLowerCase();
  if (lower === "videos") return "Video";
  if (lower === "statics") return "Static";
  return folderName.trim();
}

/** An owner's short name: the first name, or the full name when another owner shares it. */
export function ownerShortName(owner: Pick<PickerOwner, "name">, owners: readonly Pick<PickerOwner, "name">[]): string {
  const first = owner.name.trim().split(/\s+/)[0] ?? owner.name;
  const shared = owners.filter((o) => (o.name.trim().split(/\s+/)[0] ?? o.name) === first).length > 1;
  return shared ? owner.name.trim() : first;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One name per new ad, in order: the file name without its extension for an
 * S14 name; else "{short} - {folder} {n}", n continuing from the highest
 * number the draft (and this batch) already holds for that owner and folder.
 */
export function adNames(files: readonly Pick<PickerFile, "name">[], short: string, folder: string, existing: readonly string[]): string[] {
  const prefix = `${short} - ${folder} `;
  const re = new RegExp(`^${escapeRe(prefix)}(\\d+)$`);
  let n = 0;
  for (const name of existing) {
    const m = re.exec(name.trim());
    if (m) n = Math.max(n, Number(m[1]));
  }
  return files.map((file) => {
    if (parseS14(file.name)) return file.name.replace(/\.[^.]+$/, "");
    n += 1;
    return `${prefix}${n}`;
  });
}

// ─── The batch's fields (G4) ────────────────────────────────────────────────

export type BatchIdentity = { pageId: string; instagramAccountId: string; instagramActorId?: string };

export type BatchFields = {
  primaryText: string;
  headline: string;
  url: string;
  cta: string;
  identity: BatchIdentity;
};

/** G4's defaults: text and headline empty; URL the ticket link, else the last ad's; CTA and identity the last ad's. */
export function defaultBatchFields(input: {
  ticketUrl: string | null | undefined;
  lastAd: { destinationUrl?: string; cta?: string; identity?: BatchIdentity } | null | undefined;
  objectiveCta: string;
}): BatchFields {
  const ticket = (input.ticketUrl ?? "").trim();
  return {
    primaryText: "",
    headline: "",
    url: ticket || input.lastAd?.destinationUrl || "",
    cta: input.lastAd?.cta || input.objectiveCta,
    identity: { pageId: "", instagramAccountId: "", ...(input.lastAd?.identity ?? {}) },
  };
}

/** G4 / G7: the identity picked for an owner this session, else the batch's default. Never switched by the folder. */
export function identityForOwner(memory: Readonly<Record<string, BatchIdentity>>, ownerKey: string | null, fallback: BatchIdentity): BatchIdentity {
  return (ownerKey && memory[ownerKey]) || fallback;
}

// ─── Rows (G6) ──────────────────────────────────────────────────────────────

export type RowState =
  | { kind: "waiting" }
  | { kind: "copying"; pct: number }
  | { kind: "in_registry" }
  | { kind: "sending" }
  | { kind: "ready" }
  | { kind: "skipped" }
  | { kind: "copy_failed" }
  | { kind: "meta_failed"; reason: string }
  /** A static's file (its 9:16, 4:5 or 1:1) reads the static sentence, a video the video one. */
  | { kind: "not_916"; static?: boolean };

export function rowLine(state: RowState): string {
  switch (state.kind) {
    case "waiting":
      return PICKER_WORDS.copying(0);
    case "copying":
      return PICKER_WORDS.copying(state.pct);
    case "in_registry":
      return PICKER_WORDS.inRegistry;
    case "sending":
      return PICKER_WORDS.sending;
    case "ready":
      return PICKER_WORDS.ready;
    case "skipped":
      return PICKER_WORDS.alreadyInDraft;
    case "copy_failed":
      return `${PICKER_WORDS.copyFailed} — ${PICKER_WORDS.retry}`;
    case "meta_failed":
      return PICKER_WORDS.metaFailed(state.reason);
    case "not_916":
      return state.static ? PICKER_WORDS.notNineSixteenStatic : PICKER_WORDS.notNineSixteenVideo;
  }
}

export function isFailed(state: RowState): boolean {
  return state.kind === "copy_failed" || state.kind === "meta_failed" || state.kind === "not_916";
}

/**
 * A failure a retry can fix: the copy or Meta's upload. A not-9:16 file
 * fails the same ratio check every time, so it counts as failed in the end
 * line but is never retried (no Retry of its own, not in Retry failed).
 */
export function isRetryable(state: RowState): boolean {
  return state.kind === "copy_failed" || state.kind === "meta_failed";
}

export function batchCounts(states: readonly RowState[]): { n: number; ready: number; skipped: number; failed: number; retryable: number; done: boolean } {
  const ready = states.filter((s) => s.kind === "ready").length;
  const skipped = states.filter((s) => s.kind === "skipped").length;
  const failed = states.filter(isFailed).length;
  const retryable = states.filter(isRetryable).length;
  const done = states.every((s) => s.kind === "ready" || s.kind === "skipped" || isFailed(s));
  return { n: states.length - skipped, ready, skipped, failed, retryable, done };
}

// ─── The view the picker route returns (G1) ─────────────────────────────────

export type Crumb = { label: string; folderId: string | null; menu?: "cycle" };

export type PickerView =
  | { state: "no_tree" }
  | { state: "unreadable" }
  | { state: "not_in_tree" }
  | {
      state: "ok";
      eventCode: string;
      stageKey: string;
      crumbs: Crumb[];
      cycles: { key: string; label: string; folderId: string }[];
      owner: PickerOwner | null;
      owners: PickerOwner[];
      /** Folder names below the owner, for G5's {folder} and G7's chips. */
      below: string[];
      folder: { id: string; name: string };
      folders: { id: string; name: string }[];
      otherFolders: { id: string; name: string }[];
      files: PickerFile[];
      /** G7: the same path under each other owner; folderId null = — empty. */
      sameFor: { owner: PickerOwner; folderId: string | null }[];
    };
