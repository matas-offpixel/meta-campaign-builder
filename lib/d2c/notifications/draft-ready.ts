/**
 * lib/d2c/notifications/draft-ready.ts
 *
 * Minimal notification hook for review-first Bird draft campaigns. When the
 * cron creates a `draft_ready` send it emits one structured log line. No
 * email/webhook yet — Matas checks the dashboard "Drafts awaiting review"
 * counter on /d2c/event/[id].
 */

export interface DraftReadyEvent {
  event_id: string;
  job_type: string;
  bird_campaign_id: string;
  edit_url: string;
}

export function logDraftReady(evt: DraftReadyEvent): void {
  // Structured, greppable. Keep the exact `[d2c draft-ready]` prefix stable —
  // it is the search anchor for ops dashboards / log alerts.
  console.log("[d2c draft-ready]", JSON.stringify(evt));
}
