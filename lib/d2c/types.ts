/**
 * lib/d2c/types.ts
 *
 * Provider-agnostic surface for D2C comms (email, SMS, WhatsApp).
 * Mirrors `lib/ticketing/types.ts` so the dashboard reasons about both
 * pipelines the same way.
 *
 * v1 SAFETY: every provider implementation is gated behind
 * `FEATURE_D2C_LIVE`. When the flag is off (default), `send` returns
 * `{ ok: true, dryRun: true, ... }` and logs a `[DRY RUN]` line; nothing
 * hits the wire. This is enforced at the provider layer (not the route)
 * so even a manual call from a test script can't accidentally send.
 */

export type D2CProviderName =
  | "mailchimp"
  | "klaviyo"
  | "bird"
  | "firetext";

export type D2CChannel = "email" | "sms" | "whatsapp";

export type D2CConnectionStatus = "active" | "paused" | "error";

export type D2CScheduledSendStatus =
  | "scheduled"
  | "sent"
  | "failed"
  | "cancelled";

export interface D2CConnection {
  id: string;
  user_id: string;
  client_id: string;
  provider: D2CProviderName;
  credentials: Record<string, unknown>;
  external_account_id: string | null;
  status: D2CConnectionStatus;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface D2CTemplate {
  id: string;
  user_id: string;
  client_id: string | null;
  name: string;
  channel: D2CChannel;
  subject: string | null;
  body_markdown: string;
  variables_jsonb: string[];
  created_at: string;
  updated_at: string;
}

export interface D2CScheduledSend {
  id: string;
  user_id: string;
  event_id: string;
  template_id: string;
  connection_id: string;
  channel: D2CChannel;
  audience: Record<string, unknown>;
  variables: Record<string, unknown>;
  scheduled_for: string;
  status: D2CScheduledSendStatus;
  result_jsonb: unknown;
  dry_run: boolean;
  created_at: string;
  updated_at: string;
}

export interface ValidateD2CCredentialsResult {
  ok: boolean;
  error?: string;
  externalAccountId?: string | null;
}

/**
 * Provider-side message payload. Producer-friendly shape — converted
 * into the provider's wire format inside the implementation.
 */
export interface D2CMessage {
  channel: D2CChannel;
  /**
   * Subject line for email; ignored by SMS / WhatsApp.
   */
  subject?: string | null;
  /**
   * Markdown body. Providers are responsible for rendering to their
   * preferred format (HTML for email, plain text for SMS, WhatsApp
   * template parameters for WA).
   */
  bodyMarkdown: string;
  /**
   * Audience descriptor — provider-specific shape lives behind a free
   * record for v1. Examples in the migration 030 column comment.
   */
  audience: Record<string, unknown>;
  /**
   * Variables substituted into the markdown at send time.
   */
  variables: Record<string, unknown>;
  /**
   * Optional internal correlation id — providers that support an
   * idempotency key can use this to dedupe.
   */
  correlationId?: string | null;
}

export interface SendResult {
  /**
   * `true` if the provider accepted the request (or, for the dry-run
   * path, if the dry-run logger ran cleanly). Per-recipient delivery
   * outcomes live in `details`.
   */
  ok: boolean;
  /**
   * `true` when the provider short-circuited because
   * `FEATURE_D2C_LIVE=false`. Persisted onto
   * `d2c_scheduled_sends.dry_run` so the dashboard surfaces a badge.
   */
  dryRun: boolean;
  /**
   * Provider-side identifier for the send (Mailchimp campaign id,
   * Klaviyo flow message id, etc.). Optional — not every provider
   * returns one.
   */
  providerJobId?: string | null;
  /**
   * Free-form provider response. Persisted onto
   * `d2c_scheduled_sends.result_jsonb` — never read by app code.
   */
  details?: unknown;
  /**
   * Friendly error message when `ok === false`.
   */
  error?: string;
}

export interface D2CProvider {
  readonly name: D2CProviderName;
  /**
   * Validate the credentials blob against the provider's identity
   * endpoint. Used by the connections route before storing the row.
   * In dry-run mode (flag off), returns `{ ok: false, error: "..." }`
   * with a clear "live mode disabled" message — there is no point
   * pretending bad credentials are good.
   */
  validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<ValidateD2CCredentialsResult>;
  /**
   * Send (or dry-run) a single message. Implementations MUST short-
   * circuit when `FEATURE_D2C_LIVE` is off and return
   * `{ ok: true, dryRun: true, ... }`.
   */
  send(connection: D2CConnection, message: D2CMessage): Promise<SendResult>;
}

export class D2CProviderDisabledError extends Error {
  readonly providerName: D2CProviderName;
  constructor(providerName: D2CProviderName, message: string) {
    super(message);
    this.name = "D2CProviderDisabledError";
    this.providerName = providerName;
  }
}

export class NotYetImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotYetImplementedError";
  }
}

export function isD2CLiveEnabled(): boolean {
  const v = process.env.FEATURE_D2C_LIVE?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}
