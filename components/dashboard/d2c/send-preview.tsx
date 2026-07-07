"use client";

import { useState } from "react";

import {
  markdownToBasicHtml,
  substituteTemplateVariables,
} from "@/lib/d2c/event-variables";
import {
  approvalPill,
  channelVisual,
  isIntroParagraph,
  jobTypeLabel,
  splitMarkdownParagraphs,
  statusPill,
} from "@/lib/d2c/dashboard-view";
import type { D2CScheduledSend } from "@/lib/d2c/types";
import type { D2CPreviewTemplate } from "@/lib/db/d2c-dashboard";

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
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

/** Auto-bold a single-line intro paragraph (Throwback London reference). */
function withIntroBold(body: string): string {
  const paras = splitMarkdownParagraphs(body);
  if (
    paras.length > 0 &&
    isIntroParagraph(paras[0]!) &&
    !paras[0]!.includes("\n") &&
    !paras[0]!.startsWith("**")
  ) {
    paras[0] = `**${paras[0]}**`;
    return paras.join("\n\n");
  }
  return body;
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
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={`${eventName} artwork`}
        className={`w-full object-cover ${rounded ?? ""}`}
        style={{ maxHeight: 320 }}
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
}: SendPreviewProps) {
  const isEmail = send.channel === "email";
  const status = statusPill(send.status);
  const approval = approvalPill(send.approval_status);
  const visual = channelVisual(send.channel);

  const rawSubject = copyBlock?.subject ?? template?.subject ?? null;
  const subject = rawSubject
    ? substituteTemplateVariables(rawSubject, variables)
    : null;

  const rawBody = copyBlock?.body_markdown || template?.body_markdown || "";
  const substitutedBody = substituteTemplateVariables(rawBody, variables);

  const buttonLabel = template?.button_label ?? null;
  const buttonUrl = template?.button_url
    ? substituteTemplateVariables(template.button_url, variables)
    : null;

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

      {/* ── Preview mockup ────────────────────────────────────── */}
      {isEmail ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <div style={{ backgroundColor: "#1a1a1a" }} className="p-0">
            <ArtworkBlock url={artworkUrl} eventName={eventName} theme={themeColor} />
            <div className="space-y-4 px-6 py-6">
              {subject && (
                <p className="text-sm font-bold" style={{ color: "#9ca3af" }}>
                  {subject}
                </p>
              )}
              <div
                className="space-y-3 text-sm leading-relaxed [&_a]:underline [&_p]:m-0 [&_strong]:font-bold"
                style={{ color: "#e5e5e5" }}
                dangerouslySetInnerHTML={{
                  __html: markdownToBasicHtml(withIntroBold(substitutedBody)),
                }}
              />
              {buttonLabel && buttonUrl && (
                <div className="pt-2">
                  <a
                    href={buttonUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded px-6 py-3 text-sm font-bold uppercase tracking-wide text-white no-underline"
                    style={{ backgroundColor: themeColor }}
                  >
                    {buttonLabel}
                  </a>
                </div>
              )}
              <p className="pt-4 text-xs" style={{ color: "#6b7280" }}>
                Síguenos para saber más…
              </p>
            </div>
          </div>
        </div>
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
            </div>
          </div>
        </div>
      )}

      {actions && <div className="mt-3">{actions}</div>}
    </section>
  );
}
