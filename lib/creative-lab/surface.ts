/**
 * How the clip grid, caption posts, round matrix and "what's working"
 * read the rows that are already stored. Nothing here calls Meta.
 */

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

export type ClipForGroup = {
  id: string;
  artistId?: string;
  artistName: string;
  clipNo: number;
  cleared: boolean;
  renderError: string | null;
  durationSeconds?: number | null;
  judged: JudgedClip | null;
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

/** When the window is unset, a long file is the first 30 seconds. A stored window is left as it is. */
export function playableClipSeconds(args: { fileSeconds: number | null; inS: number | null; outS: number | null }): number | null {
  const unset = args.inS == null && args.outS == null;
  if (unset && args.fileSeconds != null && Number.isFinite(args.fileSeconds) && args.fileSeconds > CLIP_TRIM_SECONDS) {
    return CLIP_TRIM_SECONDS;
  }
  if (args.outS != null && Number.isFinite(args.outS)) return args.outS;
  return args.fileSeconds;
}

export function clipBucket(clip: ClipForGroup): ClipBucket {
  if (renderRefusalSentence(clip.renderError)) return "cant";
  if (!clip.judged) return "new";
  if (clip.judged.verdict === "untested" || clip.judged.verdict === "thin") return "new";
  return "keeping";
}

/** One sentence that says what to fix. A raw render error is never returned. */
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
  if (lower.includes("style_version") || lower.includes("old style")) return "This caption is on an old style — generate it again.";
  if (lower.includes("no source") || lower.includes("no file")) return "This clip has no file — import it again.";
  if (lower.includes("timeout")) return "The render timed out — try it again.";
  if (lower.includes("replaced audio") || lower.includes("no track")) return "This clip's new audio has no track yet — add the track.";
  if (value.includes(" — ") && !value.includes(":") && value.length <= 140) return value;
  return "This render was refused — find a sharper copy or ask the team.";
}

export function cantRunReason(clip: ClipForGroup): string | null {
  return renderRefusalSentence(clip.renderError);
}

/** The best New clip of a headliner. A refused clip is never returned. */
export function feedPostClip<T extends ClipForGroup>(clips: readonly T[], headlinerIds: ReadonlySet<string>): T | null {
  const groups = groupClips(clips);
  const freshHead = groups.fresh.find((clip) => clip.artistId != null && headlinerIds.has(clip.artistId));
  if (freshHead) return freshHead;
  if (groups.fresh[0]) return groups.fresh[0];
  const keptHead = groups.keeping.find((clip) => clip.artistId != null && headlinerIds.has(clip.artistId));
  return keptHead ?? groups.keeping[0] ?? null;
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
  clips: readonly { id: string }[];
  captions: readonly { id: string }[];
  excluded: ReadonlySet<string>;
}): { cells: MatrixCell[]; on: number; off: number; line: string } {
  const cells: MatrixCell[] = [];
  for (const clip of args.clips) {
    for (const caption of args.captions) {
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
