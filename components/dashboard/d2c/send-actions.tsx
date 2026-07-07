"use client";

import { useState, useTransition } from "react";

import {
  approveSend,
  cancelSend,
  rejectSend,
  toggleDryRun,
} from "@/lib/actions/d2c-sends";
import type { D2CScheduledSend } from "@/lib/d2c/types";

/**
 * components/dashboard/d2c/send-actions.tsx
 *
 * Approver controls for a single scheduled send: Approve / Reject / Cancel and
 * a dry-run toggle. Rendered only for approvers on the operator page; the
 * public share view omits this component entirely.
 */

const BTN =
  "rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-50";

export function SendActions({
  send,
  eventId,
}: {
  send: Pick<D2CScheduledSend, "id" | "status" | "approval_status" | "dry_run">;
  eventId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const isScheduled = send.status === "scheduled";
  const isPending = send.approval_status === "pending_approval";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      setMessage(res.ok ? ok : (res.error ?? "Action failed."));
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isScheduled && isPending && (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => approveSend(send.id, eventId), "Approved.")}
            className={`${BTN} border-emerald-300 text-emerald-800 hover:bg-emerald-50`}
          >
            Approve
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => rejectSend(send.id, eventId), "Rejected.")}
            className={`${BTN} border-red-300 text-red-800 hover:bg-red-50`}
          >
            Reject
          </button>
        </>
      )}
      {isScheduled && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => cancelSend(send.id, eventId), "Cancelled.")}
          className={BTN}
        >
          Cancel
        </button>
      )}
      {isScheduled && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () => toggleDryRun(send.id, eventId, !send.dry_run),
              send.dry_run ? "Live send armed." : "Set to dry run.",
            )
          }
          className={BTN}
        >
          {send.dry_run ? "Arm live send" : "Set dry run"}
        </button>
      )}
      {message && (
        <span className="text-xs text-muted-foreground" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
