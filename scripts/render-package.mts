/**
 * M4a's local package runner: one montage package for one show, rendered on
 * the separate montage Lambda site and filed in the show's Drive tree, with
 * a creative_lab_renders row per file. No Meta upload, ever: nothing here
 * imports a Meta write path.
 *
 * Dry run (the default) reads only: the show, the picks and their owners,
 * the track and its beat grid (read from the Storage copy, not saved), the
 * cut plan, and every file's name and rights. It writes nothing anywhere.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/render-package.mts --event P26-BDAY
 *
 * --apply renders. It needs the montage site's serve URL (from
 * scripts/remotion-lambda-deploy.mts --site m4-montage-…) and Matas's yes,
 * word for word, which is stored on the package as its approval (RY1) and
 * shows on Today:
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/render-package.mts --event P26-BDAY --apply \
 *     --serve-url "https://remotionlambda-euwest2-….s3.eu-west-2.amazonaws.com/sites/m4-montage-…/index.html" \
 *     --asked "the question exactly as asked" --answer "his reply exactly"
 *
 * The package's files start as rendering (held for this runner), so neither
 * the cron's package step nor a caption tick claims them; the runner renders
 * all nine side by side, files each one as it finishes, runs the checks,
 * settles the package and prints RT3's finished lines. One package at a time
 * per show and the 60 s guard apply here too.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, the REMOTION_AWS_*
 * credentials, GOOGLE_DRIVE_EXPORT_DRIVE_ID and GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON.
 * Migration 270 must be applied. Prints counts, names and links only.
 */

import { createClient } from "@supabase/supabase-js";

import { badgeLine, fileRights } from "../lib/render-templates/rights.ts";
import { beatGrid } from "../lib/render-templates/beats.ts";
import { driveFromEnv } from "../lib/drive/client.ts";
import { londonToday } from "../lib/drive/tree.ts";
import { foreignPicks, loadPackageState } from "../lib/render-templates/load.ts";
import { cutSheetText, isRefusal, planMontage } from "../lib/render-templates/montage-plan.ts";
import { packageFiles, packageOwner, pickedClips, pickedTrack, refusalFor, requestLines } from "../lib/render-templates/package-view.ts";
import { doneLines, type RenderFileRow } from "../lib/render-templates/report.ts";
import { startDeps, workerDeps } from "../lib/render-templates/server-deps.ts";
import { montageText, requestPackage } from "../lib/render-templates/start.ts";
import { fileNameFor } from "../lib/render-templates/store.ts";
import { renderPackageFile } from "../lib/render-templates/worker.ts";
import { settlePackages } from "../lib/render-templates/store.ts";

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? String(process.argv[i + 1] ?? "") : null;
};
const apply = process.argv.includes("--apply");
const code = (arg("--event") ?? "").trim().toUpperCase();
if (!code) throw new Error("--event CODE is required");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed");
const db = createClient(url, key, { auth: { persistSession: false } });

const now = new Date();
const today = londonToday(now);
const events = await db.from("events").select("id, user_id, event_code").eq("event_code", code);
if (events.error) throw new Error(`events: ${events.error.message}`);
if ((events.data ?? []).length !== 1) throw new Error(`${(events.data ?? []).length} events with code ${code}; expected exactly one`);
const event = events.data![0] as { id: string; user_id: string; event_code: string };

const deps = startDeps(db);
const loaded = await loadPackageState(db, event.id, deps, now, today);
if (!loaded) throw new Error(`${code}: no state (archived client?)`);

console.log(requestLines(loaded.state, ["montage"]).join("\n"));
const clips = pickedClips(loaded.state);
console.log(`\nPicks (${clips.length}):`);
for (const c of clips) console.log(`  ${c.name} · ${c.owner === "promoter" ? `filmed by ${c.clientName}` : `${c.artistName}'s (shareable)`}`);
const held = loaded.clips.all.filter((c) => !c.usable).length;
console.log(`Not offered: ${held} clips that stay with another client.`);
const foreign = foreignPicks(loaded.clips.all, clips.map((c) => c.id));
if (foreign.length) throw new Error("a pick is another client's footage; nothing was rendered");

if (!apply) {
  const refusal = refusalFor({ approval: true, recipes: ["montage"], state: loaded.state, picks: {}, foreignPromoter: [], copy: { voice: "promoter", approvedCaption: true, artist: null } });
  if (refusal) {
    console.log(`\nWould be refused: ${refusal.text}`);
    process.exit(0);
  }
  const track = pickedTrack(loaded.state)!;
  const row = loaded.tracks.find((t) => t.id === track.id)!;
  const grid = row.beatGrid ?? beatGrid(await deps.readLowPcm(row.storagePath!), track.dropS!, { durationS: track.durationS ?? undefined });
  const plan = planMontage({
    grid,
    drop: { trackS: track.dropS!, source: track.dropSource ?? "lab" },
    trackName: track.name,
    clips: clips.map((c) => ({ id: c.id, name: c.name, owner: c.owner, isHeadliner: c.isHeadliner, inS: c.inS, outS: c.outS })),
    text: montageText(loaded, undefined),
  });
  if (isRefusal(plan)) {
    console.log(`\nWould be refused: the plan says ${plan.refused}`);
    process.exit(0);
  }
  console.log(`\nCut plan (announcement; teaser and no text share the cuts):\n${cutSheetText(plan.sheet, "announcement")}`);
  const owner = packageOwner(loaded.state)!;
  console.log(`Files (round to be set at start; shown as r1):`);
  for (const f of packageFiles()) {
    const name = fileNameFor({ eventCode: loaded.facts.code, owner, recipe: "montage", variant: f.variant, stage: loaded.facts.stage, round: 1, ratio: f.ratio });
    const badge = badgeLine(fileRights(owner, f.variant !== "no-text", loaded.facts.clientId), loaded.facts.clientName);
    console.log(`  ${name} · ${badge.badge}${badge.why ? ` · ${badge.why}` : ""}`);
  }
  console.log("\nDry run: nothing was rendered, stored or filed.");
  process.exit(0);
}

// ─── --apply ─────────────────────────────────────────────────────────────────
const serveUrl = (arg("--serve-url") ?? "").trim();
if (!/^https:\/\/remotionlambda-euwest2-[a-z0-9]+\.s3\.eu-west-2\.amazonaws\.com\/sites\/m4-montage-[a-z0-9-]+\/index\.html$/.test(serveUrl)) {
  throw new Error("--serve-url must be the montage site's URL (…/sites/m4-montage-…/index.html), never the caption site");
}
const asked = (arg("--asked") ?? "").trim();
const answer = (arg("--answer") ?? "").trim();
if (!asked || !answer) throw new Error("--asked and --answer are Matas's question and his yes, word for word; nothing was rendered");
const { drive, reason } = driveFromEnv();
if (!drive) throw new Error(`Drive: ${reason}; nothing was rendered`);

const started = await requestPackage(db, deps, { userId: event.user_id, eventId: event.id, recipes: ["montage"], source: "claude", approval: { asked, answer }, now, today, hold: true });
if (!started.ok) {
  console.log(started.refusal.text);
  process.exit(1);
}
console.log(`\n${started.started}`);
const rows = await db.from("creative_lab_renders").select("*").eq("package_id", started.packageId);
if (rows.error) throw new Error(`creative_lab_renders: ${rows.error.message}`);
const worker = workerDeps(db, drive, () => new Date(), serveUrl);
const results = await Promise.all(
  ((rows.data ?? []) as Record<string, unknown>[]).map(async (r) => {
    const out = await renderPackageFile(db, worker, r);
    console.log(`  ${String(r.file_name)} · ${out}`);
    return out;
  }),
);
await settlePackages(db, new Date());
const files = await db.from("creative_lab_renders").select("id, file_name, status, round_no, recipe, rights_shareable, rights_held_reason, checks, drive_file_id").eq("package_id", started.packageId).order("file_name");
const fileRows: RenderFileRow[] = ((files.data ?? []) as Record<string, unknown>[]).map((r) => ({
  id: String(r.id),
  fileName: String(r.file_name),
  status: String(r.status) as RenderFileRow["status"],
  round: Number(r.round_no ?? 1),
  recipe: "montage",
  shareable: r.rights_shareable === true,
  heldReason: (r.rights_held_reason ?? null) as RenderFileRow["heldReason"],
  checks: r.checks ? { passed: (r.checks as { passed?: boolean }).passed === true, failed: ((r.checks as { failed?: string[] }).failed ?? []) as never } : null,
  driveFileId: r.drive_file_id == null ? null : String(r.drive_file_id),
}));
console.log(`\n${doneLines(loaded.facts.code, fileRows, loaded.facts.clientName).join("\n")}`);
console.log(`\npackage ${started.packageId} · ${results.filter((r) => r === "done").length} rendered · ${results.filter((r) => r === "failed").length} didn't`);
