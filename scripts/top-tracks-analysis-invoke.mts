/**
 * One test call to the Top tracks analysis host, by hand, after
 * scripts/top-tracks-analysis-deploy.mts. It signs the Lab's Storage copy of
 * one audio file (a read: no database row or Storage object is written),
 * invokes the function as the app would (the Remotion IAM user's keys), and
 * writes the analysis to --out in the shape PR #1342's
 * scripts/top-tracks-acceptance.mts reads with --analysis-json.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/top-tracks-analysis-invoke.mts \
 *     --storage-path audio/creative-lab/<event id>/<drive file id>.mp3 \
 *     --modified-time <Drive modifiedTime, or "unknown"> --out /tmp/cant-decide-analysis.json
 *
 * Prints the handler's timings and Lambda's REPORT line (billed duration,
 * peak memory, cold start), and the call's cost at 4 GB arm64. The signed
 * URL is never printed.
 */

import { writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { costPerCallUsd } from "../lib/creative-tests/top-tracks/analysis-host-plan.ts";
import { invokeTopTracksAnalysis, validateAnalysisRequest } from "../lib/creative-tests/top-tracks/lambda-analysis.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const storagePath = flag("--storage-path");
const modified = flag("--modified-time") ?? "unknown";
const out = flag("--out");
const bucket = flag("--bucket") ?? "campaign-assets";
if (!storagePath || !out) throw new Error("--storage-path audio/creative-lab/<event>/<drive id>.<ext> --modified-time <iso|unknown> --out <file.json>");

const driveId = storagePath.slice(storagePath.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
const key = `${driveId}@${modified}`;
validateAnalysisRequest({ key, storagePath });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set (--env-file=.env.local)");
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const started = Date.now();
const reply = await invokeTopTracksAnalysis(
  { key, storagePath },
  {
    // This run is the test call itself, so the app's flag is on for it alone.
    env: { ...process.env, ENABLE_TOP_TRACKS_ANALYSIS: "1" },
    tail: true,
    sign: async (p) => {
      const { data, error } = await db.storage.from(bucket).createSignedUrl(p, 15 * 60);
      if (error || !data?.signedUrl) throw new Error(`storage sign: ${error?.message ?? "no url"}`);
      return data.signedUrl;
    },
  },
);
const wallS = (Date.now() - started) / 1000;
writeFileSync(out, JSON.stringify(reply.analysis));

const report = reply.logTail?.split("\n").find((l) => l.startsWith("REPORT")) ?? "";
const billedMs = Number(/Billed Duration: (\d+) ms/.exec(report)?.[1] ?? NaN);
console.log(`key ${reply.key}`);
console.log(`wall ${wallS.toFixed(1)} s · handler ${JSON.stringify(reply.timingsS)}`);
console.log(`track ${reply.analysis.durationS.toFixed(2)} s · ${reply.analysis.beats.length} beats · ${reply.analysis.downbeats.length} downbeats · JSON ${JSON.stringify(reply.analysis).length} bytes`);
if (report) console.log(report.trim());
if (Number.isFinite(billedMs)) console.log(`cost $${costPerCallUsd(billedMs / 1000).toFixed(4)} (billed ${(billedMs / 1000).toFixed(1)} s at 4 GB arm64)`);
console.log(`wrote ${out}: run PR #1342's scripts/top-tracks-acceptance.mts --analysis-json ${out} --track "Can't Decide=<local file>@2:07.5±0.5"`);
