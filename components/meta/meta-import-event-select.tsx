"use client";

import { Select } from "@/components/ui/select";
import type { MetaImportEventOption } from "@/lib/meta/import/event";

export function formatMetaImportEventOptionLabel(event: MetaImportEventOption): string {
  const code = event.event_code?.trim();
  const prefix = code ? `[${code}] ` : "";
  const date = event.event_date ? ` · ${event.event_date}` : "";
  return `${prefix}${event.name}${date}`;
}

export function MetaImportEventSelect({
  id,
  events,
  value,
  onChange,
  disabled,
  error,
}: {
  id: string;
  events: readonly MetaImportEventOption[];
  value: string;
  onChange: (eventId: string) => void;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <Select
      id={id}
      label="Event"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      error={error}
      placeholder={events.length === 0 ? "No events run on this ad account" : "Select event"}
      options={events.map((event) => ({
        value: event.id,
        label: formatMetaImportEventOptionLabel(event),
      }))}
    />
  );
}
