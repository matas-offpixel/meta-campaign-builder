"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
}: {
  planId: string;
  launches: CampaignPlanLaunches;
  persisted: boolean;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = planDisposalAction(launches);
  const label = action === "delete" ? "Delete plan" : "Archive plan";

  async function run() {
    const confirmed = window.confirm(action === "delete" ? DELETE_PLAN_CONFIRM : ARCHIVE_PLAN_CONFIRM);
    if (!confirmed) return;
    if (!persisted) {
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
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run()}>
        {label}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
