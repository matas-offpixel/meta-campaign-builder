/**
 * lib/render-templates/checks.ts — the 8 checks and the Montage list, run
 * on every file automatically (RT2). A file that fails any of them can't be
 * uploaded (upload-guard.ts).
 *
 * Voice and Style have no machine test: Matas judges them from the question
 * he says yes to (RY1) or when he starts the render in the Lab. Their
 * machine part here is only what a file can't get wrong by itself: one
 * declared voice for the copy, and the one template from frame 0.
 * "Hands-up moments" has no machine test either (sent to design): its
 * machine part is that every clip plays inside its marked moment and that a
 * flash lands on every kick from the drop.
 *
 * Pure: the worker passes the probe of the rendered file and the facts read
 * again at check time. Relative imports only (node:test).
 */

import type { Probe } from "../creative-lab/mp4-probe.ts";
import { buildRenderFileName, parseRenderFileName, NO_CTA, MONTAGE_VARIANTS, type MontageVariant, type Ratio, type RenderFileName } from "./file-name.ts";
import { MONTAGE, checkCutSheet, type MontageClip, type MontagePlan, type MontageText } from "./montage-plan.ts";
import type { CheckKey } from "./words.ts";

export const FORMAT_SIZE: Record<Ratio, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
};

/** The render settings the worker asked Lambda for (Delivery: H.264, CRF 18, yuv420p, 30 fps, AAC 192). */
export type RenderSettings = { codec: string; crf: number | null; pixelFormat: string; audioCodec: string; audioBitrate: string };
export const MONTAGE_SETTINGS: RenderSettings = { codec: "h264", crf: 18, pixelFormat: "yuv420p", audioCodec: "aac", audioBitrate: "192k" };

export type FileCheckInput = {
  name: RenderFileName;
  fileName: string;
  probe: Probe | null;
  settings: RenderSettings;
  plan: MontagePlan;
  clips: readonly MontageClip[];
  /** The text the file was rendered with, and the same facts read again now. */
  text: MontageText;
  factsNow: { date: string; venue: string; lineup: readonly string[]; cta: readonly string[] };
  /** The stage the claim was written for, and the show's stage now. */
  claimStage: string;
  stageNow: string;
  /** The declared track, and whether its rights are flagged. */
  track: { id: string | null; flagged: boolean; durationS: number | null };
  /** Copy: one declared voice; artist voice only with an approved caption. */
  copy: { voice: "promoter" | "artist"; approvedCaption: boolean };
  ownerNeeded: "promoter" | "artist" | "offpixel";
  /** Every variant the package renders at this ratio. */
  packageVariants: readonly string[];
  /** The kit's logo is the client's current one (the kit's own file, not a lifted copy). */
  latestArt: boolean;
};

export type CheckResult = { passed: boolean; failed: CheckKey[]; notes: string[] };

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function runMontageChecks(input: FileCheckInput): CheckResult {
  const failed: CheckKey[] = [];
  const notes: string[] = [];
  const fail = (key: CheckKey, note: string) => {
    if (!failed.includes(key)) failed.push(key);
    notes.push(note);
  };
  const variant = input.name.variant as MontageVariant;
  const hasText = variant !== "no-text";
  const fps = MONTAGE.fps;

  // 1 Voice: one declared voice; the artist's only with an approved caption.
  if (hasText && input.copy.voice === "artist" && !input.copy.approvedCaption) fail("voice", "artist-voice copy with no approved caption");
  // 2 Style: the one template from frame 0 (text blocks start at frame 0 or on a cut, never a fade-in style change).
  if (hasText && input.plan.texts[variant][0]?.fromFrame !== 0) fail("style", "the first text block doesn't start at frame 0");
  // 3 Stage: the claim is written for the show's stage now.
  if (hasText && input.claimStage !== input.stageNow) fail("stage", `claim written for ${input.claimStage}, the show is at ${input.stageNow}`);
  // 4 Audio: the declared track, not flagged, the window inside it.
  if (!input.track.id) fail("audio", "no declared track");
  else if (input.track.flagged) fail("audio", "the track's rights are flagged");
  else if (input.track.durationS != null && input.plan.window.endS > input.track.durationS + 1e-6) fail("audio", "the window runs past the track's end");
  // 5 Top-tracks open: not a montage check (no press-shot open).
  // 6 Facts: date, venue, lineup and claim read from source, unchanged since.
  if (hasText) {
    if (input.text.date !== input.factsNow.date || input.text.venue !== input.factsNow.venue) fail("facts", "date or venue changed since the render");
    if (variant === "announcement" && !sameList(input.text.lineup, input.factsNow.lineup)) fail("facts", "lineup changed since the render");
    if (!sameList(input.text.cta, input.factsNow.cta)) fail("facts", "the claim changed since the render");
  }
  // 7 Format: size per ratio, 30 fps, 15 s (one frame either way), H.264 CRF 18 yuv420p.
  const want = FORMAT_SIZE[input.name.ratio];
  if (!input.probe) fail("format", "the file couldn't be read");
  else {
    if (input.probe.width !== want.width || input.probe.height !== want.height) fail("format", `${input.probe.width}×${input.probe.height}, not ${want.width}×${want.height}`);
    if (Math.abs(input.probe.fps - fps) > 0.01) fail("format", `${input.probe.fps} fps, not ${fps}`);
    if (Math.abs(input.probe.durationInSeconds - MONTAGE.durationS) > 1 / fps + 1e-6) fail("format", `${input.probe.durationInSeconds} s, not ${MONTAGE.durationS}`);
  }
  if (input.settings.codec !== "h264" || input.settings.crf !== 18 || input.settings.pixelFormat !== "yuv420p") fail("format", "not H.264 CRF 18 yuv420p");
  // 8 CTA, naming and latest art.
  const parsed = parseRenderFileName(input.fileName);
  if (!parsed || buildRenderFileName(parsed) !== input.fileName || input.fileName !== buildRenderFileName(input.name)) fail("cta_naming_art", "the file name isn't the 25 Nov convention");
  const ownerSlugKind = input.name.owner.kind;
  if (ownerSlugKind !== input.ownerNeeded) fail("cta_naming_art", `owner ${ownerSlugKind}, the footage says ${input.ownerNeeded}`);
  if (hasText === (input.name.ctaSlug === NO_CTA)) fail("cta_naming_art", "CTA pairing: text versions carry the CTA, No text carries none");
  if (hasText && !input.latestArt) fail("cta_naming_art", "not the kit's latest logo");

  // Montage list.
  const ids = input.plan.segments.map((s) => s.clipId);
  if (ids.length !== MONTAGE.clips || new Set(ids).size !== ids.length) fail("montage.clips", "not 16 distinct clips");
  const music = checkCutSheet(input.plan.sheet, "no-text").filter((f) => f.startsWith("the drop"));
  if (music.length) fail("montage.music", music.join("; "));
  const flashesWanted = input.plan.kicks.slice(input.plan.dropKick).map((k) => Math.round(k * fps));
  if (!sameList(input.plan.flashes.map(String), flashesWanted.map(String))) fail("montage.moments", "a kick after the drop has no flash");
  const byId = new Map(input.clips.map((c) => [c.id, c]));
  for (const s of input.plan.segments) {
    const clip = byId.get(s.clipId);
    if (!clip || s.sourceStartS < clip.inS - 1e-6 || s.sourceStartS + s.frames / fps > clip.outS + 1e-6) {
      fail("montage.moments", `cut ${s.index + 1} runs outside its clip's moment`);
    }
  }
  const textFailures = checkCutSheet(input.plan.sheet, variant).filter((f) => !f.startsWith("the drop"));
  if (textFailures.length) fail("montage.text", textFailures.join("; "));
  if (!MONTAGE_VARIANTS.every((v) => input.packageVariants.includes(v))) fail("montage.versions", "the package doesn't carry no text, teaser and announcement");

  return { passed: failed.length === 0, failed, notes };
}
