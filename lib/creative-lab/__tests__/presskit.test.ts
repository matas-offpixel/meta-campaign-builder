import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ClipFolderFile } from "../clip-intake.ts";
import type { ServiceRoleDb } from "../load.ts";
import {
  DEFAULT_EXCLUDE,
  importPresskitImages,
  importPresskitVideos,
  parseExclude,
  planPresskit,
  videoSkipReason,
  type OverlayJudge,
  type PresskitSource,
} from "../presskit.ts";
import { cantRunReason, clipBucket, type ClipForGroup } from "../surface.ts";
import { fakeDb } from "./fake-db.ts";

const USER = "op";
const ARTIST = "luke";
const PACK = "https://www.dropbox.com/scl/fo/pack/x?rlkey=y";
const OWN_FOLDER = "https://www.dropbox.com/scl/fo/own/z?rlkey=w";
const MB = 1024 * 1024;

const ARTIST_ROW = {
  id: ARTIST,
  user_id: USER,
  client_id: "puzzle",
  name: "Luke Dean",
  rights_doc_ref: "Luke Dean team: press pack shared, 9 Nov 2026",
  approved_at: "2026-11-09T00:00:00Z",
  clip_folder_url: OWN_FOLDER,
  clip_folder_synced_at: "2026-11-01T00:00:00Z",
  clip_folder_last_error: "old error",
  clip_source: "instagram",
};

function db() {
  return fakeDb({
    creative_lab_artists: [{ ...ARTIST_ROW }],
    creative_lab_clips: [],
    creative_assets: [],
  });
}

type Entry = ClipFolderFile & { bytes: Buffer };

function entry(path: string, bytes: Buffer | string, size?: number): Entry {
  const body = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
  return { sourceFileId: path.toLowerCase(), name: path.split("/").pop()!, size: size ?? body.length, bytes: body };
}

/** A pack laid out as the Dropbox share is: Biography, Logo, Press Pictures, Rider, Videos. */
function pack(entries: Entry[]): PresskitSource & { lists: string[]; downloads: string[] } {
  const lists: string[] = [];
  const downloads: string[] = [];
  return {
    lists,
    downloads,
    async list(subfolder) {
      lists.push(subfolder);
      const prefix = `/${subfolder.toLowerCase()}/`;
      return entries.filter((file) => file.sourceFileId.startsWith(prefix)).map(({ sourceFileId, name, size }) => ({ sourceFileId, name, size }));
    },
    async download(file) {
      downloads.push(file.sourceFileId);
      const found = entries.find((item) => item.sourceFileId === file.sourceFileId);
      if (!found) throw new Error("not in the pack");
      return found.bytes;
    },
  };
}

const LUKE_PACK = [
  entry("/Biography/Luke Dean Bio.pdf", "bio"),
  entry("/Rider/Luke Dean — Rider.pdf", "rider"),
  entry("/Press Pictures/Photo 1.jpg", "photo-1"),
  entry("/Press Pictures/Photo 2.jpg", "photo-2"),
  entry("/Logo/LUKE_DEAN_BLK.png", "logo-blk"),
  entry("/Logo/LUKE_DEAN_SVG.svg", "<svg/>"),
  entry("/Videos/Luke dean1.mp4", "video-1"),
  entry("/Videos/long.mov", "video-long"),
  entry("/Videos/MAX B2B LUKE 1.mov", "b2b-1"),
  entry("/Videos/MAX B2B LUKE 2.mov", "b2b-2"),
  entry("/Videos/MAX B2B LUKE 7.mov", "b2b-7"),
  entry("/Videos/MAX B2B LUKE 8.mov", "b2b-8"),
  entry("/Videos/DS_NEXUP_LUKE DEAN B2B LOCKY B2B MAD.AGAIN_CLIP 6_@harrycawthorne9x16.mp4", "b2b-6"),
  entry("/Videos/P44_11-8 (14).MP4", "huge", 384 * MB),
  entry("/Videos/notes.txt", "notes"),
];

function probe(_bytes: Buffer, name: string) {
  return name.includes("long")
    ? { width: 1080, height: 1920, durationInSeconds: 45 }
    : { width: 1080, height: 1920, durationInSeconds: 12 };
}

function judge(calls: { src: string | null; times: number[] }[], textIn: string[] = []): OverlayJudge {
  return async (input) => {
    calls.push({ src: input.src, times: input.times });
    const text = textIn.some((name) => input.src?.includes(name));
    return text
      ? { verdict: "text_overlay", frames: input.times.map((t) => ({ t, text: true, what: "promo text" })) }
      : { verdict: "clean", frames: input.times.map((t) => ({ t, text: false, what: "" })) };
  };
}

async function importVideos(fake: ReturnType<typeof db>, source: PresskitSource, calls: { src: string | null; times: number[] }[], textIn: string[] = [], recheckClipNos?: number[]) {
  return importPresskitVideos(fake as unknown as ServiceRoleDb, {
    recheckClipNos,
    artistId: ARTIST,
    folderUrl: PACK,
    source,
    upload: async () => undefined,
    probe,
    sign: async (path) => `signed:${path}`,
    judge: judge(calls, textIn),
  });
}

function measure(bytes: Buffer) {
  return Promise.resolve(bytes.toString().startsWith("logo") ? { width: 1000, height: 1000 } : { width: 4000, height: 5000 });
}

describe("parseExclude", () => {
  it("defaults to /b2b/i and reads /pattern/flags or a bare word", () => {
    assert.equal(parseExclude(undefined).source, DEFAULT_EXCLUDE.source);
    assert.equal(parseExclude("/b2b/i").flags, "i");
    assert.ok(parseExclude("locky").test("LUKE_LOCKY"));
    assert.equal(parseExclude("/LOCKY/").test("locky"), false);
  });

  it("drops the four MAX B2B LUKE files and the NEXUP B2B clip, and keeps Luke's own", () => {
    const names = [
      "MAX B2B LUKE 1.mov",
      "MAX B2B LUKE 2.mov",
      "MAX B2B LUKE 7.mov",
      "MAX B2B LUKE 8.mov",
      "DS_NEXUP_LUKE DEAN B2B LOCKY B2B MAD.AGAIN_CLIP 6_@harrycawthorne9x16.mp4",
    ];
    for (const name of names) {
      assert.equal(videoSkipReason({ sourceFileId: name, name, size: 10 }, DEFAULT_EXCLUDE), "name matches /b2b/i");
    }
    assert.equal(videoSkipReason({ sourceFileId: "a", name: "Luke dean1.mp4", size: 10 }, DEFAULT_EXCLUDE), null);
    assert.match(videoSkipReason({ sourceFileId: "b", name: "P44.MP4", size: 384 * MB }, DEFAULT_EXCLUDE) ?? "", /over the 200 MB/);
  });
});

describe("planPresskit (dry run)", () => {
  it("lists Videos/, Press Pictures/ and Logo/ only, and downloads nothing", async () => {
    const fake = db();
    const source = pack(LUKE_PACK);
    const plan = await planPresskit(fake as unknown as ServiceRoleDb, { artistId: ARTIST, source });
    assert.deepEqual(source.lists, ["Videos", "Press Pictures", "Logo"]);
    assert.deepEqual(source.downloads, []);
    assert.deepEqual(fake.writes, []);
    const kept = plan.filter((row) => row.action === "import").map((row) => row.name);
    assert.deepEqual(kept, ["Luke dean1.mp4", "long.mov", "Photo 1.jpg", "Photo 2.jpg", "LUKE_DEAN_BLK.png"]);
    const reasons = Object.fromEntries(plan.filter((row) => row.action === "skip").map((row) => [row.name, row.reason]));
    assert.equal(reasons["MAX B2B LUKE 7.mov"], "name matches /b2b/i");
    assert.equal(reasons["notes.txt"], "not a video");
    assert.equal(reasons["LUKE_DEAN_SVG.svg"], "not a jpg, png or webp");
    assert.match(reasons["P44_11-8 (14).MP4"] ?? "", /over the 200 MB/);
    assert.equal(plan.some((row) => /Bio|Rider/.test(row.name)), false);
  });

  it("honours --videos-only, --images-only and --max", async () => {
    const videosOnly = pack(LUKE_PACK);
    await planPresskit(db() as unknown as ServiceRoleDb, { artistId: ARTIST, source: videosOnly, mode: "videos" });
    assert.deepEqual(videosOnly.lists, ["Videos"]);
    const imagesOnly = pack(LUKE_PACK);
    await planPresskit(db() as unknown as ServiceRoleDb, { artistId: ARTIST, source: imagesOnly, mode: "images" });
    assert.deepEqual(imagesOnly.lists, ["Press Pictures", "Logo"]);
    const capped = await planPresskit(db() as unknown as ServiceRoleDb, { artistId: ARTIST, source: pack(LUKE_PACK), mode: "videos", max: 1 });
    assert.deepEqual(capped.filter((row) => row.action === "import").map((row) => row.name), ["Luke dean1.mp4"]);
    assert.equal(capped.find((row) => row.name === "long.mov")?.reason, "over --max 1");
  });
});

describe("importPresskitVideos", () => {
  it("imports from Videos/ only, as presskit clips with the artist's rights_ref and the 30 s trim", async () => {
    const fake = db();
    const source = pack(LUKE_PACK);
    const calls: { src: string | null; times: number[] }[] = [];
    const result = await importVideos(fake, source, calls);
    assert.deepEqual(source.lists, ["Videos"]);
    assert.deepEqual(source.downloads, ["/videos/luke dean1.mp4", "/videos/long.mov"]);
    assert.deepEqual(result.files.filter((file) => file.outcome === "imported").map((file) => file.name), ["Luke dean1.mp4", "long.mov"]);
    const clips = fake.tables.creative_lab_clips;
    assert.equal(clips.length, 2);
    for (const clip of clips) {
      assert.equal(clip.source, "presskit");
      assert.equal(clip.rights_ref, ARTIST_ROW.rights_doc_ref);
      assert.equal(clip.event_id, null);
    }
    const long = clips.find((clip) => clip.source_file_id === "/videos/long.mov");
    assert.equal(long?.in_s, 0);
    assert.equal(long?.out_s, 30);
    // Frames are sampled from the 30 s the tile plays, not the 45 s file.
    const longCall = calls.find((call) => call.src?.includes(".mov"));
    assert.ok(longCall && Math.max(...longCall.times) <= 29);
  });

  it("stores the text verdict on the clip, so a clip with burned-in text lands in Can't run", async () => {
    const fake = db();
    const calls: { src: string | null; times: number[] }[] = [];
    const result = await importVideos(fake, pack(LUKE_PACK), calls, [".mov"]);
    const long = result.files.find((file) => file.name === "long.mov");
    assert.equal(long?.overlay?.verdict, "text_overlay");
    assert.equal(result.files.find((file) => file.name === "Luke dean1.mp4")?.overlay?.verdict, "clean");
    const row = fake.tables.creative_lab_clips.find((clip) => clip.source_file_id === "/videos/long.mov")!;
    assert.equal((row.overlay_check as { verdict: string }).verdict, "text_overlay");
    assert.equal(fake.tables.creative_lab_clips.length, 2, "a clip with text is kept, not deleted");

    const tile: ClipForGroup = {
      id: String(row.id),
      artistName: "Luke Dean",
      clipNo: Number(row.clip_no),
      cleared: true,
      renderError: null,
      judged: null,
      source: "presskit",
      overlay: row.overlay_check as { verdict: string; flagged: number },
    };
    assert.equal(clipBucket(tile), "cant");
    assert.equal(cantRunReason(tile), "Text burned into 8 of 8 frames");
    // An Instagram clip with the same verdict was imported anyway by the operator.
    assert.equal(clipBucket({ ...tile, source: "instagram" }), "new");
    assert.equal(clipBucket({ ...tile, overlay: { verdict: "clean", flagged: 0 } }), "new");
  });

  it("skips everything on a re-run without downloading, and dedupes the same bytes under a second name", async () => {
    const fake = db();
    const first = pack([...LUKE_PACK, entry("/Videos/Luke dean1 copy.mp4", "video-1")]);
    const calls: { src: string | null; times: number[] }[] = [];
    const run1 = await importVideos(fake, first, calls);
    assert.equal(run1.files.find((file) => file.name === "Luke dean1 copy.mp4")?.reason, "same video as a clip already imported");
    assert.equal(fake.tables.creative_lab_clips.length, 2);

    const second = pack(LUKE_PACK);
    const run2 = await importVideos(fake, second, calls);
    assert.deepEqual(second.downloads, []);
    assert.deepEqual(run2.files.filter((file) => file.outcome === "imported"), []);
    assert.equal(run2.files.filter((file) => file.reason === "already imported").length, 2);
    assert.deepEqual(run2.rechecked, []);
    assert.equal(fake.tables.creative_lab_clips.length, 2);
  });

  it("rechecks a presskit clip whose check did not store", async () => {
    const fake = db();
    const calls: { src: string | null; times: number[] }[] = [];
    await importVideos(fake, pack(LUKE_PACK), calls);
    const clip = fake.tables.creative_lab_clips[0]!;
    clip.overlay_check = null;
    const run2 = await importVideos(fake, pack(LUKE_PACK), calls);
    assert.deepEqual(run2.rechecked.map((row) => row.clipId), [clip.id]);
    assert.equal((clip.overlay_check as { verdict: string }).verdict, "clean");
  });

  it("checks a named clip number again even though it holds a verdict, and only that one", async () => {
    const fake = db();
    const calls: { src: string | null; times: number[] }[] = [];
    await importVideos(fake, pack(LUKE_PACK), calls, [".mov"]);
    const clips = fake.tables.creative_lab_clips;
    const flagged = clips.find((clip) => (clip.overlay_check as { verdict: string }).verdict === "text_overlay")!;
    const before = calls.length;
    const run2 = await importVideos(fake, pack(LUKE_PACK), calls, [], [Number(flagged.clip_no)]);
    assert.equal(calls.length, before + 1);
    assert.deepEqual(run2.rechecked.map((row) => row.clipId), [flagged.id]);
    assert.equal((flagged.overlay_check as { verdict: string }).verdict, "clean");
  });

  it("leaves the artist's own folder link, sync state and clip_source as they were", async () => {
    const fake = db();
    await importVideos(fake, pack(LUKE_PACK), []);
    await importVideos(fake, pack(LUKE_PACK), []);
    assert.deepEqual(fake.tables.creative_lab_artists[0], ARTIST_ROW);
    assert.equal(fake.writes.some((write) => write.table === "creative_lab_artists"), false);
  });
});

describe("importPresskitImages", () => {
  it("stores Press Pictures/ and Logo/ only, with aspect from the pixels and the filename kept", async () => {
    const fake = db();
    const source = pack(LUKE_PACK);
    const uploads: { path: string; type: string }[] = [];
    const rows = await importPresskitImages(fake as unknown as ServiceRoleDb, {
      artistId: ARTIST,
      source,
      upload: async (path, _bytes, type) => void uploads.push({ path, type }),
      measure,
    });
    assert.deepEqual(source.lists, ["Press Pictures", "Logo"]);
    assert.equal(source.downloads.some((path) => path.startsWith("/videos/") || path.startsWith("/biography/") || path.startsWith("/rider/")), false);
    assert.deepEqual(rows.map((row) => [row.group, row.name, row.outcome]), [
      ["press", "Photo 1.jpg", "imported"],
      ["press", "Photo 2.jpg", "imported"],
      ["logo", "LUKE_DEAN_BLK.png", "imported"],
      ["logo", "LUKE_DEAN_SVG.svg", "skipped"],
    ]);
    const assets = fake.tables.creative_assets;
    assert.equal(assets.length, 3);
    for (const asset of assets) {
      assert.equal(asset.media_kind, "image");
      assert.match(String(asset.storage_path), new RegExp(`^images/creative-lab/${ARTIST}/[0-9a-f]{64}\\.(jpg|png)$`));
    }
    assert.equal(assets.find((asset) => asset.filename === "Photo 1.jpg")?.aspect_ratio, "4:5");
    assert.equal(assets.find((asset) => asset.filename === "LUKE_DEAN_BLK.png")?.aspect_ratio, "1:1");
    assert.equal(uploads.find((upload) => upload.path.endsWith(".png"))?.type, "image/png");
    assert.equal(rows[0]?.width, 4000);
    assert.equal(rows[0]?.height, 5000);
    assert.equal(fake.tables.creative_lab_clips.length, 0);
  });

  it("does not download or store an image again on a re-run", async () => {
    const fake = db();
    await importPresskitImages(fake as unknown as ServiceRoleDb, { artistId: ARTIST, source: pack(LUKE_PACK), upload: async () => undefined, measure });
    const again = pack(LUKE_PACK);
    const rows = await importPresskitImages(fake as unknown as ServiceRoleDb, { artistId: ARTIST, source: again, upload: async () => undefined, measure });
    assert.deepEqual(again.downloads, []);
    assert.deepEqual(rows.filter((row) => row.outcome !== "skipped"), []);
    assert.equal(rows.filter((row) => row.reason === "already stored").length, 3);
    assert.equal(fake.tables.creative_assets.length, 3);
    const plan = await planPresskit(fake as unknown as ServiceRoleDb, { artistId: ARTIST, source: pack(LUKE_PACK), mode: "images" });
    assert.deepEqual(plan.filter((row) => row.action === "import"), []);
    assert.deepEqual(fake.tables.creative_lab_artists[0], ARTIST_ROW);
  });
});
