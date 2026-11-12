/**
 * One draft of a made triple-fit, through renderMadeTripleFit →
 * renderTripleFitClip → TripleFitOnClip on Lambda.
 *
 * Migration 229 is not applied, so no made row exists. The made clip is
 * held in memory: its source is Luke Dean's clip 15, and its event is the
 * event whose approved ladder claim is live. Nothing is written to
 * creative_lab_renders, Storage, or Drive.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/triple-fit-lab-draft.mts --out .scratch/triple-fit-lab-draft
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { deploySite, deleteSite, getOrCreateBucket } from "@remotion/lambda";
import { createClient } from "@supabase/supabase-js";

import { approvedClaim, type WarningRow } from "../lib/creative-lab/claim-approval.ts";
import { REMOTION_REGION } from "../lib/creative-lab/lambda.ts";
import type { ServiceRoleDb } from "../lib/creative-lab/load.ts";
import { renderMadeTripleFit } from "../lib/creative-lab/made-triple-fit.ts";

const SITE = "triple-fit-lab-draft";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
if (argv.some((arg) => ["--apply", "--export", "--upload", "--launch"].includes(arg))) {
  console.error("this script renders local drafts only");
  process.exit(2);
}
const outDir = resolve(flag("--out") ?? "");
if (!flag("--out")) {
  console.error("--out is required");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const event = await db.from("events").select("id, event_code").eq("event_code", "P26-BDAY").maybeSingle();
if (event.error || !event.data) {
  console.error(event.error?.message ?? "P26-BDAY not found");
  process.exit(2);
}
const artist = await db.from("creative_lab_artists").select("id, name").eq("name", "Luke Dean").maybeSingle();
if (artist.error || !artist.data) {
  console.error(artist.error?.message ?? "Luke Dean not found");
  process.exit(2);
}
const source = await db
  .from("creative_lab_clips")
  .select("id, clip_no")
  .eq("artist_id", artist.data.id)
  .eq("clip_no", 15)
  .maybeSingle();
if (source.error || !source.data) {
  console.error(source.error?.message ?? "Luke Dean clip 15 not found");
  process.exit(2);
}

const warnings = await db.from("ticket_warnings").select("id, claim, format, state, approved_by, approved_at, runs_from, runs_to").eq("event_id", event.data.id);
if (warnings.error) {
  console.error(warnings.error.message);
  process.exit(2);
}
const live = approvedClaim((warnings.data ?? []) as WarningRow[], new Date());
if (live.kind !== "approved" || !live.id.startsWith("fda292bd")) {
  console.error(`the live claim is ${live.kind === "approved" ? live.id : "none"}, not fda292bd`);
  process.exit(2);
}
console.log(`source ${source.data.id} clip ${source.data.clip_no} · claim ${live.id.slice(0, 8)} · event ${event.data.event_code}`);

const made = {
  id: "draft-luke-15",
  triple_fit_source_id: source.data.id,
  event_id: event.data.id,
};

function withoutClaims(real: ServiceRoleDb): ServiceRoleDb {
  return {
    from(table: string) {
      if (table !== "ticket_warnings") return real.from(table);
      const empty = {
        select() { return empty; },
        eq() { return empty; },
        in() { return empty; },
        maybeSingle: async () => ({ data: null, error: null }),
        then(onFulfilled?: (value: { data: never[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
        },
      };
      return empty as unknown as ReturnType<ServiceRoleDb["from"]>;
    },
  };
}

const COMP = resolve("node_modules/@remotion/compositor-darwin-arm64");
function still(mp4: string, seconds: number): string {
  const png = mp4.replace(/\.mp4$/, `_${seconds}s.png`);
  const run = spawnSync(join(COMP, "ffmpeg"), ["-y", "-v", "error", "-ss", String(seconds), "-i", mp4, "-frames:v", "1", png], {
    env: { ...process.env, DYLD_LIBRARY_PATH: COMP },
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(run.stderr.slice(-600));
  return png;
}

async function draft(name: string, database: ServiceRoleDb, serveUrl: string): Promise<void> {
  console.log(`rendering ${name}`);
  const started = Date.now();
  const result = await renderMadeTripleFit(database, { clip: made, serveUrl });
  const mp4 = join(outDir, `${name}.mp4`);
  writeFileSync(mp4, result.bytes);
  const shots = [0.5, 4].map((seconds) => still(mp4, seconds));
  console.log(`${name}: ${result.width}x${result.height} ${result.durationSeconds}s · ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log([mp4, ...shots].join("\n"));
}

const { bucketName } = await getOrCreateBucket({ region: REMOTION_REGION });
console.log("deploying the composition site");
const site = await deploySite({
  entryPoint: resolve("src/remotion/index.tsx"),
  bucketName,
  region: REMOTION_REGION,
  siteName: SITE,
});
try {
  await draft("luke-dean-15_lab-no-claim", withoutClaims(db), site.serveUrl);
  await draft("luke-dean-15_lab-roll-call", db, site.serveUrl);
} finally {
  await deleteSite({ bucketName, region: REMOTION_REGION, siteName: SITE });
  console.log(`removed site ${SITE}`);
}
