// scripts/d2c-stats-backfill.mts
//
// HE3: Bird broadcast stats and Mailchimp campaign reports into
// d2c_broadcast_stats (migration 246). Read-only against Bird and
// Mailchimp: GETs only, no PATCH / POST / DELETE, nothing changed.
//
// Dry-run by default: reads the providers and prints counts per account
// (rows by attribution and channel, calls made) and a sample of rows as
// counts only. No database write.
//
//   --apply                write the rows (migration 246 must be applied)
//   --client <uuid>        one client's connections only
//   --provider bird|mailchimp
//   --since YYYY-MM-DD     only sends from this date (default: all history)
//   --nightly              the cron's 56-day window instead of all history
//   --sample N             rows to print per account (default 8)
//   --json FILE            write the dry-run rows (counts, attribution) to FILE
//
// Local-only sources, for a client with no stored connection (needs --client):
//   --env-bird SUFFIX      BIRD_API_KEY_<SUFFIX> + BIRD_WORKSPACE_ID_<SUFFIX>
//   --env-mailchimp VAR    a Mailchimp key in env var VAR
//   --env-only             skip stored connections (no D2C decrypt at all)
//
// Keys are read from the environment or decrypted through
// get_d2c_credentials (D2C_TOKEN_KEY) and never printed.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/d2c-stats-backfill.mts [--apply]

import { writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { parseMailchimpApiKey } from "../lib/d2c/mailchimp/credentials.ts";
import { NIGHTLY_LOOKBACK_DAYS, runD2CStatsIngest } from "../lib/d2c/stats-ingest/run.ts";
import type { D2CStatsSource } from "../lib/d2c/stats-ingest/types.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

const APPLY = has("--apply");
const clientId = arg("--client") ?? null;
const providerArg = arg("--provider");
const provider = providerArg === "bird" || providerArg === "mailchimp" ? providerArg : null;
if (providerArg && !provider) throw new Error("--provider must be bird or mailchimp");
const sinceArg = arg("--since");
const nightly = has("--nightly");
const sampleN = Number(arg("--sample") ?? 8);
const jsonOut = arg("--json");
const envBird = arg("--env-bird");
const envMailchimp = arg("--env-mailchimp");
const envOnly = has("--env-only");

if ((envBird || envMailchimp) && !clientId) throw new Error("--env-bird / --env-mailchimp need --client <uuid>");
if (sinceArg && !/^\d{4}-\d{2}-\d{2}$/.test(sinceArg)) throw new Error("--since must be YYYY-MM-DD");

function extraSources(): D2CStatsSource[] {
  const out: D2CStatsSource[] = [];
  if (envBird) {
    const key = process.env[`BIRD_API_KEY_${envBird}`];
    const ws = process.env[`BIRD_WORKSPACE_ID_${envBird}`];
    if (!key || !ws) throw new Error(`BIRD_API_KEY_${envBird} / BIRD_WORKSPACE_ID_${envBird} not set`);
    out.push({ provider: "bird", accountHint: ws, apiKey: key, clientIds: [clientId!], connectionIds: [`env:BIRD_API_KEY_${envBird}`] });
  }
  if (envMailchimp) {
    const raw = process.env[envMailchimp];
    const parsed = raw ? parseMailchimpApiKey(raw) : null;
    if (!parsed) throw new Error(`${envMailchimp} is not a <key>-<dc> Mailchimp key`);
    out.push({
      provider: "mailchimp",
      accountHint: parsed.serverPrefix,
      serverPrefix: parsed.serverPrefix,
      apiKey: parsed.apiKey,
      clientIds: [clientId!],
      connectionIds: [`env:${envMailchimp}`],
    });
  }
  return out;
}

function pct(n: number | null, d: number | null): string {
  return n != null && d ? `${((n / d) * 100).toFixed(1)}%` : "—";
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const nowMs = Date.now();
  const sinceMs = sinceArg ? Date.parse(`${sinceArg}T00:00:00Z`) : null;
  const windowSince = nightly ? nowMs - NIGHTLY_LOOKBACK_DAYS * 86_400_000 : sinceMs;

  const result = await runD2CStatsIngest(db, {
    apply: APPLY,
    nowMs,
    birdSinceMs: windowSince,
    mailchimpSinceIso: windowSince == null ? null : new Date(windowSince).toISOString(),
    clientId,
    provider,
    extraSources: extraSources(),
    skipStoredConnections: envOnly,
  });

  const { data: events } = await db.from("events").select("id, event_code").in(
    "id",
    [...new Set(result.rows.map((r) => r.event_id).filter((id): id is string => Boolean(id)))].slice(0, 500),
  );
  const codeOf = new Map(((events ?? []) as { id: string; event_code: string | null }[]).map((e) => [e.id, e.event_code ?? e.id]));

  console.log(`${APPLY ? "APPLY" : "DRY RUN (no writes)"} · ${windowSince == null ? "all history" : `since ${new Date(windowSince).toISOString().slice(0, 10)}`}`);
  for (const s of result.skippedConnections) console.log(`skipped connection ${s.connectionId}: ${s.reason}`);
  for (const s of result.sources) {
    console.log(`\n${s.provider} account ${s.accountId} via ${s.connectionIds.join(", ")}`);
    if (s.error) {
      console.log(`  ERROR ${s.error}`);
      continue;
    }
    console.log(`  calls ${s.calls} · rows ${s.rows} · show ${s.byAttribution.show} · client ${s.byAttribution.client} · not tied ${s.byAttribution.not_tied} · unattributed ${s.byAttribution.unattributed} · ticket-holder ${s.ticketHolderRows}`);
    console.log(`  channels ${JSON.stringify(s.byChannel)}`);
    for (const n of s.notes) console.log(`  note: ${n}`);
    const rows = result.rows
      .filter((r) => r.provider === s.provider && r.account_id === s.accountId)
      .sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""))
      .slice(0, sampleN);
    for (const r of rows) {
      const where = r.event_id ? `show ${codeOf.get(r.event_id)}` : r.attribution;
      const counts =
        r.channel === "email"
          ? `delivered ${r.delivered} · opens (bot-filtered) ${r.opens_unique_filtered ?? "est."} · clicks ${r.clicked} (${pct(r.clicked, r.delivered)})`
          : `sent ${r.sent} · delivered ${r.delivered} · read ${r.read} · clicked ${r.clicked} (${pct(r.clicked, r.delivered)})`;
      console.log(`    ${(r.sent_at ?? "").slice(0, 10)} ${r.channel}/${r.audience_kind} ${where}: ${counts}`);
    }
  }
  console.log(`\ntotal: ${result.rows.length} rows · ${result.calls} provider GETs · ${APPLY ? `${result.written} written` : "nothing written"}${result.error ? ` · error ${result.error}` : ""}`);

  if (jsonOut) {
    writeFileSync(
      jsonOut,
      JSON.stringify(
        result.rows.map((r) => ({
          provider: r.provider,
          channel: r.channel,
          attribution: r.attribution,
          event: r.event_id ? codeOf.get(r.event_id) : null,
          audience_kind: r.audience_kind,
          list_id: r.list_id,
          sent_at: r.sent_at,
          sent: r.sent,
          delivered: r.delivered,
          read: r.read,
          clicked: r.clicked,
          opens_unique_filtered: r.opens_unique_filtered,
          open_rate_filtered: r.open_rate_filtered,
        })),
        null,
        1,
      ),
    );
    console.log(`wrote ${jsonOut}`);
  }
  if (!result.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
