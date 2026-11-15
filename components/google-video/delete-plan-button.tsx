"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Deletes a draft or exported YouTube plan from the database.
 * The confirm dialog names the plan. The request does not call Google Ads.
 */
export function DeleteVideoPlanButton({ planId, planName }: { planId: string; planName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const named = planName.trim() || "Untitled plan";
    const ok = window.confirm(
      `Delete "${named}"? This removes the plan from the database only. Nothing in Google Ads is changed.`,
    );
    if (!ok) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/google-video/${planId}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (!json?.ok) {
        setError(json?.error ?? "Delete failed.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button type="button" variant="outline" size="sm" onClick={remove} disabled={busy}>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Delete
      </Button>
      {error && (
        <span className="text-[11px] text-destructive" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
