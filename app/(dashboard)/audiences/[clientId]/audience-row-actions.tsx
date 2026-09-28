"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function AudienceRowActions({
  audienceId,
  clientId,
  status,
  writesEnabled,
}: {
  audienceId: string;
  clientId: string;
  status: string;
  writesEnabled: boolean;
}) {
  const router = useRouter();
  const [archiving, setArchiving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reused, setReused] = useState(false);

  async function archive() {
    setArchiving(true);
    await fetch(`/api/audiences/${audienceId}`, { method: "DELETE" });
    router.refresh();
    setArchiving(false);
  }

  async function createOnMeta() {
    setCreating(true);
    setReused(false);
    const res = await fetch(`/api/audiences/${audienceId}/write`, { method: "POST" });
    const json = (await res.json().catch(() => null)) as {
      audience?: { reused?: boolean };
    } | null;
    if (res.ok && json?.audience?.reused) setReused(true);
    router.refresh();
    setCreating(false);
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {writesEnabled && (status === "draft" || status === "failed") && (
        <Button
          type="button"
          size="sm"
          onClick={() => void createOnMeta()}
          disabled={creating}
        >
          {creating ? "Creating..." : status === "failed" ? "Retry" : "Create on Meta"}
        </Button>
      )}
      {reused ? <span className="text-xs text-muted-foreground">reused</span> : null}
      <Link
        href={`/audiences/${clientId}/new?audience_id=${audienceId}`}
        className="text-xs font-medium text-primary-hover hover:underline"
      >
        Edit
      </Link>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void archive()}
        disabled={archiving}
      >
        {archiving ? "Archiving..." : "Archive"}
      </Button>
    </div>
  );
}
