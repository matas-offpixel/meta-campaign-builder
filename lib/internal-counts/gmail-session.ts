/**
 * lib/internal-counts/gmail-session.ts
 *
 * The mailbox, ready to read: the Drive service account acting as
 * GMAIL_INGEST_MAILBOX through domain-wide delegation (lib/gmail/auth.ts).
 * Shared by the cron, the backfill and the review list's status line.
 *
 * Setup that isn't finished is a reason, not an error: until Matas grants
 * the delegation (or switches the Gmail API on), the cron answers 200 with
 * skippedReason "gmail_not_delegated" and the review list says "Gmail
 * access isn't set up yet". Nothing fails loudly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { delegatedAccountFromEnv, delegatedTokenSource, GmailAccessError, type TokenFetch } from "../gmail/auth.ts";
import { GmailClient, type GmailFetch } from "../gmail/client.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export const NOT_DELEGATED = "gmail_not_delegated";

export type GmailSession =
  | { ok: true; mailbox: string; gmail: GmailClient }
  | { ok: false; reason: string; mailbox: string | null };

/** Maps a setup problem to the cron's skippedReason; anything else is thrown on. */
export function skipReasonFor(err: unknown): string | null {
  if (!(err instanceof GmailAccessError)) return null;
  if (err.problem === "not_delegated") return NOT_DELEGATED;
  if (err.problem === "not_configured") return `not_configured: ${err.message}`;
  return null;
}

export async function openGmailSession(
  env: NodeJS.ProcessEnv = process.env,
  fetchers: { token?: TokenFetch; api?: GmailFetch } = {},
): Promise<GmailSession> {
  let mailbox: string | null = env.GMAIL_INGEST_MAILBOX?.trim() || null;
  try {
    const account = delegatedAccountFromEnv(env);
    mailbox = account.mailbox;
    const token = delegatedTokenSource(account, fetchers.token);
    await token();
    return { ok: true, mailbox: account.mailbox, gmail: new GmailClient(token, fetchers.api) };
  } catch (err) {
    const reason = skipReasonFor(err);
    if (reason) return { ok: false, reason, mailbox };
    throw err;
  }
}

export type GmailStatus = { state: "reading" | "not_set_up" | "unreachable"; mailbox: string | null };

let statusCache: { at: number; status: GmailStatus } | null = null;
const STATUS_TTL_MS = 5 * 60 * 1000;

/**
 * For the review list: "reading" when a read works (a token and the
 * mailbox's profile), "not_set_up" while the delegation or the env isn't
 * there, "unreachable" for anything else. Cached for 5 minutes.
 */
export async function gmailStatus(
  env: NodeJS.ProcessEnv = process.env,
  fetchers: { token?: TokenFetch; api?: GmailFetch } = {},
  now = Date.now(),
): Promise<GmailStatus> {
  if (statusCache && now - statusCache.at < STATUS_TTL_MS) return statusCache.status;
  let status: GmailStatus;
  try {
    const session = await openGmailSession(env, fetchers);
    if (session.ok) {
      await session.gmail.profileEmail();
      status = { state: "reading", mailbox: session.mailbox };
    } else {
      status = { state: "not_set_up", mailbox: session.mailbox };
    }
  } catch (err) {
    const setup = skipReasonFor(err);
    status = { state: setup ? "not_set_up" : "unreachable", mailbox: env.GMAIL_INGEST_MAILBOX?.trim() || null };
  }
  statusCache = { at: now, status };
  return status;
}

export function clearGmailStatusCache(): void {
  statusCache = null;
}

/** The operator account the mailbox belongs to: the reports' owner (RLS). Null when there's none. */
export async function operatorForMailbox(sb: Db, mailbox: string): Promise<string | null> {
  const want = mailbox.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Reading operators failed: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === want);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}
