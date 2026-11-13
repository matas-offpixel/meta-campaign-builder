"use client";

/**
 * The event page's config panel (D9, HD2): capacity, the umbrella flag, the
 * CIRQLIN page link, reference shows and count aliases. These replace the
 * NX model's constants; nothing is inferred from codes or slugs, and a
 * missing value says so in D9's words. Mounted on /events/[id]/edit.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { saveEventConfig, type EventConfigField } from "@/lib/actions/event-config";
import { parseCapacity } from "@/lib/event-config/form";
import type { EventConfigPanelData, ReferenceOption } from "@/lib/event-config/panel";
import { NO_CAPACITY, NO_CIRQLIN_PAGE } from "@/lib/event-config/read";

interface Props {
  eventId: string;
  data: EventConfigPanelData;
  /** Frames render the panel without a server to save to. */
  readOnly?: boolean;
}

const fmt = (n: number) => n.toLocaleString("en-GB");

function showDate(iso: string | null): string {
  if (!iso) return "No date";
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function allocationLine(paidTierAllocation: number | null, capacityInput: string): string {
  if (paidTierAllocation != null) return `Sellable allocation ${fmt(paidTierAllocation)}, from the paid tiers.`;
  const capacity = parseCapacity(capacityInput);
  if (capacity.ok && capacity.value != null) return `Sellable allocation ${fmt(capacity.value)}: no tier allocations, so it's the capacity.`;
  return `${NO_CAPACITY}.`;
}

function ReferencePicker({
  options,
  picked,
  onToggle,
  disabled,
}: {
  options: ReferenceOption[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  disabled: boolean;
}) {
  // The shows saved as references lead the list; the order is fixed when
  // the panel opens, so a row doesn't move when it's ticked.
  const [savedFirst] = useState(() => new Set(picked));
  const shows = options
    .filter((o) => !o.isUmbrella)
    .sort((a, b) => Number(savedFirst.has(b.id)) - Number(savedFirst.has(a.id)));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">Reference shows</legend>
      <p className="text-xs text-muted-foreground">
        {picked.size === 0
          ? "None picked: this show compares against the client's library."
          : `Compares against ${picked.size} show${picked.size === 1 ? "" : "s"} instead of the client's library.`}
      </p>
      {shows.length === 0 ? (
        <p className="text-xs text-muted-foreground">The client has no other shows.</p>
      ) : (
        <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-border px-3 py-2">
          {shows.map((o) => (
            <li key={o.id} className="flex items-baseline justify-between gap-3">
              <Checkbox
                id={`ref-${o.id}`}
                label={o.name}
                checked={picked.has(o.id)}
                onChange={() => onToggle(o.id)}
                disabled={disabled}
              />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{showDate(o.eventDate)}</span>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

export function EventConfigPanel({ eventId, data, readOnly = false }: Props) {
  const router = useRouter();
  const { config, options } = data;
  const [capacity, setCapacity] = useState(config.capacity != null ? String(config.capacity) : "");
  const [isUmbrella, setIsUmbrella] = useState(config.isUmbrella);
  const [pageId, setPageId] = useState(config.cirqlinPageId ?? "");
  const [picked, setPicked] = useState(() => new Set(config.referenceEventIds));
  const [aliases, setAliases] = useState(config.countAliases.join("\n"));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<{ message: string; field?: EventConfigField } | null>(null);

  const line = useMemo(() => allocationLine(config.sellable.paidTierAllocation, capacity), [config.sellable.paidTierAllocation, capacity]);
  const fieldError = (f: EventConfigField) => (error?.field === f ? error.message : undefined);

  const toggle = (id: string) => {
    setSaved(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    const result = await saveEventConfig({
      eventId,
      capacity,
      isUmbrella,
      cirqlinPageId: pageId,
      referenceEventIds: [...picked],
      aliases,
    });
    setSaving(false);
    if (!result.ok) {
      setError({ message: result.error, field: result.field });
      return;
    }
    setSaved(true);
    router.refresh();
  };

  const touched = <T,>(set: (v: T) => void) => (v: T) => {
    setSaved(false);
    set(v);
  };

  return (
    <form onSubmit={onSave} className="space-y-4 rounded-md border border-border bg-card p-5" data-testid="event-config-panel">
      <div>
        <h2 className="font-heading text-base tracking-wide">Dashboard</h2>
        <p className="mt-1 text-xs text-muted-foreground">What the sales and spend dashboard reads for this show.</p>
      </div>

      <div className="space-y-1.5">
        <Input
          id="event-config-capacity"
          label="Capacity"
          inputMode="numeric"
          value={capacity}
          onChange={(e) => touched(setCapacity)(e.target.value)}
          error={fieldError("capacity")}
          disabled={saving}
        />
        <p className="text-xs text-muted-foreground">{line}</p>
      </div>

      <div className="space-y-1.5">
        <Checkbox
          id="event-config-umbrella"
          label="Umbrella event"
          checked={isUmbrella}
          onChange={(e) => touched(setIsUmbrella)(e.target.checked)}
          disabled={saving}
        />
        <p className="text-xs text-muted-foreground">
          An umbrella has no trajectory, no tickets and no cost per ticket. Its spend shows on its own.
        </p>
      </div>

      <div className="space-y-1.5">
        <Input
          id="event-config-cirqlin"
          label="CIRQLIN page id"
          value={pageId}
          onChange={(e) => touched(setPageId)(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          error={fieldError("cirqlinPageId")}
          disabled={saving}
        />
        {!pageId.trim() && <p className="text-xs text-muted-foreground">{NO_CIRQLIN_PAGE}.</p>}
      </div>

      <ReferencePicker options={options} picked={picked} onToggle={toggle} disabled={saving} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="event-config-aliases" className="text-sm font-medium text-foreground">
          Count aliases
        </label>
        <textarea
          id="event-config-aliases"
          value={aliases}
          onChange={(e) => touched(setAliases)(e.target.value)}
          rows={3}
          spellCheck={false}
          disabled={saving}
          className={`w-full rounded-md border bg-background px-3 py-2 font-mono text-sm
            focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring
            ${fieldError("aliases") ? "border-destructive" : "border-border-strong"}`}
        />
        {fieldError("aliases") ? (
          <p className="text-xs text-destructive">{fieldError("aliases")}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {aliases.trim()
              ? "One per line, exactly as Internal Counts writes the show's name. Case counts."
              : "No aliases: this show's counts go to the review list."}
          </p>
        )}
      </div>

      {error && !error.field && <p className="text-xs text-destructive">{error.message}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" disabled={saving}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save dashboard settings
        </Button>
        {saved && <span className="text-xs text-muted-foreground">Saved</span>}
      </div>
    </form>
  );
}
