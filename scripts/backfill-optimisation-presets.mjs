// scripts/backfill-optimisation-presets.mjs
//
// One-time backfill for `client_optimisation_presets` (migration 165).
//
// Of the 14 Optimisation Strategy questions the wizard asks per campaign,
// 13 are client policy. This script reads what each client's published
// campaigns already do and writes it down once, per client x objective, so
// no future campaign has to be asked again.
//
// Per client x objective:
//   - seed from the most recent PUBLISHED campaign with that objective,
//     with its absolute threshold bands re-expressed as MULTIPLIERS of that
//     campaign's own target (so one preset fits every budget);
//   - otherwise seed from the industry benchmarks in lib/optimisation-rules.ts.
//
// Every preset is written with default_arm = 'off'. Recording what a client
// already does must not change what any campaign will do next; arming is a
// per-client decision made in the UI with the ladder visible.
//
// An existing preset is NEVER overwritten — a backfill that clobbered a
// hand-tuned ladder would be worse than not running.
//
// Dry-run by default; prints one table per client. Pass --apply to write.
//
// Usage (needs --experimental-strip-types: the planner is a .ts module so
// the dry run is unit-testable on a fixture):
//   node --env-file=.env.local --experimental-strip-types scripts/backfill-optimisation-presets.mjs
//   node --env-file=.env.local --experimental-strip-types scripts/backfill-optimisation-presets.mjs --apply
//   node --env-file=.env.local --experimental-strip-types scripts/backfill-optimisation-presets.mjs --client=<uuid>
//
// Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

import {
  planPresetBackfill,
  renderBackfillTable,
} from "../lib/optimisation/preset-backfill.ts";

const APPLY = process.argv.includes("--apply");
const CLIENT_ARG = process.argv.find((a) => a.startsWith("--client="));
const ONLY_CLIENT = CLIENT_ARG ? CLIENT_ARG.slice("--client=".length) : null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — run with --env-file=.env.local",
  );
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const OBJECTIVES = new Set([
  "purchase",
  "registration",
  "traffic",
  "awareness",
  "engagement",
]);

async function loadClients() {
  let query = supabase.from("clients").select("id, name, user_id");
  if (ONLY_CLIENT) query = query.eq("id", ONLY_CLIENT);
  const { data, error } = await query;
  if (error) throw new Error(`clients read failed: ${error.message}`);
  return data ?? [];
}

async function loadCampaigns() {
  let query = supabase
    .from("campaign_drafts")
    .select("id, name, client_id, status, updated_at, draft_json")
    .not("client_id", "is", null);
  if (ONLY_CLIENT) query = query.eq("client_id", ONLY_CLIENT);
  const { data, error } = await query;
  if (error) throw new Error(`campaign_drafts read failed: ${error.message}`);

  const rows = [];
  for (const row of data ?? []) {
    const draft = row.draft_json ?? {};
    const objective = draft?.settings?.objective;
    if (!OBJECTIVES.has(objective)) continue;
    rows.push({
      id: row.id,
      name: row.name ?? draft?.settings?.campaignName ?? null,
      clientId: row.client_id,
      objective,
      status: row.status ?? draft?.status ?? "draft",
      updatedAt: row.updated_at ?? draft?.updatedAt ?? "",
      strategy: draft?.optimisationStrategy ?? null,
    });
  }
  return rows;
}

async function loadExisting() {
  let query = supabase
    .from("client_optimisation_presets")
    .select("id, client_id, objective, version");
  if (ONLY_CLIENT) query = query.eq("client_id", ONLY_CLIENT);
  const { data, error } = await query;
  if (error) {
    // Migration 165 unapplied is a legitimate dry-run state: every pair is
    // reported as a write. It is NOT a legitimate --apply state.
    const missing =
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      /client_optimisation_presets/i.test(error.message ?? "");
    if (!missing) throw new Error(`presets read failed: ${error.message}`);
    if (APPLY) {
      throw new Error(
        "client_optimisation_presets does not exist — apply migration 165 before --apply",
      );
    }
    console.log("! migration 165 not applied — dry run only\n");
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    clientId: row.client_id,
    objective: row.objective,
    version: row.version,
    defaultArm: "off",
    mode: "benchmarks",
    rules: [],
    guardrails: { maxExpansionPercent: 100, ceilingBehaviour: "stop" },
    updatedAt: null,
  }));
}

async function main() {
  const [clientRows, campaigns, existing] = await Promise.all([
    loadClients(),
    loadCampaigns(),
    loadExisting(),
  ]);

  const userIdByClient = new Map(clientRows.map((c) => [c.id, c.user_id]));
  const plan = planPresetBackfill({
    clients: clientRows.map((c) => ({ id: c.id, name: c.name ?? c.id })),
    campaigns,
    existing,
  });

  console.log(renderBackfillTable(plan));
  console.log("");

  if (!APPLY) {
    console.log(`Dry run. Re-run with --apply to write ${plan.writes} preset(s).`);
    return;
  }

  let written = 0;
  const failures = [];
  for (const row of plan.rows) {
    if (!row.willWrite) continue;
    const userId = userIdByClient.get(row.clientId);
    if (!userId) {
      failures.push(`${row.clientName} / ${row.objective}: client has no user_id`);
      continue;
    }
    const { error } = await supabase.from("client_optimisation_presets").insert({
      user_id: userId,
      client_id: row.clientId,
      objective: row.objective,
      version: 1,
      default_arm: row.defaultArm,
      mode: row.mode,
      rules: row.rules,
      guardrails: row.guardrails,
    });
    if (error) {
      failures.push(`${row.clientName} / ${row.objective}: ${error.message}`);
      continue;
    }
    written += 1;
  }

  console.log(`Wrote ${written} preset(s).`);
  for (const failure of failures) console.error(`  x ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
