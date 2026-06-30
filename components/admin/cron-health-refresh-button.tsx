"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

/**
 * Manual "Refresh now" trigger for /admin/cron-health. POSTs to the admin
 * route (which re-runs the check + writes a fresh report) then refreshes the
 * server component so the new report renders.
 */
export function CronHealthRefreshButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/cron-health-check", {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={handleClick} disabled={pending}>
        {pending ? "Checking…" : "Refresh now"}
      </Button>
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </div>
  );
}
