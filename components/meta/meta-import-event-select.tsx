"use client";

import { Combobox } from "@/components/ui/combobox";
import {
  metaImportEventPickerOptions,
  type MetaImportListedEvent,
} from "@/lib/meta/import/event";

export function MetaImportEventSelect({
  id,
  events,
  value,
  onChange,
  disabled,
}: {
  id: string;
  events: readonly MetaImportListedEvent[];
  value: string;
  onChange: (eventId: string) => void;
  disabled?: boolean;
}) {
  return (
    <div id={id}>
      <Combobox
        label="Event"
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder="Select event"
        emptyText="No matching events"
        options={metaImportEventPickerOptions(events)}
      />
    </div>
  );
}
