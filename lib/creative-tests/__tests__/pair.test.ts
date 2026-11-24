/**
 * Variant pairs (docs/design-record/2026-11-18-creative-test-variant-pairs.html):
 * the track-pair maker's rules (VP2: the drop 3 to 5 s in, no overlap, the
 * app's own snippets only), the labels (VP1), the sign-off gate (VP7), the
 * ad set's name (VP4), TF1's money, the hold and #1297's cap sentence (VP8),
 * the lane (VP4), and the panel, share link and result against VP-B / VP-C.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { memoryDb } from "../../onsale-refresh/__tests__/memory-db.ts";
import { SNIPPET_FILES } from "../../../scripts/plan-frames/snippet-fixtures.ts";
import { VPA393_FORM, variantPairPanelView, variantPairShareCards, variantPairSnippetView } from "../../../scripts/plan-frames/variant-pair-fixtures.ts";
import { approveTest, type ApproveDeps, type TestMeta } from "../approve.ts";
import { TF1, capText, planCheck, sizeTest } from "../budget.ts";
import { makePair, recordPairApproval } from "../make-test.ts";
import {
  LABELS_SAME,
  LABEL_MISSING,
  LABEL_TOO_LONG,
  PLACE_SECOND_DROP,
  WAITING_ARTIST_PAGE,
  WAITING_SIGN_OFF,
  WINDOWS_OVERLAP,
  artistPageText,
  boxLine,
  dropInText,
  pairAdSetKind,
  pairApproveRefusal,
  pairArtistPageRefusal,
  pairTestName,
  parseStartsAt,
  preciseSpan,
  preciseTime,
  readPairHeld,
  signedOffText,
  spanLine,
  trackPairLabels,
  trackPairRefusal,
  type PairHeld,
} from "../pair.ts";
import { canApprove, type TestRow } from "../plan.ts";
import { testsAdSetName } from "../tests-campaign.ts";
import type { AudioFileRow } from "../audio-intake.ts";

const EARLIER = "Can't Decide · earlier drop";
const PAYOFF = "Can't Decide · payoff drop";

describe("VP1 / VP2: the words", () => {
  it("a track pair's default labels, its name and its ad set kind", () => {
    assert.deepEqual(trackPairLabels("Can't Decide"), [EARLIER, PAYOFF]);
    assert.equal(pairTestName(1, "track", "Can't Decide"), "Test 1 · Track pair · Can't Decide");
    assert.equal(pairTestName(2, "track", "Get Hard"), "Test 2 · Track pair · Get Hard");
    assert.equal(pairAdSetKind("track"), "Track pair");
  });

  it("times keep up to two decimals when they aren't whole; the box line and the span line", () => {
    assert.deepEqual([7, 23, 123.5, 139.5, 106.85, 122.85, 121].map(preciseTime), ["0:07", "0:23", "2:03.5", "2:19.5", "1:46.85", "2:02.85", "2:01"]);
    assert.equal(boxLine(123.5, 16, 127.5), "2:03.5–2:19.5 · 16 s · drop 4.0 s in");
    assert.equal(boxLine(121, 16, 127.5), "2:01–2:17 · 16 s · drop 6.5 s in");
    assert.equal(boxLine(7, 16, null), "0:07–0:23 · 16 s");
    assert.equal(preciseSpan(106.85, 16), "1:46.85–2:02.85");
    assert.equal(spanLine({ pair: "track", windows: [{ startS: 7, dropS: 11 }, { startS: 123.5, dropS: 127.5 }], lengthS: 16, static: "Luke Dean card 4" }), "0:07–0:23 vs 2:03.5–2:19.5 · Static: Luke Dean card 4");
  });

  it("\"Starts at\" reads m:ss with up to two decimals, or plain seconds", () => {
    assert.equal(parseStartsAt("2:03.5"), 123.5);
    assert.equal(parseStartsAt("1:46.85"), 106.85);
    assert.equal(parseStartsAt("0:07"), 7);
    assert.equal(parseStartsAt(" 34 "), 34);
    for (const bad of ["", "2:3", "2:60", "1:46.855", "abc", "-4"]) assert.equal(parseStartsAt(bad), null, bad);
  });
});

describe("VP2 / VP9: the maker's rules", () => {
  const boxes = (earlier: [number | null, number | null], later: [number | null, number | null], labels = [EARLIER, PAYOFF]) => [
    { label: labels[0]!, startS: earlier[0], dropS: earlier[1] },
    { label: labels[1]!, startS: later[0], dropS: later[1] },
  ];

  it("P26-BDAY's pairs can be made: each drop 4 s in, the windows apart", () => {
    assert.equal(trackPairRefusal({ lengthS: 16, boxes: boxes([7, 11], [123.5, 127.5]) }), null);
    assert.equal(trackPairRefusal({ lengthS: 16, boxes: boxes([34, 38], [106.85, 110.85], ["Get Hard · earlier drop", "Get Hard · payoff drop"]) }), null);
  });

  it("the drop lands 3 to 5 s in, both ends allowed, and the refusal names the box", () => {
    assert.equal(trackPairRefusal({ lengthS: 16, boxes: boxes([8, 11], [123.5, 128.5]) }), null);
    assert.equal(trackPairRefusal({ lengthS: 16, boxes: boxes([7, 11], [121, 127.5]) }), "Can't Decide · payoff drop: the drop is 6.5 s in. Move the window so the drop is 3 to 5 s in.");
    assert.equal(trackPairRefusal({ lengthS: 16, boxes: boxes([8.1, 11], [123.5, 127.5]) }), dropInText(EARLIER, 2.9));
    assert.equal(dropInText(EARLIER, 2.9), "Can't Decide · earlier drop: the drop is 2.9 s in. Move the window so the drop is 3 to 5 s in.");
  });

  it("the two windows can't overlap", () => {
    assert.equal(trackPairRefusal({ lengthS: 16, boxes: boxes([7, 11], [20, 24]) }), WINDOWS_OVERLAP);
    assert.equal(WINDOWS_OVERLAP, "The two windows overlap. Move one so they don't.");
    // Touching is apart: 7–23 then 23–39.
    assert.equal(trackPairRefusal({ lengthS: 16, boxes: boxes([7, 11], [23, 27]) }), null);
  });

  it("the second drop, the labels: placed, there, different, at most 60 characters", () => {
    assert.equal(trackPairRefusal({ lengthS: 16, boxes: boxes([null, null], [123.5, 127.5]) }), PLACE_SECOND_DROP);
    assert.equal(PLACE_SECOND_DROP, "Place the second drop.");
    assert.equal(trackPairRefusal({ lengthS: 16, boxes: boxes([7, 11], [123.5, 127.5], [" ", PAYOFF]) }), LABEL_MISSING);
    assert.equal(LABEL_MISSING, "Give each version a label.");
    assert.equal(trackPairRefusal({ lengthS: 16, boxes: boxes([7, 11], [123.5, 127.5], [PAYOFF, PAYOFF]) }), LABELS_SAME);
    assert.equal(LABELS_SAME, "The two labels are the same. Change one.");
    assert.equal(trackPairRefusal({ lengthS: 16, boxes: boxes([7, 11], [123.5, 127.5], ["x".repeat(61), PAYOFF]) }), LABEL_TOO_LONG);
    assert.equal(trackPairRefusal({ lengthS: 16, boxes: boxes([7, 11], [123.5, 127.5], ["x".repeat(60), PAYOFF]) }), null);
  });
});

describe("VP7: sign-off, then live at Approve", () => {
  const held = (extra: Partial<PairHeld> = {}): PairHeld => ({ pair: "track", audioFileId: "f-cd", asset: "Can't Decide", static: "Luke Dean card 4", staticDriveFileId: "card-4", lengthS: 16, windows: [{ startS: 7, dropS: 11 }, { startS: 123.5, dropS: 127.5 }], signOff: null, artistPageApproval: null, ...extra });

  it("Approve is off until Matas signs off, then VP2's rules are checked again", () => {
    assert.equal(pairApproveRefusal(held(), [EARLIER, PAYOFF]), WAITING_SIGN_OFF);
    assert.equal(WAITING_SIGN_OFF, "Waiting for sign-off from Matas.");
    const signed = held({ signOff: { by: "matas", at: "2026-11-18T10:00:00Z" } });
    assert.equal(pairApproveRefusal(signed, [EARLIER, PAYOFF]), null);
    assert.equal(pairApproveRefusal({ ...signed, windows: [{ startS: 7, dropS: 11 }, { startS: 121, dropS: 127.5 }] }, [EARLIER, PAYOFF]), dropInText(PAYOFF, 6.5));
  });

  it("from the artist's page it needs the artist-page approval too; one approval covers both ads", () => {
    assert.equal(pairArtistPageRefusal(held(), "page-luke", "page-luke"), WAITING_ARTIST_PAGE);
    assert.equal(WAITING_ARTIST_PAGE, "Waiting for artist-page approval.");
    assert.equal(pairArtistPageRefusal(held(), "page-puzzle", "page-luke"), null);
    assert.equal(pairArtistPageRefusal(held(), "page-puzzle", null), null);
    assert.equal(pairArtistPageRefusal(held({ artistPageApproval: { by: "matas", at: "2026-11-18T11:00:00Z" } }), "page-luke", "page-luke"), null);
  });

  it("the lines read the London day it was recorded", () => {
    assert.equal(signedOffText("2026-11-18T10:00:00Z"), "Signed off by Matas · 18 Nov");
    assert.equal(signedOffText("2026-11-18T23:30:00Z"), "Signed off by Matas · 18 Nov");
    assert.equal(artistPageText("2026-11-18T11:00:00Z"), "Artist-page approval recorded by Matas · 18 Nov");
  });
});

describe("VP4: the ad set and the lane", () => {
  it("\"{code} · Tests · Track pair · {d Mon}\", and the second pair made that day takes \" · 2\"", () => {
    const first = testsAdSetName("P26-BDAY", pairAdSetKind("track"), "2026-11-18T10:00:00Z");
    assert.equal(first, "P26-BDAY · Tests · Track pair · 18 Nov");
    assert.equal(testsAdSetName("P26-BDAY", pairAdSetKind("track"), "2026-11-18T10:05:00Z", [first]), "P26-BDAY · Tests · Track pair · 18 Nov · 2");
    // Another kind's ad set the same day doesn't make it " · 2".
    assert.equal(testsAdSetName("P26-BDAY", pairAdSetKind("track"), "2026-11-18T10:00:00Z", ["P26-BDAY · Tests · Video · 18 Nov"]), first);
  });

  it("pairs run beside one another and beside CT6's tests; CT6's tests never wait on a pair", () => {
    const tests: TestRow[] = [
      { id: "p1", n: 1, kind: "pair", format: "video", runsIn: "tests_adset", state: "running" },
      { id: "p2", n: 2, kind: "pair", format: "video", runsIn: "tests_adset", state: "making" },
      { id: "t3", n: 3, kind: "tracks", format: "video", runsIn: "tests_adset", state: "making" },
      { id: "t4", n: 4, kind: "statics", format: "video", runsIn: "tests_adset", state: "waiting" },
    ];
    assert.deepEqual(canApprove(tests, 2), { ok: true });
    assert.deepEqual(canApprove(tests, 3), { ok: true });
    assert.deepEqual(canApprove(tests, 4), { ok: false, text: "Waiting for Test 3" });
    // A running CT6 test doesn't hold a pair either.
    assert.deepEqual(canApprove([{ ...tests[2]!, state: "running" }, { ...tests[1]! }], 2), { ok: true });
  });
});

describe("VP8: TF1's money, the hold and the cap", () => {
  it("P26-BDAY: about £1.00 a day per pair from TF1, never a fixed £10; £4.00 a pair, £8.00 for both", () => {
    // ~£10.10 a day of current spend → 10 % → £1 a day.
    const sized = sizeTest({ last7Spend: 70.7, mainAdSets: [{ dailyMinor: 1000, live: true }], minDailyMinor: 100, currency: "GBP" });
    assert.ok(sized.ok);
    assert.equal(sized.dailyMinor, 100);
    assert.equal(sized.holdMinor, 400);
    assert.equal(sized.holdMinor, sized.dailyMinor * TF1.holdDays);
    assert.equal(sized.line, "£1 a day · 10 % of current daily spend (cap £10)");
    // The second pair holds against the cap with the first.
    assert.equal(planCheck({ budget: 1000, spendToDate: 900, holdMinor: 400, otherHoldMinor: 400, currency: "GBP" }), null);
  });

  it("a pair that doesn't fit reads #1297's sentence word for word", () => {
    // £100 budget, £70 spent: £30 left, the cap £6.00; the other pair holds £4.00, so £2.00 is left for this £4.00.
    assert.equal(planCheck({ budget: 100, spendToDate: 70, holdMinor: 400, otherHoldMinor: 400, currency: "GBP" }), "This test needs £4.00 for its 4 days, and the plan's 20 % cap has £2.00 left.");
    assert.equal(capText(4, 2, "GBP"), "This test needs £4.00 for its 4 days, and the plan's 20 % cap has £2.00 left.");
  });
});

// ── The maker on a memory db ────────────────────────────────────────────────

const CD: AudioFileRow = { ...SNIPPET_FILES[1]!, id: "f-cd", spotify_track_id: "cd", spotify_title: "Can't Decide", duration_s: 175, drop_s: 127.5, window_start_s: 123.5, length_s: 16 };
const TRACKS = [{ id: "cd", title: "Can't Decide", rank: 1 }];
const CTX = { event: { event_code: "P26-BDAY", status: "on_sale" }, artistNames: new Map([["luke-dean", "Luke Dean"]]), allFiles: [CD], tracksByArtist: new Map([["luke-dean", TRACKS]]) };
const STATIC = { driveFileId: "card-4", fileName: "Luke Dean card 4.png" };
const BOXES = [
  { label: EARLIER, startS: 7, dropS: 11 },
  { label: PAYOFF, startS: 123.5, dropS: 127.5 },
];

describe("VP2: Make pair", () => {
  it("makes the plan with no CT6 tests, Test 1 · pair with two labelled variants, and _r1 / _r2 renders at their windows", async () => {
    const { db, tables } = memoryDb({ creative_test_plans: [], creative_tests: [], creative_test_variants: [], creative_lab_snippet_renders: [] });
    // The boxes in either order: the earlier start is variant 1.
    const made = await makePair(db, { eventId: "ev1", userId: "matas", fileId: "f-cd", static: STATIC, lengthS: 16, boxes: [BOXES[1]!, BOXES[0]!] }, CTX);
    assert.ok(made.ok);
    assert.equal(made.n, 1);
    assert.deepEqual(tables.creative_tests!.map((t) => [t.n, t.kind, t.format, t.runs_in, t.state]), [[1, "pair", "video", "tests_adset", "making"]]);
    const held = readPairHeld(tables.creative_tests![0]!.held)!;
    assert.deepEqual(held.windows, [{ startS: 7, dropS: 11 }, { startS: 123.5, dropS: 127.5 }]);
    assert.equal(held.asset, "Can't Decide");
    assert.equal(held.static, "Luke Dean card 4");
    assert.equal(held.signOff, null);
    assert.deepEqual(tables.creative_test_variants!.map((v) => [v.position, v.label]), [[1, EARLIER], [2, PAYOFF]]);
    const renders = tables.creative_lab_snippet_renders!;
    assert.deepEqual(renders.map((r) => [r.start_s, r.length_s, r.static_drive_file_id, r.status]), [[7, 16, "card-4", "queued"], [123.5, 16, "card-4", "queued"]]);
    assert.ok(String(renders[0]!.file_name).endsWith("_r1_9x16.mp4"));
    assert.ok(String(renders[1]!.file_name).endsWith("_r2_9x16.mp4"));
    // Nothing reaches Meta.
    assert.equal(tables.launched_ads, undefined);
    assert.equal(tables.meta_write_idempotency, undefined);

    // A second track's pair is Test 2, beside the first.
    const gh: AudioFileRow = { ...CD, id: "f-gh", spotify_track_id: "gh", spotify_title: "Get Hard", duration_s: 190, drop_s: 110.85 };
    const second = await makePair(db, { eventId: "ev1", userId: "matas", fileId: "f-gh", static: STATIC, lengthS: 16, boxes: [{ label: "Get Hard · earlier drop", startS: 34, dropS: 38 }, { label: "Get Hard · payoff drop", startS: 106.85, dropS: 110.85 }] }, { ...CTX, allFiles: [CD, gh] });
    assert.ok(second.ok);
    assert.equal(second.n, 2);
  });

  it("refuses with VP9's words and writes nothing", async () => {
    const { db, tables } = memoryDb({ creative_test_plans: [], creative_tests: [], creative_test_variants: [], creative_lab_snippet_renders: [] });
    const moved = await makePair(db, { eventId: "ev1", userId: "matas", fileId: "f-cd", static: STATIC, lengthS: 16, boxes: VPA393_FORM.boxes.map((b) => ({ ...b })) }, CTX);
    assert.deepEqual(moved, { ok: false, error: "Can't Decide · payoff drop: the drop is 6.5 s in. Move the window so the drop is 3 to 5 s in.", status: 409 });
    const overlap = await makePair(db, { eventId: "ev1", userId: "matas", fileId: "f-cd", static: STATIC, lengthS: 16, boxes: [{ label: EARLIER, startS: 116, dropS: 120 }, BOXES[1]!] }, CTX);
    assert.deepEqual(overlap, { ok: false, error: WINDOWS_OVERLAP, status: 409 });
    assert.equal(tables.creative_test_plans!.length, 0);
    assert.equal(tables.creative_tests!.length, 0);
    assert.equal(tables.creative_lab_snippet_renders!.length, 0);
  });

  it("made again: new labels keep the snippets and the sign-off; a moved window renders again and clears it", async () => {
    const { db, tables } = memoryDb({ creative_test_plans: [], creative_tests: [], creative_test_variants: [], creative_lab_snippet_renders: [] });
    const made = await makePair(db, { eventId: "ev1", userId: "matas", fileId: "f-cd", static: STATIC, lengthS: 16, boxes: BOXES }, CTX);
    assert.ok(made.ok);
    tables.creative_tests![0]!.user_id = "matas";
    tables.creative_tests![0]!.event_id = "ev1";
    assert.deepEqual(await recordPairApproval(db, { testId: made.testId, userId: "matas", eventId: "ev1", which: "signOff", now: new Date("2026-11-18T10:00:00Z") }), { ok: true });
    const relabel = await makePair(db, { eventId: "ev1", userId: "matas", fileId: "f-cd", static: STATIC, lengthS: 16, boxes: [{ ...BOXES[0]!, label: "Can't Decide · intro drop" }, BOXES[1]!] }, CTX);
    assert.ok(relabel.ok && !relabel.rerendered);
    assert.equal(tables.creative_lab_snippet_renders!.length, 2);
    assert.deepEqual(tables.creative_test_variants!.map((v) => v.label), ["Can't Decide · intro drop", PAYOFF]);
    assert.equal(readPairHeld(tables.creative_tests![0]!.held)!.signOff?.at, "2026-11-18T10:00:00.000Z");

    const moved = await makePair(db, { eventId: "ev1", userId: "matas", fileId: "f-cd", static: STATIC, lengthS: 16, boxes: [BOXES[0]!, { ...BOXES[1]!, startS: 124, dropS: 128 }] }, CTX);
    assert.ok(moved.ok && moved.rerendered);
    assert.equal(moved.testId, made.testId);
    assert.equal(tables.creative_lab_snippet_renders!.length, 4);
    assert.equal(readPairHeld(tables.creative_tests![0]!.held)!.signOff, null);
  });

  it("only while it's being made: a sign-off never changes after Approve", async () => {
    const { db } = memoryDb({ creative_tests: [{ id: "p1", user_id: "matas", event_id: "ev1", kind: "pair", state: "running", held: { pair: "track", windows: [] } }] });
    assert.deepEqual(await recordPairApproval(db, { testId: "p1", userId: "matas", eventId: "ev1", which: "signOff" }), { ok: false, error: "This pair has been approved, so its sign-off can't change.", status: 409 });
  });

  it("the snippet route lets only Matas record a sign-off or an artist-page approval", () => {
    const route = readFileSync(path.join(process.cwd(), "app/api/creative-lab/events/[eventId]/snippet/route.ts"), "utf8");
    assert.match(route, /case "signOff":\s*case "artistPageApproval": \{\s*\/\/ VP7: only Matas records either\.\s*if \(!MATAS_USER_IDS\.includes\(user\.id\)\)/);
  });
});

describe("VP2: \"Window from\" lists the app's own snippets of the file only", () => {
  it("each render carries its file and window; files cut outside the app aren't renders, so they're never offered", () => {
    const view = variantPairSnippetView(true);
    const offered = view.renders.filter((r) => r.audioFileId === "f-cd" && r.status === "done" && r.startS != null);
    assert.deepEqual(offered.map((r) => [r.startS, r.lengthS]), [[7, 16], [123.5, 16]]);
    const component = readFileSync(path.join(process.cwd(), "components/dashboard/events/creative-lab/snippet.tsx"), "utf8");
    assert.match(component, /renders=\{view\.renders\.filter\(\(r\) => r\.audioFileId === open\.id && r\.status === "done" && r\.startS != null\)\}/);
  });

  it("VP-A: the pair being made, its sign-off line, and Approve's block before it", () => {
    const signed = variantPairSnippetView(true).pairs[0]!;
    assert.deepEqual(signed.approvalLines, ["Signed off by Matas · 18 Nov"]);
    assert.equal(signed.approveBlock, null);
    assert.equal(signed.rendered, true);
    const unsigned = variantPairSnippetView(false).pairs[0]!;
    assert.equal(unsigned.approveBlock, "Waiting for sign-off from Matas.");
    assert.deepEqual(unsigned.labels, [EARLIER, PAYOFF]);
  });
});

// ── Approve a pair on fakes ─────────────────────────────────────────────────

const MATAS = "matas";
const NOW = new Date("2026-11-18T12:00:00Z");

function adDays() {
  // P26-BDAY-like main spend: £70.70 over 11–17 Nov (~£10.10 a day), ad-1 the best with 6 checkouts.
  const out = [];
  for (const [i, d] of ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"].entries()) {
    out.push({ date: d, meta_ad_id: "ad-1", meta_adset_id: "as-1", meta_campaign_id: "c-main", campaign_name: "[P26-BDAY] Puzzle - On Sale", spend: 10.1, landing_page_views: 0, registrations: 0, actions: i < 6 ? [{ action_type: "omni_initiated_checkout", value: "1" }] : [] });
  }
  return out;
}

function pairSeed(signed: boolean, extra: Record<string, unknown> = {}) {
  const held = { pair: "track", audioFileId: "f-cd", asset: "Can't Decide", static: "Luke Dean card 4", staticDriveFileId: "card-4", lengthS: 16, windows: [{ startS: 7, dropS: 11 }, { startS: 123.5, dropS: 127.5 }], signOff: signed ? { by: MATAS, at: "2026-11-18T10:00:00Z" } : null, artistPageApproval: null, ...extra };
  return memoryDb({
    creative_tests: [{ id: "p1", user_id: MATAS, plan_id: "plan", event_id: "ev1", n: 1, kind: "pair", format: "video", runs_in: "tests_adset", state: "making", held, meta_campaign_id: null, meta_adset_id: null }],
    creative_test_variants: [
      { id: "v1", test_id: "p1", position: 1, label: EARLIER, snippet_render_id: "r1", state: "pending", meta_ad_id: null },
      { id: "v2", test_id: "p1", position: 2, label: PAYOFF, snippet_render_id: "r2", state: "pending", meta_ad_id: null },
    ],
    creative_lab_snippet_renders: [
      { id: "r1", status: "done", creative_asset_id: "a1", file_name: "P26-BDAY_luke-dean-1_snippet-luke-dean-card-4-on-sale_r1_9x16.mp4" },
      { id: "r2", status: "done", creative_asset_id: "a2", file_name: "P26-BDAY_luke-dean-1_snippet-luke-dean-card-4-on-sale_r2_9x16.mp4" },
    ],
    creative_assets: [
      { id: "a1", storage_path: "videos/creative-lab/snippet/r1-9x16.mp4", content_hash: "h1", byte_size: 100 },
      { id: "a2", storage_path: "videos/creative-lab/snippet/r2-9x16.mp4", content_hash: "h2", byte_size: 100 },
    ],
    creative_lab_audio_files: [{ id: "f-cd", artist_id: "luke-dean" }],
    artists: [{ id: "luke-dean", meta_page_id: "page-luke" }],
    events: [{ id: "ev1", event_code: "P26-BDAY", meta_ad_account_id: "act_1", client_id: "cl1", budget_marketing: 5000 }],
    event_daily_rollups: [{ event_id: "ev1", date: "2026-11-10", ad_spend: 1000 }],
    launched_ad_sets: [{ meta_adset_id: "as-1", event_id: "ev1", draft_id: "d-main", launched_at: "2026-10-30T12:00:00Z" }],
    onsale_refresh_proposals: [{ event_id: "ev1", objective: "initiate_checkout", window_end: "2026-11-17" }],
    launched_ads: [],
    meta_write_idempotency: [],
  });
}

function fakes(mem: ReturnType<typeof memoryDb>, opts: { page?: string; adSetNames?: string[] } = {}) {
  const calls: string[] = [];
  const meta: TestMeta = {
    async readAccount() {
      calls.push("readAccount");
      return { minDailyBudget: 100, currency: "GBP" };
    },
    async readAdSet(id) {
      calls.push(`readAdSet ${id}`);
      return { id, campaign_id: "c-main", effective_status: "ACTIVE", daily_budget: "1000", optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS", promoted_object: { pixel_id: "px", custom_event_type: "INITIATED_CHECKOUT" }, targeting: { geo_locations: { countries: ["GB"] }, age_min: 18, publisher_platforms: ["facebook", "instagram"] } };
    },
    async readCampaign(id) {
      calls.push(`readCampaign ${id}`);
      return { objective: "OUTCOME_SALES", dailyBudget: null, status: "ACTIVE" };
    },
    async readAdCopy() {
      calls.push("readAdCopy");
      return { pageId: opts.page ?? "page-puzzle", instagramActorId: null, message: "Luke Dean · Puzzle 4th Birthday", link: "https://example.com/tickets", cta: "buy_tickets" };
    },
    async findCampaigns() {
      calls.push("findCampaigns");
      return [{ id: "c-tests", name: "P26-BDAY · Tests", effective_status: "ACTIVE" }];
    },
    async listAdSetNames() {
      calls.push("listAdSetNames");
      return opts.adSetNames ?? [];
    },
    async createCampaign() {
      calls.push("createCampaign");
      return "c-new";
    },
    async createAdSet(_a, payload) {
      calls.push(`createAdSet ${JSON.stringify(payload)}`);
      return "as-pair";
    },
  };
  const launches: { createPaused: boolean }[] = [];
  const deps: ApproveDeps = {
    db: mem.db,
    env: { CREATIVE_TESTS_CREATE_ENABLED: "true" },
    meta,
    async upload(req) {
      return { videoId: `vid-${req.contentHash}`, registryAssetId: null };
    },
    async launch(body) {
      launches.push(body as never);
      const draft = body.draft as unknown as { creatives: { name: string }[] };
      for (const [i, c] of draft.creatives.entries()) mem.tables.launched_ads!.push({ launch_run_id: "run-1", ad_name: c.name, meta_ad_id: `ad-${i + 1}` });
      return { ok: true, status: 200, launchRunId: "run-1" };
    },
    isMatas: (id) => id === MATAS,
    days: async () => adDays() as never,
    now: NOW,
  };
  return { deps, calls, launches };
}

describe("VP7 / VP4 / VP8: Approve a pair", () => {
  it("stays off with \"Waiting for sign-off from Matas.\" until he signs off, with no Graph call and no write", async () => {
    const mem = pairSeed(false);
    const { deps, calls, launches } = fakes(mem);
    const result = await approveTest(deps, { testId: "p1", userId: MATAS });
    assert.deepEqual(result, { status: 409, body: { ok: false, error: WAITING_SIGN_OFF } });
    assert.equal(calls.length, 0);
    assert.equal(launches.length, 0);
    assert.equal(mem.writes.length, 0);
  });

  it("signed off: its own ad set, \"P26-BDAY · Tests · Track pair · 18 Nov\", TF1's £1 a day, held as £4.00, everything ACTIVE", async () => {
    const mem = pairSeed(true);
    const { deps, calls, launches } = fakes(mem);
    const result = await approveTest(deps, { testId: "p1", userId: MATAS });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const adset = JSON.parse(calls.find((c) => c.startsWith("createAdSet "))!.slice("createAdSet ".length));
    assert.equal(adset.name, "P26-BDAY · Tests · Track pair · 18 Nov");
    assert.equal(adset.status, "ACTIVE");
    assert.equal(adset.daily_budget, 100);
    assert.equal(adset.end_time, "2026-11-22T23:59:00+0000");
    assert.deepEqual(launches.map((l) => l.createPaused), [false]);
    const test = mem.tables.creative_tests![0]!;
    assert.equal(test.daily_budget_minor, 100);
    assert.equal(test.hold_minor, 400);
    assert.equal(test.state, "running");
    assert.deepEqual(mem.tables.creative_test_variants!.map((v) => v.state), ["created", "created"]);
  });

  it("the second pair made the same day takes \" · 2\"", async () => {
    const mem = pairSeed(true);
    const { deps, calls } = fakes(mem, { adSetNames: ["P26-BDAY · Tests · Track pair · 18 Nov"] });
    const result = await approveTest(deps, { testId: "p1", userId: MATAS });
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(calls.find((c) => c.startsWith("createAdSet "))!.slice("createAdSet ".length)).name, "P26-BDAY · Tests · Track pair · 18 Nov · 2");
  });

  it("from Luke Dean's own page it waits for the artist-page approval, and nothing is made", async () => {
    const mem = pairSeed(true);
    const { deps, calls } = fakes(mem, { page: "page-luke" });
    const result = await approveTest(deps, { testId: "p1", userId: MATAS });
    assert.deepEqual(result, { status: 409, body: { ok: false, error: WAITING_ARTIST_PAGE } });
    assert.ok(!calls.some((c) => c.startsWith("createAdSet") || c.startsWith("createCampaign")));
    const recorded = pairSeed(true, { artistPageApproval: { by: MATAS, at: "2026-11-18T11:00:00Z" } });
    assert.equal((await approveTest(fakes(recorded, { page: "page-luke" }).deps, { testId: "p1", userId: MATAS })).status, 200);
  });

  it("a pair that doesn't fit the cap is refused with #1297's sentence, counting the other pair", async () => {
    const mem = pairSeed(true);
    // £100 budget, £70 spent: the cap is £6.00; the other pair holds £4.00.
    mem.tables.events![0]!.budget_marketing = 100;
    mem.tables.event_daily_rollups![0]!.ad_spend = 70;
    mem.tables.creative_tests!.push({ id: "p2", user_id: MATAS, plan_id: "plan", event_id: "ev1", n: 2, kind: "pair", format: "video", runs_in: "tests_adset", state: "running", hold_minor: 400 });
    const { deps, calls } = fakes(mem);
    const result = await approveTest(deps, { testId: "p1", userId: MATAS });
    assert.deepEqual(result.body, { ok: false, error: "This test needs £4.00 for its 4 days, and the plan's 20 % cap has £2.00 left." });
    assert.ok(!calls.some((c) => c.startsWith("createAdSet")));
  });
});

// ── VP-B / VP-C ─────────────────────────────────────────────────────────────

describe("VP6: the event page and the share link (VP-B, VP-C)", () => {
  it("VP-B: ready to call at the day-4 read, the span line and the sign-off line at 1280", () => {
    const view = variantPairPanelView();
    const card = view.cards[0]!;
    assert.equal(card.name, "Test 1 · Track pair · Can't Decide");
    assert.equal(card.open, true);
    assert.equal(card.state, "Ready to call");
    assert.equal(view.chip, "Test 1 ready to call");
    assert.equal(card.spanLine, "0:07–0:23 vs 2:03.5–2:19.5 · Static: Luke Dean card 4");
    assert.deepEqual(card.approvalLines, ["Signed off by Matas · 18 Nov"]);
    assert.equal(card.budgetLine, "In P26-BDAY · Tests · Track pair · 18 Nov · £1 a day · 10 % of current daily spend (cap £10) · read at day 4, £4.00 spent");
    // Issue 6 (TF8): the rows carry the show's invented £3.00 benchmark; £0.84 is under it, so it's still ready to call.
    assert.deepEqual(card.rows.map((r) => r.phone), ["63 % of spend · Can't Decide · payoff drop · £0.84 per checkout · show £3.00 · 3", "37 % of spend · Can't Decide · earlier drop · £1.48 per checkout · show £3.00 · 1"]);
    assert.deepEqual(card.rows.map((r) => [r.label, r.sharePct, r.spend, r.results, r.cost]), [
      [PAYOFF, "63", "£2.52", 3, "£0.84 · show £3.00"],
      [EARLIER, "37", "£1.48", 1, "£1.48 · show £3.00"],
    ]);
  });

  it("VP-C: the winner with its label, figures only: no span, no sign-off, no share", () => {
    const cards = variantPairShareCards();
    assert.equal(cards.length, 1);
    assert.equal(cards[0]!.name, "Test 1 · Track pair · Can't Decide");
    assert.equal(cards[0]!.state, "Winner: Can't Decide · payoff drop · £0.84 per checkout · show £3.00");
    assert.deepEqual(cards[0]!.headers, { variant: "Variant", results: "Checkouts", cost: "Per checkout" });
    assert.deepEqual(cards[0]!.rows.map((r) => [r.label, r.results, r.cost]), [
      [PAYOFF, 3, "£0.84 · show £3.00"],
      [EARLIER, 1, "£1.48 · show £3.00"],
    ]);
    assert.doesNotMatch(JSON.stringify(cards), /Signed off|Static:| vs |of spend|a day|Artist-page/);
  });

  it("the share link's component never draws the span or sign-off lines", () => {
    const component = readFileSync(path.join(process.cwd(), "components/dashboard/creative-section/what-we-are-testing.tsx"), "utf8");
    assert.doesNotMatch(component, /spanLine|approvalLines/);
  });
});

describe("migration 261", () => {
  const SQL = readFileSync(path.join(process.cwd(), "supabase/migrations/261_creative_tests_variant_pair_kind.sql"), "utf8");
  const CODE = SQL.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

  it("widens creative_tests.kind for pair, keeping every old kind", () => {
    assert.match(CODE, /add constraint creative_tests_kind_check\s+check \(kind in \('tracks', 'statics', 'together', 'copy', 'clip', 'pair'\)\)/);
  });

  it("widens the state check for TF6's stopped, keeping every old state", () => {
    assert.match(CODE, /add constraint creative_tests_state_check\s+check \(state in \('waiting', 'making', 'approved', 'running', 'called', 'no_clear_winner', 'not_enough_variants', 'ended', 'stopped'\)\)/);
  });

  it("adds TF5's benchmark to each read and TF6's extensions to each test, new columns only", () => {
    assert.match(CODE, /add column if not exists extensions smallint not null default 0 check \(extensions between 0 and 2\)/);
    assert.match(CODE, /add column if not exists extension_evidence jsonb/);
    for (const col of ["benchmark_cost numeric\\(12, 4\\)", "benchmark_spend numeric\\(12, 2\\)", "benchmark_results numeric\\(12, 2\\)"]) assert.match(CODE, new RegExp(`add column if not exists ${col}`));
  });

  it("is additive: no table, column or row dropped or changed; only the kind and state checks are replaced", () => {
    assert.doesNotMatch(CODE, /\bdrop\s+(table|column)\b/i);
    assert.doesNotMatch(CODE, /\btruncate\b|\bdelete\s+from\b|\bupdate\s+public\.|\binsert\s+into\b/i);
    assert.match(CODE, /pg_get_constraintdef\(oid\) ilike '%\(kind = any%' or pg_get_constraintdef\(oid\) ilike '%\(state = any%'/);
  });
});
