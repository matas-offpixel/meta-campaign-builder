"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Megaphone, X } from "lucide-react";

interface Props {
  open: boolean;
  clientId: string;
  onClose: () => void;
}

/**
 * Engagement-type picker. Replaces the direct navigation to /events/new
 * on the client detail page so the user can choose between:
 *   - Event           → existing /events/new flow
 *   - Brand campaign  → new /clients/[id]/brand-campaigns/new flow
 *
 * Same fixed-overlay pattern as `components/templates/save-template-modal.tsx`
 * — kept local because the codebase doesn't ship a generic Dialog primitive
 * yet and rolling Radix Dialog is out of scope for this slice.
 */
export function NewEventKindModal({ open, clientId, onClose }: Props) {
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const goEvent = () => {
    router.push(`/events/new?clientId=${clientId}`);
  };
  const goBrandCampaign = () => {
    router.push(`/clients/${clientId}/brand-campaigns/new`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-event-kind-title"
        className="relative z-10 w-full max-w-xl rounded-md border border-border bg-background p-6 shadow-md"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2
            id="new-event-kind-title"
            className="font-heading text-xl tracking-wide"
          >
            What are we creating?
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KindTile
            icon={<CalendarDays className="h-5 w-5" />}
            title="Event"
            description="Dated show with ticket sales."
            onClick={goEvent}
          />
          <KindTile
            icon={<Megaphone className="h-5 w-5" />}
            title="Brand Campaign"
            description="Brand awareness / reach campaign."
            onClick={goBrandCampaign}
          />
        </div>
      </div>
    </div>
  );
}

function KindTile({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-[180px] flex-col items-start gap-2 rounded-md border border-border bg-card p-4 text-left transition-colors hover:border-border-strong hover:bg-muted/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-foreground group-hover:bg-background">
        {icon}
      </span>
      <span className="font-heading text-sm tracking-wide">{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}
