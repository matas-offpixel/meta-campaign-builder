"use client";

import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  planEventPickerRows,
  todayIsoDate,
  visiblePlanEvents,
  type PlanEventOption,
} from "@/lib/plan/event-picker";

export const EVENT_PICK_DESCRIPTION =
  "Pick the event. Identities re-resolve from that client. Launched campaigns stay put.";

export function EventPickDialog({
  open,
  title,
  confirmLabel,
  events,
  selectedId,
  busy,
  onSelectedIdChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  events: PlanEventOption[];
  selectedId: string;
  busy?: boolean;
  onSelectedIdChange: (eventId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const pickerOptions = useMemo(
    () =>
      planEventPickerRows(
        visiblePlanEvents(events, {
          today: todayIsoDate(),
          showPast: true,
          selectedId,
        }),
      ).map((row) => ({
        value: row.id,
        label: row.label,
        sublabel: row.sublabel || undefined,
        keywords: row.keywords || undefined,
      })),
    [events, selectedId],
  );

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (busy) return;
        onClose();
      }}
    >
      <DialogContent>
        <DialogHeader onClose={busy ? undefined : onClose}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{EVENT_PICK_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <Combobox
          label="Event"
          value={selectedId}
          onChange={onSelectedIdChange}
          options={pickerOptions}
          placeholder="Select an event"
          emptyText="No matching events"
        />
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!selectedId || busy}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
