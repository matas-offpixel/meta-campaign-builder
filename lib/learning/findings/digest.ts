/**
 * E8: the Monday digest — one Slack message on ads_ops, Mondays 10:00 UTC
 * (vercel.json "0 10 * * 1": 10:00 London in winter, 11:00 in summer, both
 * inside notify()'s 10:00–20:00 business hours), deduped per ISO week.
 *
 * Content, in the brief's E8 order:
 *   1. the 3 strongest cross-client learnings (axis_rollup, scope all,
 *      strong first, then ok; thin never shows);
 *   2. one line per live show (show_week, last complete week);
 *   3. tests called (test_verdict rows whose call was made in the 7 days to
 *      the digest, the same Monday's 04:15 run included, in RP1's C1 / S4
 *      words);
 *   4. recommendations waiting (rows with a recommendation; none until PR2).
 * Words plain and factual until S4 rules them; £ and ×; no emoji.
 *
 * Gates: ENABLE_LEARNING_DIGEST must be exactly "1"; notify() adds
 * ENABLE_SLACK_NOTIFICATIONS and SLACK_WEBHOOK_ADS_OPS (and business hours,
 * respectBusinessHours true). Off by default. The dry run builds and returns
 * the text and never calls notify(). Operator-only: archived clients'
 * rows are left out. Relative imports only.
 */

import { loadArchivedClientIds } from "../../db/client-status.ts";
import type { NotifyOptions, NotifyResult } from "../../notify/slack.ts";
import { londonDay } from "../../creative-tests/fast-call.ts";
import { symbolFor } from "../../creative-tests/words.ts";
import { CALLED_VERDICTS } from "./axis-rollup.ts";
import { addDays } from "./observed-tests.ts";
import { lastCompleteWeek } from "./show-week.ts";
import { all, type Db, type Row } from "./read-all.ts";

export const DIGEST_ENV = "ENABLE_LEARNING_DIGEST";
export const DIGEST_SCHEDULE = "0 10 * * 1";

export function isLearningDigestEnabled(env: Record<string, string | undefined>): boolean {
  return env[DIGEST_ENV] === "1";
}

export type DigestRow = {
  kind: string;
  scope: string;
  scope_id: string | null;
  client_id: string | null;
  stage: string | null;
  week_start: string | null;
  subject: string | null;
  metric: string | null;
  value_a: number | string | null;
  value_b: number | string | null;
  ratio: number | string | null;
  n_shows: number | null;
  n_pairs: number | null;
  spend_gbp: number | string | null;
  results: number | string | null;
  confidence: string | null;
  verdict: string | null;
  evidence: unknown;
  recommendation: unknown;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const ev = (r: DigestRow) => (r.evidence ?? {}) as Record<string, unknown>;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const money = (n: number, currency?: unknown) => `${symbolFor(typeof currency === "string" ? currency : null)}${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const times = (n: number) => `${n >= 10 ? n.toFixed(0) : n.toFixed(1)}×`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const SIDE_WORDS: Record<string, string> = {
  with_date: "with date",
  no_date: "no date",
  no_text: "no text",
  with_text: "with text",
  cta: "CTA",
  no_cta: "no CTA",
  static: "static",
  video: "video",
  ab_a: "[AB-A]",
  ab_b: "[AB-B]",
};
const PHASE_WORDS: Record<string, string> = { teaser: "teaser", announced: "announced", presale: "presale", general_sale: "general sale" };
const RESULT_WORDS: Record<string, string> = { complete_registration: "signup", initiate_checkout: "checkout", purchase: "purchase", landing_page_view: "landing-page view" };
const stageWords = (stage: string | null) => (stage === "registration" ? "signup stage" : stage === "ticket_sale" ? "ticket stage" : "unknown stage");
const resultOfMetric = (metric: string | null) => RESULT_WORDS[(metric ?? "").replace(/^cost_per_/, "")] ?? "result";

/** ISO week key of a London day: "2026-W48". */
export function isoWeekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  // The week's Thursday decides its year.
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function digestDedupeKey(day: string): string {
  return `learning_digest:${isoWeekKey(day)}`;
}

/** One cross-client learning in plain words. */
export function learningLine(r: DigestRow): string | null {
  const e = ev(r);
  const subject = r.subject ?? "";
  const shows = plural(r.n_shows ?? 0, "show");
  if (subject.startsWith("pair|")) {
    const ratio = num(r.ratio);
    const sides = (e.sides as string[] | undefined) ?? [];
    if (ratio == null || sides.length !== 2) return null;
    const [cheaper, factor] = ratio < 1 ? [sides[0]!, 1 / ratio] : [sides[1]!, ratio];
    const voice = e.voice === "promoter" ? " · promoter page" : e.voice === "artist" ? " · artist page" : "";
    return `${String(e.axis)} · ${stageWords(r.stage)}${voice}: ${SIDE_WORDS[cheaper] ?? cheaper} ${times(factor)} cheaper · ${shows} · ${plural(r.n_pairs ?? 0, "pair")} · ${r.confidence}`;
  }
  if (subject.startsWith("phase|")) {
    const median = num(r.value_a);
    if (median == null) return null;
    return `teaser → ${PHASE_WORDS[String(e.to)] ?? String(e.to)} · ${stageWords(r.stage)}: cost ${times(median)} median · ${shows} · ${r.confidence}`;
  }
  if (subject.startsWith("tests|")) {
    const tests = num(r.value_b) ?? 0;
    const winners = num(r.value_a) ?? 0;
    return `${String(e.testKind)}: ${plural(winners, "winner")} in ${plural(tests, "test")} · ${shows} · ${r.confidence}`;
  }
  return null;
}

export function showLine(r: DigestRow): string {
  const e = ev(r);
  const word = resultOfMetric(r.metric);
  const thisWeek = (e.thisWeek ?? {}) as { spend?: number; results?: number; cost?: number | null };
  const lastWeek = (e.lastWeek ?? {}) as { spend?: number; cost?: number | null };
  const results = thisWeek.results ?? 0;
  const figures = results > 0 && thisWeek.cost != null ? `${plural(results, word)} · ${money(thisWeek.cost, e.currency)} per ${word}` : `no ${word}s`;
  const last = lastWeek.cost != null ? `last week ${money(lastWeek.cost, e.currency)}` : lastWeek.spend ? `last week no ${word}s` : "no spend last week";
  return `${r.scope_id}: ${money(thisWeek.spend ?? 0, e.currency)} · ${figures} (${last})`;
}

export function testLine(r: DigestRow): string {
  const e = ev(r);
  const code = String(r.scope_id ?? "");
  // "NX26-DOD · AB copy test" already names the show; a Tests ad set ("Top tracks reels · Luke Dean") doesn't.
  const name = String(e.adsetName || e.campaignName || r.subject).replace(new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · `), "");
  return `${code} · ${name}: ${String(e.text ?? r.verdict)}`;
}

const CONFIDENCE_RANK: Record<string, number> = { strong: 0, ok: 1 };

export function buildDigest(input: { rows: readonly DigestRow[]; digestDay: string; appUrl?: string | null }): { text: string; counts: Record<string, number> } {
  const { weekStart, weekEnd } = lastCompleteWeek(input.digestDay);
  const since = addDays(input.digestDay, -7);
  const rollups = input.rows
    .filter((r) => r.kind === "axis_rollup" && r.scope === "all" && (r.confidence === "strong" || r.confidence === "ok"))
    .map((r) => ({ r, line: learningLine(r) }))
    .filter((x): x is { r: DigestRow; line: string } => x.line != null)
    .sort((a, b) => (CONFIDENCE_RANK[a.r.confidence ?? ""] ?? 9) - (CONFIDENCE_RANK[b.r.confidence ?? ""] ?? 9) || (b.r.n_shows ?? 0) - (a.r.n_shows ?? 0) || a.line.localeCompare(b.line))
    .slice(0, 3);
  const thin = input.rows.filter((r) => r.kind === "axis_rollup" && r.scope === "all" && r.confidence === "thin").length;
  const shows = input.rows.filter((r) => r.kind === "show_week" && r.week_start === weekStart).sort((a, b) => String(a.scope_id).localeCompare(String(b.scope_id)));
  const called = input.rows
    .filter((r) => r.kind === "test_verdict" && CALLED_VERDICTS.includes(r.verdict ?? "") && String(ev(r).readOn ?? "") > since && String(ev(r).readOn ?? "") <= input.digestDay)
    .sort((a, b) => String(a.scope_id).localeCompare(String(b.scope_id)) || String(a.subject).localeCompare(String(b.subject)));
  const waiting = input.rows.filter((r) => r.recommendation != null);

  const lines: string[] = [`Learnings · week of ${dayLabel(weekStart)}–${dayLabel(weekEnd)}`, ""];
  lines.push("Strongest cross-client learnings");
  if (rollups.length) for (const x of rollups) lines.push(`• ${x.line}`);
  else lines.push(`• None at ok or above yet${thin ? ` (${plural(thin, "thin rollup")})` : ""}.`);
  lines.push("", "Shows");
  if (shows.length) for (const r of shows) lines.push(`• ${showLine(r)}`);
  else lines.push("• No show spent last week.");
  lines.push("", "Tests called");
  if (called.length) for (const r of called) lines.push(`• ${testLine(r)}`);
  else lines.push("• None this week.");
  lines.push("", "Recommendations waiting");
  if (waiting.length) lines.push(`• ${plural(waiting.length, "recommendation")}.`);
  else lines.push("• None yet.");
  if (input.appUrl) lines.push("", input.appUrl.replace(/\/+$/, ""));
  return { text: lines.join("\n"), counts: { learnings: rollups.length, thinRollups: thin, shows: shows.length, testsCalled: called.length, recommendations: waiting.length } };
}

const DIGEST_COLUMNS = "id, kind, scope, scope_id, client_id, stage, week_start, subject, metric, value_a, value_b, ratio, n_shows, n_pairs, spend_gbp, results, confidence, verdict, evidence, recommendation";

/** The stored findings the digest reads, archived clients left out. */
export async function loadDigestRows(db: Db, digestDay: string): Promise<DigestRow[]> {
  const { weekStart } = lastCompleteWeek(digestDay);
  const archived = await loadArchivedClientIds(db as never);
  const rows: Row[] = [
    ...(await all(db, "learning_findings", DIGEST_COLUMNS, (q) => q.eq("kind", "axis_rollup").eq("scope", "all"), ["id"])),
    ...(await all(db, "learning_findings", DIGEST_COLUMNS, (q) => q.eq("kind", "show_week").eq("week_start", weekStart), ["id"])),
    ...(await all(db, "learning_findings", DIGEST_COLUMNS, (q) => q.eq("kind", "test_verdict"), ["id"])),
  ];
  return (rows as unknown as DigestRow[]).filter((r) => !(r.client_id && archived.has(r.client_id)));
}

export type DigestResult =
  | { ok: true; skippedReason: string }
  | { ok: boolean; dryRun: boolean; digestDay: string; dedupeKey: string; text: string; counts: Record<string, number>; sent: boolean; reason: string | null };

/**
 * The digest run. `notify` is injected (the route passes the live one); the
 * dry run never calls it.
 */
export async function runLearningDigest(input: {
  env: Record<string, string | undefined>;
  db: Db;
  now?: Date;
  dryRun?: boolean;
  notify: (opts: NotifyOptions) => Promise<NotifyResult>;
  /** The rows to build from; the default reads learning_findings. */
  rows?: readonly DigestRow[];
}): Promise<DigestResult> {
  if (!isLearningDigestEnabled(input.env)) return { ok: true, skippedReason: "killswitch" };
  const now = input.now ?? new Date();
  const digestDay = londonDay(now.toISOString());
  const rows = input.rows ?? (await loadDigestRows(input.db, digestDay));
  const { text, counts } = buildDigest({ rows, digestDay, appUrl: input.env.NEXT_PUBLIC_APP_URL ?? null });
  const dedupeKey = digestDedupeKey(digestDay);
  if (input.dryRun) return { ok: true, dryRun: true, digestDay, dedupeKey, text, counts, sent: false, reason: "dry_run" };
  const result = await input.notify({ channel: "ads_ops", text, dedupeKey, dedupeWindowMs: 8 * 24 * 60 * 60 * 1000, respectBusinessHours: true });
  return { ok: true, dryRun: false, digestDay, dedupeKey, text, counts, sent: result.sent, reason: result.reason ?? null };
}
