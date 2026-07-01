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
  | "cancelled"
  // Bird broadcast draft created; awaiting Matas review + manual fire in Bird UI.
  | "draft_ready";

export type D2CScheduledSendApprovalStatus =
  | "pending_approval"
  | "approved"
  | "rejected";

/**
 * Milestone a scheduled send represents. Persisted to
 * `d2c_scheduled_sends.job_type` (migration 124) and used to build the
 * deterministic idempotency key `${event_id}:${job_type}`.
 */
export type D2CJobType =
  | "announce"
  | "reminder"
  | "community_early"
  | "presale_live"
  | "gen_sale"
  | "autoresp_setup";

export const D2C_JOB_TYPES: readonly D2CJobType[] = [
  "announce",
  "reminder",
  "community_early",
  "presale_live",
  "gen_sale",
  "autoresp_setup",
] as const;

export type D2CBriefIngestSource = "pdf" | "manual";

export type D2CBriefIngestStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed";

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
  live_enabled: boolean;
  approved_by_matas: boolean;
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
  approval_status: D2CScheduledSendApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  job_type: D2CJobType | null;
  idempotency_key: string | null;
  /** Bird draft campaign id (draft_ready broadcast sends only). */
  bird_campaign_id: string | null;
  /** Bird broadcast child id nested under bird_campaign_id (draft_ready only). */
  bird_broadcast_id: string | null;
  /** Deep link into Bird Studio to review/fire the draft campaign. */
  bird_campaign_edit_url: string | null;
  created_at: string;
  updated_at: string;
}

/** Deterministic idempotency key for a milestone send. */
export function buildD2CIdempotencyKey(eventId: string, jobType: D2CJobType): string {
  return `${eventId}:${jobType}`;
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
   * (Non-Mailchimp stubs may still return a live-flag gate until implemented.)
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

/**
 * The three gates that must ALL be true before a live send leaves dry-run:
 * global feature flag + per-connection live_enabled + per-connection
 * approved_by_matas. Shared by every provider (Mailchimp + Bird).
 */
export function d2cDryRunGates(connection: Pick<D2CConnection, "live_enabled" | "approved_by_matas">): {
  featureOff: boolean;
  liveDisabled: boolean;
  notMatasApproved: boolean;
} {
  return {
    featureOff: !isD2CLiveEnabled(),
    liveDisabled: !connection.live_enabled,
    notMatasApproved: !connection.approved_by_matas,
  };
}

export function shouldD2CDryRun(connection: Pick<D2CConnection, "live_enabled" | "approved_by_matas">): boolean {
  const g = d2cDryRunGates(connection);
  return g.featureOff || g.liveDisabled || g.notMatasApproved;
}

// ─── Orchestration: per-event rendered copy (migration 124) ────────────────

/** One rendered copy block for a single milestone. */
export interface D2CRenderedCopyBlock {
  subject?: string | null;
  body_markdown: string;
}

/** copy_jsonb shape: rendered copy keyed by job type. */
export type D2CEventCopyBundle = Partial<Record<D2CJobType, D2CRenderedCopyBlock>>;

export interface D2CEventCopy {
  id: string;
  user_id: string;
  event_id: string;
  client_id: string;
  artwork_url: string | null;
  whatsapp_community_url: string | null;
  copy_jsonb: D2CEventCopyBundle;
  source_brief_job_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Insert shape produced by the brief parser. */
export interface D2CEventCopyInsert {
  artwork_url?: string | null;
  whatsapp_community_url?: string | null;
  copy_jsonb: D2CEventCopyBundle;
}

// ─── Orchestration: brief ingest jobs (migration 125) ──────────────────────

export interface D2CBriefIngestJob {
  id: string;
  user_id: string;
  client_id: string;
  source: D2CBriefIngestSource;
  source_uri: string | null;
  status: D2CBriefIngestStatus;
  result_event_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Brief parser contract ─────────────────────────────────────────────────

/**
 * The event row the parser proposes. Mirrors the `events` table columns the
 * D2C pipeline needs (migration 003). user_id + client_id are filled in by the
 * processor, not the model.
 */
export interface BriefEventInsert {
  name: string;
  venue_name: string;
  venue_city: string;
  venue_country?: string | null;
  event_timezone: string;
  event_date?: string | null;
  event_start_at?: string | null;
  announcement_at?: string | null;
  signup_launch_at?: string | null;
  presale_at: string;
  general_sale_at: string;
  ticket_url: string;
  signup_url?: string | null;
  event_code?: string | null;
  capacity?: number | null;
}

/** One proposed scheduled send (pre-DB-id). */
export interface BriefScheduledSendInsert {
  job_type: D2CJobType;
  channel: D2CChannel;
  scheduled_for: string;
  subject?: string | null;
  body_markdown: string;
}

export interface BriefParseResult {
  event: BriefEventInsert;
  copy: D2CEventCopyInsert;
  scheduled_sends: BriefScheduledSendInsert[];
}

export class BriefValidationError extends Error {
  readonly missingFields: string[];
  constructor(missingFields: string[], message?: string) {
    super(
      message ??
        `Brief is missing required fields: ${missingFields.join(", ")}`,
    );
    this.name = "BriefValidationError";
    this.missingFields = missingFields;
  }
}
