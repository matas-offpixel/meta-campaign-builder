"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function AudienceRowActions({
  audienceId,
  clientId,
}: {
  audienceId: string;
  clientId: string;
}) {
  const router = useRouter();
  const [archiving, setArchiving] = useState(false);

  async function archive() {
    setArchiving(true);
    await fetch(`/api/audiences/${audienceId}`, { method: "DELETE" });
    router.refresh();
    setArchiving(false);
  }

  return (
    <div className="flex items-center justify-end gap-2">
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
