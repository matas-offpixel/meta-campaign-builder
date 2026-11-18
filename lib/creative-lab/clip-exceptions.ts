/**
 * Per-clip exceptions to the T1 face rule (O39 / O56 / O64 / O120, t1-face.ts) on artwork overlays. The rule
 * itself is never loosened: an exception names one clip on one event, one version, who ruled it and when, and
 * caps every figure at what was approved by eye. A verdict over any cap is still refused.
 *
 * scripts/t1-video-drafts.mts applies one only to a placement the face rule refuses; contrast, the red line and
 * brightness still run.
 *
 * No `@/` imports: node --test cannot resolve them.
 */

export type ClipFaceException = {
  eventCode: string;
  /** creative_lab_clips.id */
  clipId: string;
  clipNo: number;
  /** The draft version (scripts/t1-video-drafts.mts): roll-call only. */
  version: "v2-roll-call";
  /** Share of the claim's time with a face in the claim. */
  maxClaimShare: number;
  /** Share of the clip with a face or the artist's head in the top block. */
  maxTopShare: number;
  /** Longest run with a face in the type, seconds. */
  maxRunS: number;
  ruledBy: string;
  ruledOn: string;
  ruling: string;
};

// Ruled by Matas 18 Nov 2026: he approved the P26-BDAY roll-call drafts of clips 27 and 30 by eye (face in the claim
// 22.2 % and 17.4 %). The claim cap is 22 % as ruled, compared at 22.5 % so the 22.2 % he approved rounds to it.
// The top-block share and run caps are the approved drafts' own figures.
const P26_ROLL_CALL_RULING =
  "Matas approved the P26-BDAY roll-call drafts of Luke Dean clips 27 and 30 by eye on 18 Nov 2026: roll-call only, face in the claim at most 22 % (compared at 22.5 %), the top-block share and run as drawn.";

export const CLIP_FACE_EXCEPTIONS: readonly ClipFaceException[] = [
  {
    eventCode: "P26-BDAY",
    clipId: "01aa4d92-b946-455e-8823-16b4f00cd97a",
    clipNo: 27,
    version: "v2-roll-call",
    maxClaimShare: 0.225,
    maxTopShare: 0.15,
    maxRunS: 1.6,
    ruledBy: "Matas",
    ruledOn: "2026-11-18",
    ruling: P26_ROLL_CALL_RULING,
  },
  {
    eventCode: "P26-BDAY",
    clipId: "b75b6bf8-1020-44f7-bbec-0bc368870cb4",
    clipNo: 30,
    version: "v2-roll-call",
    maxClaimShare: 0.225,
    maxTopShare: 0.17,
    maxRunS: 1.2,
    ruledBy: "Matas",
    ruledOn: "2026-11-18",
    ruling: P26_ROLL_CALL_RULING,
  },
];

export function clipFaceException(
  eventCode: string,
  clipId: string,
  version: string,
  list: readonly ClipFaceException[] = CLIP_FACE_EXCEPTIONS,
): ClipFaceException | null {
  return list.find((row) => row.eventCode === eventCode && row.clipId === clipId && row.version === version) ?? null;
}

/** The face verdict is within every cap of the exception. */
export function faceExceptionAllows(
  exception: ClipFaceException | null,
  verdict: { topShare: number; claimShare: number; longestRunS: number },
): boolean {
  if (!exception) return false;
  return verdict.claimShare <= exception.maxClaimShare + 1e-9
    && verdict.topShare <= exception.maxTopShare + 1e-9
    && verdict.longestRunS <= exception.maxRunS + 1e-9;
}

/** The override line: who ruled, when, and the figures it lets through. */
export function clipExceptionLine(exception: ClipFaceException, verdict: { topShare: number; claimShare: number; longestRunS: number }): string {
  const pc = (v: number) => `${(v * 100).toFixed(1)} %`;
  return `EXCEPTION (${exception.ruledBy}, ${exception.ruledOn}): clip ${exception.clipNo} ${exception.version} drawn although the face rule refuses it: claim ${pc(verdict.claimShare)} (cap ${pc(exception.maxClaimShare)}), top block ${pc(verdict.topShare)} (cap ${pc(exception.maxTopShare)}), run ${verdict.longestRunS.toFixed(1)} s (cap ${exception.maxRunS.toFixed(1)} s).`;
}
