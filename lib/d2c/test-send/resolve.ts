/**
 * lib/d2c/test-send/resolve.ts
 *
 * Pure helpers for the email "Send test to me" fire (bug fix:
 * fix(d2c/test-send)). No imports beyond types — safe to unit-test without a
 * database or network.
 *
 * Content resolution mirrors what the dashboard preview shows (send-preview.tsx):
 * prefer the per-milestone rendered copy (`d2c_event_copy.copy_jsonb[job_type]`),
 * fall back to the send's own template. This guarantees "what you preview is
 * what the test arrives as" even though the live cron send path (legacy
 * branch, app/api/cron/d2c-send/route.ts) currently reads the template only —
 * in practice the two are populated identically at brief-ingest time.
 */

import type { D2CEventCopyBundle, D2CJobType } from "../types.ts";

export interface TestSendContentInput {
  jobType: D2CJobType | null;
  copyBundle: D2CEventCopyBundle | null | undefined;
  templateSubject: string | null;
  templateBodyMarkdown: string | null;
}

export interface ResolvedTestSendContent {
  /** Already prefixed with "[TEST] ". */
  subject: string;
  bodyMarkdown: string;
}

/** Returns null when there is no content to send at all (empty template + empty copy). */
export function resolveTestSendContent(
  input: TestSendContentInput,
): ResolvedTestSendContent | null {
  const copyBlock = input.jobType ? input.copyBundle?.[input.jobType] ?? null : null;
  const bodyMarkdown = copyBlock?.body_markdown || input.templateBodyMarkdown || "";
  if (!bodyMarkdown.trim()) return null;

  const rawSubject = copyBlock?.subject ?? input.templateSubject ?? null;
  const subject = `[TEST] ${rawSubject && rawSubject.trim() ? rawSubject.trim() : "(no subject)"}`;
  return { subject, bodyMarkdown };
}

/**
 * Build the audience descriptor for a single-recipient test send: reuses the
 * send's real audience (list_id, from_name, reply_to) but targets ONLY the
 * caller-provided ephemeral static segment and fires immediately. Never
 * targets the send's real tag/tags — a test must reach exactly one inbox.
 */
export function buildTestEmailAudience(
  baseAudience: Record<string, unknown>,
  opts: { listId: string; savedSegmentId: number; sendId: string; nowMs: number },
): Record<string, unknown> {
  const audience: Record<string, unknown> = {
    ...baseAudience,
    list_id: opts.listId,
    saved_segment_id: opts.savedSegmentId,
    send_now: true,
    campaign_title: `test-${opts.sendId}-${opts.nowMs}`,
  };
  delete audience.tags;
  delete audience.tag;
  return audience;
}
