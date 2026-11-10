/**
 * Draft T2 claim statics (overlay-templates O4 / O8 / O12, H26) for Matas to
 * judge. Local only: cards go to --out and nowhere else — this script has no
 * Drive or Storage write, never approves a claim, and every card carries a
 * draft watermark, so assertExportable refuses it. Kit fonts are read in place
 * from FONTS_DIR (default ~/Library/Fonts); nothing renders on Lambda.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/t2-claim-drafts.mts \
 *     --event P26-BDAY --kit <the STORY PSD's kit folder> --out <notes folder>
 *
 * (a) the event's rung-1 claim: an approved row if there is one; else the held
 *     row once the rung-1 split (asset bank 4, H20) has reworded it; else the
 *     record's words (A23, AB2). Unapproved → "DRAFT · claim not approved".
 * (b) the roll-call fixture (AB2, A21), "DRAFT · sample claim".
 * (c) the longest fixture roll-call at every O8 step, to the first that fits
 *     or "can't shorten"; --overlong adds a fixture that can't fit.
 * (d) (a) with the bands off.  (e) (a) on the bare paint, no panel.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { trimToInk } from "../lib/creative-lab/artist-card.ts";
import { WATERMARK, approvedClaim, assertExportable, type WarningRow } from "../lib/creative-lab/claim-approval.ts";
import { fontsDir, indexFonts } from "../lib/creative-lab/kit-font.ts";
import { DEFAULT_GRADIENT_SHADOW } from "../lib/creative-lab/overlay-gradient.ts";
import { T2_INVENTED } from "../lib/creative-lab/overlay-kits.ts";
import { describeAttempt, renderStandaloneMessage, type T2Input, type T2Result } from "../lib/creative-lab/t2-render.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const fail = (m: string): never => {
  console.error(m);
  process.exit(2);
};
const code = flag("--event") ?? "";
const kitDir = flag("--kit") ?? "";
const outDir = flag("--out") ?? "";
if (!code || !kitDir || !outDir) fail("--event, --kit and --out are required");
if (argv.includes("--apply") || argv.includes("--export")) fail("this script never files or exports: drafts go to --out only");

/** The record's fixtures (asset bank 4 AB2 / A21; overlay templates O12 with A21's line 2). */
const ROLL_CALL = "Early bird, 1st & 2nd release sold out\n3rd release selling fast";
const LONGEST = "Early bird, 1st, 2nd & 3rd release sold out\nFinal 100 final release tickets";
const OVERLONG = "Early bird, 1st, 2nd, 3rd, 4th, 5th & 6th release sold out\nFinal 100 final release tickets now";
/** A23 / AB2-1280: the General sale is the release that may say "live". */
const RECORD_RUNG1 = "General sale live";

// ─── Kit (read in place from the STORY PSD's extracted layers) ──────────────
type Layer = { name: string; bounds: { left: number; top: number; width: number; height: number } };
const manifest = JSON.parse(readFileSync(join(kitDir, "manifest.json"), "utf8")) as { psd: string; width: number; height: number; layers: Layer[]; layer_files?: Record<string, string> };
const pieces = JSON.parse(readFileSync(join(kitDir, "pieces.json"), "utf8")) as { pieces: { role: string; label: string; file: string }[] };
const scale = 1080 / manifest.width;
const panelLayer = manifest.layers.find((l) => l.name === "4th bday poster NEW");
const ground = readFileSync(join(kitDir, "layers", "04-background.png"));
const panel = panelLayer
  ? { png: readFileSync(join(kitDir, "layers", "03-4th-bday-poster-new.png")), left: panelLayer.bounds.left * scale, top: panelLayer.bounds.top * scale, width: panelLayer.bounds.width * scale, height: panelLayer.bounds.height * scale }
  : null;
const logoRec = pieces.pieces.find((p) => p.role === "logo");
const logo = logoRec ? await trimToInk(readFileSync(join(kitDir, logoRec.file))) : null;
const info = pieces.pieces.filter((p) => p.role === "info").map((p) => p.label);
const dateLine = info.find((l) => /DAY\b/i.test(l)) ?? "";
const venueLine = info.find((l) => l.includes(">") && !/\dPM/i.test(l)) ?? "";

// ─── Live reads, select only ───────────────────────────────────────────────
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const ev = await db.from("events").select("id, name").eq("event_code", code).maybeSingle();
if (ev.error || !ev.data) fail(`No event ${code}`);
const event = ev.data!;
const tw = await db.from("ticket_warnings").select("id, claim, format, state, approved_by, approved_at, runs_from, runs_to, updated_at").eq("event_id", event.id).range(0, 999);
if (tw.error) fail(`ticket_warnings: ${tw.error.message}`);
const rows = (tw.data ?? []) as (WarningRow & { updated_at: string })[];
const facts = await db.from("creative_lab_event_facts").select("lineup").eq("event_id", event.id).maybeSingle();
const lineup = ((facts.data?.lineup as string[] | null) ?? []).filter(Boolean);

const source = approvedClaim(rows, new Date());
const split = rows.find((r) => r.state === "held" && /^general sale live$/i.test(r.claim.trim()));
const rung1 =
  source.kind === "approved"
    ? { text: source.claim, why: `approved ticket_warnings ${source.id}`, watermark: null as string | null }
    : split
      ? { text: split.claim, why: `held ticket_warnings ${split.id} (rung-1 split landed), not approved`, watermark: WATERMARK.notApproved }
      : { text: RECORD_RUNG1, why: `the rung-1 split hasn't landed (held rows: ${rows.map((r) => `"${r.claim}" ${r.state}`).join(", ") || "none"}), so the record's words (A23, AB2-1280); not approved`, watermark: WATERMARK.notApproved };

const fonts = indexFonts(fontsDir());
mkdirSync(outDir, { recursive: true });
const base: Omit<T2Input, "claim" | "watermark"> = { ground, panel, bands: DEFAULT_GRADIENT_SHADOW, lineup, details: [dateLine, venueLine], logo, fonts };

type Card = { id: string; title: string; source: string; result: T2Result; files: string[] };
const cards: Card[] = [];
async function card(id: string, title: string, src: string, input: T2Input) {
  const r = await renderStandaloneMessage(input);
  const files: string[] = [];
  if (r.master && r.crop45 && r.square) {
    // A draft is never exportable: check the guard says so before writing to the notes folder.
    try {
      assertExportable({ watermark: r.watermark });
      if (!r.watermark) fail(`${id}: an unwatermarked card would be exportable; drafts only`);
    } catch (e) {
      if ((e as Error).name !== "NotExportableError") throw e;
    }
    const flagged = r.plan && !r.plan.canApprove && input.attempt == null ? "_CANT-SHORTEN" : "";
    for (const [fmt, buf] of [["9x16", r.master], ["4x5", r.crop45], ["1x1", r.square]] as const) {
      const f = `${id}_${fmt}_DRAFT${flagged}.png`;
      writeFileSync(join(outDir, f), buf);
      files.push(f);
    }
  }
  cards.push({ id, title, source: src, result: r, files });
  console.log(`${id}: ${r.held ?? "drawn"} · ${r.rules.map((x) => `${x.rule} ${x.pass ? "✓" : "✗"}`).join(" · ")}`);
}

await card("a-general-sale-live", `(a) "${rung1.text}"`, rung1.why, { ...base, claim: rung1.text, watermark: rung1.watermark });
await card("b-roll-call", "(b) roll-call fixture", "fixture (asset bank 4 AB2, A21)", { ...base, claim: ROLL_CALL, watermark: WATERMARK.sample });

// (c) every ladder state of the longest fixture, to the first that fits.
async function ladder(prefix: string, words: string, src: string) {
  const probe = await renderStandaloneMessage({ ...base, claim: words, watermark: WATERMARK.sample });
  const plan = probe.plan!;
  const last = plan.chosen ?? plan.attempts.length - 1;
  for (let i = 0; i <= last; i += 1) {
    await card(`${prefix}-${String(i).padStart(2, "0")}`, `(c) ${describeAttempt(plan, i)}`, src, { ...base, claim: words, watermark: WATERMARK.sample, attempt: i });
  }
  if (plan.chosen == null) await card(`${prefix}-flagged`, `(c) can't shorten · ${plan.meter}`, src, { ...base, claim: words, watermark: WATERMARK.sample });
  return plan;
}
const longPlan = await ladder("c-longest", LONGEST, "fixture (overlay templates O12 line 1, A21's higher-rung line 2)");
const overPlan = argv.includes("--overlong") ? await ladder("c-overlong", OVERLONG, "invented fixture, longer than any record's, to reach can't shorten") : null;

await card("d-general-sale-live-bands-off", `(d) "${rung1.text}", bands off`, rung1.why, { ...base, bands: null, claim: rung1.text, watermark: rung1.watermark });
await card("e-general-sale-live-bare-paint", `(e) "${rung1.text}", no panel`, rung1.why, { ...base, panel: null, claim: rung1.text, watermark: rung1.watermark });

// ─── Sheet of the 9:16 cards ───────────────────────────────────────────────
const W = 270;
const H = 480;
const LABEL = 64;
const shown = cards.filter((c) => c.result.master);
const cols = Math.min(6, shown.length);
const rowsN = Math.ceil(shown.length / cols);
const tiles: sharp.OverlayOptions[] = [];
for (let i = 0; i < shown.length; i += 1) {
  const c = shown[i]!;
  const x = (i % cols) * (W + 16) + 16;
  const y = Math.floor(i / cols) * (H + LABEL + 16) + 16;
  tiles.push({ input: await sharp(c.result.master!).resize(W, H).png().toBuffer(), left: x, top: y });
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const label = await sharp({ text: { text: `<span foreground="#ffffff">${esc(c.id)}\n${esc(c.result.rules.find((r) => r.rule === "fit")?.detail ?? "")}</span>`, font: "Helvetica 13", width: W, rgba: true, dpi: 72 } }).png().toBuffer();
  tiles.push({ input: label, left: x, top: y + H + 6 });
}
const sheet = await sharp({ create: { width: cols * (W + 16) + 16, height: rowsN * (H + LABEL + 16) + 16, channels: 3, background: "#1a1a1a" } }).composite(tiles).png().toBuffer();
writeFileSync(join(outDir, "SHEET-9x16.png"), sheet);

// ─── report.md ─────────────────────────────────────────────────────────────
const pct = (v: number | null) => (v == null ? "–" : `${(v * 100).toFixed(1)} %`);
const lines: string[] = [];
const say = (s = "") => lines.push(s);
say(`# T2 claim statics · ${code} · ${event.name} · ${new Date().toISOString().slice(0, 16)}Z`);
say();
say(`ticket_warnings, read live (select only): ${rows.map((r) => `${r.id.slice(0, 8)} "${r.claim}" ${r.state}${r.approved_at ? " approved" : ""}`).join(" · ") || "no rows"}.`);
say(`Card (a) words: ${rung1.why}.`);
say(`Lineup (creative_lab_event_facts): ${lineup.join(" · ")}. Details (STORY PSD live layer): ${dateLine} / ${venueLine}.`);
say(`Ground: ${manifest.psd} Background layer; panel "4th bday poster NEW" at the PSD's position (×${scale.toFixed(4)}); logo: the lockup layer. Fonts: ${fontsDir()}, read in place; local render only.`);
say();
say("| Card | Claim as drawn | Source | Step used | Fit (each line, against 929 px) | Claim box (≤ 15 %) | Red line (ink box, ≤ 25 % below 2:1) | Lineup / details (≤ 10 %) | Result |");
say("|---|---|---|---|---|---|---|---|---|");
for (const c of cards) {
  const r = c.result;
  const fit = r.lines.map((l) => `${l.color} ${Math.round(l.capPx)} px cap · ${l.widthPx} px${l.fits ? "" : " **over**"}`).join("<br>");
  const red = r.contrast.redLine == null ? "–" : `${pct(r.contrast.redLine)} → ${r.redLineWhite ? "**white**" : "red"}`;
  const fitRule = r.rules.find((x) => x.rule === "fit");
  const ok = r.held ? `held: ${r.held}` : r.rules.every((x) => x.pass) ? "passes" : `fails: ${r.rules.filter((x) => !x.pass).map((x) => x.rule).join(", ")}`;
  say(`| ${c.id} | ${r.lines.map((l) => l.text).join(" / ")} | ${c.source} | ${fitRule?.detail ?? "–"} | ${fit} | ${pct(r.contrast.claimBox)} | ${red} | ${pct(r.contrast.lineup)} / ${pct(r.contrast.details)} | ${ok}${r.watermark ? `, "${r.watermark}"` : ""}${r.approvalLines.length ? ` · approval line "${r.approvalLines.join('", "')}"` : ""} |`);
}
say();
say("## O8 ladders");
for (const [name, plan] of [["longest fixture", longPlan], ["overlong (invented)", overPlan]] as const) {
  if (!plan) continue;
  say(`**${name}:** meter "${plan.meter}"`);
  plan.attempts.forEach((a, i) => say(`- ${i}${i === plan.chosen ? " ← chosen" : ""}: ${describeAttempt(plan, i)} · "${a.lines.join(" / ")}" · widths ${a.widths.map((w) => Math.round(w)).join(" / ")} px · ${a.fits ? "fits" : "over"}`));
  say();
}
say("## Bands sampled at O25's stops (centre column, alpha %)");
const withBands = cards.find((c) => c.result.bandStops)?.result.bandStops;
if (withBands) {
  for (const [fmt, stops] of [["9:16", withBands.master], ["4:5", withBands.crop45], ["1:1", withBands.square]] as const) say(`- ${fmt}: ${stops.map((s) => `${s.at} H → ${s.got} % (O25 ${s.want})`).join(" · ")}`);
}
say();
say("## Invented (T2)");
for (const i of T2_INVENTED) say(`- ${i}`);
say();
say("Files: " + cards.flatMap((c) => c.files).join(", ") + ", SHEET-9x16.png");
writeFileSync(join(outDir, "report.md"), lines.join("\n") + "\n");
console.log(`wrote ${cards.length} cards to ${outDir}`);
