"use client";

import type {
  D2CScheduledSend,
  D2CScheduledSendApprovalStatus,
} from "@/lib/d2c/types";

/**
 * components/dashboard/d2c/scheduled-send-row.tsx
 *
 * Presentational row for one brief-generated scheduled send: milestone label,
 * channel, scheduled_for, status + approval badges, a [DRY RUN] badge when the
 * row will not send live, and an Approve button (operator-gated).
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

export interface ScheduledSendRowProps {
  send: D2CScheduledSend;
  canApprove: boolean;
  busy?: boolean;
  onApprove?: (id: string) => void;
}

export function ScheduledSendRow({
  send,
  canApprove,
  busy,
  onApprove,
}: ScheduledSendRowProps) {
  const jobLabel =
    (send.job_type && JOB_TYPE_LABELS[send.job_type]) ??
    send.job_type ??
    "Send";
  const approval = APPROVAL_BADGE[send.approval_status];
  const isPending = send.approval_status === "pending_approval";

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {jobLabel}
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {send.channel}
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
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${approval.className}`}
        >
          {approval.label}
        </span>
        {canApprove && isPending && (
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
  );
}
