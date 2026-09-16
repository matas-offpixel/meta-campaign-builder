"use client";

import { Select } from "@/components/ui/select";
import {
  formatTikTokImportEventOptionLabel,
  type TikTokImportEventOption,
} from "@/lib/tiktok/import/event";

export function TikTokImportEventSelect({
  id,
  events,
  value,
  onChange,
  suggestionLabel,
  disabled,
  error,
  placeholder = "Select event",
}: {
  id: string;
  events: readonly TikTokImportEventOption[];
  value: string;
  onChange: (eventId: string) => void;
  suggestionLabel?: string | null;
  disabled?: boolean;
  error?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Select
        id={id}
        label="Event"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        error={error}
        placeholder={placeholder}
        options={events.map((event) => ({
          value: event.id,
          label: formatTikTokImportEventOptionLabel(event),
        }))}
      />
      {suggestionLabel ? (
        <p className="text-xs text-muted-foreground">{suggestionLabel}</p>
      ) : null}
    </div>
  );
}
