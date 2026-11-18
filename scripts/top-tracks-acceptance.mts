/**
 * Top tracks acceptance (TK3, docs/design-record/2026-11-18-creative-lab-top-tracks.html):
 * the drop and hook the Lab chooses on real files, against Matas's times.
 * Local files only: it reads nothing from Drive or the database and writes
 * nothing but stdout (and --json).
 *
 *   npx tsx scripts/top-tracks-acceptance.mts \
 *     --track "Can't Decide=/path/cant-decide.mp3@127.5±0.5" \
 *     --track "An Angel=/path/an-angel.wav@174±4" [--track …] [--json out.json] \
 *     [--bass-stem /path/to/venv/bin/python]
 *
 * --bass-stem runs TK3's fallback locally (Demucs through scripts/top-tracks/bass-stem.py,
 * bass-stem.ts) and prints its ranking and what the fallback would choose
 * if VW14 had found nothing. The Lab only uses it when VW14 finds no
 * qualifying drop; here it is reported for every track.
 *
 * A miss is reported, never tuned (TK3: "a miss is never a reason to re-tune
 * VW14"). For a miss it prints, as VW14's acceptance asks, every kick within
 * 4 s of the target with its measures, and where the chosen drop lands for the
 * roll ratio at 0.5 / 0.6 / 0.7 and the mids fall at 1 / 1.5 / 2 / 3 dB.
 */

import { writeFileSync } from "node:fs";

import { bassLevelDb, findDrops, findKicks, pcm16ToFloat, trackFeatures, VW14, type TrackFeatures } from "../lib/creative-tests/top-tracks/analysis.ts";
import { barGrid, chooseDrop, mmss, planTrack } from "../lib/creative-tests/top-tracks/audio-rules.ts";
import { decodeForAnalysis } from "../lib/creative-tests/top-tracks/ffmpeg.ts";
import { bassStemTop2, detectorCandidates, localDemucs, rankOnBassStem } from "../lib/creative-tests/top-tracks/bass-stem.ts";
import { readEnvelopes, runFfmpegArgs, withTempDir } from "../lib/creative-tests/audio-ffmpeg.ts";
import { ENVELOPE_RATE } from "../lib/creative-tests/audio-ffmpeg.ts";
import { rmsEnvelope } from "../lib/creative-tests/drop.ts";

const argv = process.argv.slice(2);
const many = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]!] : []));
const jsonOut = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : undefined;
const stemPython = argv.includes("--bass-stem") ? argv[argv.indexOf("--bass-stem") + 1] : undefined;
const stemSource = stemPython ? localDemucs({ python: stemPython }) : null;

type Spec = { title: string; file: string; targetS: number | null; tolS: number | null };
function parseSpec(raw: string): Spec {
  const m = /^(.+?)=(.+?)(?:@([\d.:]+)±([\d.]+))?$/.exec(raw);
  if (!m) throw new Error(`--track "${raw}": want "Title=/path@m:ss.s±tol" (the target is optional)`);
  const t = m[3];
  const targetS = t ? (t.includes(":") ? Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]) : Number(t)) : null;
  return { title: m[1]!, file: m[2]!, targetS, tolS: m[4] ? Number(m[4]) : null };
}

const fmt = (s: number) => `${mmss(s)}${(s % 1).toFixed(2).slice(1)}`;

function kickRows(f: TrackFeatures, kicks: number[], around: number) {
  const bass = bassLevelDb(f);
  const pm = (v: ArrayLike<number>, a: number, b: number) => {
    let s = 0;
    let n = 0;
    for (let i = Math.max(0, a); i < Math.min(v.length, b); i += 1) {
      s += 10 ** (v[i]! / 10);
      n += 1;
    }
    return n ? 10 * Math.log10(s / n) : -120;
  };
  let loud = -120;
  for (let i = 0; i + 40 <= bass.length; i += 1) loud = Math.max(loud, pm(bass, i, i + 40));
  return kicks
    .filter((k) => Math.abs(k - around) <= 4)
    .map((k) => {
      const t = Math.round(k / VW14.hopS);
      const bi = Math.round(k / VW14.bassFrameS);
      const cnt = (a: number, b: number) => kicks.filter((x) => x >= a && x < b).length;
      return {
        tS: k,
        kicksBeforePerS: cnt(k - 2, k) / 2,
        kicksAfterPerS: cnt(k, k + 2) / 2,
        midsFallDb: Math.round((pm(f.midsDb, t - 200, t) - pm(f.midsDb, t, t + 100)) * 10) / 10,
        kickBandChangeDb: Math.round((pm(f.kickBandDb, t, t + 200) - pm(f.kickBandDb, t - 200, t)) * 10) / 10,
        bassVsLoudestDb: Math.round((pm(bass, bi, bi + 40) - loud) * 10) / 10,
      };
    });
}

const out: unknown[] = [];
let misses = 0;
for (const spec of many("--track").map(parseSpec)) {
  const f = trackFeatures(pcm16ToFloat(await decodeForAnalysis(spec.file)));
  const kicks = findKicks(f);
  const drops = findDrops(f, kicks);
  const plan = planTrack({ title: spec.title, features: f, kicks, drops, bassStemTop2: null });
  const choice = plan.choice;
  const dropS = "dropS" in choice ? choice.dropS : null;
  const err = dropS != null && spec.targetS != null ? dropS - spec.targetS : null;
  const pass = err != null && spec.tolS != null ? Math.abs(err) <= spec.tolS + 1e-9 : null;
  console.log(`\n${spec.title} · ${fmt(f.durationS)} · last third from ${fmt(choice.lastThirdFromS)} · ${kicks.length} kicks`);
  console.log(`  VW14 drops: ${drops.map((d) => `${fmt(d.tS)} (${d.test})`).join(", ") || "none"}`);
  console.log(`  chosen: ${dropS != null ? fmt(dropS) : "—"} (${choice.kind})${spec.targetS != null ? ` · target ${fmt(spec.targetS)} ± ${spec.tolS} s · error ${err != null ? (err >= 0 ? "+" : "") + err.toFixed(2) : "—"} s · ${pass ? "PASS" : "MISS"}` : ""}`);
  for (const line of plan.lines) console.log(`  ${line}`);
  if (dropS != null) {
    const g = barGrid(kicks, dropS);
    console.log(`  grid: ${g.steady ? `steady, beat ${g.beatS.toFixed(3)} s` : `no steady beat (median gap ${g.beatS ?? "—"} s, spread ${g.spread ?? "—"} over ${g.gaps} gaps)`}`);
  }
  const row: Record<string, unknown> = { title: spec.title, durationS: f.durationS, drops, chosen: dropS, kind: choice.kind, targetS: spec.targetS, tolS: spec.tolS, errorS: err, pass, lines: plan.lines };
  if (pass === false && spec.targetS != null) {
    misses += 1;
    const near = kickRows(f, kicks, spec.targetS);
    console.log(`  kicks within 4 s of ${fmt(spec.targetS)} (s · kicks/s before → after · mids fall dB · kick band change dB · bass vs loudest 2 s dB):`);
    for (const k of near) console.log(`    ${fmt(k.tS)} · ${k.kicksBeforePerS} → ${k.kicksAfterPerS} · ${k.midsFallDb} · ${k.kickBandChangeDb} · ${k.bassVsLoudestDb}`);
    const grid: { rollRatio: number; midsFallDb: number; chosen: number | null; kind: string }[] = [];
    for (const rollRatio of [0.5, 0.6, 0.7]) {
      for (const midsFallDb of [1, 1.5, 2, 3]) {
        const d = findDrops(f, kicks, { rollRatio, midsFallDb });
        const c = chooseDrop({ drops: d, durationS: f.durationS, kicks });
        grid.push({ rollRatio, midsFallDb, chosen: "dropS" in c ? c.dropS : null, kind: c.kind });
      }
    }
    console.log("  chosen drop by roll ratio × mids fall (report only; the Lab runs 0.6 × 1.5 dB):");
    for (const r of [0.5, 0.6, 0.7]) console.log(`    ${r}: ${grid.filter((g) => g.rollRatio === r).map((g) => `${g.midsFallDb} dB → ${g.chosen != null ? fmt(g.chosen) : "—"}`).join(" · ")}`);
    row.kicksNearTarget = near;
    row.grid = grid;
  }
  if (stemSource) {
    const candidates = detectorCandidates(rmsEnvelope((await readEnvelopes(spec.file)).low, ENVELOPE_RATE));
    const stems = await withTempDir("tt-stem-", async (dir) => {
      const wav = `${dir}/in.wav`;
      await runFfmpegArgs(["-hide_banner", "-nostats", "-y", "-i", spec.file, "-vn", "-ar", "44100", "-ac", "2", wav]);
      return stemSource.stems(wav);
    });
    const ranked = rankOnBassStem(candidates, stems, kicks);
    const top2 = bassStemTop2(candidates, stems, kicks);
    const forced = chooseDrop({ drops: [], durationS: f.durationS, kicks, bassStemTop2: top2 });
    console.log(`  bass stem (${stemSource.name}): ${candidates.length} detector candidates; ranked: ${ranked.slice(0, 5).map((c) => `${fmt(c.tS)} (${c.score.toFixed(2)}, jump ${c.features.bassJump} dB)`).join(", ")}`);
    const fd = "dropS" in forced ? forced.dropS : null;
    console.log(`  fallback if VW14 found nothing: ${fd != null ? fmt(fd) : forced.kind}${fd != null && spec.targetS != null ? ` · error ${(fd - spec.targetS >= 0 ? "+" : "") + (fd - spec.targetS).toFixed(2)} s` : ""}`);
    row.bassStem = { candidates, ranked: ranked.slice(0, 10), top2, fallbackChoice: fd };
  }
  out.push(row);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2));
console.log(misses ? `\n${misses} miss${misses === 1 ? "" : "es"} — reported, not tuned (TK3).` : "\nNo misses.");
