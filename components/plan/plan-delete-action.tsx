"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ARCHIVE_PLAN_CONFIRM,
  DELETE_PLAN_CONFIRM,
  planDisposalAction,
} from "@/lib/plan/delete-policy";
import type { CampaignPlanLaunches } from "@/lib/plan/types";

export function PlanDeleteAction({
  planId,
  launches,
  persisted,
  onDeleted,
  trigger = "button",
  open: openProp,
  onOpenChange,
}: {
  planId: string;
  launches: CampaignPlanLaunches;
  persisted: boolean;
  onDeleted?: () => void;
  trigger?: "button" | "none";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  function setOpen(next: boolean) {
    onOpenChange?.(next);
    if (openProp === undefined) setUncontrolledOpen(next);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = planDisposalAction(launches);
  const label = action === "delete" ? "Delete plan" : "Archive plan";
  const confirmCopy = action === "delete" ? DELETE_PLAN_CONFIRM : ARCHIVE_PLAN_CONFIRM;

  async function run() {
    if (!persisted) {
      setOpen(false);
      onDeleted?.();
      router.push("/plans");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/plan/${encodeURIComponent(planId)}`, {
        method: action === "delete" ? "DELETE" : "PATCH",
        headers: action === "archive" ? { "Content-Type": "application/json" } : undefined,
        body: action === "archive" ? JSON.stringify({ status: "archived" }) : undefined,
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; action?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `Could not ${action} plan`);
        return;
      }
      setOpen(false);
      onDeleted?.();
      router.push("/plans");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} plan`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {trigger === "button" ? (
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(true)}>
          {label}
        </Button>
      ) : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      <Dialog open={open} onClose={() => (!busy ? setOpen(false) : undefined)}>
        <DialogContent>
          <DialogHeader onClose={() => (!busy ? setOpen(false) : undefined)}>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{confirmCopy}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={busy} onClick={() => void run()}>
              {busy ? (action === "delete" ? "Deleting…" : "Archiving…") : label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}
