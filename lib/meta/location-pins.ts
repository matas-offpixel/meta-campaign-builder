/**
 * Location pins (design record
 * docs/design-record/2026-11-24-campaign-creator-location-pin.html, LP1–LP5).
 *
 * Shared by the Step 5 picker and the launch checks (#1361's 811209 warning
 * uses `regionMismatchForSelection` and the same words). Pure: no React, no
 * fetch.
 *
 * The words are design's list (words-location-pins-2026-11-24.tsv, copied as
 * the fixture next to the tests). Never write a string here that isn't in
 * that list: lib/meta/__tests__/location-pins-words.test.ts fails on any
 * difference, and on a key no code uses.
 */

import type { LocationSelection, LocationTargetingGroup, LocationTier } from "../types.ts";

export const LOCATION_PIN_WORDS = {
  "location.pin.row": "{name} (pin) · {radius} km",
  "location.pin.chip": "{+|−} {name} (pin) · {radius} km · {latitude}, {longitude}",
  "location.pin.badge": "pin",
  "location.pin.add": "Add a pin",
  "location.pin.title": "Add a pin",
  "location.pin.help": "A pin targets a circle around a point. Use it where Meta has no city.",
  "location.pin.name": "Name",
  "location.pin.name.placeholder": "e.g. Leeds",
  "location.pin.latitude": "Latitude",
  "location.pin.longitude": "Longitude",
  "location.pin.radius": "Radius (km)",
  "location.pin.paste": "Paste “53.7997, -1.5492” from a map and both fill.",
  "location.pin.save": "Add pin",
  "location.pin.cancel": "Cancel",
  "location.pin.error.name": "Name the pin.",
  "location.pin.error.latitude": "Latitude is a number from -90 to 90.",
  "location.pin.error.longitude": "Longitude is a number from -180 to 180.",
  "location.pin.error.radius": "Radius is 1 to 80 km.",
  "location.preset.leeds": "Leeds, West Yorkshire (pin)",
  "location.preset.leeds.title": "Leeds city centre, 53.7997, -1.5492, 80 km. Meta has no Leeds city in West Yorkshire.",
  "location.region_mismatch": "{name}, {region}: this is in {region}, not {expected region}.",
  "location.region_mismatch.fix": "Use the {name} pin",
  "location.region_mismatch.fix.none": "Add a pin",
  "location.region_mismatch.keep": "Keep {name}, {region}",
  "location.region_mismatch.kept": "{name}, {region} kept by {who}, {date, time}",
} as const;

export type LocationPinWordKey = keyof typeof LOCATION_PIN_WORDS;

export function pinWord(key: LocationPinWordKey): string {
  return LOCATION_PIN_WORDS[key];
}

/** Replace each `{name}` with its value; a fill-in with no value stays as written. */
export function fillPinWords(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([^{}]+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
  );
}

// ─── Pins ───────────────────────────────────────────────────────────────────

/** Meta's range for a custom location's radius (LP2). */
export const PIN_RADIUS_MIN_KM = 1;
export const PIN_RADIUS_MAX_KM = 80;
/** The form's starting radius, like a searched city's (LP2, invented in the record). */
export const PIN_DEFAULT_RADIUS_KM = 40;

export interface PinPreset {
  /** The group id the preset chip toggles. */
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  chip: LocationPinWordKey;
  title: LocationPinWordKey;
}

/** LP3. The point is #1368's live write: Leeds city centre, 80 km. */
export const PIN_PRESETS = {
  leeds: {
    id: "preset_leeds_pin",
    name: "Leeds",
    latitude: 53.7997,
    longitude: -1.5492,
    radiusKm: 80,
    chip: "location.preset.leeds",
    title: "location.preset.leeds.title",
  },
} as const satisfies Record<string, PinPreset>;

export type PinPresetKey = keyof typeof PIN_PRESETS;

/** A number as entered: no trailing zeros added, none lost ("53.7997", "-1.5492", "80"). */
function num(n: number): string {
  return String(n);
}

export function isPin(sel: LocationSelection): boolean {
  return sel.locationType === "pin" && typeof sel.latitude === "number" && typeof sel.longitude === "number";
}

/** "Leeds (pin) · 80 km" — the row and the group label (LP1). */
export function pinRowLabel(name: string, radiusKm: number): string {
  return fillPinWords(pinWord("location.pin.row"), { name, radius: num(radiusKm) });
}

/** "+ Leeds (pin) · 80 km · 53.7997, -1.5492", "−" when excluded (LP1). */
export function pinChipLabel(sel: LocationSelection): string {
  return fillPinWords(pinWord("location.pin.chip"), {
    "+|−": sel.mode === "exclude" ? "−" : "+",
    name: sel.label,
    radius: num(sel.radius ?? 0),
    latitude: num(sel.latitude ?? 0),
    longitude: num(sel.longitude ?? 0),
  });
}

export interface PinInput {
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  mode: "include" | "exclude";
  tier?: LocationTier;
}

export function pinSelection(input: PinInput, source: "search" | "preset", id: string): LocationSelection {
  return {
    id,
    source,
    label: input.name.trim(),
    mode: input.mode,
    locationType: "pin",
    latitude: input.latitude,
    longitude: input.longitude,
    radius: input.radiusKm,
    distanceUnit: "kilometer",
    ...(input.tier ? { tier: input.tier } : {}),
  };
}

/** A hand-added pin's group (badge "pin"). `stamp` makes the ids unique, like a search add's `manual_{Date.now()}`. */
export function manualPinGroup(input: PinInput, stamp: number): LocationTargetingGroup {
  return {
    id: `manual_pin_${stamp}`,
    label: pinRowLabel(input.name.trim(), input.radiusKm),
    source: "manual",
    selections: [pinSelection(input, "search", `pin_${stamp}_${input.mode}`)],
  };
}

/** The preset's group (badge "preset"). Needs no Meta search: the point is fixed. */
export function presetPinGroup(
  key: PinPresetKey,
  opts: { id?: string; mode?: "include" | "exclude"; tier?: LocationTier } = {},
): LocationTargetingGroup {
  const p = PIN_PRESETS[key];
  const mode = opts.mode ?? "include";
  return {
    id: opts.id ?? p.id,
    label: pinRowLabel(p.name, p.radiusKm),
    source: "preset",
    selections: [
      pinSelection(
        { name: p.name, latitude: p.latitude, longitude: p.longitude, radiusKm: p.radiusKm, mode, tier: opts.tier },
        "preset",
        `${p.id}_${mode}`,
      ),
    ],
  };
}

/** True when the group is that preset's pin (the chip is on), whatever its id. */
export function isPresetPinGroup(group: LocationTargetingGroup, key: PinPresetKey): boolean {
  const p = PIN_PRESETS[key];
  if (group.id === p.id) return true;
  return (
    group.source === "preset" &&
    group.selections.length === 1 &&
    group.selections.every(
      (s) => isPin(s) && s.latitude === p.latitude && s.longitude === p.longitude && s.radius === p.radiusKm,
    )
  );
}

/** A group whose every selection is a pin. */
export function isPinGroup(group: LocationTargetingGroup): boolean {
  return group.selections.length > 0 && group.selections.every(isPin);
}

// ─── The form (LP2) ─────────────────────────────────────────────────────────

export interface PinFormValues {
  name: string;
  latitude: string;
  longitude: string;
  radius: string;
}

export type PinFormErrors = Partial<Record<keyof PinFormValues, LocationPinWordKey>>;

const PAIR = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

/** "53.7997, -1.5492" → both numbers, as typed. Anything else → null. */
export function parseLatLngPair(text: string): { latitude: string; longitude: string } | null {
  const m = PAIR.exec(text);
  return m ? { latitude: m[1]!, longitude: m[2]! } : null;
}

function finite(text: string): number | null {
  const t = text.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Each error under its own field, checked when Add pin is pressed. */
export function validatePinForm(values: PinFormValues): {
  errors: PinFormErrors;
  pin: Omit<PinInput, "mode" | "tier"> | null;
} {
  const errors: PinFormErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = "location.pin.error.name";
  const latitude = finite(values.latitude);
  if (latitude === null || latitude < -90 || latitude > 90) errors.latitude = "location.pin.error.latitude";
  const longitude = finite(values.longitude);
  if (longitude === null || longitude < -180 || longitude > 180) errors.longitude = "location.pin.error.longitude";
  const radiusKm = finite(values.radius);
  if (radiusKm === null || radiusKm < PIN_RADIUS_MIN_KM || radiusKm > PIN_RADIUS_MAX_KM) {
    errors.radius = "location.pin.error.radius";
  }
  if (Object.keys(errors).length) return { errors, pin: null };
  return { errors, pin: { name, latitude: latitude!, longitude: longitude!, radiusKm: radiusKm! } };
}

// ─── A hit in the wrong place (LP4) ─────────────────────────────────────────

export interface KnownAmbiguousCity {
  /** The name most people mean. */
  name: string;
  /** Where Meta's city actually is. Meta's own `region` for 811209 is just "England", so it is never read. */
  actual: string;
  /** Where people mean. */
  expected: string;
  /** The pin preset that fixes it, if there is one. */
  pinPreset?: PinPresetKey;
}

/**
 * Places Meta has under a name that most people mean for somewhere else,
 * keyed by Meta city key. Added to as cases turn up.
 */
export const KNOWN_AMBIGUOUS_CITIES: Readonly<Record<string, KnownAmbiguousCity>> = {
  // Leeds, Kent. Meta has no Leeds city in West Yorkshire (#1368).
  "811209": { name: "Leeds", actual: "Kent", expected: "West Yorkshire", pinPreset: "leeds" },
};

export interface RegionMismatch {
  cityKey: string;
  entry: KnownAmbiguousCity;
  /** "Leeds, Kent: this is in Kent, not West Yorkshire." */
  line: string;
  /** "Use the Leeds pin" when a preset exists, else "Add a pin". */
  fix: string;
  /** The preset the fix adds, if any. */
  pinPreset?: PinPresetKey;
  /** "Keep Leeds, Kent" (rows only). */
  keep: string;
}

/** The region the operator typed after a comma, if any ("Leeds, Kent" → "kent"). */
function typedRegion(query: string | undefined): string | null {
  if (!query) return null;
  const i = query.indexOf(",");
  if (i < 0) return null;
  const region = query.slice(i + 1).trim().toLowerCase();
  return region || null;
}

/**
 * The mismatch for a Meta city key, or null. `query` is the text typed in
 * the search: "Leeds, Kent" asked for Kent, so it gives no line; "Leeds" and
 * "Leeds, West Yorkshire" do.
 */
export function regionMismatchForCityKey(cityKey: string | undefined, query?: string): RegionMismatch | null {
  if (!cityKey) return null;
  const entry = KNOWN_AMBIGUOUS_CITIES[cityKey];
  if (!entry) return null;
  if (typedRegion(query) === entry.actual.toLowerCase()) return null;
  const named = { name: entry.name, region: entry.actual };
  return {
    cityKey,
    entry,
    line: fillPinWords(pinWord("location.region_mismatch"), { ...named, "expected region": entry.expected }),
    fix: entry.pinPreset
      ? fillPinWords(pinWord("location.region_mismatch.fix"), { name: PIN_PRESETS[entry.pinPreset].name })
      : pinWord("location.region_mismatch.fix.none"),
    pinPreset: entry.pinPreset,
    keep: fillPinWords(pinWord("location.region_mismatch.keep"), named),
  };
}

/** A saved selection's mismatch (null when it isn't on the list). Ignores Keep: see `keptRegionMismatchLine`. */
export function regionMismatchForSelection(sel: LocationSelection): RegionMismatch | null {
  if (sel.locationType !== "city") return null;
  return regionMismatchForCityKey(sel.locationKey);
}

/** The first include selection in a group that is on the list and not kept. */
export function openRegionMismatch(group: LocationTargetingGroup): { sel: LocationSelection; mismatch: RegionMismatch } | null {
  for (const sel of group.selections) {
    if (sel.regionMismatchKept) continue;
    const mismatch = regionMismatchForSelection(sel);
    if (mismatch) return { sel, mismatch };
  }
  return null;
}

const KEPT_AT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "{date, time}": "Tue 24 Nov, 16:40", London time — the launch checks' format (RC3). */
export function keptAtLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = Object.fromEntries(KEPT_AT.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute}`;
}

/** "Leeds, Kent kept by Matas, Tue 24 Nov, 16:40" (muted), or null when not kept. */
export function keptRegionMismatchLine(sel: LocationSelection): string | null {
  if (!sel.regionMismatchKept) return null;
  const mismatch = regionMismatchForSelection(sel);
  if (!mismatch) return null;
  return fillPinWords(pinWord("location.region_mismatch.kept"), {
    name: mismatch.entry.name,
    region: mismatch.entry.actual,
    who: sel.regionMismatchKept.keptBy,
    "date, time": keptAtLabel(sel.regionMismatchKept.keptAt),
  });
}

/** Keep: store who and when on the selection, in draft_json. */
export function keepRegionMismatch(
  group: LocationTargetingGroup,
  selectionId: string,
  keptBy: string,
  now: Date,
): LocationTargetingGroup {
  return {
    ...group,
    selections: group.selections.map((s) =>
      s.id === selectionId ? { ...s, regionMismatchKept: { keptBy, keptAt: now.toISOString() } } : s,
    ),
  };
}

/**
 * "Use the Leeds pin" on a Locations row (LP5): the row becomes the preset's
 * pin, keeping its tier and mode. The group keeps its id, so every ad set
 * that targets it targets the pin.
 */
export function swapGroupForPinPreset(group: LocationTargetingGroup, key: PinPresetKey): LocationTargetingGroup {
  const first = group.selections[0];
  const tiers = new Set(group.selections.filter((s) => s.mode === "include").map((s) => s.tier));
  const tier = tiers.size === 1 ? [...tiers][0] : undefined;
  return presetPinGroup(key, { id: group.id, mode: first?.mode ?? "include", tier });
}
