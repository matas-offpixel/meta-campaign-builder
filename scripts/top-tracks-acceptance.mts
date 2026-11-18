/**
 * Top tracks acceptance, issue 2 (docs/design-record/2026-11-18-creative-lab-top-tracks-2.html):
 * the grid, the drops and the drop TK15 chooses on real files, against
 * Matas's times. Local files only: it reads nothing from Drive or the
 * database and writes nothing but stdout (and --json).
 *
 *   npx tsx scripts/top-tracks-acceptance.mts --python <venv>/bin/python \
 *     --track "Can't Decide=/path/cant-decide.mp3@2:07.375±0.625" \
 *     [--track "An Angel=/path/an-angel.wav@2:54±4"] [--analysis-json /path.json] [--json out.json]
 *
 * Beat This! and htdemucs run through scripts/top-tracks/analyse.py
 * (analysis-source.ts localStudio), or --analysis-json reads a stored run.
 * Per track it prints Beat This!'s tempo and bar, every drop with its
 * break's length and level (the record asks for the list when there are
 * more than 4), the drop chosen, the window and whether the window's start
 * and end fall on downbeats. A miss is reported, never tuned.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { pcm16ToFloat, trackFeatures } from "../lib/creative-tests/top-tracks/analysis.ts";
import { localStudio } from "../lib/creative-tests/top-tracks/analysis-source.ts";
import { mmss, planTrack } from "../lib/creative-tests/top-tracks/audio-rules.ts";
import { decodeForAnalysis } from "../lib/creative-tests/top-tracks/ffmpeg.ts";
import { dropPickerLine, findBassDrops, studioGrid, type StudioAnalysis } from "../lib/creative-tests/top-tracks/studio.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const many = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]!] : []));
const python = flag("--python");
const storedJson = flag("--analysis-json");
const jsonOut = flag("--json");
const studio = python ? localStudio({ python }) : null;
if (!studio && !storedJson) throw new Error("--python <venv python> (Beat This! + Demucs) or --analysis-json <file>");

type Spec = { title: string; file: string; targetS: number | null; tolS: number | null };
function parseSpec(raw: string): Spec {
  const m = /^(.+?)=(.+?)(?:@([\d.:]+)±([\d.]+))?$/.exec(raw);
  if (!m) throw new Error(`--track "${raw}": want "Title=/path@m:ss.s±tol"`);
  const t = m[3];
  const targetS = t ? (t.includes(":") ? Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]) : Number(t)) : null;
  return { title: m[1]!, file: m[2]!, targetS, tolS: m[4] ? Number(m[4]) : null };
}
const fmt = (s: number) => `${mmss(s)}${(s % 1).toFixed(2).slice(1)}`;

const out: unknown[] = [];
let misses = 0;
for (const spec of many("--track").map(parseSpec)) {
  const analysis: StudioAnalysis = storedJson ? (JSON.parse(readFileSync(storedJson, "utf8")) as StudioAnalysis) : await studio!.analyse(spec.file);
  const features = trackFeatures(pcm16ToFloat(await decodeForAnalysis(spec.file)));
  const found = findBassDrops(analysis);
  const plan = planTrack({ title: spec.title, features, analysis });
  const dropS = "dropS" in plan.choice ? plan.choice.dropS : null;
  const err = dropS != null && spec.targetS != null ? dropS - spec.targetS : null;
  const pass = err != null && spec.tolS != null ? Math.abs(err) <= spec.tolS + 1e-9 : null;
  const bars = analysis.downbeats.slice(1).map((d, i) => d - analysis.downbeats[i]!).sort((a, b) => a - b);
  const bar = bars[bars.length >> 1] ?? null;
  console.log(`\n${spec.title} · ${fmt(analysis.durationS)} · last third from ${fmt(plan.choice.lastThirdFromS)}`);
  console.log(`  Beat This!: ${analysis.beats.length} beats, ${analysis.downbeats.length} downbeats, median bar ${bar?.toFixed(3) ?? "—"} s${bar ? ` (${((4 * 60) / bar).toFixed(1)} BPM in 4/4)` : ""}`);
  console.log(`  Bass stem: R ${found.R} dB · ${found.drops.length} drop${found.drops.length === 1 ? "" : "s"}${found.drops.length > 4 ? " (more than 4: listed for the record)" : ""}`);
  for (const d of found.drops) console.log(`    ${dropPickerLine(d)} · break ${fmt(d.breakFromS)}–${fmt(d.breakToS)} at ${d.breakDb} dB vs R · 8 beats ${d.testDb} dB vs R`);
  console.log(`  chosen: ${dropS != null ? fmt(dropS) : "—"} (${plan.choice.kind})${spec.targetS != null ? ` · target ${fmt(spec.targetS)} ± ${spec.tolS} s · error ${err != null ? (err >= 0 ? "+" : "") + err.toFixed(2) : "—"} s · ${pass ? "PASS" : "MISS"}` : ""}`);
  for (const line of plan.lines) console.log(`    ${line}`);
  let onDownbeats: boolean | null = null;
  if (plan.ok && plan.window.cut === "bars") {
    const on = (t: number) => analysis.downbeats.some((d) => Math.abs(d - t) < 0.002);
    onDownbeats = on(plan.window.startS) && on(plan.window.endS);
    console.log(`  window ${fmt(plan.window.startS)}–${fmt(plan.window.endS)} (${plan.window.lengthS.toFixed(2)} s) · start and end on downbeats: ${onDownbeats ? "yes" : "NO"}`);
  }
  if (dropS != null) {
    const g = studioGrid(analysis.downbeats, dropS);
    console.log(`  grid around the drop: ${g.steady ? "steady (±3 % over 16 bars)" : `${g.reason} (spread ${g.spread ?? "—"})`}`);
  }
  if (pass === false) misses += 1;
  out.push({ title: spec.title, durationS: analysis.durationS, barS: bar, R: found.R, drops: found.drops, breaks: found.breaks, chosen: dropS, kind: plan.choice.kind, targetS: spec.targetS, tolS: spec.tolS, errorS: err, pass, onDownbeats, lines: plan.lines });
}
for (const name of many("--not-run")) console.log(`\n${name}: not run — file not in the Drive`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2));
console.log(misses ? `\n${misses} miss${misses === 1 ? "" : "es"} — reported, not tuned.` : "\nNo misses.");
