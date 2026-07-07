/**
 * lib/d2c/dashboard-view.ts
 *
 * Pure presentation seams for the D2C event dashboard (operator + public
 * share). No server-only imports so both the RSC pages and the unit tests
 * can consume them. Everything here is deterministic — timestamps flow in
 * as arguments (`nowMs`) rather than being read from `Date.now()` inline.
 */

import type {
  D2CChannel,
  D2CJobType,
  D2CScheduledSend,
  D2CScheduledSendStatus,
} from "./types";

export const D2C_JOB_TYPE_LABELS: Record<D2CJobType, string> = {
  announce: "Announcement",
  reminder: "Presale reminder",
  community_early: "Community early access",
  presale_live: "Presale live",
  gen_sale: "General sale",
  autoresp_setup: "Autoresponder setup",
};

export function jobTypeLabel(jobType: D2CJobType | null): string {
  if (!jobType) return "Send";
  return D2C_JOB_TYPE_LABELS[jobType] ?? jobType;
}

export interface StatusPill {
  label: string;
  /** Tailwind classes for the pill background + text. */
  className: string;
}

/** Status → pill styling. Covers every D2CScheduledSendStatus. */
export function statusPill(status: D2CScheduledSendStatus): StatusPill {
  switch (status) {
    case "scheduled":
      return { label: "Scheduled", className: "bg-sky-100 text-sky-800" };
    case "sent":
      return { label: "Sent", className: "bg-emerald-100 text-emerald-800" };
    case "failed":
      return { label: "Failed", className: "bg-red-100 text-red-800" };
    case "cancelled":
      return { label: "Cancelled", className: "bg-neutral-200 text-neutral-600" };
    case "draft_ready":
      return { label: "Draft ready", className: "bg-violet-100 text-violet-800" };
    default:
      return { label: status, className: "bg-neutral-200 text-neutral-600" };
  }
}

export interface ApprovalPill {
  label: string;
  className: string;
}

export function approvalPill(
  approval: D2CScheduledSend["approval_status"],
): ApprovalPill {
  switch (approval) {
    case "approved":
      return { label: "Approved", className: "bg-emerald-100 text-emerald-800" };
    case "rejected":
      return { label: "Rejected", className: "bg-red-100 text-red-800" };
    case "pending_approval":
    default:
      return {
        label: "Pending approval",
        className: "bg-amber-100 text-amber-800",
      };
  }
}

/**
 * Colour + relative height for a channel's timeline bar. Height encodes
 * "loudness": WhatsApp (direct to phone) is tallest, email medium, sms short.
 */
export interface ChannelVisual {
  /** Solid colour (hex) for the timeline bar + preview accents. */
  color: string;
  /** 0..1 relative bar height. */
  heightRatio: number;
  label: string;
}

export function channelVisual(channel: D2CChannel): ChannelVisual {
  switch (channel) {
    case "whatsapp":
      return { color: "#25d366", heightRatio: 1, label: "WhatsApp" };
    case "email":
      return { color: "#6366f1", heightRatio: 0.7, label: "Email" };
    case "sms":
      return { color: "#f59e0b", heightRatio: 0.5, label: "SMS" };
    default:
      return { color: "#9ca3af", heightRatio: 0.6, label: channel };
  }
}

export interface TimelineBar {
  id: string;
  jobType: D2CJobType | null;
  channel: D2CChannel;
  scheduledFor: string;
  /** Left offset 0..100 (%) along the timeline min→max span. */
  offsetPct: number;
  color: string;
  heightRatio: number;
  status: D2CScheduledSendStatus;
}

/**
 * Position each send along a horizontal timeline from the earliest to the
 * latest `scheduled_for`. Single-send (or all-same-time) collections collapse
 * every bar to 50% so the strip still renders sensibly.
 */
export function buildTimelineBars(sends: D2CScheduledSend[]): TimelineBar[] {
  const parsed = sends
    .map((s) => ({ send: s, t: Date.parse(s.scheduled_for) }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  if (parsed.length === 0) return [];

  const min = parsed[0]!.t;
  const max = parsed[parsed.length - 1]!.t;
  const span = max - min;

  return parsed.map(({ send, t }) => {
    const visual = channelVisual(send.channel);
    return {
      id: send.id,
      jobType: send.job_type,
      channel: send.channel,
      scheduledFor: send.scheduled_for,
      offsetPct: span > 0 ? ((t - min) / span) * 100 : 50,
      color: visual.color,
      heightRatio: visual.heightRatio,
      status: send.status,
    };
  });
}

/**
 * Split a markdown body into paragraph blocks (double-newline separated),
 * preserving single newlines as intra-paragraph line breaks. Pure — the
 * consumer decides how to render each block.
 */
export function splitMarkdownParagraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

const INTRO_RE = /^(thanks for|thank you for|you'?re in|you are in|welcome)/i;

/**
 * Heuristic used by the email preview to auto-bold the first paragraph when it
 * reads like an intro line (matches the Throwback London reference — "Thanks
 * for signing up…").
 */
export function isIntroParagraph(text: string): boolean {
  return INTRO_RE.test(text.trim());
}

/** Build the canonical public share URL for a token. */
export function buildD2CShareUrl(origin: string, token: string): string {
  const trimmed = origin.replace(/\/+$/, "");
  return `${trimmed}/share/d2c/${token}`;
}
