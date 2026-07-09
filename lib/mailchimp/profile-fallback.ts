/**
 * Pure, dependency-injected logic for the Mailchimp classic-webhook
 * "profile-update fallback" path — extracted out of the route handler
 * (`app/api/webhooks/mailchimp/[clientId]/[audienceId]/route.ts`) so it's
 * unit-testable without pulling in `next/server` or `@/`-aliased Supabase
 * clients, neither of which resolve under Node's native test runner
 * (`node --experimental-strip-types`, no path-alias support).
 *
 * Covers `profile` / `upemail` / `cleaned` (the original set) plus
 * `subscribe` / `unsubscribe` (2026-07-08 fix): Mailchimp fires `subscribe`
 * — never `tag_added` — when a member is created with a tag already applied
 * via the API (e.g. Evntree pushing a new signup), so that event type must
 * also route through the tag re-fetch + diff rather than the catch-all
 * "ignored" branch. All five event types carry the member's email under
 * `data[email]` (`data[new_email]` for `upemail`) — verified against
 * Mailchimp's webhook payload docs, not `data[merges][EMAIL]`.
 *
 * 2026-07-09 pivot (PR #704): this path is now **tag-tracking only**. The
 * email autoresponder is delivered by a Mailchimp Customer Journey
 * (`trigger-tag_added` step), not by a per-fire send from this webhook — so
 * `runProfileFallback` no longer fires anything. It re-fetches + reconciles
 * the member's tags (keeping `mailchimp_tag_event_log` accurate for signup
 * counting) and returns the diff result verbatim.
 */

const PROFILE_FALLBACK_EVENT_TYPES = new Set([
  "profile",
  "upemail",
  "cleaned",
  "subscribe",
  "unsubscribe",
]);

export function isProfileFallbackEventType(type: string | null): boolean {
  return type !== null && PROFILE_FALLBACK_EVENT_TYPES.has(type);
}

/** Mirrors the route's `data[new_email]` → `data[email]` precedence. */
export function extractProfileFallbackEmail(get: (key: string) => string | null): string {
  return get("data[new_email]") || get("data[email]") || "";
}

export interface HandleProfileUpdateResult {
  ok: boolean;
  reconciled: number;
  addedEventIds: string[];
  error?: string;
}

export type HandleProfileUpdateFn<TSupabase> = (
  supabase: TSupabase,
  clientId: string,
  audienceId: string,
  email: string,
) => Promise<HandleProfileUpdateResult>;

export interface ProfileFallbackDeps<TSupabase> {
  handleProfileUpdate: HandleProfileUpdateFn<TSupabase>;
}

export interface ProfileFallbackResponse {
  mode: "profile_update";
  ok: boolean;
  reconciled: number;
  addedEventIds: string[];
  error?: string;
}

/**
 * Runs the profile-update fallback: re-fetch + diff the member's tags via
 * `handleProfileUpdate` and return the result verbatim. Tag-tracking only —
 * no autoresponder fire (2026-07-09 pivot, PR #704: the email autoresp is a
 * Mailchimp Customer Journey now). `addedEventIds` is still surfaced so the
 * response shape is stable for anything reading it, but nothing acts on it
 * here.
 */
export async function runProfileFallback<TSupabase>(
  supabase: TSupabase,
  clientId: string,
  audienceId: string,
  email: string,
  deps: ProfileFallbackDeps<TSupabase>,
): Promise<ProfileFallbackResponse> {
  const result = await deps.handleProfileUpdate(supabase, clientId, audienceId, email);

  return {
    mode: "profile_update",
    ...result,
  };
}
