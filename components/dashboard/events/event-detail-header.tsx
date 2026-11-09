"use client";

import Link from "next/link";
import { ExternalLink, Pencil, Star, Trash2 } from "lucide-react";

import { DriveHeaderButton, type DrivePreview } from "@/components/dashboard/events/drive/live";
import type { EventKind } from "@/lib/db/events";
import { KindBadge } from "@/components/dashboard/_shared/kind-badge";
import { InsightsPill } from "@/components/insights-rail/insights-pill";
import { Button } from "@/components/ui/button";
import { fmtDaysUntilEvent } from "@/lib/dashboard/format";
import type { SharePhase } from "@/lib/drive/panel";

export function EventDetailHeader(props: {
  event: {
    id: string;
    name: string;
    kind: EventKind;
    status: string;
    event_date: string | null;
    drive_folder_id: string | null;
    client: { id: string; name: string } | null;
  };
  lab: { paydayLabel: string; daysToEvent: number | null } | null;
  linkedQuote: { id: string; quote_number: string } | null;
  favourite: boolean;
  favWorking: boolean;
  now: Date;
  confirmDelete: boolean;
  working: boolean;
  onToggleFavourite: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  drivePreview?: DrivePreview | null;
  driveInitialOpen?: boolean;
  driveInitialPhase?: SharePhase;
}) {
  const { event, lab } = props;
  const daysUntil = fmtDaysUntilEvent(event.event_date, props.now);
  const isBrand = event.kind === "brand_campaign";
  const description = [
    event.client?.name ? `${event.client.name} · ${event.status.replace("_", " ")}` : event.status.replace("_", " "),
    lab?.paydayLabel ? `Next payday ${lab.paydayLabel}.${lab.daysToEvent == null ? "" : ` ${lab.daysToEvent} days to the event.`}` : null,
  ].filter(Boolean).join(" · ");
  const label = "shrink-0 whitespace-nowrap";
  return (
    <header className="border-b border-border bg-card px-6 py-4">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 max-[700px]:flex-col max-[700px]:items-stretch">
        <div className="min-w-0 max-[700px]:w-full">
          <h1 className="font-heading text-2xl tracking-wide min-[701px]:truncate max-[700px]:whitespace-normal">
            <span className="inline-flex min-w-0 items-center gap-2 max-[700px]:flex max-[700px]:w-full max-[700px]:flex-wrap">
              <button
                type="button"
                onClick={props.onToggleFavourite}
                disabled={props.favWorking}
                aria-label={props.favourite ? "Unfavourite event" : "Favourite event"}
                aria-pressed={props.favourite}
                title={props.favourite ? "Unfavourite" : "Favourite"}
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <Star className={`h-4 w-4 ${props.favourite ? "fill-amber-400 text-amber-400" : ""}`} />
              </button>
              <span className="whitespace-nowrap min-[701px]:truncate max-[700px]:shrink-0">{event.name}</span>
              <KindBadge kind={event.kind} />
              {daysUntil && !isBrand ? (
                <span
                  className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-normal tracking-normal ${
                    daysUntil.isPast ? "border-border text-muted-foreground" : "border-border-strong text-foreground"
                  }`}
                >
                  {daysUntil.label}
                </span>
              ) : null}
              {props.linkedQuote ? (
                <Link
                  href={`/invoicing/quotes/${props.linkedQuote.id}`}
                  className="shrink-0 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[11px] font-normal tracking-normal text-muted-foreground hover:border-border-strong hover:text-foreground"
                  title="View originating quote"
                >
                  From quote {props.linkedQuote.quote_number}
                </Link>
              ) : null}
            </span>
          </h1>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground max-[700px]:whitespace-nowrap">{description}</p> : null}
        </div>
        <div className="flex items-center gap-2 max-[700px]:flex-wrap">
          <InsightsPill />
          {event.client ? (
            <Link href={`/clients/${event.client.id}`} className={label}>
              <Button variant="outline" size="sm" className={label}>
                <ExternalLink className="h-3.5 w-3.5" />
                View client
              </Button>
            </Link>
          ) : null}
          <DriveHeaderButton
            eventId={event.id}
            eventName={event.name}
            hasFolder={Boolean(event.drive_folder_id)}
            preview={props.drivePreview}
            initialOpen={props.driveInitialOpen}
            initialPhase={props.driveInitialPhase}
          />
          <Button variant="outline" size="sm" className={label} onClick={props.onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          {props.confirmDelete ? (
            <>
              <Button variant="destructive" size="sm" className={label} onClick={props.onDelete} disabled={props.working}>
                Confirm delete
              </Button>
              <Button variant="ghost" size="sm" className={label} onClick={props.onCancelDelete} disabled={props.working}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" className={label} onClick={props.onAskDelete} disabled={props.working}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
