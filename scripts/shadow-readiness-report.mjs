// scripts/shadow-readiness-report.mjs
//
// READ-ONLY. Per armed published campaign, last 7d of
// campaign_automation_decisions. No Live flips. No env changes. No Meta writes.
//
//   node --env-file=.env.local scripts/shadow-readiness-report.mjs
//   node --env-file=.env.local scripts/shadow-readiness-report.mjs --out=docs/session-logs/shadow-readiness-2026-09-05.md

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const OUT_ARG = process.argv.find((a) => a.startsWith("--out="));
const OUT_PATH = OUT_ARG
  ? OUT_ARG.slice("--out=".length)
  : "docs/session-logs/shadow-readiness-2026-09-05.md";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — run with --env-file=.env.local",
  );
}

const CHANGE_ACTIONS = new Set(["scale_up", "scale_down", "pause"]);
const READING_ACTIONS = new Set([
  "scale_up",
  "scale_down",
  "pause",
  "maintain",
  "insufficient_conversions",
]);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function pct(n, d) {
  if (!d) return "0%";
  return `${((100 * n) / d).toFixed(1)}%`;
}

function hoursAgo(iso, now) {
  if (!iso) return null;
  return (now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

function cooldownHoursFor(metric, window) {
  if (window === "7d" || metric === "cpr" || metric === "cpa" || metric === "roas") return 168;
  return 24;
}

function actionCounts(rows) {
  const counts = {};
  for (const row of rows) {
    const action = row.action_recommended ?? "unknown";
    counts[action] = (counts[action] ?? 0) + 1;
  }
  return counts;
}

function largestChange(rows) {
  let best = null;
  for (const row of rows) {
    if (!CHANGE_ACTIONS.has(row.action_recommended)) continue;
    const delta = Number(row.action_delta);
    const before = Number(row.budget_before_pence);
    const after = Number(row.budget_after_pence);
    const absDelta = Number.isFinite(delta)
      ? Math.abs(delta)
      : before
        ? (Math.abs(after - before) / before) * 100
        : 0;
    if (!best || absDelta > best.absDelta) {
      best = {
        absDelta,
        action: row.action_recommended,
        delta: Number.isFinite(delta) ? delta : null,
        before,
        after,
        adsetId: row.adset_id,
        decidedAt: row.decided_at,
      };
    }
  }
  return best;
}

function uniqueTickHours(rows) {
  return new Set(rows.map((row) => new Date(row.decided_at).toISOString().slice(0, 13))).size;
}

function verdict(input) {
  const { mode, enabledRules, live, changePct, readingPct, ticks, lastChangeHours, cooldownH, name } =
    input;
  if (live) {
    return { verdict: "ready", reason: "already Live — this report does not flip it" };
  }
  if (mode === "none" || enabledRules === 0) {
    return {
      verdict: "rules misconfigured",
      reason: mode === "none" ? "optimisation mode is none" : "zero enabled rules",
    };
  }
  if (/Appetite/i.test(name) || /Camelphat/i.test(name)) {
    return {
      verdict: "rules misconfigured",
      reason: "stored Meta id is not the live APPETITE purchase campaign (see #889)",
    };
  }
  if (ticks < 2 || readingPct < 20) {
    return {
      verdict: "not enough evidence",
      reason:
        ticks < 2
          ? "fewer than two ticks with rows in the last 7d"
          : "under 20% of decisions carried a metric reading",
    };
  }
  if (changePct >= 20 && readingPct >= 50 && (lastChangeHours == null || lastChangeHours < cooldownH * 3)) {
    return {
      verdict: "ready",
      reason: "rules present, majority of rows have a reading, and the loop has proposed budget changes",
    };
  }
  return {
    verdict: "not enough evidence",
    reason: "rules present but not enough recent change-proposals with readings",
  };
}

function formatLargest(best) {
  if (!best) return "none";
  const sign = best.delta != null && best.delta > 0 ? "+" : "";
  const delta = best.delta != null ? `${sign}${best.delta}%` : `${best.absDelta.toFixed(1)}%`;
  return `${best.action} ${delta} (${best.before}→${best.after} pence) at ${best.decidedAt}`;
}

async function loadDrafts() {
  const { data, error } = await supabase
    .from("campaign_drafts")
    .select("id, name, draft_json, optimisation_automation_live, optimisation_automation_enabled, status")
    .eq("status", "published")
    .eq("optimisation_automation_enabled", true);
  if (error) throw new Error(`campaign_drafts: ${error.message}`);
  return (data ?? []).map((row) => {
    const draft = row.draft_json ?? {};
    const settings = draft.settings ?? {};
    const strategy = draft.optimisationStrategy ?? {};
    const rules = Array.isArray(strategy.rules) ? strategy.rules : [];
    return {
      draftId: row.id,
      name: settings.campaignName || row.name || draft.metaCampaignId,
      campaignId: draft.metaCampaignId,
      objective: settings.objective ?? null,
      mode: strategy.mode ?? null,
      enabledRules: rules.filter((rule) => rule.enabled).length,
      live: row.optimisation_automation_live === true,
    };
  });
}

async function loadDecisions(sinceISO) {
  const { data, error } = await supabase
    .from("campaign_automation_decisions")
    .select(
      "campaign_id, adset_id, action_recommended, action_delta, budget_before_pence, budget_after_pence, metric, metric_value, metric_window, decided_at, reason_text",
    )
    .gt("decided_at", sinceISO)
    .order("decided_at", { ascending: false });
  if (error) throw new Error(`campaign_automation_decisions: ${error.message}`);
  return data ?? [];
}

function render(now, note, campaigns) {
  const lines = [
    "# Shadow Live-readiness — 2026-09-05",
    "",
    "Read-only. No Live flips. No env changes.",
    "",
    note,
    "",
    `Generated at ${now.toISOString()} from \`campaign_automation_decisions\` (last 7d) and armed \`campaign_drafts\`.`,
    "",
    "| Campaign | decisions | actions | metric coverage | would-change | largest change | cooldown | verdict |",
    "|---|---:|---|---:|---:|---|---|---|",
  ];

  for (const row of campaigns) {
    const actions = Object.entries(row.actions)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join(", ");
    lines.push(
      `| ${row.name} (\`${row.campaignId}\`) | ${row.decisions} | ${actions || "—"} | ${row.readingPct} | ${row.changePct} | ${row.largest} | ${row.cooldown} | **${row.verdict}** — ${row.reason} |`,
    );
  }

  lines.push("", "## Per campaign", "");
  for (const row of campaigns) {
    lines.push(`### ${row.name}`, "");
    lines.push(`- draft \`${row.draftId}\` · Meta \`${row.campaignId}\` · ${row.objective} · mode=${row.mode} · enabled_rules=${row.enabledRules} · Live=${row.live}`);
    lines.push(`- ticks (distinct UTC hours with a row): ${row.ticks}`);
    lines.push(`- first/last row: ${row.firstAt ?? "—"} → ${row.lastAt ?? "—"}`);
    lines.push(`- last CHANGE: ${row.lastChangeAt ?? "none in window"} (${row.lastChangeHours == null ? "—" : `${row.lastChangeHours.toFixed(1)}h ago`}); cooldown floor ${row.cooldownH}h`);
    lines.push("");
  }

  lines.push("## Recommendation", "");
  const ready = campaigns.filter((c) => c.verdict === "ready");
  if (ready.length === 0) {
    lines.push("No campaign is marked ready from this snapshot.");
  } else {
    lines.push(
      `Arm **${ready[0].name}** Live first. ${ready[0].reason} This run did not flip Live or change \`ENABLE_OPTIMISATION_*\`.`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const drafts = await loadDrafts();
  const decisions = await loadDecisions(since);
  const byCampaign = new Map();
  for (const row of decisions) {
    const list = byCampaign.get(row.campaign_id) ?? [];
    list.push(row);
    byCampaign.set(row.campaign_id, list);
  }

  const note =
    "PRs #887 / #888 / #889 have **not** had two post-merge ticks. This report is generated from the decisions that already exist and says so.";

  const campaigns = drafts
    .filter((d) => d.campaignId)
    .map((draft) => {
      const rows = byCampaign.get(draft.campaignId) ?? [];
      const counts = actionCounts(rows);
      const withReading = rows.filter(
        (row) => row.metric_value != null || READING_ACTIONS.has(row.action_recommended),
      ).length;
      // A "reading" is a numeric metric_value. insufficient / maintain-with-reason-no-data do not count.
      const numericReadings = rows.filter((row) => row.metric_value != null).length;
      const wouldChange = rows.filter((row) => CHANGE_ACTIONS.has(row.action_recommended)).length;
      const lastChange = rows.find((row) => CHANGE_ACTIONS.has(row.action_recommended));
      const metric = rows[0]?.metric ?? (draft.objective === "purchase" ? "cpa" : draft.objective === "traffic" ? "lpv_cost" : "cpr");
      const window = rows[0]?.metric_window ?? (metric === "lpv_cost" ? "24h" : "7d");
      const cooldownH = cooldownHoursFor(metric, window);
      const lastChangeHours = hoursAgo(lastChange?.decided_at, now);
      const inCooldown =
        lastChangeHours != null && lastChangeHours < cooldownH
          ? `in cooldown (${lastChangeHours.toFixed(1)}h / ${cooldownH}h)`
          : lastChangeHours == null
            ? "no CHANGE in window"
            : `not in cooldown (last CHANGE ${lastChangeHours.toFixed(1)}h ago)`;
      const ticks = uniqueTickHours(rows);
      const readingPctN = rows.length ? (100 * numericReadings) / rows.length : 0;
      const changePctN = rows.length ? (100 * wouldChange) / rows.length : 0;
      const judged = verdict({
        mode: draft.mode,
        enabledRules: draft.enabledRules,
        live: draft.live,
        changePct: changePctN,
        readingPct: readingPctN,
        ticks,
        lastChangeHours,
        cooldownH,
        name: draft.name,
      });
      return {
        ...draft,
        decisions: rows.length,
        actions: counts,
        readingPct: pct(numericReadings, rows.length),
        changePct: pct(wouldChange, rows.length),
        largest: formatLargest(largestChange(rows)),
        cooldown: inCooldown,
        cooldownH,
        ticks,
        firstAt: rows.at(-1)?.decided_at ?? null,
        lastAt: rows[0]?.decided_at ?? null,
        lastChangeAt: lastChange?.decided_at ?? null,
        lastChangeHours,
        verdict: judged.verdict,
        reason: judged.reason,
        withReading,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const md = render(now, note, campaigns);
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md);
  process.stdout.write(md);
  process.stdout.write(`\n\nWrote ${OUT_PATH}\n`);
}

main();
