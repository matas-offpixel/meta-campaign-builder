"use client";

import type {
  D2CScheduledSend,
  D2CScheduledSendApprovalStatus,
  D2CJobType,
} from "@/lib/d2c/types";
import {
  getFireType,
  FIRE_TYPE_LABEL,
  FIRE_TYPE_BADGE_CLASS,
} from "@/lib/d2c/fire-type";

/**
 * components/dashboard/d2c/scheduled-send-row.tsx
 *
 * Presentational row for one brief-generated scheduled send: milestone label,
 * channel badge, fire-type badge (DRAFT REVIEW / SENDS NOW), dispatch time,
 * status + approval badges, dry-run indicator, and a Preview button that opens
 * the send-preview modal.
 */

const JOB_TYPE_LABELS: Record<string, string> = {
  announce: "Announcement",
  reminder: "Presale reminder",
  community_early: "Community early access",
  presale_live: "Presale live",
  gen_sale: "General sale",
  autoresp_setup: "Autoresponder setup",
};

const APPROVAL_BADGE: Record<
  D2CScheduledSendApprovalStatus,
  { label: string; className: string }
> = {
  pending_approval: {
    label: "Pending approval",
    className: "bg-amber-100 text-amber-800",
  },
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", className: "bg-rose-100 text-rose-800" },
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

/** Extract a compact review preview from result_jsonb (best-effort, defensive). */
function draftPreview(resultJsonb: unknown): {
  templateId?: string;
  segmentTag?: string;
  recipientEstimate?: string;
  variables: [string, string][];
} {
  const out: {
    templateId?: string;
    segmentTag?: string;
    recipientEstimate?: string;
    variables: [string, string][];
  } = { variables: [] };
  if (!resultJsonb || typeof resultJsonb !== "object") return out;
  const r = resultJsonb as Record<string, unknown>;
  const orch = (r.orchestration as Record<string, unknown> | undefined) ?? {};
  const details = (orch.details as Record<string, unknown> | undefined) ?? {};
  if (typeof details.templateId === "string") out.templateId = details.templateId;
  if (typeof details.segmentTag === "string") out.segmentTag = details.segmentTag;
  const est = r.recipientEstimate ?? details.recipientEstimate;
  if (typeof est === "number" || typeof est === "string") out.recipientEstimate = String(est);
  const vars = details.variables;
  if (vars && typeof vars === "object") {
    out.variables = Object.entries(vars as Record<string, unknown>)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => [k, String(v)] as [string, string]);
  }
  return out;
}

export interface ScheduledSendRowProps {
  send: D2CScheduledSend;
  canApprove: boolean;
  busy?: boolean;
  onApprove?: (id: string) => void;
  /** Opens the preview modal for this send. */
  onPreview?: (id: string) => void;
}

export function ScheduledSendRow({
  send,
  canApprove,
  busy,
  onApprove,
  onPreview,
}: ScheduledSendRowProps) {
  const jobType = send.job_type as D2CJobType | null;
  const jobLabel =
    (jobType && JOB_TYPE_LABELS[jobType]) ?? jobType ?? "Send";
  const approval = APPROVAL_BADGE[send.approval_status];
  const isPending = send.approval_status === "pending_approval";
  const isDraftReady = send.status === "draft_ready";
  const preview = isDraftReady ? draftPreview(send.result_jsonb) : null;

  const fireType = getFireType(jobType);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {jobLabel}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {send.channel}
            </span>
            {/* Fire-type badge */}
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
          <div className="mt-1 text-xs text-muted-foreground">
            {formatWhen(send.scheduled_for)}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Preview button — shown so operator can inspect before approving */}
          {onPreview && (
            <button
              type="button"
              onClick={() => onPreview(send.id)}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
            >
              Preview
            </button>
          )}

          {isDraftReady ? (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800">
              Draft ready for review
            </span>
          ) : (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${approval.className}`}
            >
              {approval.label}
            </span>
          )}
          {isDraftReady && send.bird_campaign_edit_url && (
            <a
              href={send.bird_campaign_edit_url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-700"
            >
              Review in Bird →
            </a>
          )}
          {!isDraftReady && canApprove && isPending && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onApprove?.(send.id)}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "…" : "Approve"}
            </button>
          )}
        </div>
      </div>

      {isDraftReady && preview && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs sm:grid-cols-2">
          {preview.recipientEstimate && (
            <div className="flex justify-between gap-2 sm:col-span-2">
              <dt className="text-muted-foreground">Est. recipients</dt>
              <dd className="font-medium text-foreground">{preview.recipientEstimate}</dd>
            </div>
          )}
          {preview.templateId && (
            <div className="flex justify-between gap-2 sm:col-span-2">
              <dt className="text-muted-foreground">Template ID</dt>
              <dd className="truncate font-mono text-[11px] text-foreground">{preview.templateId}</dd>
            </div>
          )}
          {preview.segmentTag && (
            <div className="flex justify-between gap-2 sm:col-span-2">
              <dt className="text-muted-foreground">Signup segment</dt>
              <dd className="truncate font-mono text-[11px] text-foreground">{preview.segmentTag}</dd>
            </div>
          )}
          {preview.variables.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="truncate text-muted-foreground">{k}</dt>
              <dd className="truncate font-medium text-foreground" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
