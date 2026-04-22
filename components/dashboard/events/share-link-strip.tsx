"use client";

import { useState } from "react";
import { Link as LinkIcon, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ShareReportControls } from "@/app/(dashboard)/events/[id]/share-report-controls";

/**
 * components/dashboard/events/share-link-strip.tsx
 *
 * Compact admin strip rendered above the Event Reporting block on
 * the Reporting tab (PR #57 #2). Default state is a single
 * unobtrusive "Share link" button — clicking expands the existing
 * `<ShareReportControls>` panel inline so the toggle / URL /
 * expiry / regenerate controls are still one click away when
 * needed but don't dominate the Reporting view they're admin for.
 *
 * Goal: keep the Reporting tab visually mirroring the public
 * /share/report/[token] surface (which has no admin UI), while
 * preserving full edit access for the operator.
 */

interface Props {
  eventId: string;
  initialShare: React.ComponentProps<typeof ShareReportControls>["initialShare"];
  /** When true, the strip renders the disabled "no link yet" hint
   *  inside the trigger so the operator knows what to expect on
   *  expand without mounting the full panel. */
  shareEnabled: boolean;
}

export function ShareLinkStrip({ eventId, initialShare, shareEnabled }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-controls="share-link-panel"
          // Tiny status dot — green = link live, muted = link minted
          // but disabled / not yet minted. Lets the operator see at
          // a glance whether the share URL is currently serving
          // without expanding the panel.
          title={shareEnabled ? "Share link is live" : "Share link disabled"}
        >
          <LinkIcon className="h-3.5 w-3.5" />
          Share link
          <span
            aria-hidden
            className={`ml-1 inline-block h-1.5 w-1.5 rounded-full ${
              shareEnabled ? "bg-emerald-500" : "bg-muted-foreground/40"
            }`}
          />
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </Button>
      </div>
      {open && (
        <div id="share-link-panel">
          <ShareReportControls eventId={eventId} initialShare={initialShare} />
        </div>
      )}
    </div>
  );
}
