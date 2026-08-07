/**
 * lib/notify/slack.ts
 *
 * Task #121 Phase 1 — the one reusable Slack notification service every
 * future alert (budget pacing here in Phase 2, then task #120's automation
 * pings, a Monday digest, urgent blockers, per-event lifecycle...) calls
 * into. Zero proactive alerting exists today; this is the seam every later
 * phase plugs into rather than each growing its own webhook-posting code.
 *
 * `notify()` takes an explicit `NotifyDeps` bag rather than reaching for
 * Supabase/`fetch` itself — same pure-core split as
 * `lib/optimisation/tick-runner.ts`'s `runOptimisationTick`. This file has
 * NO `@/` imports so it stays exercisable by the `node --test` runner
 * (which cannot resolve path aliases); the Supabase-backed dedupe store
 * lives in `lib/db/notification-dedupe.ts` and is wired together with the
 * real `fetch`-based webhook poster in `lib/notify/slack-deps.ts` (the only
 * file in this directory allowed to import `@/`), which the cron route (or
 * any future caller) uses to build `NotifyDeps` once per invocation.
 *
 * Design principle (task #121 brief): fail open. A notification failure —
 * missing webhook, Slack returning a 500, a dedupe-store error — must never
 * throw out of `notify()` and break the calling cron. Every failure mode
 * returns `{ sent: false, reason }` instead.
 */

import { isBusinessHours } from "./business-hours.ts";

export type SlackChannel = "ads_ops" | "ads_urgent" | "ads_automation";

export interface NotifyOptions {
  channel: SlackChannel;
  /** Slack markdown-flavoured fallback text (used for notification previews and as the whole payload if `blocks` is omitted). */
  text: string;
  /** Optional Slack Block Kit blocks for a richer message. */
  blocks?: unknown[];
  /** When set, `notify()` consults `notification_dedupe_state` before firing — see module doc comment. */
  dedupeKey?: string;
  /** How long a fired `dedupeKey` suppresses a repeat. Default 24h. */
  dedupeWindowMs?: number;
  /**
   * Gate delivery to {@link isBusinessHours}. Default `true` for
   * `ads_ops`/`ads_automation`, `false` for `ads_urgent` (urgent alerts
   * always fire) — the per-call value always wins when explicitly set.
   */
  respectBusinessHours?: boolean;
}

export type NotifySkipReason =
  | "killswitch_off"
  | "channel_disabled"
  | "no_webhook_configured"
  | "outside_business_hours"
  | "deduped"
  | "muted"
  | "post_failed"
  | "internal_error";

export interface NotifyResult {
  sent: boolean;
  reason?: NotifySkipReason;
}

export const DEFAULT_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEZONE = "Europe/London";

export interface DedupeCheckResult {
  shouldSkip: boolean;
  reason?: "deduped" | "muted";
}

export interface SlackPostResult {
  ok: boolean;
  status: number;
}

/**
 * Everything environment/network/DB that `notify()` needs, injected so the
 * core logic is testable with plain fixtures. `lib/notify/slack-deps.ts`
 * builds the real thing; unit tests build stubs directly.
 */
export interface NotifyDeps {
  now?: Date;
  timezone?: string;
  isMasterKillswitchOn: () => boolean;
  isChannelEnabled: (channel: SlackChannel) => boolean;
  getWebhookUrl: (channel: SlackChannel) => string | undefined;
  postToSlack: (webhookUrl: string, payload: { text: string; blocks?: unknown[] }) => Promise<SlackPostResult>;
  /** Omit entirely (or leave undefined) when `opts.dedupeKey` will never be used — `notify()` only calls this when a `dedupeKey` is present. */
  checkDedupe?: (dedupeKey: string, windowMs: number, now: Date) => Promise<DedupeCheckResult>;
  /** Upserts the dedupe row (increments `fire_count`, stamps `last_fired_at`, stores `data`) after a successful pre-flight — see module doc comment on ordering. */
  recordFire?: (dedupeKey: string, payload: Record<string, unknown>) => Promise<void>;
}

// ── Pure env readers — reused by both this file's tests and the live-deps builder ──

/** `ENABLE_SLACK_NOTIFICATIONS` must be exactly `"1"`. Unset/anything else = fully off. */
export function isMasterKillswitchOnFromEnv(): boolean {
  return process.env.ENABLE_SLACK_NOTIFICATIONS === "1";
}

const CHANNEL_ENABLED_ENV: Record<SlackChannel, string> = {
  ads_ops: "SLACK_CHANNEL_ADS_OPS_ENABLED",
  ads_urgent: "SLACK_CHANNEL_ADS_URGENT_ENABLED",
  ads_automation: "SLACK_CHANNEL_ADS_AUTOMATION_ENABLED",
};

/**
 * Per-channel override. Defaults to enabled (the master killswitch above is
 * already the "everything off by default" gate) — set to `"0"` or `"false"`
 * to disable just one channel without touching `ENABLE_SLACK_NOTIFICATIONS`.
 */
export function isChannelEnabledFromEnv(channel: SlackChannel): boolean {
  const raw = process.env[CHANNEL_ENABLED_ENV[channel]];
  return raw !== "0" && raw !== "false";
}

const WEBHOOK_ENV: Record<SlackChannel, string> = {
  ads_ops: "SLACK_WEBHOOK_ADS_OPS",
  ads_urgent: "SLACK_WEBHOOK_ADS_URGENT",
  ads_automation: "SLACK_WEBHOOK_ADS_AUTOMATION",
};

export function getWebhookUrlFromEnv(channel: SlackChannel): string | undefined {
  return process.env[WEBHOOK_ENV[channel]] || undefined;
}

/** Default per channel when `opts.respectBusinessHours` is not explicitly set — urgent always fires. */
function defaultRespectBusinessHours(channel: SlackChannel): boolean {
  return channel !== "ads_urgent";
}

async function postJson(webhookUrl: string, payload: { text: string; blocks?: unknown[] }): Promise<SlackPostResult> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: response.ok, status: response.status };
}

/** The real `postToSlack` — plain `fetch`, no `@/` import needed, safe to keep in this pure file. */
export const livePostToSlack = postJson;

export async function notify(opts: NotifyOptions, deps: NotifyDeps): Promise<NotifyResult> {
  try {
    if (!deps.isMasterKillswitchOn()) {
      console.info("[notify] ENABLE_SLACK_NOTIFICATIONS != \"1\" — killswitch off, skipping", {
        channel: opts.channel,
        dedupeKey: opts.dedupeKey,
      });
      return { sent: false, reason: "killswitch_off" };
    }

    if (!deps.isChannelEnabled(opts.channel)) {
      console.info(`[notify] channel "${opts.channel}" disabled via per-channel env — skipping`);
      return { sent: false, reason: "channel_disabled" };
    }

    const webhookUrl = deps.getWebhookUrl(opts.channel);
    if (!webhookUrl) {
      console.error(`[notify] no webhook configured for channel "${opts.channel}" — skipping`);
      return { sent: false, reason: "no_webhook_configured" };
    }

    const now = deps.now ?? new Date();
    const timezone = deps.timezone ?? DEFAULT_TIMEZONE;
    const respectBusinessHours = opts.respectBusinessHours ?? defaultRespectBusinessHours(opts.channel);
    if (respectBusinessHours && !isBusinessHours(now, timezone)) {
      console.info(`[notify] outside business hours (${timezone}) — skipping channel "${opts.channel}"`);
      return { sent: false, reason: "outside_business_hours" };
    }

    const dedupeWindowMs = opts.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    if (opts.dedupeKey) {
      const check = deps.checkDedupe
        ? await deps.checkDedupe(opts.dedupeKey, dedupeWindowMs, now)
        : { shouldSkip: false };
      if (check.shouldSkip) {
        console.info(`[notify] dedupeKey "${opts.dedupeKey}" skipped: ${check.reason}`);
        return { sent: false, reason: check.reason };
      }

      // Reserve the slot BEFORE posting: if the Slack POST throws or hangs,
      // we still don't want to re-fire the same alert on the next tick — a
      // deliberate "fail open toward silence, not toward spam" trade-off.
      if (deps.recordFire) {
        await deps.recordFire(opts.dedupeKey, { channel: opts.channel, text: opts.text, blocks: opts.blocks, firedAt: now.toISOString() });
      }
    }

    let result: SlackPostResult;
    try {
      result = await deps.postToSlack(webhookUrl, { text: opts.text, blocks: opts.blocks });
    } catch (err) {
      console.error("[notify] postToSlack threw", err instanceof Error ? err.message : err);
      return { sent: false, reason: "post_failed" };
    }

    if (!result.ok) {
      console.error(`[notify] Slack webhook returned non-200 (status=${result.status}) for channel "${opts.channel}"`);
      return { sent: false, reason: "post_failed" };
    }

    return { sent: true };
  } catch (err) {
    console.error("[notify] unexpected internal error — failing open", err instanceof Error ? err.message : err);
    return { sent: false, reason: "internal_error" };
  }
}
