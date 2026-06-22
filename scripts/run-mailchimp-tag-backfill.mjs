// scripts/run-mailchimp-tag-backfill.mjs
//
// One-time / on-demand driver for the resumable Mailchimp tag backfill.
// Fires POST /tag-backfill/start for one or more events, then polls
// /tag-backfill/status every 30s and prints progress until each completes.
//
// The actual work is done by the per-minute `mailchimp-backfill-tick` cron;
// this script just kicks the job and watches it. Safe to re-run — the start
// endpoint dedupes against an in-progress job.
//
// Run with (defaults to IRWOHD + Camelphat):
//   node --env-file=.env.local scripts/run-mailchimp-tag-backfill.mjs
//
// Or pass explicit event IDs:
//   node --env-file=.env.local scripts/run-mailchimp-tag-backfill.mjs <eventId> [<eventId> ...]
//
// Requires env: CRON_SECRET, plus APP_BASE_URL (or NEXT_PUBLIC_APP_URL /
// VERCEL_URL). Defaults base to https://app.offpixel.co.uk.

const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  throw new Error("Missing CRON_SECRET");
}

const BASE = (
  process.env.APP_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
  "https://app.offpixel.co.uk"
).replace(/\/$/, "");

// Default targets per the PR brief.
const DEFAULT_EVENTS = [
  { id: "68535c85-0000-0000-0000-000000000000", label: "IRWOHD (replace with real id)" },
  { id: "14d55718-0000-0000-0000-000000000000", label: "Camelphat (replace with real id)" },
];

const argIds = process.argv.slice(2);
const targets =
  argIds.length > 0
    ? argIds.map((id) => ({ id, label: id }))
    : DEFAULT_EVENTS;

const authHeaders = { Authorization: `Bearer ${CRON_SECRET}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startBackfill(eventId) {
  const res = await fetch(`${BASE}/api/events/${eventId}/mailchimp/tag-backfill/start`, {
    method: "POST",
    headers: authHeaders,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function getStatus(eventId) {
  const res = await fetch(`${BASE}/api/events/${eventId}/mailchimp/tag-backfill/status`, {
    headers: authHeaders,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function runOne({ id, label }) {
  console.log(`\n=== ${label} (${id}) ===`);
  const started = await startBackfill(id);
  console.log(`start → HTTP ${started.status}`, JSON.stringify(started.json));

  // Poll until status reports completed/failed (or no job).
  for (;;) {
    await sleep(30_000);
    const { status, json } = await getStatus(id);
    const job = json?.job ?? null;
    if (!job) {
      console.log(`status → HTTP ${status} no job found; aborting watch`);
      return "no_job";
    }
    const state = job.status ?? "unknown";
    const pct = job.percentComplete ?? "?";
    const processed = job.membersProcessed ?? "?";
    const total = job.totalMembers ?? "?";
    console.log(`status → HTTP ${status} state=${state} ${pct}% (${processed}/${total})`);
    if (state === "completed" || state === "failed" || status === 404) {
      console.log(`done: ${label} → ${state}`);
      return state;
    }
  }
}

async function main() {
  console.log(`Backfill driver → base=${BASE}`);
  for (const target of targets) {
    try {
      await runOne(target);
    } catch (err) {
      console.error(`error for ${target.label}:`, err?.message ?? err);
    }
  }
  console.log("\nAll targets processed.");
}

main();
