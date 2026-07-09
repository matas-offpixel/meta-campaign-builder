"use client";

import { useState } from "react";
import { ExternalLink, RefreshCw, Send } from "lucide-react";

import { substituteTemplateVariables } from "@/lib/d2c/event-variables";
import {
  approvalPill,
  buildBirdBroadcastUrl,
  buildMailchimpCampaignUrl,
  channelVisual,
  jobTypeLabel,
  resolveCta,
  statusPill,
} from "@/lib/d2c/dashboard-view";
import { renderD2CEmailHtml } from "@/lib/d2c/render/email-html";
import {
  formatMetricsSummary,
  readMailchimpCampaignId,
  readMailchimpServerPrefix,
  readSendMetrics,
} from "@/lib/d2c/metrics/types";
import type { D2CScheduledSend } from "@/lib/d2c/types";
import type { D2CPreviewTemplate } from "@/lib/db/d2c-dashboard";
import type { AutorespFireSummary } from "@/lib/db/d2c-autoresp";
import { AudiencePicker } from "./audience-picker";
import { AutorespPanel } from "./autoresp-panel";

const WHATSAPP_BLUE = "#00a5f4";

/**
 * components/dashboard/d2c/send-preview.tsx
 *
 * Live per-send preview: a styled email OR WhatsApp mockup of exactly what a
 * fan receives, plus a metadata band (job type, channel, schedule, status,
 * dry-run, approval). Presentational + client-only (needs an artwork onError
 * fallback). Approver actions are injected via the `actions` slot so the
 * public read-only share view can omit them entirely.
 */

const DEFAULT_THEME = "#c81c68"; // Throwback pink

export interface SendPreviewProps {
  send: D2CScheduledSend;
  template?: D2CPreviewTemplate;
  copyBlock?: { subject?: string | null; body_markdown: string } | null;
  artworkUrl: string | null;
  eventName: string;
  communityUrl: string | null;
  /** Resolved {{token}} → value map applied to subject / body / button URL. */
  variables: Record<string, string>;
  /** Per-client CTA colour; defaults to Throwback pink. */
  themeColor?: string;
  /** Approver controls — omitted on the public share view. */
  actions?: React.ReactNode;
  /** Scroll anchor id (timeline strip jumps here). */
  anchorId?: string;
  /**
   * Public share view = true → no operator-only controls (Refresh, test send).
   * Metrics + link-outs still render (read-only).
   */
  readOnly?: boolean;
  /** Mailchimp DC prefix (e.g. "us7") for the campaign link-out, if known. */
  mailchimpServerPrefix?: string | null;
  /** Event id — needed by the autoresponder arm/disarm + backfill controls. */
  eventId?: string;
  /** Approver flag — gates the autoresponder controls. */
  canApprove?: boolean;
  /** Fire summary for autoresp_setup sends (badge / stats / recent timeline). */
  autorespFires?: AutorespFireSummary | null;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

/**
 * Resolve the signup tag off a send's audience descriptor for the email
 * autoresp Customer Journey checklist. Prefers the singular `tag`, then the
 * first entry of a `tags` array (both key conventions seen in the wild).
 */
function autorespSignupTag(audience: unknown): string | null {
  if (!audience || typeof audience !== "object") return null;
  const a = audience as Record<string, unknown>;
  if (typeof a.tag === "string" && a.tag.trim()) return a.tag.trim();
  if (Array.isArray(a.tags)) {
    const first = a.tags.find((t) => typeof t === "string" && t.trim());
    if (typeof first === "string") return first.trim();
  }
  return null;
}

function ArtworkBlock({
  url,
  eventName,
  theme,
  rounded,
}: {
  url: string | null;
  eventName: string;
  theme: string;
  rounded?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      // Natural aspect ratio — portrait 4:5 artwork must not be centre-cropped
      // (Goal 2). `h-auto` + `object-contain` lets the image size to its own
      // ratio within the preview column width.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={`${eventName} artwork`}
        className={`h-auto w-full object-contain ${rounded ?? ""}`}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className={`flex h-40 w-full items-center justify-center px-4 text-center text-sm font-semibold text-white ${rounded ?? ""}`}
      style={{
        background: `linear-gradient(135deg, ${theme}, #1a1a1a)`,
      }}
    >
      {eventName}
    </div>
  );
}

export function SendPreview({
  send,
  template,
  copyBlock,
  artworkUrl,
  eventName,
  communityUrl,
  variables,
  themeColor = DEFAULT_THEME,
  actions,
  anchorId,
  readOnly = false,
  mailchimpServerPrefix = null,
  eventId,
  canApprove = false,
  autorespFires = null,
}: SendPreviewProps) {
  const isEmail = send.channel === "email";
  const isAutoresp = send.job_type === "autoresp_setup";
  const status = statusPill(send.status);
  const approval = approvalPill(send.approval_status);
  const visual = channelVisual(send.channel);

  const rawSubject = copyBlock?.subject ?? template?.subject ?? null;

  const rawBody = copyBlock?.body_markdown || template?.body_markdown || "";
  const substitutedBody = substituteTemplateVariables(rawBody, variables);

  const cta = resolveCta(template);
  const ctaUrl = cta ? substituteTemplateVariables(cta.url, variables) : null;

  const isCommunityBroadcast =
    Boolean(communityUrl) ||
    typeof (send.audience as Record<string, unknown>)?.community_url === "string";

  return (
    <section id={anchorId} className="scroll-mt-24">
      {/* ── Metadata band ─────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">
          {jobTypeLabel(send.job_type)}
        </span>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white"
          style={{ backgroundColor: visual.color }}
        >
          {visual.label}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatWhen(send.scheduled_for)}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status.className}`}>
          {status.label}
        </span>
        {send.dry_run && (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
            Dry run
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${approval.className}`}>
          {approval.label}
        </span>
      </div>

      {/* ── Autoresponder panel (badge / fire-stats / recent / controls) ── */}
      {isAutoresp && (
        <AutorespPanel
          sendId={send.id}
          eventId={eventId ?? ""}
          resultJsonb={send.result_jsonb}
          fires={autorespFires}
          readOnly={readOnly}
          canApprove={canApprove}
          channel={send.channel === "whatsapp" ? "whatsapp" : "email"}
          signupTag={autorespSignupTag(send.audience)}
          serverPrefix={mailchimpServerPrefix}
        />
      )}

      {/* ── Metrics + link-outs (Goals 4 + 6) ─────────────────── */}
      {!isAutoresp && (
        <SendMetricsRow
          send={send}
          readOnly={readOnly}
          serverPrefix={mailchimpServerPrefix}
        />
      )}

      {/* ── Multi-tag audience picker (Goal 5) ────────────────── */}
      {!readOnly &&
        isEmail &&
        (send.job_type === "announce" || send.job_type === "gen_sale") && (
          <div className="mb-3">
            <AudiencePicker sendId={send.id} />
          </div>
        )}

      {/* ── Preview mockup ────────────────────────────────────── */}
      {isEmail ? (
        // Bug D fix (2026-07-08): renders via the SAME renderD2CEmailHtml
        // the real/test Mailchimp send uses (lib/d2c/mailchimp/provider.ts,
        // the test-send route) — preview and inbox are now byte-identical,
        // instead of the previous bespoke Tailwind mockup that never matched
        // what fans actually received (no artwork/CTA/chassis in the email).
        <div
          className="overflow-hidden rounded-xl border border-border"
          dangerouslySetInnerHTML={{
            __html: renderD2CEmailHtml({
              subject: rawSubject,
              bodyMarkdown: rawBody,
              variables,
              artworkUrl,
              eventName,
              buttonLabel: cta?.label ?? null,
              buttonUrl: cta?.url ?? null,
              themeColor,
            }),
          }}
        />
      ) : (
        <div className="rounded-xl border border-border bg-[#e5ddd5] p-4">
          <div className="mb-2 flex justify-end">
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
              {isCommunityBroadcast ? "Community broadcast" : "Direct message"}
            </span>
          </div>
          <div className="ml-auto max-w-[85%]">
            <div className="overflow-hidden rounded-lg rounded-tr-none bg-[#dcf8c6] shadow-sm">
              {artworkUrl && (
                <ArtworkBlock
                  url={artworkUrl}
                  eventName={eventName}
                  theme={themeColor}
                />
              )}
              <div className="whitespace-pre-wrap px-3 py-2 font-mono text-[13px] leading-relaxed text-neutral-800">
                {substitutedBody}
              </div>
              {cta && ctaUrl && (
                <a
                  href={ctaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 border-t border-black/10 bg-white py-3 text-xs font-semibold uppercase tracking-wide no-underline"
                  style={{ color: WHATSAPP_BLUE }}
                >
                  <ExternalLink size={14} aria-hidden />
                  {cta.label}
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {!readOnly && <TestSendButton sendId={send.id} channel={send.channel} />}

      {actions && <div className="mt-3">{actions}</div>}
    </section>
  );
}

function formatWhenShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(d);
}

/**
 * Metrics summary line + provider link-outs. Metrics render read-only on both
 * surfaces; the Refresh button is operator-only (60s cooldown, matches the
 * server-side rate limit).
 */
function SendMetricsRow({
  send,
  readOnly,
  serverPrefix,
}: {
  send: D2CScheduledSend;
  readOnly: boolean;
  serverPrefix: string | null;
}) {
  const [metrics, setMetrics] = useState(() => readSendMetrics(send.result_jsonb));
  const [refreshing, setRefreshing] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const dc = serverPrefix ?? readMailchimpServerPrefix(send.result_jsonb);
  const campaignId = readMailchimpCampaignId(send.result_jsonb);
  const isSent = send.status === "sent";
  const mailchimpUrl =
    send.channel === "email"
      ? buildMailchimpCampaignUrl(dc, campaignId, { sent: isSent })
      : null;
  const birdUrl =
    send.channel !== "email"
      ? buildBirdBroadcastUrl(send.bird_broadcast_id, send.bird_campaign_edit_url)
      : null;

  const onRefresh = async () => {
    if (refreshing || Date.now() < cooldownUntil) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/d2c/scheduled-sends/${send.id}/metrics`, {
        method: "POST",
      });
      const json = await res.json();
      if (json.ok && json.metrics) {
        setMetrics(json.metrics);
        setCooldownUntil(Date.now() + 60_000);
      } else {
        setError(json.error ?? "Refresh failed");
      }
    } catch {
      setError("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const hasMetrics = Boolean(metrics);
  const showRow = isSent || hasMetrics || send.status === "scheduled";
  if (!showRow && !mailchimpUrl && !birdUrl) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {hasMetrics ? (
        <span className="text-foreground">{formatMetricsSummary(metrics!)}</span>
      ) : send.status === "scheduled" ? (
        <span className="text-muted-foreground">
          No data yet — scheduled for {formatWhenShort(send.scheduled_for)}
        </span>
      ) : (
        <span className="text-muted-foreground">No metrics yet</span>
      )}

      {!readOnly && (isSent || hasMetrics) && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing || Date.now() < cooldownUntil}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
          title={Date.now() < cooldownUntil ? "Cooling down (60s)" : "Refresh metrics"}
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} aria-hidden />
          Refresh
        </button>
      )}

      {mailchimpUrl && (
        <a
          href={mailchimpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink size={12} aria-hidden />
          {isSent ? "Mailchimp report" : "Mailchimp campaign"}
        </a>
      )}
      {birdUrl && (
        <a
          href={birdUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink size={12} aria-hidden />
          View broadcast in Bird
        </a>
      )}
      {error && <span className="text-red-600">{error}</span>}
    </div>
  );
}

/** Operator-only "Send test to me" — the single live-fire path. */
function TestSendButton({
  sendId,
  channel,
}: {
  sendId: string;
  channel: D2CScheduledSend["channel"];
}) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const onClick = async () => {
    if (sending) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(`/api/d2c/scheduled-sends/${sendId}/test-send`, {
        method: "POST",
      });
      const json = await res.json();
      if (json.ok) {
        const live = json.live === false ? " (dry-run — live gate off)" : "";
        setResult({ ok: true, msg: `Sent to ${json.target}${live}` });
      } else {
        setResult({ ok: false, msg: json.error ?? "Failed" });
      }
    } catch {
      setResult({ ok: false, msg: "Failed" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-3 flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={sending}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
      >
        <Send size={13} className={sending ? "animate-pulse" : ""} aria-hidden />
        {channel === "email" ? "Send test to me" : "Send test to my WhatsApp"}
      </button>
      {result && (
        <span className={`text-xs ${result.ok ? "text-emerald-700" : "text-red-600"}`}>
          {result.ok ? "✓ " : "✗ "}
          {result.msg}
        </span>
      )}
    </div>
  );
}
