"use client";

/**
 * "Add a pin" (LP2 of docs/design-record/2026-11-24-campaign-creator-location-pin.html).
 * A small form in place under the location search. Every string is a row of
 * words-location-pins-2026-11-24.tsv, through `pinWord`; Include / Exclude
 * are the picker's existing words.
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { StatusLine } from "@/components/steps/step-surface";
import { createClient } from "@/lib/supabase/client";
import {
  PIN_DEFAULT_RADIUS_KM,
  parseLatLngPair,
  pinWord,
  validatePinForm,
  type PinFormErrors,
  type PinFormValues,
  type PinInput,
} from "@/lib/meta/location-pins";

export function emptyPinForm(name = ""): PinFormValues {
  return { name, latitude: "", longitude: "", radius: String(PIN_DEFAULT_RADIUS_KM) };
}

const FIELD =
  "w-full rounded-md border bg-card px-2 py-1.5 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none";

export function LocationPinForm({
  initial,
  initialMode = "include",
  initialChecked = false,
  onAdd,
  onCancel,
}: {
  initial: PinFormValues;
  initialMode?: "include" | "exclude";
  /** Frames only: show the checks as if Add pin had been pressed. */
  initialChecked?: boolean;
  onAdd: (pin: Omit<PinInput, "tier">) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<PinFormValues>(initial);
  const [mode, setMode] = useState<"include" | "exclude">(initialMode);
  const [errors, setErrors] = useState<PinFormErrors>(() => (initialChecked ? validatePinForm(initial).errors : {}));

  const set = (field: keyof PinFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const setLatitude = (value: string) => {
    // A pair from a map ("53.7997, -1.5492") fills both fields.
    const pair = parseLatLngPair(value);
    if (!pair) return set("latitude", value);
    setValues((prev) => ({ ...prev, latitude: pair.latitude, longitude: pair.longitude }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next.latitude;
      delete next.longitude;
      return next;
    });
  };

  const submit = () => {
    const checked = validatePinForm(values);
    setErrors(checked.errors);
    if (checked.pin) onAdd({ ...checked.pin, mode });
  };

  const field = (
    key: keyof PinFormValues,
    label: string,
    input: React.ReactNode,
    help?: string,
  ) => (
    <div className={key === "name" ? "col-span-2 min-w-0 sm:col-span-1" : "min-w-0"}>
      <label className="mb-1 block text-[11.5px] font-semibold" htmlFor={`pin-${key}`}>
        {label}
      </label>
      {input}
      {errors[key] ? (
        <StatusLine tone="alert" className="mt-1 text-[11.5px] text-destructive">
          {pinWord(errors[key]!)}
        </StatusLine>
      ) : help ? (
        <StatusLine className="mt-1 text-[11.5px] text-muted-foreground">{help}</StatusLine>
      ) : null}
    </div>
  );

  const cls = (key: keyof PinFormValues) => `${FIELD} ${errors[key] ? "border-destructive" : "border-border"}`;

  return (
    <div className="mt-2 rounded-lg border border-border bg-card p-3" data-pin-form="">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{pinWord("location.pin.title")}</span>
        <button
          type="button"
          onClick={onCancel}
          aria-label={pinWord("location.pin.cancel")}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <StatusLine className="mt-0.5 mb-2 text-xs text-muted-foreground">{pinWord("location.pin.help")}</StatusLine>
      <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-[1.4fr_1fr_1fr_0.8fr_auto]">
        {field(
          "name",
          pinWord("location.pin.name"),
          <input
            id="pin-name"
            type="text"
            value={values.name}
            placeholder={pinWord("location.pin.name.placeholder")}
            onChange={(e) => set("name", e.target.value)}
            className={cls("name")}
          />,
        )}
        {field(
          "latitude",
          pinWord("location.pin.latitude"),
          <input
            id="pin-latitude"
            type="text"
            inputMode="decimal"
            value={values.latitude}
            onChange={(e) => setLatitude(e.target.value)}
            className={cls("latitude")}
          />,
          pinWord("location.pin.paste"),
        )}
        {field(
          "longitude",
          pinWord("location.pin.longitude"),
          <input
            id="pin-longitude"
            type="text"
            inputMode="decimal"
            value={values.longitude}
            onChange={(e) => set("longitude", e.target.value)}
            className={cls("longitude")}
          />,
        )}
        {field(
          "radius",
          pinWord("location.pin.radius"),
          <input
            id="pin-radius"
            type="text"
            inputMode="numeric"
            value={values.radius}
            onChange={(e) => set("radius", e.target.value)}
            className={cls("radius")}
          />,
        )}
        <div className="min-w-0">
          <span className="mb-1 block text-[11.5px] font-semibold">&nbsp;</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "include" | "exclude")}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
          >
            <option value="include">Include</option>
            <option value="exclude">Exclude</option>
          </select>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          {pinWord("location.pin.cancel")}
        </button>
        <button
          type="button"
          onClick={submit}
          className="rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          {pinWord("location.pin.save")}
        </button>
      </div>
    </div>
  );
}

/**
 * Who a Keep records: the signed-in operator's email (or id), as the launch
 * checks' Keep does (#1361). `fallback` stands in where there is no session
 * (frames).
 */
export function useViewerLabel(fallback = "operator"): string {
  const [viewer, setViewer] = useState(fallback);
  useEffect(() => {
    let alive = true;
    try {
      createClient()
        .auth.getUser()
        .then(({ data }) => {
          const label = data.user?.email ?? data.user?.id;
          if (alive && label) setViewer(label);
        })
        .catch(() => {});
    } catch {
      // No Supabase in this environment (frames): keep the fallback.
    }
    return () => {
      alive = false;
    };
  }, []);
  return viewer;
}
