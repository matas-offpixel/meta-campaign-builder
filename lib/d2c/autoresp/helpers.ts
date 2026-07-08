/**
 * lib/d2c/autoresp/helpers.ts
 *
 * Pure, dependency-free seams for the webhook/poll-driven autoresponder. No
 * server-only imports so `node --test` can consume them directly (per
 * feedback_node_test_react_server_no_dom + feedback_type_import_pulls_server_secrets_into_client).
 *
 * The autoresponder "config" is stored on
 * `d2c_scheduled_sends.result_jsonb.autoresp_config` (no schema change — the
 * column is jsonb). Arming (approve) flips `enabled=true`; disarm flips it back.
 */

export interface AutorespConfig {
  enabled: boolean;
  armed_at: string | null;
  armed_by: string | null;
}

/** Read the autoresp config off a send's `result_jsonb`. Null when absent. */
export function readAutorespConfig(resultJsonb: unknown): AutorespConfig | null {
  if (!resultJsonb || typeof resultJsonb !== "object") return null;
  const raw = (resultJsonb as Record<string, unknown>).autoresp_config;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  return {
    enabled: obj.enabled === true,
    armed_at: typeof obj.armed_at === "string" ? obj.armed_at : null,
    armed_by: typeof obj.armed_by === "string" ? obj.armed_by : null,
  };
}

/** True when the send has an armed (enabled) autoresponder. */
export function isAutorespArmed(resultJsonb: unknown): boolean {
  return readAutorespConfig(resultJsonb)?.enabled === true;
}

/** Read the last Bird poll cursor off `result_jsonb.autoresp_last_poll_at`. */
export function readAutorespLastPollAt(resultJsonb: unknown): string | null {
  if (!resultJsonb || typeof resultJsonb !== "object") return null;
  const v = (resultJsonb as Record<string, unknown>).autoresp_last_poll_at;
  return typeof v === "string" ? v : null;
}

/**
 * Merge a partial autoresp patch into an existing `result_jsonb`, preserving
 * every other key (metrics, orchestration, etc.). Pure — the caller persists
 * the returned object.
 */
export function mergeAutorespResultJsonb(
  existing: unknown,
  patch: {
    config?: AutorespConfig;
    lastPollAt?: string;
    backfill?: unknown;
  },
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  if (patch.config !== undefined) base.autoresp_config = patch.config;
  if (patch.lastPollAt !== undefined) base.autoresp_last_poll_at = patch.lastPollAt;
  if (patch.backfill !== undefined) base.autoresp_backfill = patch.backfill;
  return base;
}

/**
 * Decide whether to fire the autoresponder for a member. Fires only when the
 * config is armed AND the member has not already been fired (dedup). Pure — the
 * `alreadyFired` flag is resolved by the caller against d2c_autoresp_fires.
 */
export function shouldFireAutoresp(input: {
  config: AutorespConfig | null;
  alreadyFired: boolean;
}): boolean {
  return input.config?.enabled === true && !input.alreadyFired;
}

export type AutorespProvider = "mailchimp" | "bird";

/**
 * Extract the single recipient identifier for a fire from a webhook / contact
 * payload. Mailchimp fires target an email; Bird fires target an E.164 phone.
 * Returns null when the identifier is missing or malformed — the caller skips
 * (never fires to a bad address).
 */
export function resolveAutorespRecipient(
  input: { email?: string | null; phone?: string | null },
  provider: AutorespProvider,
): string | null {
  if (provider === "mailchimp") {
    const email = (input.email ?? "").trim().toLowerCase();
    // Minimal shape check — a full RFC validator is overkill; Mailchimp rejects
    // genuinely bad addresses at send time. We only guard against empty / obvious
    // non-addresses so we never claim a dedup row for junk.
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
    return email;
  }
  return normaliseE164(input.phone);
}

/**
 * Normalise a phone number to E.164 (`+` followed by 8–15 digits). Strips
 * spaces, hyphens, parentheses. Returns null when it can't be coerced into a
 * valid-looking E.164 — Bird identifiers must be E.164.
 */
export function normaliseE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  // Preserve an explicit leading `+`; otherwise assume the digits are already a
  // country-code-prefixed E.164 body (Bird stores identifiers with the `+`).
  return hadPlus ? `+${digits}` : `+${digits}`;
}
