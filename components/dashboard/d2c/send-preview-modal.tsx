"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WaTemplatePreview } from "@/components/d2c/preview/wa-template-preview";
import {
  markdownToBasicHtml,
  substituteTemplateVariables,
} from "@/lib/d2c/event-variables";
import {
  getFireType,
  isDirectFire,
  FIRE_TYPE_LABEL,
  FIRE_TYPE_BADGE_CLASS,
} from "@/lib/d2c/fire-type";
import type { D2CScheduledSend, D2CJobType, D2CEventCopyBundle } from "@/lib/d2c/types";

/**
 * components/dashboard/d2c/send-preview-modal.tsx
 *
 * Per-send preview modal: shows what will be sent (email HTML or WA template
 * mock), the resolved variable table with null-highlighting, and a fire-type-
 * aware Approve button.
 *
 * - DRAFT_REVIEW approve: calls onApprove immediately (creates Bird draft, no
 *   message to fans).
 * - DIRECT_FIRE approve: button is locked for 1 second after open to prevent
 *   accidental fires.
 */

const JOB_TYPE_LABELS: Record<string, string> = {
  announce: "Announcement",
  reminder: "Presale reminder",
  community_early: "Community early access",
  presale_live: "Presale live",
  gen_sale: "General sale",
  autoresp_setup: "Autoresponder setup",
};

function formatWhenFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "short",
  }).format(d);
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = d.getTime() - Date.now();
  const diffDays = Math.round(diffMs / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "in 1 day";
  if (diffDays > 1) return `in ${diffDays} days`;
  if (diffDays === -1) return "1 day ago";
  return `${Math.abs(diffDays)} days ago`;
}

function resolvedVars(send: D2CScheduledSend): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(send.variables ?? {})) {
    out[k] = v != null ? String(v) : "";
  }
  return out;
}

/** Extract audience context from send.audience (best-effort). */
function audienceInfo(send: D2CScheduledSend): {
  tag?: string;
  templateName?: string;
} {
  const aud = send.audience as Record<string, unknown> | null | undefined;
  if (!aud) return {};
  return {
    tag: typeof aud.segment_tag === "string" ? aud.segment_tag : undefined,
    templateName:
      typeof aud.template_name === "string" ? aud.template_name : undefined,
  };
}

/** Extract WA-specific fields from the orchestration result_jsonb (best-effort). */
function waFromResultJsonb(send: D2CScheduledSend): {
  footer?: string;
  buttonText?: string;
  buttonUrl?: string;
} {
  try {
    const r = send.result_jsonb as Record<string, unknown> | null | undefined;
    if (!r) return {};
    const orch = r.orchestration as Record<string, unknown> | undefined;
    const details = orch?.details as Record<string, unknown> | undefined;
    if (!details) return {};
    return {
      footer: typeof details.footer === "string" ? details.footer : undefined,
      buttonText:
        typeof details.buttonText === "string" ? details.buttonText : undefined,
      buttonUrl:
        typeof details.buttonUrl === "string" ? details.buttonUrl : undefined,
    };
  } catch {
    return {};
  }
}

export interface SendPreviewModalProps {
  send: D2CScheduledSend;
  copyBundle: D2CEventCopyBundle;
  artworkUrl: string | null;
  eventName: string;
  open: boolean;
  onClose: () => void;
  onApprove: (id: string) => void;
  approving: boolean;
}

export function SendPreviewModal({
  send,
  copyBundle,
  artworkUrl,
  eventName,
  open,
  onClose,
  onApprove,
  approving,
}: SendPreviewModalProps) {
  const jobType = send.job_type as D2CJobType | null;
  const fireType = getFireType(jobType);
  const isDirect = isDirectFire(jobType);

  // 1-second arm delay for direct-fire to prevent accidental clicks.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!open) {
      setArmed(false);
      return;
    }
    if (!isDirect) {
      setArmed(true);
      return;
    }
    const t = setTimeout(() => setArmed(true), 1000);
    return () => clearTimeout(t);
  }, [open, isDirect]);

  const vars = resolvedVars(send);
  const varEntries = Object.entries(vars);
  const nullVarKeys = new Set(
    varEntries.filter(([, v]) => !v).map(([k]) => k),
  );

  // Body from copy_jsonb for this job type
  const copyBlock = jobType ? copyBundle[jobType] : null;
  const rawBody = copyBlock?.body_markdown ?? "";
  const substitutedBody = substituteTemplateVariables(rawBody, vars);

  const isEmail = send.channel === "email";
  const previewHtml = isEmail ? markdownToBasicHtml(substitutedBody) : "";

  const info = audienceInfo(send);
  const waExtra = !isEmail ? waFromResultJsonb(send) : {};

  const isPending = send.approval_status === "pending_approval";

  const approveLabel = isDirect
    ? "Send now to recipients"
    : "Create Bird draft";

  return (
    <Dialog open={open} onClose={onClose} ariaLabel={`Preview: ${send.job_type ?? "send"}`}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* ── Header ─────────────────────────────────────────── */}
        <DialogHeader onClose={onClose}>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>
              {(jobType && JOB_TYPE_LABELS[jobType]) ?? jobType ?? "Send"}
            </DialogTitle>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {send.channel}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${FIRE_TYPE_BADGE_CLASS[fireType]}`}
            >
              {FIRE_TYPE_LABEL[fireType]}
            </span>
            {send.dry_run && (
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                Dry run
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatWhenFull(send.scheduled_for)}{" "}
            <span className="text-muted-foreground/70">
              ({formatRelative(send.scheduled_for)})
            </span>
          </p>
          {isDirect && (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              ⚠️ This is a direct-fire send — approving immediately fires
              WhatsApp messages to real fans. No further confirmation.
            </p>
          )}
        </DialogHeader>

        {/* ── Content preview ────────────────────────────────── */}
        <div className="space-y-5">
          {isEmail ? (
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Email preview
              </p>
              {copyBlock?.subject && (
                <p className="mb-2 text-sm font-medium text-foreground">
                  Subject:{" "}
                  <span className="font-normal">
                    {substituteTemplateVariables(copyBlock.subject, vars)}
                  </span>
                </p>
              )}
              <div
                className="max-w-none space-y-2 rounded-md border border-border bg-card p-4 text-sm leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </section>
          ) : (
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                WhatsApp preview
              </p>
              <WaTemplatePreview
                artworkUrl={artworkUrl}
                body={substitutedBody}
                footer={waExtra.footer}
                buttonText={waExtra.buttonText}
                buttonUrl={waExtra.buttonUrl}
                senderName={eventName}
              />
            </section>
          )}

          {/* ── Variable table ─────────────────────────────── */}
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Resolved variables
              {nullVarKeys.size > 0 && (
                <span className="ml-2 rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-800">
                  {nullVarKeys.size} empty
                </span>
              )}
            </p>
            {varEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground">No variables.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-1 text-left font-medium text-muted-foreground">
                      Variable
                    </th>
                    <th className="pb-1 text-left font-medium text-muted-foreground">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {varEntries.map(([k, v]) => {
                    const empty = nullVarKeys.has(k);
                    return (
                      <tr
                        key={k}
                        className={empty ? "bg-yellow-50" : undefined}
                      >
                        <td className="py-0.5 pr-4 font-mono text-muted-foreground">
                          {`{{${k}}}`}
                        </td>
                        <td
                          className={`py-0.5 ${empty ? "text-yellow-700 italic" : "text-foreground"}`}
                        >
                          {v || <span className="italic">empty</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          {/* ── Audience / segment ─────────────────────────── */}
          {(info.tag || info.templateName) && (
            <section>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Audience
              </p>
              <dl className="space-y-1 text-xs">
                {info.tag && (
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">Segment tag</dt>
                    <dd className="font-mono text-foreground">{info.tag}</dd>
                  </div>
                )}
                {info.templateName && (
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">Template</dt>
                    <dd className="font-mono text-foreground">
                      {info.templateName}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} type="button">
            Cancel
          </Button>
          {isPending && (
            <button
              type="button"
              disabled={!armed || approving}
              onClick={() => onApprove(send.id)}
              className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${
                isDirect
                  ? "bg-amber-600 text-white hover:bg-amber-700"
                  : "bg-foreground text-background hover:opacity-90"
              }`}
            >
              {approving
                ? "Approving…"
                : !armed
                  ? "Hold…"
                  : approveLabel}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
