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

/** A clip longer than this is refused. The same limit proposeRound uses. */
export const CLIP_LIMIT_SECONDS = 30;

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

export function clipOverLimit(seconds: number | null | undefined): boolean {
  return seconds != null && Number.isFinite(seconds) && seconds > CLIP_LIMIT_SECONDS;
}

export function clipBucket(clip: ClipForGroup): ClipBucket {
  if (clip.renderError || clipOverLimit(clip.durationSeconds)) return "cant";
  if (!clip.judged) return "new";
  if (clip.judged.verdict === "untested" || clip.judged.verdict === "thin") return "new";
  return "keeping";
}

export function cantRunReason(clip: ClipForGroup): string | null {
  if (clip.renderError) return clip.renderError;
  if (clipOverLimit(clip.durationSeconds)) {
    return `This clip is ${Math.round(clip.durationSeconds ?? 0)}s. Clips over ${CLIP_LIMIT_SECONDS} seconds can't run.`;
  }
  return null;
}

/** The best New clip of a headliner. A refused or over-limit clip is never returned. */
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
