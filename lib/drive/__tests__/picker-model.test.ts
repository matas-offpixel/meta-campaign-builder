/** The launcher's From Drive picker: the rules (G2–G6, HG2–HG6) without Drive or Meta. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { failedRows, planPrepare, retryTargets, runBatch, readCopyStream, type BatchRow, type CopyOutcome } from "../picker-batch.ts";
import {
  PICKER_WORDS,
  adNames,
  batchCounts,
  defaultBatchFields,
  folderTiles,
  formatBytes,
  formatDuration,
  identityForOwner,
  middleCut,
  ownerShortName,
  parseS14,
  ratioOf,
  rowLine,
  splitFileName,
  wrapFileName,
  type PickerFile,
  type RowState,
} from "../picker-model.ts";

const MB = 1024 * 1024;

function file(name: string, over: Partial<PickerFile> = {}): PickerFile {
  return { id: `id-${name}`, name, mimeType: "video/mp4", size: 20 * MB, hasThumbnail: true, width: 1080, height: 1920, rotation: null, durationMs: 21_800, ...over };
}

describe("ratio and the disabled reasons (G2, HG2)", () => {
  it("a 1920 × 1080 clip is disabled with the video reason; a phone clip Drive stores 1920 × 1080 with rotation 90 reads 9:16", () => {
    const [landscape, phone] = folderTiles([file("terrace.mov", { width: 1920, height: 1080 }), file("phone.mp4", { width: 1920, height: 1080, rotation: 90 })], "single");
    assert.deepEqual([landscape!.ratio, landscape!.selectable, landscape!.reason], ["16:9", false, PICKER_WORDS.notNineSixteenVideo]);
    assert.deepEqual([phone!.ratio, phone!.selectable], ["9:16", true]);
  });

  it("2 % tolerance: 1080 × 1950 is 9:16, 1080 × 2000 isn't", () => {
    assert.equal(ratioOf({ width: 1080, height: 1950, rotation: 0 }), "9:16");
    assert.notEqual(ratioOf({ width: 1080, height: 2000, rotation: 0 }), "9:16");
  });

  it("over the step's limits: 1.2 GB video and a 31 MB image, with their words; unmeasured is selectable with Size checked when copied", () => {
    const tiles = folderTiles(
      [file("enzo-full-set-4k.mp4", { size: 1.2 * 1024 * MB }), file("big.jpg", { mimeType: "image/jpeg", size: 31 * MB }), file("new.mp4", { width: null, height: null })],
      "single",
    );
    assert.deepEqual(tiles.map((t) => t.reason), [PICKER_WORDS.overVideo, PICKER_WORDS.overImage, null]);
    assert.equal(tiles[2]!.note, PICKER_WORDS.sizeChecked);
    assert.equal(tiles[2]!.selectable, true);
  });

  it("a non-9:16 static in Single has the static reason; folders and other MIME types are not tiles", () => {
    const tiles = folderTiles([file("p.jpg", { mimeType: "image/jpeg", width: 1080, height: 1350 }), file("doc.pdf", { mimeType: "application/pdf" })], "single");
    assert.equal(tiles.length, 1);
    assert.equal(tiles[0]!.reason, PICKER_WORDS.notNineSixteenStatic);
  });

  it("Dual / Full pair statics by S14 name: the 4:5 rides on the 9:16; a 9:16 without its 4:5 is disabled; video stays its own Single tile", () => {
    const base = "P26-BDAY_enzo-siragusa-1_quote-on-sale_r1";
    const files = [
      file(`${base}_9x16.jpg`, { mimeType: "image/jpeg" }),
      file(`${base}_4x5.jpg`, { mimeType: "image/jpeg", width: 1080, height: 1350 }),
      file("P26-BDAY_enzo-siragusa-2_quote-on-sale_r1_9x16.jpg", { mimeType: "image/jpeg" }),
      file("plain-9x16.jpg", { mimeType: "image/jpeg" }),
      file(`${base}_9x16.mp4`),
    ];
    const dual = folderTiles(files, "dual");
    assert.deepEqual(
      dual.map((t) => [t.file.name, t.selectable, t.reason]),
      [
        [`${base}_9x16.jpg`, true, null],
        ["P26-BDAY_enzo-siragusa-2_quote-on-sale_r1_9x16.jpg", false, PICKER_WORDS.needs45],
        ["plain-9x16.jpg", false, PICKER_WORDS.needs45],
        [`${base}_9x16.mp4`, true, null],
      ],
    );
    assert.equal(dual[0]!.pairs["4:5"]?.name, `${base}_4x5.jpg`);
    const full = folderTiles(files, "full");
    assert.equal(full[0]!.reason, PICKER_WORDS.needs45and11);
    assert.equal(parseS14(`${base}_9x16_winner.mp4`)?.winner, true);
  });

  it("formats: duration, size, the middle cut", () => {
    assert.equal(formatDuration(21_800), "21.8 s");
    assert.equal(formatDuration(252_000), "4:12");
    assert.equal(formatBytes(1.2 * 1024 * MB), "1.2 GB");
    assert.equal(formatBytes(26.8 * MB), "26.8 MB");
    const cut = middleCut("P26-BDAY_enzo-siragusa-5_caption-artist-on-sale_r1_9x16.mp4", 40);
    assert.ok(cut.length <= 40 && cut.endsWith("_9x16.mp4") && cut.includes("…"));
  });
});

describe("names, fields and identity (G4, G5, HG4, HG5)", () => {
  it("S14 names keep the file name without its extension; others continue {first} - {folder} {n} from the draft", () => {
    assert.deepEqual(
      adNames([{ name: "P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16.mp4" }, { name: "crowd.mp4" }, { name: "pov.mp4" }], "Enzo", "UGC", ["Enzo - UGC 3", "Luke - UGC 7"]),
      ["P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16", "Enzo - UGC 4", "Enzo - UGC 5"],
    );
  });

  it("two owners sharing a first name use the full name; Videos straight reads Video", () => {
    const owners = [{ name: "Luke Dean" }, { name: "Luke Solomon" }, { name: "Enzo Siragusa" }];
    assert.equal(ownerShortName(owners[0]!, owners), "Luke Dean");
    assert.equal(ownerShortName(owners[2]!, owners), "Enzo");
    const plan = planPrepare({
      tiles: folderTiles([file("a.mp4")], "single"),
      mode: "single",
      owner: { key: "k", name: "Enzo Siragusa", folderId: "f" },
      owners: [{ key: "k", name: "Enzo Siragusa", folderId: "f" }],
      folderName: "Videos",
      existingNames: [],
      existingDriveIds: new Set(),
    });
    assert.equal(plan.ads[0]!.name, "Enzo - Video 1");
  });

  it("the first batch prefills the ticket URL and the last CTA and identity; with no ticket link the last ad's URL", () => {
    const last = { destinationUrl: "https://last.example/", cta: "SHOP_NOW", identity: { pageId: "p1", instagramAccountId: "ig1" } };
    assert.deepEqual(defaultBatchFields({ ticketUrl: "https://tickets.example/p26", lastAd: last, objectiveCta: "LEARN_MORE" }), {
      primaryText: "",
      headline: "",
      url: "https://tickets.example/p26",
      cta: "SHOP_NOW",
      identity: { pageId: "p1", instagramAccountId: "ig1" },
    });
    assert.equal(defaultBatchFields({ ticketUrl: null, lastAd: last, objectiveCta: "LEARN_MORE" }).url, "https://last.example/");
    assert.equal(defaultBatchFields({ ticketUrl: null, lastAd: null, objectiveCta: "LEARN_MORE" }).cta, "LEARN_MORE");
  });

  it("an identity picked for Enzo is remembered for Enzo, not for Luke", () => {
    const fallback = { pageId: "puzzle", instagramAccountId: "puzzle-ig" };
    const memory = { enzo: { pageId: "puzzle", instagramAccountId: "enzo-ig" } };
    assert.equal(identityForOwner(memory, "enzo", fallback).instagramAccountId, "enzo-ig");
    assert.equal(identityForOwner(memory, "luke", fallback).instagramAccountId, "puzzle-ig");
  });

  it("the same folder twice adds nothing the second time; a mixed selection makes video and image ads", () => {
    const tiles = folderTiles([file("a.mp4"), file("b.mp4"), file("c.jpg", { mimeType: "image/jpeg" })], "single");
    const first = planPrepare({ tiles, mode: "single", owner: null, owners: [], folderName: "UGC", existingNames: [], existingDriveIds: new Set() });
    assert.deepEqual(first.ads.map((a) => a.kind), ["video", "video", "image"]);
    const again = planPrepare({ tiles, mode: "single", owner: null, owners: [], folderName: "UGC", existingNames: [], existingDriveIds: new Set(tiles.map((t) => t.file.id)) });
    assert.equal(again.ads.length, 0);
    assert.equal(again.skipped.length, 3);
  });
});

describe("the batch (G6, HG6)", () => {
  const rows: BatchRow[] = ["one", "two", "three"].map((name) => ({
    rowId: name,
    name,
    adId: `ad-${name}`,
    variationId: "v",
    kind: "video",
    parts: [{ fileId: `f-${name}`, fileName: `${name}.mp4`, role: "9:16", slotAssetId: "s" }],
  }));

  it("one failing file ends 2 prepared · 0 skipped · 1 failed — Retry, the rest carry on, and Retry makes the third", async () => {
    let failOnce = true;
    const lines: string[] = [];
    const uploaded: string[] = [];
    const deps = {
      copy: async (row: BatchRow, _part: unknown, onProgress: (p: { type: "progress"; pct: number }) => void): Promise<CopyOutcome> => {
        onProgress({ type: "progress", pct: 40 });
        if (row.rowId === "two" && failOnce) {
          failOnce = false;
          return { ok: false, code: "copy_failed", reason: "Couldn't copy from Drive" };
        }
        return { ok: true, storagePath: `videos/drive-send/${row.rowId}.mp4`, storageBucket: "campaign-assets", registryAssetId: `reg-${row.rowId}`, mediaType: "video", fileName: `${row.rowId}.mp4`, fromRegistry: false };
      },
      sendToMeta: async () => ({ url: "", videoId: "v1" }),
      onRow: (_id: string, state: RowState) => lines.push(rowLine(state)),
      onUploaded: (row: BatchRow) => uploaded.push(row.rowId),
      onSlotFailed: () => {},
    };
    const states = await runBatch(rows, deps);
    const counts = batchCounts([...states.values()]);
    assert.equal(PICKER_WORDS.endLine(counts.ready, counts.skipped, counts.failed), "2 ads prepared · 0 skipped (already in this draft) · 1 failed — Retry");
    assert.deepEqual(uploaded, ["one", "three"]);
    assert.ok(lines.includes("Copying from Drive… 40 %"));
    assert.ok(lines.includes("Couldn't copy from Drive — Retry"));
    const retry = failedRows(rows, states);
    assert.deepEqual(retry.map((r) => r.rowId), ["two"]);
    const again = await runBatch(retry, deps);
    assert.equal(again.get("two")?.kind, "ready");
  });

  it("a registry hit reads Already in Off / Pixel; a Meta refusal keeps Meta's plain words; a skipped row is skipped", async () => {
    const seen: string[] = [];
    const states = await runBatch(
      [rows[0]!, rows[1]!, { ...rows[2]!, adId: null }],
      {
        copy: async (_row, _part, onProgress) => {
          onProgress({ type: "registry" });
          return { ok: true, storagePath: "p", storageBucket: "b", registryAssetId: "r", mediaType: "video", fileName: "x", fromRegistry: true };
        },
        sendToMeta: async (row) => {
          if (row.rowId === "two") throw new Error("The video is too short for Reels");
          return { url: "" };
        },
        onRow: (_id, state) => seen.push(rowLine(state)),
        onUploaded: () => {},
        onSlotFailed: () => {},
      },
    );
    assert.ok(seen.includes("Already in Off / Pixel — sending to Meta…"));
    assert.equal(rowLine(states.get("two")!), "Meta didn't take this file — The video is too short for Reels");
    assert.equal(rowLine(states.get("three")!), "Already in this draft — skipped");
    const counts = batchCounts([...states.values()]);
    assert.equal(PICKER_WORDS.preparingHead(counts.n, counts.ready), "Preparing 2 ads · 1 ready");
  });

  it("Retry on one row retries that row only (if it failed); Retry failed takes every failed row", () => {
    const states = new Map<string, RowState>([
      ["one", { kind: "copy_failed" }],
      ["two", { kind: "ready" }],
      ["three", { kind: "meta_failed", reason: "x" }],
    ]);
    assert.deepEqual(retryTargets(rows, states, "one").map((r) => r.rowId), ["one"]);
    assert.deepEqual(retryTargets(rows, states, "two"), []);
    assert.deepEqual(retryTargets(rows, states).map((r) => r.rowId), ["one", "three"]);
    assert.equal(PICKER_WORDS.endLineHead(2, 0, 1), "2 ads prepared · 0 skipped (already in this draft) · 1 failed");
  });

  it("a not-9:16 row counts as failed but is never retried: not in Retry failed, no Retry of its own (R5)", () => {
    const four = [...rows, { ...rows[0]!, rowId: "four" }];
    const states = new Map<string, RowState>([
      ["one", { kind: "copy_failed" }],
      ["two", { kind: "ready" }],
      ["three", { kind: "meta_failed", reason: "x" }],
      ["four", { kind: "not_916", static: true }],
    ]);
    assert.deepEqual(retryTargets(four, states).map((r) => r.rowId), ["one", "three"]);
    assert.deepEqual(retryTargets(four, states, "four"), []);
    const counts = batchCounts([...states.values()]);
    assert.equal(counts.failed, 3, "the end line still counts it as failed");
    assert.equal(counts.retryable, 2, "Retry failed (2)");
    assert.equal(counts.done, true);
    assert.equal(batchCounts([{ kind: "ready" }, { kind: "not_916", static: true }]).retryable, 0);
  });

  it("a static whose 4:5 fails the copy-time ratio check reads the static sentence, not the video one", async () => {
    const slotLines: string[] = [];
    const staticRow: BatchRow = {
      rowId: "s1",
      name: "P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16",
      adId: "ad-s1",
      variationId: "v",
      kind: "image",
      parts: [
        { fileId: "f-916", fileName: "a_r1_9x16.jpg", role: "9:16", slotAssetId: "s916" },
        { fileId: "f-45", fileName: "a_r1_4x5.jpg", role: "4:5", slotAssetId: "s45" },
      ],
    };
    const states = await runBatch([staticRow, rows[0]!], {
      copy: async (_row, part) =>
        part.role === "4:5" || part.fileId === "f-one"
          ? { ok: false, code: "not_916", reason: "measured" }
          : { ok: true, storagePath: "p", storageBucket: "b", registryAssetId: "r", mediaType: "image", fileName: part.fileName, fromRegistry: false },
      sendToMeta: async () => ({ url: "" }),
      onRow: () => {},
      onUploaded: () => {},
      onSlotFailed: (_row, part, line) => slotLines.push(`${part.slotAssetId}: ${line}`),
    });
    assert.equal(rowLine(states.get("s1")!), "Not 9:16 — pairs with its 9:16 in Dual or Full");
    assert.equal(rowLine(states.get("one")!), "Not 9:16 — video runs as 9:16 only");
    assert.deepEqual(slotLines, ["s45: Not 9:16 — pairs with its 9:16 in Dual or Full", "s: Not 9:16 — video runs as 9:16 only"]);
  });

  it("readCopyStream reads the NDJSON progress and the done line, split across chunks", async () => {
    const text = '{"type":"progress","pct":10}\n{"type":"registry"}\n{"type":"done","ok":true,"storagePath":"x","storageBucket":"b","registryAssetId":"r","mediaType":"video","fileName":"f","fromRegistry":true}\n';
    const enc = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.slice(0, 17));
        c.enqueue(enc.slice(17));
        c.close();
      },
    });
    const seen: string[] = [];
    const result = await readCopyStream(new Response(body), (p) => seen.push(p.type));
    assert.deepEqual(seen, ["progress", "registry"]);
    assert.equal(result.ok && result.storagePath, "x");
  });
});

describe("file names keep their end (G2)", () => {
  it("the tail holds the ratio token and the extension (and a row's (again)); otherwise just the extension", () => {
    assert.deepEqual(splitFileName("P26-BDAY_enzo-siragusa-5_caption-artist-on-sale_r1_9x16.mp4"), { head: "P26-BDAY_enzo-siragusa-5_caption-artist-on-sale_r1", tail: "_9x16.mp4" });
    assert.deepEqual(splitFileName("P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16 (again)"), { head: "P26-BDAY_enzo-siragusa-1_quote-on-sale_r1", tail: "_9x16 (again)" });
    assert.deepEqual(splitFileName("x_r2_4x5_winner.jpg"), { head: "x_r2", tail: "_4x5_winner.jpg" });
    assert.deepEqual(splitFileName("enzo-ibiza-terrace.mov"), { head: "enzo-ibiza-terrace", tail: ".mov" });
    assert.deepEqual(splitFileName("Enzo - UGC 4"), { head: "Enzo - UGC 4", tail: "" });
  });
});

describe("a tile's name wraps to two lines (N1)", () => {
  // Six pixels a character: 205 px holds 34, 157 holds 26 (the record's boxes at 1280 and 393).
  const mono = (text: string) => text.length * 6;
  const NAMES = [
    "P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16.mp4",
    "P26-BDAY_enzo-siragusa-4_quote-on-sale_r1_9x16.mp4",
    "P26-BDAY_enzo-siragusa-5_caption-artist-on-sale_r1_9x16.mp4",
    "P26-BDAY_enzo-siragusa-2_caption-artist-on-sale_r1_9x16.mp4",
  ];
  const PART = ["siragusa-1_quote", "siragusa-4_quote", "siragusa-5_caption", "siragusa-2_caption"];

  it("each of the four P26-BDAY names is whole on two lines, breaking only after _ or -", () => {
    for (const width of [205, 210]) {
      NAMES.forEach((name, i) => {
        const lines = wrapFileName(name, width, mono);
        assert.equal(lines.length, 2, `${name} at ${width}`);
        assert.equal(lines.join(""), name, "no character dropped, no …");
        assert.match(lines[0]!, /[_-]$/, "line 1 ends at a _ or -");
        assert.ok(lines.every((l) => mono(l) <= width));
        assert.ok(lines.join("").includes(PART[i]!));
      });
    }
    assert.deepEqual(wrapFileName(NAMES[0]!, 205, mono), ["P26-BDAY_enzo-siragusa-1_quote-on-", "sale_r1_9x16.mp4"]);
    assert.deepEqual(wrapFileName(NAMES[2]!, 205, mono), ["P26-BDAY_enzo-siragusa-5_caption-", "artist-on-sale_r1_9x16.mp4"]);
  });

  it("cuts in the middle only when line 2 still runs over, the tail kept at the end", () => {
    assert.deepEqual(wrapFileName(NAMES[2]!, 157, mono), ["P26-BDAY_enzo-siragusa-5_", "caption-artist…r1_9x16.mp4"]);
    assert.deepEqual(wrapFileName(NAMES[2]!, 120, mono), ["P26-BDAY_enzo-", "siragusa-5…_9x16.mp4"]);
    // The quote names fit at 157, so they are not cut.
    assert.deepEqual(wrapFileName(NAMES[1]!, 157, mono), ["P26-BDAY_enzo-siragusa-4_", "quote-on-sale_r1_9x16.mp4"]);
    for (const name of NAMES) {
      for (let width = 60; width <= 400; width += 7) {
        const lines = wrapFileName(name, width, mono);
        assert.ok(lines.length <= 2);
        assert.ok(lines.every((l) => mono(l) <= width), `${name} at ${width}`);
        assert.ok(lines.at(-1)!.endsWith("_9x16.mp4"), "the tail is whole, at the end");
        if (lines.length === 2) assert.ok(!lines[0]!.includes("9x16"), "the tail never wraps on its own");
        if (lines.join("") !== name) assert.ok(lines[1]!.includes("…"), "only line 2 is cut");
      }
    }
  });

  it("at 393 (156 px, a narrow 1 as in the real font) the cut keeps its three properties", () => {
    // 6.25 px a character, "1" 5 px: "…siragusa-1_" fits line 1, "…siragusa-4_" runs 0.25 px over.
    const real = (text: string) => [...text].reduce((w, ch) => w + (ch === "1" ? 5 : 6.25), 0);
    assert.deepEqual(wrapFileName(NAMES[0]!, 156, real), ["P26-BDAY_enzo-siragusa-1_", "quote-on-sale_r1_9x16.mp4"]);
    for (const [name, lead] of [
      [NAMES[1]!, "4_quote"],
      [NAMES[2]!, "5_caption"],
      [NAMES[3]!, "2_caption"],
    ] as const) {
      const lines = wrapFileName(name, 156, real);
      assert.equal(lines.length, 2);
      // 1. Cut only on line 2.
      assert.ok(!lines[0]!.includes("…"));
      assert.equal(lines[1]!.split("…").length, 2, "one cut, on line 2");
      const [before, after] = lines[1]!.split("…") as [string, string];
      // 2. The number and the angle before the "…".
      assert.ok(before.startsWith(lead), `${before} starts with ${lead}`);
      // 3. The round and ratio tail after it.
      assert.ok(after.endsWith("r1_9x16.mp4"), after);
      assert.ok(lines.every((l) => real(l) <= 156));
    }
  });

  it("one line when it fits; a word with no break is cut by characters", () => {
    assert.deepEqual(wrapFileName("enzo-ibiza-terrace.mov", 205, mono), ["enzo-ibiza-terrace.mov"]);
    const lines = wrapFileName("enzofullsetfourkaynoseparators.mp4", 60, mono);
    assert.equal(lines.length, 2);
    assert.equal(lines[0], "enzofullse");
    assert.ok(lines[1]!.endsWith(".mp4") && lines[1]!.includes("…"));
    assert.ok(lines.every((l) => mono(l) <= 60));
  });
});
