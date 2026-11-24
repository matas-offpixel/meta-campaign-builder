/**
 * The variant-pair frames (docs/design-record/2026-11-18-creative-test-variant-pairs.html):
 *
 *   VP-A  the test maker: the Snippet tab with Can't Decide open as a pair.
 *         1280: both boxes, their markers, lines and labels, "Window from",
 *         "Static: Luke Dean card 4", "Signed off by Matas · 18 Nov",
 *         "Make pair · Can't Decide" and "Approve variants".
 *         393 (VPA393): the payoff box moved to 2:01, the drop 6.5 s in, so the
 *         refusal shows and "Make pair" is off; not yet signed off, so
 *         "Approve variants" is off with "Waiting for sign-off from Matas.".
 *   VP-B  the Test plan panel: Test 1 · Track pair · Can't Decide at the day-4
 *         read, ready to call, with the span line and the sign-off line at 1280.
 *   VP-C  the share result: VP-B called.
 *   TF-D  (docs/design-record/2026-11-18-creative-testing-6.html) Test 2 · Track
 *         pair · Get Hard against a £3.00 benchmark: extended at day 4 (1280,
 *         TFD), stopped at day 8 (393, TFD393).
 *
 * VP-B and VP-C carry issue 6's invented £3.00 benchmark (TF7, TF8).
 *
 * Real (the Luke Dean session, 18 Nov): the windows, Can't Decide's 2:55 and its
 * 2:07.5 drop. Invented: the waveform, the earlier drop (0:11), the static's name
 * and every figure (the record's expected figures: £4.00 at day 4, £2.52 / 3 and
 * £1.48 / 1).
 */

import type { AudioFileRow } from "../../lib/creative-tests/audio-intake.ts";
import { buildPanel, buildShareCards, type ReadInput, type TestInput, type VariantInput } from "../../lib/creative-tests/panel-view.ts";
import type { PairHeld } from "../../lib/creative-tests/pair.ts";
import type { TopTrack } from "../../lib/creative-tests/snippet.ts";
import { buildSnippetView, type SnippetView } from "../../lib/creative-tests/snippet-view.ts";

export const VARIANT_PAIR_FRAME_IDS = ["VPA", "VPA393"] as const;
export const VARIANT_PAIR_PLAN_IDS = ["VPB", "VPC", "TFD", "TFD393"] as const;

const MATAS = "frame-matas";
const LUKE = "luke-dean";
const SIGNED = "2026-11-18T10:00:00.000Z";
const START = "2026-11-18T08:00:00.000Z";
const at = (hours: number) => new Date(Date.parse(START) + hours * 3_600_000).toISOString();

const EARLIER = "Can't Decide · earlier drop";
const PAYOFF = "Can't Decide · payoff drop";
const STATIC = { driveFileId: "card-4", name: "Luke Dean card 4", fileName: "Luke Dean card 4.png" };

/** A waveform that reads as Can't Decide: an intro, the earlier drop at 0:11, the 2:04 break, the bass back at 2:07.5. */
function waveform(n = 400, durationS = 175): number[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * durationS;
    const wobble = 0.12 * Math.abs(Math.sin(i * 1.7)) + 0.06 * Math.abs(Math.sin(i * 0.31));
    const body = t < 11 ? 0.3 : t < 60 ? 0.78 : t < 100 ? 0.55 : t < 124 ? 0.8 : t < 127.5 ? 0.22 : t < 165 ? 0.9 : 0.4;
    return Math.round(Math.min(1, body + wobble) * 1000) / 1000;
  });
}

function file(id: string, extra: Partial<AudioFileRow>): AudioFileRow {
  return {
    id,
    event_id: "frame-event",
    artist_id: LUKE,
    drive_file_id: `drive-${id}`,
    drive_file_name: `${id}.wav`,
    format: "wav",
    bitrate_kbps: 1411,
    duration_s: 175,
    storage_path: `audio/creative-lab/frame-event/drive-${id}.wav`,
    unusable_reason: null,
    spotify_track_id: null,
    spotify_title: null,
    match_state: "matched",
    matched_by: MATAS,
    matched_at: SIGNED,
    drop_s: null,
    drop_source: "lab",
    drop_set_by: null,
    drop_set_at: null,
    window_start_s: null,
    length_s: 16,
    waveform: null,
    rights_flag: null,
    rights_flagged_at: null,
    created_at: SIGNED,
    ...extra,
  };
}

const TRACKS: TopTrack[] = [
  { id: "cd", title: "Can't Decide", rank: 1 },
  { id: "gh", title: "Get Hard", rank: 2 },
  { id: "mb", title: "Make Believe", rank: 3 },
];

const FILES: AudioFileRow[] = [
  file("f-cd", { drive_file_name: "Luke Dean - Can't Decide.wav", spotify_track_id: "cd", spotify_title: "Can't Decide", drop_s: 127.5, window_start_s: 123.5, waveform: waveform() }),
  file("f-gh", { drive_file_name: "Luke Dean - Get Hard.wav", spotify_track_id: "gh", spotify_title: "Get Hard", duration_s: 190, drop_s: 110.85, window_start_s: 106.85 }),
  file("f-mb", { drive_file_name: "Luke Dean - Make Believe.wav", spotify_track_id: "mb", spotify_title: "Make Believe", duration_s: 200, drop_s: 21, window_start_s: 17 }),
];

function pairHeld(signed: boolean, track: "cd" | "gh" = "cd"): PairHeld {
  return {
    pair: "track",
    audioFileId: track === "cd" ? "f-cd" : "f-gh",
    asset: track === "cd" ? "Can't Decide" : "Get Hard",
    static: STATIC.name,
    staticDriveFileId: STATIC.driveFileId,
    lengthS: 16,
    windows:
      track === "cd"
        ? [
            { startS: 7, dropS: 11 },
            { startS: 123.5, dropS: 127.5 },
          ]
        : [
            { startS: 34, dropS: 38 },
            { startS: 106.85, dropS: 110.85 },
          ],
    signOff: signed ? { by: MATAS, at: SIGNED } : null,
    artistPageApproval: null,
  };
}

const RENDERS = [
  { id: "r-cd-1", audio_file_id: "f-cd", status: "done", file_name: "P26-BDAY_luke-dean-1_snippet-luke-dean-card-4-on-sale_r1_9x16.mp4", approved_at: SIGNED, drive_status: "filed", test_id: "pair-1", error: null, start_s: 7, length_s: 16 },
  { id: "r-cd-2", audio_file_id: "f-cd", status: "done", file_name: "P26-BDAY_luke-dean-1_snippet-luke-dean-card-4-on-sale_r2_9x16.mp4", approved_at: SIGNED, drive_status: "filed", test_id: "pair-1", error: null, start_s: 123.5, length_s: 16 },
];

export function variantPairSnippetView(signed: boolean): SnippetView {
  return buildSnippetView({
    eventId: "frame-event",
    eventCode: "P26-BDAY",
    acts: [{ id: LUKE, name: "Luke Dean" }],
    actId: LUKE,
    tracks: TRACKS,
    files: FILES,
    names: new Map([[MATAS, "Matas"]]),
    statics: [STATIC],
    renders: RENDERS,
    testN: null,
    testState: null,
    variantLabels: new Map(),
    renderTags: new Map([
      ["r-cd-1", { n: 1, label: EARLIER }],
      ["r-cd-2", { n: 1, label: PAYOFF }],
    ]),
    pairs: [
      {
        id: "pair-1",
        n: 1,
        state: "making",
        held: pairHeld(signed),
        variants: [
          { label: EARLIER, position: 1, snippet_render_id: "r-cd-1" },
          { label: PAYOFF, position: 2, snippet_render_id: "r-cd-2" },
        ],
      },
    ],
    isMatas: true,
    actsWithPage: new Set(),
  });
}

/** VP-A 393: the payoff box moved to start at 2:01, so the drop is 6.5 s in. */
export const VPA393_FORM = {
  fileId: "f-cd",
  lengthS: 16,
  boxes: [
    { label: EARLIER, startS: 7, dropS: 11 },
    { label: PAYOFF, startS: 121, dropS: 127.5 },
  ],
} as const;

export const VPA_FORM = {
  fileId: "f-cd",
  lengthS: 16,
  boxes: [
    { label: EARLIER, startS: 7, dropS: 11 },
    { label: PAYOFF, startS: 123.5, dropS: 127.5 },
  ],
} as const;

// VP-B / VP-C ------------------------------------------------------------------

function pairTest(state: TestInput["state"], winner: string | null): TestInput {
  return {
    id: "pair-1",
    n: 1,
    kind: "pair",
    format: "video",
    runs_in: "tests_adset",
    state,
    result_event: "initiate_checkout",
    currency: "GBP",
    daily_budget_minor: 100,
    budget_pct: 10,
    at_minimum: false,
    first_delivery_at: START,
    winner_variant_id: winner,
    adset_name: "P26-BDAY · Tests · Track pair · 18 Nov",
    held: pairHeld(true),
  };
}

const VARIANTS: VariantInput[] = [
  { id: "vp-earlier", test_id: "pair-1", position: 1, role: "variant", label: EARLIER, state: "live" },
  { id: "vp-payoff", test_id: "pair-1", position: 2, role: "variant", label: PAYOFF, state: "live" },
];

const READS: ReadInput[] = [
  {
    test_id: "pair-1",
    read_at: at(96),
    variants: [
      { variantId: "vp-payoff", spend: 2.52, results: 3 },
      { variantId: "vp-earlier", spend: 1.48, results: 1 },
    ],
    // Issue 6's invented £3.00 benchmark: the payoff drop's £0.84 is under it, so VP-B still reads "Ready to call".
    benchmark_cost: 3,
  },
];

export function variantPairPanelView() {
  return buildPanel({ eventCode: "P26-BDAY", tests: [pairTest("running", null)], variants: VARIANTS, reads: READS, now: at(97) });
}

export function variantPairShareCards() {
  return buildShareCards({ tests: [pairTest("called", "vp-payoff")], variants: VARIANTS, reads: READS, now: at(97) });
}

// TF-D (issue 6's example) ------------------------------------------------------

const GH_PAYOFF = "Get Hard · payoff drop";
const GH_EARLIER = "Get Hard · earlier drop";

const TFD_VARIANTS: VariantInput[] = [
  { id: "gh-earlier", test_id: "pair-2", position: 1, role: "variant", label: GH_EARLIER, state: "live" },
  { id: "gh-payoff", test_id: "pair-2", position: 2, role: "variant", label: GH_PAYOFF, state: "live" },
];

/** Day 4 (22 Nov), £4.00: payoff £2.52 / 0, earlier £1.48 / 0. Day 8 (26 Nov), £8.00: payoff £5.04 / 0, earlier £2.96 / 0. */
const DAY4: ReadInput = { test_id: "pair-2", read_at: at(96), benchmark_cost: 3, variants: [{ variantId: "gh-payoff", spend: 2.52, results: 0 }, { variantId: "gh-earlier", spend: 1.48, results: 0 }] };
const DAY8: ReadInput = { test_id: "pair-2", read_at: at(192), benchmark_cost: 3, variants: [{ variantId: "gh-payoff", spend: 5.04, results: 0 }, { variantId: "gh-earlier", spend: 2.96, results: 0 }] };

function getHardPair(state: TestInput["state"]): TestInput {
  return {
    ...pairTest(state, null),
    id: "pair-2",
    n: 2,
    adset_name: "P26-BDAY · Tests · Track pair · 18 Nov · 2",
    held: pairHeld(true, "gh"),
    extensions: 1,
    started_at: START,
    extension_evidence: { day4: [{ variantId: "gh-payoff", cost: null, results: 0 }, { variantId: "gh-earlier", cost: null, results: 0 }] },
  };
}

/** TF-D 1280: extended at the day-4 read. */
export function tfdExtendedView() {
  return buildPanel({ eventCode: "P26-BDAY", tests: [getHardPair("running")], variants: TFD_VARIANTS, reads: [DAY4], now: at(97) });
}

/** TF-D 393: stopped at the day-8 read. */
export function tfdStoppedView() {
  return buildPanel({ eventCode: "P26-BDAY", tests: [getHardPair("stopped")], variants: TFD_VARIANTS, reads: [DAY8, DAY4], now: at(193) });
}
