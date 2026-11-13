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
 * writes (needs migration 234 and the Gmail delegation). --since YYYY-MM-DD
 * limits to messages received on or after that day.
 *
 * --assume-proposed (dry run only) treats the exact-name proposals in
 * lib/internal-counts/aliases.ts as matched, to show what the backfill
 * writes once Matas matches them. --from-dir DIR (dry run only) reads a
 * local export instead of Gmail: DIR/manifest.json is
 * [{ id, threadId, subject, from, receivedAt, body, pdf }] with pdf a file
 * in DIR (or null). It reads no database, so it runs before migration 234.
 * --no-db (dry run only) reads Gmail but no database: run it before
 * migration 234 is applied. --json FILE writes the summary. The summary ends with every sheet, show
 * and tier where "price equals the column's count" fired.
 *
 * Gmail is read as GMAIL_INGEST_MAILBOX by the Drive service account
 * (GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON) through domain-wide delegation,
 * gmail.readonly only. No key or token is ever printed.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { MessageSummary } from "../lib/gmail/client.ts";
import { PROPOSED_COUNT_ALIASES } from "../lib/internal-counts/aliases.ts";
import { loadRunContext, offlineContext } from "../lib/internal-counts/context.ts";
import { openGmailSession, operatorForMailbox } from "../lib/internal-counts/gmail-session.ts";
import {
  BACKFILL_QUERY,
  gmailSource,
  runInternalCountsPull,
  type MessageSource,
  type PullLine,
  type PullSummary,
} from "../lib/internal-counts/pull.ts";

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
const noDb = flag("--no-db");
const jsonOut = value("--json");
if (apply && (assumeProposed || fromDir || noDb)) {
  console.error("--assume-proposed, --from-dir and --no-db are for dry runs only");
  process.exit(2);
}
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error("--since takes YYYY-MM-DD");
  process.exit(2);
}

function dirSource(dir: string): MessageSource {
  type Entry = { id: string; threadId?: string; subject: string; from: string; receivedAt: string; body: string; pdf: string | null };
  const entries = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Entry[];
  return {
    async list(): Promise<MessageSummary[]> {
      return entries.map((e) => ({
        id: e.id,
        threadId: e.threadId ?? e.id,
        subject: e.subject,
        from: e.from,
        receivedAt: e.receivedAt,
        body: e.body,
        pdfs: e.pdf ? [{ filename: e.pdf, attachmentId: e.pdf }] : [],
      }));
    },
    async pdf(m) {
      const name = m.pdfs[0]?.attachmentId;
      const file = name ? path.join(dir, name) : null;
      return file && existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
    },
  };
}

function lineText(l: PullLine): string {
  const head = `${l.receivedAt.slice(0, 16).replace("T", " ")}  ${l.subject}  (${l.kind})`;
  const r = l.result;
  if (!r) return head;
  const notes = r.reviewItems
    .map((i) => `      · [${i.kind}] ${i.showName ? `${i.showName}: ` : ""}${JSON.stringify(i.detail).slice(0, 160)}`)
    .join("\n");
  if (!r.plan) return `${head}\n    ${r.status}${notes ? `\n${notes}` : ""}`;
  const shows = r.plan.blocks
    .map((b) => `${b.showName} ${b.paid}${b.comps ? `+${b.comps} comps` : ""}${b.status === "write" ? "" : ` (${b.status})`}`)
    .join(", ");
  return `${head}\n    ${r.blocksWritten} written, ${r.blocksHeld} held — ${shows}${notes ? `\n${notes}` : ""}`;
}

function printSummary(s: PullSummary): void {
  console.log("\n## Summary");
  console.log(`messages found: ${s.found}`);
  console.log(`counts read: ${s.counts} (unreadable: ${s.unreadable}); replies stored as notes: ${s.replies}; near misses: ${s.nearMisses}; not ours: ${s.ignored}; already read: ${s.alreadyRead}`);
  console.log(`show blocks ${apply ? "written" : "that would write"}: ${s.blocksWritten}; held: ${s.blocksHeld}`);
  console.log(`review items: ${s.reviewItems}`);
  for (const [kind, n] of Object.entries(s.reviewByKind).sort()) console.log(`  ${kind}: ${n}`);
  console.log(`\n## "Price equals the column's count" firings: ${s.priceFirings.length}`);
  console.log("received | count date | show | tier | price | count | every other check passed");
  for (const f of s.priceFirings) {
    console.log(`${f.receivedAt.slice(0, 10)} | ${f.countDate} | ${f.showName} | ${f.tierName} | £${(f.pricePence / 100).toFixed(2)} | ${f.count} | ${f.otherwiseClean ? "yes" : "no"}`);
  }
}

async function main(): Promise<void> {
  console.log(`# Internal Counts backfill ${apply ? "APPLY" : "DRY RUN — nothing written"}${assumeProposed ? " (proposed aliases treated as confirmed)" : ""}`);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const offline = !!fromDir || noDb;
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
    const session = await openGmailSession();
    if (!session.ok) {
      console.error(`Gmail isn't ready: ${session.reason}`);
      process.exit(2);
    }
    console.log(`Reading ${session.mailbox} (gmail.readonly, delegated), query: ${BACKFILL_QUERY}`);
    source = gmailSource(session.gmail, BACKFILL_QUERY);
    const owner = apply ? await operatorForMailbox(sb, session.mailbox) : null;
    if (apply && !owner) {
      console.error(`No operator account for ${session.mailbox}; the reports need an owner.`);
      process.exit(2);
    }
    userId = owner ?? "dry-run";
  }
  const ctx = offline ? offlineContext(assumeProposed ? PROPOSED_COUNT_ALIASES : undefined) : await loadRunContext(sb);
  const summary = await runInternalCountsPull(sb, ctx, source, {
    userId,
    since,
    dryRun: !apply,
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
            from: l.from,
            kind: l.kind,
            status: l.result?.status ?? null,
            blocks: l.result?.plan?.blocks.map((b) => ({
              show: b.showName,
              countDate: b.countDate,
              paid: b.paid,
              comps: b.comps,
              sinceLast: b.sinceLast,
              ourDelta: b.ourDelta,
              status: b.status,
            })),
            review: l.result?.reviewItems,
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
