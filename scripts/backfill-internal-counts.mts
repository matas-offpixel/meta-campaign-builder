/**
 * Internal Counts history backfill (D8, HD1): read every Internal Counts
 * email in the connected inbox, oldest first, through the same parser,
 * checks and writes as the hourly pull.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-internal-counts.mts
 *   npx tsx --env-file=.env.local scripts/backfill-internal-counts.mts --since 2026-09-01
 *   npx tsx --env-file=.env.local scripts/backfill-internal-counts.mts --apply
 *   npx tsx scripts/backfill-internal-counts.mts --from-dir DIR --assume-proposed
 *
 * Dry run by default: reads only, writes nothing, and prints every message
 * with what it would write and what would go to the review list. --apply
 * writes (needs migration 234 and a connected Gmail). --since YYYY-MM-DD
 * limits to messages received on or after that day.
 *
 * --assume-proposed (dry run only) treats the exact-name proposals in
 * lib/internal-counts/aliases.ts as confirmed, to show what the backfill
 * writes once Matas confirms them. --from-dir DIR (dry run only) reads a
 * local export instead of Gmail: DIR/manifest.json is
 * [{ id, subject, from, receivedAt, body, pdf }] with pdf a file in DIR
 * (or null). It reads no database, so it runs before migration 234.
 * --json FILE writes the summary.
 *
 * Gmail reads use gmail.readonly only. No token is ever printed.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { MessageSummary } from "../lib/gmail/client.ts";
import { PROPOSED_COUNT_ALIASES } from "../lib/internal-counts/aliases.ts";
import { openGmailSession } from "../lib/internal-counts/gmail-session.ts";
import {
  BACKFILL_QUERY,
  gmailSource,
  runInternalCountsPull,
  type MessageSource,
  type PullLine,
  type PullSummary,
} from "../lib/internal-counts/pull.ts";
import type { DryRunMemory } from "../lib/internal-counts/store.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const apply = flag("--apply");
const assumeProposed = flag("--assume-proposed");
const since = value("--since");
const fromDir = value("--from-dir");
const jsonOut = value("--json");
if (apply && (assumeProposed || fromDir)) {
  console.error("--assume-proposed and --from-dir are for dry runs only");
  process.exit(2);
}
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error("--since takes YYYY-MM-DD");
  process.exit(2);
}

function dirSource(dir: string): MessageSource {
  type Entry = { id: string; subject: string; from: string; receivedAt: string; body: string; pdf: string | null };
  const entries = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Entry[];
  return {
    async list(): Promise<MessageSummary[]> {
      return entries.map((e) => ({
        id: e.id,
        subject: e.subject,
        from: e.from,
        receivedAt: e.receivedAt,
        body: e.body,
        pdfs: e.pdf ? [{ filename: e.pdf, attachmentId: e.pdf }] : [],
      }));
    },
    async pdf(m) {
      const name = m.pdfs[0]?.attachmentId;
      return name ? new Uint8Array(readFileSync(path.join(dir, name))) : null;
    },
  };
}

function lineText(l: PullLine): string {
  const head = `${l.receivedAt.slice(0, 16).replace("T", " ")}  ${l.subject}`;
  if (l.outcome !== "processed" || !l.result?.plan) return `${head}\n    ${l.outcome}`;
  const plan = l.result.plan;
  const shows = plan.blocks
    .map((b) => `${b.showName} ${b.paid}${b.comps ? `+${b.comps} comps` : ""}${b.write ? "" : " (review)"}`)
    .join(", ");
  const notes = plan.reviewItems.map((i) => `      · [${i.kind}] ${i.showName ? `${i.showName}: ` : ""}${i.message}`).join("\n");
  return `${head}\n    ${l.result.blocksWritten} written, ${l.result.blocksInReview} to review — ${shows}${notes ? `\n${notes}` : ""}`;
}

function printSummary(s: PullSummary): void {
  console.log("\n## Summary");
  console.log(`messages found: ${s.found}`);
  console.log(`Internal Counts by subject: ${s.matched}`);
  console.log(`  parsed: ${s.processed}, unreadable or no PDF: ${s.unreadable}, already read: ${s.alreadyRead}`);
  console.log(`blocks ${apply ? "written" : "that would write"}: ${s.blocksWritten}; blocks to review: ${s.blocksInReview}`);
  console.log(`review items: ${s.reviewItems}`);
  for (const [kind, n] of Object.entries(s.reviewByKind).sort()) console.log(`  ${kind}: ${n}`);
  console.log(`skipped (subject isn't Internal Counts): ${s.skippedSubjects.length}`);
  for (const subj of s.skippedSubjects) console.log(`  ${subj}`);
}

async function main(): Promise<void> {
  console.log(`# Internal Counts backfill ${apply ? "APPLY" : "DRY RUN — nothing written"}${assumeProposed ? " (proposed aliases treated as confirmed)" : ""}`);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const offline = !!fromDir;
  if (!offline && (!url || !key)) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or --from-dir)");
    process.exit(2);
  }
  const sb = offline ? (null as never) : createClient(url!, key!, { auth: { persistSession: false } });
  let source: MessageSource;
  let userId = "offline";
  if (fromDir) {
    source = dirSource(fromDir);
  } else {
    const session = await openGmailSession(sb);
    if (!session.ok) {
      console.error(`Gmail isn't ready: ${session.reason}`);
      process.exit(2);
    }
    console.log(`Reading ${session.connection.email} (gmail.readonly), query: ${BACKFILL_QUERY}`);
    source = gmailSource(session.gmail, BACKFILL_QUERY);
    userId = session.connection.user_id;
  }
  const memory: DryRunMemory = { counts: [] };
  const summary = await runInternalCountsPull(sb, source, {
    userId,
    since,
    dryRun: !apply,
    offline,
    memory,
    confirmedAliases: assumeProposed ? PROPOSED_COUNT_ALIASES : undefined,
    onMessage: (l) => console.log(lineText(l)),
  });
  printSummary(summary);
  if (jsonOut) {
    const { lines, ...rest } = summary;
    writeFileSync(
      jsonOut,
      JSON.stringify(
        {
          ...rest,
          messages: lines.map((l) => ({
            id: l.messageId,
            receivedAt: l.receivedAt,
            subject: l.subject,
            outcome: l.outcome,
            blocks: l.result?.plan?.blocks.map((b) => ({
              show: b.showName,
              countDate: b.countDate,
              paid: b.paid,
              comps: b.comps,
              sinceLast: b.sinceLast,
              ourDelta: b.ourDelta,
              write: b.write,
            })),
            review: l.result?.plan?.reviewItems,
          })),
        },
        null,
        2,
      ),
    );
    console.log(`\nWrote ${jsonOut}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
