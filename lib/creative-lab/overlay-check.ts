/**
 * Burned-in text check. Eight frames from one Lambda still, plus the
 * thumbnail. Scene text is not a rejection. The model being unsure, or
 * text only on the thumbnail, is check by eye.
 */

export type OverlayVerdict = "clean" | "text_overlay" | "check_by_eye";

export type OverlayFrame = { t: number; text: boolean; what: string; thumbnail?: boolean };

export type OverlayCheck = {
  verdict: OverlayVerdict;
  frames: OverlayFrame[];
  reason: string;
  flagged: number;
};

/** 0.5 s, six moments evenly between that and the last second, then the last second. */
export function frameSampleTimes(durationSeconds: number): number[] {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1;
  const start = Math.min(0.5, Math.max(0, duration - 0.05));
  const last = Math.max(start, duration - 1);
  const span = last - start;
  const mids = Array.from({ length: 6 }, (_, index) => start + (span * (index + 1)) / 7);
  return [start, ...mids, last].map((t) => Math.round(t * 1000) / 1000);
}

export function burnedInCount(frames: readonly OverlayFrame[]): number {
  return frames.filter((frame) => frame.text && !frame.thumbnail).length;
}

export function thumbnailOnly(frames: readonly OverlayFrame[]): boolean {
  const thumb = frames.some((frame) => frame.thumbnail && frame.text);
  return thumb && burnedInCount(frames) === 0;
}

/**
 * The model's verdict, corrected. Text on the thumbnail alone, or a
 * verdict the model did not settle, is check by eye. A text_overlay
 * names how many of the eight frames.
 */
export function settleOverlayVerdict(input: {
  verdict?: string | null;
  frames?: readonly OverlayFrame[] | null;
  reason?: string | null;
  unsure?: boolean;
}): OverlayCheck {
  const frames = (input.frames ?? []).map((frame) => ({
    t: Number(frame.t) || 0,
    text: frame.text === true,
    what: String(frame.what ?? "").trim(),
    ...(frame.thumbnail ? { thumbnail: true } : {}),
  }));
  const flagged = burnedInCount(frames);
  if (input.unsure || thumbnailOnly(frames) || (input.verdict !== "clean" && input.verdict !== "text_overlay" && input.verdict !== "check_by_eye")) {
    return { verdict: "check_by_eye", frames, reason: input.reason?.trim() || "Check this one by eye.", flagged };
  }
  if (input.verdict === "text_overlay" || flagged > 0) {
    return {
      verdict: "text_overlay",
      frames,
      reason: `Text burned into ${flagged} of 8 frames`,
      flagged,
    };
  }
  if (input.verdict === "check_by_eye") {
    return { verdict: "check_by_eye", frames, reason: input.reason?.trim() || "Check this one by eye.", flagged: 0 };
  }
  return { verdict: "clean", frames, reason: input.reason?.trim() || "No burned-in text.", flagged: 0 };
}

export const OVERLAY_TOOL = {
  name: "overlay_verdict",
  description: "Say whether added text is burned into the clip.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdict: { type: "string", enum: ["clean", "text_overlay", "check_by_eye"] },
      frames: {
        type: "array",
        items: {
          type: "object",
          properties: {
            t: { type: "number" },
            text: { type: "boolean" },
            what: { type: "string" },
            thumbnail: { type: "boolean" },
          },
          required: ["t", "text", "what"],
        },
      },
      reason: { type: "string" },
      unsure: { type: "boolean" },
    },
    required: ["verdict", "frames", "reason"],
  },
};

export const OVERLAY_PROMPT = [
  "The first image is eight frames of one clip, left to right, at the times given.",
  "The second image is the thumbnail.",
  "Reject added captions, titles, subtitles, lyric text, promo or date or venue graphics, and watermarks that contain words.",
  "Do not reject text that is part of the scene: club signage, LED screens, DJ booth branding, T-shirt prints.",
  "Text on the thumbnail only is check_by_eye, not a rejection.",
  "If you are unsure, set unsure true and verdict check_by_eye.",
].join(" ");

export function overlaySkipLine(flagged: number): string {
  return `Skipped — text in ${flagged} of 8 frames`;
}

export function overlayPanelLine(flagged: number): string {
  return `Text burned into ${flagged} of 8 frames — it would read as someone else's ad.`;
}
