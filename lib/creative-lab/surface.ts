/**
 * How the clip grid, caption posts, round matrix and "what's working"
 * read the rows that are already stored. Nothing here calls Meta.
 */

import { captionAllowsClip } from "./footage-owner.ts";
import { TOO_SMALL_FOR_916, tooSmallFor916 } from "./import-quality.ts";

export type VerdictChip = { label: string; tone: "win" | "lose" | "hold" | "flag" | "dash" };

/** null is Holding only after a round was judged. Untested and thin stay Untested. */
export function verdictChip(verdict: string | null): VerdictChip {
  if (verdict === "winner") return { label: "Winner", tone: "win" };
  if (verdict === "loser") return { label: "Loser", tone: "lose" };
  if (verdict === "flagged") return { label: "cost 1.5× the usual", tone: "flag" };
  if (verdict == null) return { label: "Holding", tone: "hold" };
  return { label: "Untested", tone: "dash" };
}

export function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "—";
  return `£${value.toFixed(2)}`;
}

export function metricUnit(metric: string | null | undefined): string {
  switch (metric) {
    case "complete_registration":
      return "signup";
    case "lead":
      return "lead";
    case "purchase":
      return "purchase";
    case "initiate_checkout":
      return "checkout";
    case "link_click":
      return "click";
    case "landing_page_view":
      return "landing page view";
    default:
      return metric ? metric.replaceAll("_", " ") : "result";
  }
}

export type JudgedClip = {
  verdict: string | null;
  cost: number | null;
  results: number | null;
  metric: string | null;
  roundNo: number;
};

/** A file longer than this plays its first 30 seconds. The folder import stores the same window. */
export const CLIP_TRIM_SECONDS = 30;

/** Shown when Generate fails, or finishes without writing a caption. */
export const CAPTIONS_NOT_WRITTEN = "The captions didn't write — try again.";

/** Every candidate the writer returned was already stored on this event. */
export const LINES_ALREADY_ON_EVENT = "Every line it wrote is already on this event — change the angle and write again";

/** The sentence under Generate when the request fails. A raw error is not shown. */
export function generateFailureSentence(error: unknown): string {
  return sentenceOf(error) ?? CAPTIONS_NOT_WRITTEN;
}

export type ClipForGroup = {
  id: string;
  artistId?: string | null;
  artistName: string;
  clipNo: number;
  cleared: boolean;
  renderError: string | null;
  durationSeconds?: number | null;
  judged: JudgedClip | null;
  /** The clip row's source: spark, file, instagram or presskit. */
  source?: string;
  /** The clip row's burned-in text verdict (overlay_check). */
  overlay?: { verdict: string; flagged?: number } | null;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
};

export type ClipBucket = "keeping" | "new" | "cant";

/** A superseded render is an old path, kept for the record. It is not a refusal. */
export function isSupersededRender(error: string | null | undefined): boolean {
  return (error ?? "").trim().toLowerCase().startsWith("superseded:");
}

/**
 * The newest render that is still on the current path. A superseded row is
 * skipped. Only a failed row on that path refuses the clip.
 */
export function currentRenderError(
  renders: readonly { status: string; error: string | null; createdAt: string }[],
): string | null {
  const current = [...renders]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .find((render) => !isSupersededRender(render.error));
  if (!current || current.status !== "failed") return null;
  return current.error?.trim() || "The render was refused.";
}

/**
 * The seconds the tile and the render play. A stored window is kept.
 * When it is unset, a file longer than 30 seconds is the first 30 seconds.
 */
export function clipWindow(args: { fileSeconds: number | null; inS: number | null; outS: number | null }): { inS: number; outS: number | null } {
  const inS = args.inS != null && Number.isFinite(args.inS) ? args.inS : null;
  const outS = args.outS != null && Number.isFinite(args.outS) ? args.outS : null;
  if (inS == null && outS == null) {
    if (args.fileSeconds != null && Number.isFinite(args.fileSeconds) && args.fileSeconds > CLIP_TRIM_SECONDS) {
      return { inS: 0, outS: CLIP_TRIM_SECONDS };
    }
    return { inS: 0, outS: args.fileSeconds != null && Number.isFinite(args.fileSeconds) ? args.fileSeconds : null };
  }
  return { inS: inS ?? 0, outS };
}

export function playableClipSeconds(args: { fileSeconds: number | null; inS: number | null; outS: number | null }): number | null {
  const window = clipWindow(args);
  if (window.outS == null) return null;
  return Math.max(0, window.outS - window.inS);
}

/** Width of the largest 9:16 rectangle inside the source. A wider file loses the sides. */
export function cropWidth9x16(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 0;
  const target = 9 / 16;
  return width / height > target ? height * target : width;
}

export function isNative9x16(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  const ratio = width / height;
  return Math.abs(ratio - 9 / 16) / (9 / 16) <= 0.05;
}

/** A 9:16 crop under this width is not the lead and not Best clip. */
export const MIN_LEAD_CROP_PX = 540;

export type RankedClip = ClipForGroup & {
  sourceWidth?: number | null;
  sourceHeight?: number | null;
  billingOrder?: number;
  isHeadliner?: boolean;
};

/** Native 9:16 first, then the wider crop, then billing order. Under 540 px is left for a hand pick. */
export function bestRunnableClip<T extends RankedClip>(clips: readonly T[]): T | null {
  const eligible = clips.filter((clip) => {
    if (clipBucket(clip) === "cant") return false;
    const width = clip.sourceWidth;
    const height = clip.sourceHeight;
    if (width == null || height == null) return false;
    return cropWidth9x16(width, height) >= MIN_LEAD_CROP_PX;
  });
  eligible.sort((a, b) => {
    const nativeA = isNative9x16(a.sourceWidth ?? 0, a.sourceHeight ?? 0) ? 0 : 1;
    const nativeB = isNative9x16(b.sourceWidth ?? 0, b.sourceHeight ?? 0) ? 0 : 1;
    if (nativeA !== nativeB) return nativeA - nativeB;
    const widthA = cropWidth9x16(a.sourceWidth ?? 0, a.sourceHeight ?? 0);
    const widthB = cropWidth9x16(b.sourceWidth ?? 0, b.sourceHeight ?? 0);
    if (widthB !== widthA) return widthB - widthA;
    return (a.billingOrder ?? 0) - (b.billingOrder ?? 0);
  });
  return eligible[0] ?? null;
}

/**
 * "Text burned into N of 8 frames" when the clip's own check found text.
 * An Instagram clip with that verdict was imported anyway by the operator,
 * so it is not refused.
 */
export function burnedInTextSentence(clip: Pick<ClipForGroup, "overlay" | "source">): string | null {
  if (clip.overlay?.verdict !== "text_overlay" || clip.source === "instagram") return null;
  return `Text burned into ${Number(clip.overlay.flagged) || 0} of 8 frames`;
}

/** O93. One status when the 9:16 window is under 675 px. The row stays. */
export function tooSmall916Sentence(clip: Pick<ClipForGroup, "sourceWidth" | "sourceHeight">): string | null {
  const width = clip.sourceWidth;
  const height = clip.sourceHeight;
  if (width == null || height == null) return null;
  return tooSmallFor916({ width, height }) ? TOO_SMALL_FOR_916 : null;
}

export function clipBucket(clip: ClipForGroup): ClipBucket {
  if (tooSmall916Sentence(clip)) return "cant";
  if (renderRefusalSentence(clip.renderError)) return "cant";
  if (burnedInTextSentence(clip)) return "cant";
  if (!clip.judged) return "new";
  if (clip.judged.verdict === "untested" || clip.judged.verdict === "thin") return "new";
  return "keeping";
}

/**
 * One sentence that says what to fix. A raw render error is never returned.
 *
 * The classes, in the order they are tested: the clip's frame, the caption's
 * length, lines or style, the render timing out (the queue's `timeout` or
 * Lambda's "timed out"), the renderer itself (Remotion Lambda), the clip's
 * own file (missing, or its signed url or probe failing), a bare network
 * "fetch failed" (the renderer, since it names no file), the finished file
 * not saving, and replaced audio. A superseded row is an old path, not a
 * refusal.
 */
export function renderRefusalSentence(error: string | null | undefined): string | null {
  const value = (error ?? "").trim();
  if (!value || isSupersededRender(value)) return null;
  const lower = value.toLowerCase();
  if (lower.includes("9:16 only") || lower.includes("isn't vertical") || lower.includes("is not rendered")) {
    return "This clip isn't vertical — use a 9:16 file.";
  }
  if (lower.includes("does not fit") || lower.includes("too long") || lower.includes("exceeds") || lower.includes("at most") || lower.includes("not approved")) {
    return "This caption is too long — shorten it.";
  }
  if (lower.includes("caption lines are missing")) return "This caption has no lines — generate it again.";
  if (lower.includes("style_version") || lower.includes("old style")) return "This caption is on an old style — generate it again.";
  if (lower.includes("timeout") || lower.includes("timed out")) return "The render timed out — try it again.";
  if (lower.includes("lambda") || lower.includes("remotion")) return "The renderer failed — try it again.";
  if (lower.includes("no source") || lower.includes("no file")) return "This clip has no file — import it again.";
  if (lower.includes("signed url") || lower.includes("probe") || lower.includes("clip fetch") || lower.startsWith("mp4 ")) {
    return "This clip's file couldn't be read — import it again.";
  }
  // Node's bare "fetch failed" is a network error anywhere in the run, so it can't blame the clip.
  if (lower.includes("fetch failed")) return "The renderer failed — try it again.";
  if (lower.includes("storage upload")) return "The finished render didn't save — try it again.";
  if (lower.includes("replaced audio") || lower.includes("no track")) return "This clip's new audio has no track yet — add the track.";
  if (value.includes(" — ") && !value.includes(":") && value.length <= 140) return value;
  return "This render was refused — find a sharper copy or ask the team.";
}

/** The failed-render sentences a person can retry from the row. "import it again" and "generate it again" are fixed elsewhere. */
const RETRY_SENTENCES = new Set([
  "The renderer failed — try it again.",
  "The render timed out — try it again.",
  "The finished render didn't save — try it again.",
]);
const RETRY_TAIL = " — try it again.";

/** True when the render failed for a reason a fresh try can fix. */
export function renderRetryable(error: string | null | undefined): boolean {
  const sentence = renderRefusalSentence(error);
  return sentence != null && RETRY_SENTENCES.has(sentence);
}

/**
 * A render can be tried again when it sits in no round, or when one round
 * it sits in is still being built (draft or rendering). A settled round does
 * not block the retry while another round is still open.
 */
export function renderRoundOpen(roundStatuses: readonly string[]): boolean {
  return roundStatuses.length === 0 || roundStatuses.some((status) => status === "draft" || status === "rendering");
}

/**
 * The failed row's sentence, split so "try it again" can be the link itself.
 * With the round past rendering the sentence ends "— propose the round again"
 * and has no link. Other sentences come back whole.
 */
export function renderFailureLine(sentence: string, roundOpen: boolean): { lead: string; link: string | null; tail: string } {
  if (!RETRY_SENTENCES.has(sentence)) return { lead: sentence, link: null, tail: "" };
  const head = sentence.slice(0, -RETRY_TAIL.length);
  if (!roundOpen) return { lead: `${head} — propose the round again.`, link: null, tail: "" };
  return { lead: `${head} — `, link: "try it again", tail: "." };
}

/** The render rows the clip section lists. A superseded row is kept for the record and not shown. */
export function visibleRenderRows<T extends { status: string; error: string | null }>(rows: readonly T[]): T[] {
  return rows.filter(
    (row) => (row.status === "queued" || row.status === "rendering" || row.status === "done" || row.status === "failed") && !isSupersededRender(row.error),
  );
}

/** The line under a lineup row's name while Find clips reads Instagram. */
export function findClipsReadingLine(handle: string | null | undefined): string {
  const clean = (handle ?? "").trim().replace(/^@/, "");
  return clean ? `reading @${clean}'s posts` : "reading their posts";
}

/** A route's error when it is already one sentence a person can act on; otherwise null. */
function sentenceOf(error: unknown): string | null {
  const value = typeof error === "string" ? error.trim() : "";
  if (!value || value.length > 140) return null;
  if (!/[.?!]$/.test(value)) return null;
  if (/[:{}<>]|\b(?:error|exception|undefined|null)\b/i.test(value.replace(/[.?!]$/, ""))) return null;
  return value;
}

/** The sentence on a lineup row when Find clips fails. */
export function findClipsErrorSentence(error: unknown, handle: string | null | undefined): string {
  const clean = (handle ?? "").trim().replace(/^@/, "");
  return sentenceOf(error) ?? `Couldn't read ${clean ? `@${clean}'s` : "the"} posts — try Find clips again.`;
}

/** The sentence on a candidate tile when Add or Import fails. */
export function importErrorSentence(error: unknown): string {
  return sentenceOf(error) ?? "This clip didn't import — try again.";
}

export function cantRunReason(clip: ClipForGroup): string | null {
  return tooSmall916Sentence(clip) ?? renderRefusalSentence(clip.renderError) ?? burnedInTextSentence(clip);
}

/** The lead clip for the feed post and for Best clip. A refused clip, and a crop under 540 px, is never returned. */
export function feedPostClip<T extends RankedClip>(clips: readonly T[]): T | null {
  return bestRunnableClip(clips);
}

/**
 * The clip a caption preview draws. A stored clip that is not on the card
 * is not replaced with the lead clip — the post says so instead.
 */
export function captionPreviewClip<T extends RankedClip>(clips: readonly T[], clipId: string | null | undefined): T | null {
  if (clipId) return clips.find((clip) => clip.id === clipId) ?? null;
  return feedPostClip(clips);
}

/** Generate's words. The card's busy flag only disables the button. */
export function generateButtonLabel(writing: boolean, count = 3): string {
  return writing ? "Writing…" : `Write ${count}`;
}

/**
 * One preview per usable Untested clip that does not already have one.
 * Untested is the clip row's label: never judged, verdict untested, or thin.
 * durationSeconds is the playable window. An imported file longer than 30s
 * plays as its first 30s, so that length is usable. A window that itself
 * runs past 30s is not.
 */
export function clipsForEachNew<T extends ClipForGroup>(clips: readonly T[], alreadyPreviewed: ReadonlySet<string>): T[] {
  return clips
    .filter((clip) => {
      if (alreadyPreviewed.has(clip.id)) return false;
      if (clipBucket(clip) !== "new") return false;
      const seconds = clip.durationSeconds;
      if (seconds != null && seconds > CLIP_TRIM_SECONDS) return false;
      return true;
    })
    .sort((a, b) => a.clipNo - b.clipNo);
}

export function groupClips<T extends ClipForGroup>(clips: readonly T[]): { keeping: T[]; fresh: T[]; cant: T[] } {
  const keeping: T[] = [];
  const fresh: T[] = [];
  const cant: T[] = [];
  for (const clip of clips) {
    const bucket = clipBucket(clip);
    if (bucket === "keeping") keeping.push(clip);
    else if (bucket === "cant") cant.push(clip);
    else fresh.push(clip);
  }
  return { keeping, fresh, cant };
}

export function durationLabel(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function sourceBadge(source: string): "IG" | "TT" | "file" {
  const value = source.trim().toLowerCase();
  if (value.includes("instagram") || value === "ig") return "IG";
  if (value.includes("tiktok") || value === "spark" || value === "tt") return "TT";
  return "file";
}

/** Stored lines, or a " / " join, become real line breaks. The slash is not shown. */
export function captionCopy(lines: readonly string[]): string {
  return lines
    .flatMap((line) => line.split(/\s+\/\s+/))
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function failedCheckSentence(ok: boolean, details: readonly string[]): string | null {
  if (ok) return null;
  return details.map((detail) => detail.trim()).find(Boolean) ?? "This caption did not pass.";
}

export function ctaForStage(stage: "on_sale" | "upcoming" | "signup"): string {
  return stage === "on_sale" ? "Get tickets" : "Sign up";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "{event} · {d Month} · {venue}". A missing date or venue is left out. */
export function feedHeadline(args: { eventName: string; eventDate: string | null | undefined; venue: string | null | undefined }): string {
  const parts = [args.eventName.trim()];
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(args.eventDate?.trim() ?? "");
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  const day = match ? Number(match[3]) : 0;
  if (month && day >= 1 && day <= 31) parts.push(`${day} ${month}`);
  const venue = args.venue?.trim();
  if (venue) parts.push(venue);
  return parts.filter(Boolean).join(" · ");
}

/** The Clips cell. The short line keeps the blocked count. */
export function clipStripLines(blocked: number): { line: string; short: string } {
  if (blocked <= 0) return { line: "ready", short: "ready" };
  const line = `${blocked} blocked`;
  return { line, short: line };
}

export function styleLabel(style: string): string {
  switch (style) {
    case "lineup":
      return "Lineup";
    case "artist_first_person":
      return "Artist, first person";
    case "artist":
      return "Artist";
    case "pov":
      return "POV";
    case "scarcity":
      return "Scarcity";
    default:
      return style.replaceAll("_", " ");
  }
}

export type MatrixCell = { clipId: string; captionId: string; on: boolean };

export function roundMatrix(args: {
  clips: readonly { id: string; owner?: "promoter" | "artist" | null; artistId?: string | null; featuredArtistIds?: readonly string[] }[];
  captions: readonly { id: string; style?: string; mode?: string | null; artistId?: string | null; status?: string }[];
  excluded: ReadonlySet<string>;
}): { cells: MatrixCell[]; on: number; off: number; line: string } {
  const cells: MatrixCell[] = [];
  for (const clip of args.clips) {
    for (const caption of args.captions) {
      if (clip.owner && caption.style && !captionAllowsClip(
        { id: caption.id, style: caption.style, mode: caption.mode, artistId: caption.artistId, status: caption.status },
        { id: clip.id, owner: clip.owner, artistId: clip.artistId ?? null, featuredArtistIds: clip.featuredArtistIds ?? [] },
      )) continue;
      const key = `${clip.id}:${caption.id}`;
      cells.push({ clipId: clip.id, captionId: caption.id, on: !args.excluded.has(key) });
    }
  }
  const off = cells.filter((cell) => !cell.on).length;
  const on = cells.length - off;
  return {
    cells,
    on,
    off,
    line: `${on} ads · ${args.clips.length} × ${args.captions.length}, ${off} left out`,
  };
}

export function firstPairings<T>(cells: readonly T[], count = 3): { shown: T[]; more: number } {
  return { shown: cells.slice(0, count), more: Math.max(0, cells.length - count) };
}

export type WorkingAd = {
  style: string;
  roundId: string;
  eventId: string;
  verdict: string | null;
  cost: number | null;
  results: number | null;
  clipNo: number;
  artistName: string;
  roundNo: number;
};

export function whatsWorking(
  ads: readonly WorkingAd[],
  args: { clientName: string; eventId: string },
): { angle: string | null; clip: string | null } | null {
  const decisive = ads.filter((ad) => ad.verdict === "winner" || ad.verdict === "loser" || ad.verdict === "flagged");
  if (!decisive.length) return null;
  const angle = angleLine(ads, args.clientName);
  const clip = winningClip(ads, args.eventId);
  if (!angle && !clip) return null;
  return { angle, clip };
}

function winningClip(ads: readonly WorkingAd[], eventId: string): string | null {
  const winners = ads.filter((ad) => ad.verdict === "winner");
  const onEvent = winners.filter((ad) => ad.eventId === eventId);
  const pool = onEvent.length ? onEvent : winners;
  const latest = pool.slice().sort((a, b) => b.roundNo - a.roundNo)[0];
  if (!latest) return null;
  return `${latest.artistName} clip #${latest.clipNo} is the current winner`;
}

function pooled(ads: readonly WorkingAd[]): number | null {
  const results = ads.reduce((sum, ad) => sum + (ad.results ?? 0), 0);
  const spend = ads.reduce((sum, ad) => sum + (ad.cost ?? 0) * (ad.results ?? 0), 0);
  if (results <= 0 || spend <= 0) return null;
  return spend / results;
}

function angleLine(ads: readonly WorkingAd[], clientName: string): string | null {
  const byRound = new Map<string, WorkingAd[]>();
  for (const ad of ads) {
    if ((ad.results ?? 0) <= 0 || (ad.cost ?? 0) <= 0) continue;
    const list = byRound.get(ad.roundId) ?? [];
    list.push(ad);
    byRound.set(ad.roundId, list);
  }
  const styles = [...new Set(ads.map((ad) => ad.style))];
  let best: { left: string; right: string; percent: number } | null = null;
  for (const left of styles) {
    for (const right of styles) {
      if (left === right) continue;
      const shared = [...byRound.values()].filter((rows) => rows.some((ad) => ad.style === left) && rows.some((ad) => ad.style === right));
      if (!shared.length) continue;
      const leftAds = shared.flatMap((rows) => rows.filter((ad) => ad.style === left));
      const rightAds = shared.flatMap((rows) => rows.filter((ad) => ad.style === right));
      const leftCost = pooled(leftAds);
      const rightCost = pooled(rightAds);
      if (leftCost == null || rightCost == null || rightCost <= leftCost) continue;
      const percent = Math.round(((rightCost - leftCost) / rightCost) * 100);
      if (percent <= 0) continue;
      if (!best || percent > best.percent) best = { left, right, percent };
    }
  }
  if (!best) return null;
  return `${styleLabel(best.left)} captions beat ${styleLabel(best.right)} by ${best.percent}% on ${clientName}`;
}

/** The Clips cell. Nothing yet reads "none yet"; the short line keeps the blocked count. */
export function clipStripState(total: number, blocked: number): { line: string; short: string } {
  if (total <= 0) return { line: "none yet", short: "none" };
  return clipStripLines(blocked);
}

/** The Round cell: the latest round's state, in a long and a short form of the same word. */
export function roundStripState(status: string | null | undefined): { line: string; short: string } {
  switch (status) {
    case null:
    case undefined:
    case "":
      return { line: "not started", short: "none" };
    case "draft":
    case "rendering":
      return { line: "draft", short: "draft" };
    case "approved":
      return { line: "approved", short: "approved" };
    case "launched":
      return { line: "running", short: "running" };
    case "judged":
      return { line: "judged", short: "judged" };
    case "rejected":
      return { line: "rejected", short: "rejected" };
    default:
      return { line: status, short: status };
  }
}

/** "40 signups", "1 signup". */
export function resultsLabel(results: number | null | undefined, metric: string | null | undefined): string {
  if (results == null || !Number.isFinite(results)) return "—";
  const unit = metricUnit(metric);
  return `${results.toLocaleString("en-GB")} ${results === 1 ? unit : `${unit}s`}`;
}

/** "{artist} #{n} × {angle}". */
export function adPairingName(clip: { artistName: string; clipNo: number } | null | undefined, style: string | null | undefined): string {
  const left = clip ? `${clip.artistName} #${clip.clipNo}` : "Clip";
  return `${left} × ${style ? styleLabel(style) : "caption"}`;
}

/** A round's ads have run once it has launched or been judged. Before that nothing has a result. */
export function roundHasRun(status: string): boolean {
  return status === "launched" || status === "judged";
}

/**
 * The part of a clip a tile plays and scrubs: from in_s to the out point,
 * or the file's end, and never more than 30 seconds.
 */
export function scrubWindow(inS: number, outS: number | null, duration: number | null): { start: number; end: number | null } {
  const start = Number.isFinite(inS) ? inS : 0;
  const stop = outS ?? (duration != null && duration > 0 ? duration : null);
  if (stop == null) return { start, end: null };
  return { start, end: Math.min(stop, start + CLIP_TRIM_SECONDS) };
}

/** The frame a tile rests on: half a second in when the clip starts at 0, else its in point. */
export function posterTime(inS: number, outS: number | null): number {
  return inS === 0 && (outS == null || outS > 0.5) ? 0.5 : inS;
}

export type CandidateForTile = {
  igMediaId: string;
  postedAt: string | null;
  likes: number | null;
  comments: number | null;
  score: number | null;
  aspect: string | null;
  hasFile: boolean;
  status: string;
  reason?: string | null;
};

/** Best first: by score, then newest. Rank is 1-based. */
export function rankCandidates<T extends CandidateForTile>(rows: readonly T[]): (T & { rank: number })[] {
  return [...rows]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(b.postedAt ?? "").localeCompare(String(a.postedAt ?? "")))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

/** "today", "1 day ago", "8 days ago", "3 weeks ago", "2 months ago". */
export function postAge(postedAt: string | null | undefined, now: string | Date): string | null {
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(postedAt ?? "")?.[1];
  if (!day) return null;
  const today = (typeof now === "string" ? now : now.toISOString()).slice(0, 10);
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return null;
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

export type CandidateTile = {
  action: "add" | "request" | "import" | null;
  status: string | null;
  /** The status ends in a control that opens the eight frames. */
  see: boolean;
};

/**
 * At most one action per candidate tile, and at most one status line.
 * A text check names the frames. A check the model would not settle is
 * the sentence, and Import is the verb.
 */
export function candidateTileState(row: CandidateForTile & {
  overlay?: { verdict: string; flagged: number } | null;
}): CandidateTile {
  if (row.overlay?.verdict === "check_by_eye") {
    return { action: "import", status: "Couldn't check for text — look before you import", see: false };
  }
  if (row.overlay?.verdict === "text_overlay") {
    return { action: null, status: `Skipped — text in ${row.overlay.flagged} of 8 frames`, see: true };
  }
  if (row.status === "skipped") return { action: null, status: `Skipped — ${row.reason?.trim() || "not usable"}`, see: false };
  if (row.status === "requested") return { action: null, status: "Requested", see: false };
  if (row.status === "imported") return { action: null, status: "✓ Added", see: false };
  return { action: row.hasFile ? "add" : "request", status: null, see: false };
}

/** The 9:16 window on a wider or taller frame. `focus` is the horizontal centre, 0–1. */
export function cropWindowBox(focus: number, width: number, height: number): {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
} {
  const safe = Math.min(1, Math.max(0, Number.isFinite(focus) ? focus : 0.5));
  const source = width > 0 && height > 0 ? width / height : 16 / 9;
  const target = 9 / 16;
  const known: [number, string][] = [[16 / 9, "16:9"], [4 / 3, "4:3"], [1, "1:1"], [4 / 5, "4:5"], [9 / 16, "9:16"]];
  const named = known.find(([value]) => Math.abs(value - source) < 0.02)?.[1] ?? "wide";
  const label = `${named} → 9:16`;
  if (source >= target) {
    const span = target / source;
    return { left: (1 - span) * safe, top: 0, width: span, height: 1, label };
  }
  const span = source / target;
  return { left: 0, top: (1 - span) / 2, width: 1, height: span, label };
}

function queueOrdinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

/**
 * The word on a render row. A row with no measured average still says
 * what it is doing. It never leaves the bar to stand alone.
 */
export function renderRowWord(
  row: { id: string; status: string; renderMs: number | null; updatedAt: string; error: string | null },
  rows: readonly { id: string; status: string; renderMs: number | null }[],
  now: string,
): string {
  if (row.status === "done") return "Ready";
  if (row.status === "failed") return renderRefusalSentence(row.error) ?? "This render failed — try it again.";
  const waiting = rows.filter((item) => item.status === "queued" || item.status === "rendering");
  const index = waiting.findIndex((item) => item.id === row.id);
  if (row.status === "queued") return `queued · ${queueOrdinal(Math.max(1, index + 1))}`;
  const done = rows.map((item) => item.renderMs).filter((ms): ms is number => ms != null && ms > 0);
  if (done.length === 0) return "rendering";
  const mean = done.reduce((sum, ms) => sum + ms, 0) / done.length;
  const elapsed = Math.max(0, Date.parse(now) - Date.parse(row.updatedAt || ""));
  if (!Number.isFinite(elapsed)) return "rendering";
  const remain = Math.max(1, Math.round((mean - elapsed) / 60_000));
  return `~${remain} min`;
}

/** 0–1 fill for the row's bar. Finished is full. Queued is empty. */
export function renderRowFraction(
  row: { id: string; status: string; renderMs: number | null; updatedAt: string },
  rows: readonly { renderMs: number | null }[],
  now: string,
): number {
  if (row.status === "done") return 1;
  if (row.status !== "rendering") return 0;
  const done = rows.map((item) => item.renderMs).filter((ms): ms is number => ms != null && ms > 0);
  if (done.length === 0) return 0;
  const mean = done.reduce((sum, ms) => sum + ms, 0) / done.length;
  const elapsed = Math.max(0, Date.parse(now) - Date.parse(row.updatedAt || ""));
  if (!Number.isFinite(elapsed)) return 0;
  return Math.min(0.95, elapsed / mean);
}

/** Native 9:16 says Add. Any other known shape says the crop will follow. */
export function candidateAddLabel(aspect: string | null | undefined): "Add" | "Add · crop" {
  const value = (aspect ?? "").trim();
  if (!value || value === "9:16" || value === "unknown") return "Add";
  return "Add · crop";
}

/** The deciding verdict for one clip or caption across a round's ads. */
export function itemVerdict(verdicts: readonly (string | null)[]): string | null {
  for (const verdict of ["winner", "loser", "flagged", "untested", "thin"]) {
    if (verdicts.includes(verdict)) return verdict;
  }
  return null;
}

/** The caption box is this share of the frame width (the 4:5 safe area's text column). */
export const CAPTION_BOX_WIDTH_PCT = 84;

/**
 * Left and right insets, in % of the frame width, for a caption box
 * CAPTION_BOX_WIDTH_PCT wide centred on the profile's horizontal centre
 * (0.493 in v1.json → 7.3% / 8.7%). The preview reads the same profile
 * value as the Lambda render, so a profile change moves both together.
 */
export function captionBoxInsets(horizontalCenterPctOfWidth: number, widthPct = CAPTION_BOX_WIDTH_PCT): { left: number; right: number } {
  const centre = horizontalCenterPctOfWidth * 100;
  const half = widthPct / 2;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { left: round(centre - half), right: round(100 - centre - half) };
}
