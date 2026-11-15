/**
 * Client-side identity and apply rules for Google Search geo rows.
 *
 * The saved jsonb shape stays `{ location, bid_modifier_pct, resolved_* }`.
 * `geo-targets-codec` rebuilds each target and drops anything else, so a
 * row id and a `resolved_for` stamp are not persisted. Identity lives on
 * `GeoRowModel` in the wizard. Push trusts a stored resource name only
 * when `resolved_name` still belongs to the location text.
 */

import type { GoogleSearchGeoTarget } from "./types.ts";

export type GeoResolveStatus = "idle" | "loading" | "matched" | "no_match" | "no_account";

export interface GeoResolveUi {
  status: GeoResolveStatus;
  /** Present when status === "matched". Canonical name from Google. */
  canonicalName?: string;
  /** Present when status === "no_match". The location string that was tried. */
  attempted?: string;
  /** Set when Google has no target for an English region name. */
  warning?: string;
}

export interface GeoRowModel {
  id: string;
  geo: GoogleSearchGeoTarget;
  resolve: GeoResolveUi;
}

export interface GeoResolveMatch {
  resourceName: string;
  canonicalName: string;
}

/** Lowercase, punctuation folded to spaces, collapsed. */
export function normaliseGeoMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * A canonical name belongs to the typed location when it starts with that
 * text. "sunderlan" matches "Sunderland, England, United Kingdom".
 * "United Kingdom" does not match "Newcastle upon Tyne, England, United
 * Kingdom" — the country is only a suffix, so an includes-check would
 * accept the wrong place.
 *
 * No canonical name means nothing contradicts the stored id (older rows
 * that only stamped `resolved_resource_name`).
 */
export function resolutionMatchesLocation(
  location: string,
  resolvedName: string | null | undefined,
): boolean {
  if (resolvedName == null || resolvedName.trim() === "") return true;
  const typed = normaliseGeoMatchText(location);
  const canonical = normaliseGeoMatchText(resolvedName);
  if (!typed || !canonical) return false;
  return canonical.startsWith(typed);
}

export function geoResolutionIsTrusted(geo: GoogleSearchGeoTarget): boolean {
  return trustedGeoResourceName(geo) != null;
}

/** Canonical name when it belongs to the location text, otherwise the typed text. */
export function geoDisplayName(geo: GoogleSearchGeoTarget | null | undefined): string | null {
  if (!geo) return null;
  if (geo.resolved_name && resolutionMatchesLocation(geo.location, geo.resolved_name)) {
    return geo.resolved_name;
  }
  return geo.location.trim() ? geo.location : null;
}

/** Resource name push may use without calling suggest. Null means look it up. */
export function trustedGeoResourceName(geo: GoogleSearchGeoTarget): string | null {
  const id = geo.resolved_resource_name?.trim();
  if (!id) return null;
  if (!resolutionMatchesLocation(geo.location, geo.resolved_name)) return null;
  return id;
}

export function defaultGeoRowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `geo-row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function resolveUiForGeo(geo: GoogleSearchGeoTarget): GeoResolveUi {
  if (geoResolutionIsTrusted(geo) && geo.resolved_name?.trim()) {
    return { status: "matched", canonicalName: geo.resolved_name };
  }
  if (
    geo.resolved_resource_name?.trim() &&
    geo.resolved_name?.trim() &&
    !resolutionMatchesLocation(geo.location, geo.resolved_name)
  ) {
    return { status: "loading" };
  }
  if (geo.resolved_resource_name === null && geo.location.trim()) {
    return { status: "no_match", attempted: geo.location.trim() };
  }
  return { status: "idle" };
}

export function geoRowsFromTargets(
  targets: GoogleSearchGeoTarget[],
  idFactory: () => string = defaultGeoRowId,
): GeoRowModel[] {
  return targets.map((geo) => ({
    id: idFactory(),
    geo: { ...geo },
    resolve: resolveUiForGeo(geo),
  }));
}

export function editGeoLocation(rows: GeoRowModel[], id: string, location: string): GeoRowModel[] {
  return rows.map((row) => {
    if (row.id !== id) return row;
    return {
      ...row,
      geo: {
        ...row.geo,
        location,
        resolved_resource_name: null,
        resolved_name: null,
      },
      resolve: location.trim() ? { status: "loading" } : { status: "idle" },
    };
  });
}

export function editGeoBid(
  rows: GeoRowModel[],
  id: string,
  bidModifierPct: number | null,
): GeoRowModel[] {
  return rows.map((row) =>
    row.id === id ? { ...row, geo: { ...row.geo, bid_modifier_pct: bidModifierPct } } : row,
  );
}

export function addEmptyGeoRow(
  rows: GeoRowModel[],
  idFactory: () => string = defaultGeoRowId,
): GeoRowModel[] {
  const geo: GoogleSearchGeoTarget = { location: "", bid_modifier_pct: null };
  return [...rows, { id: idFactory(), geo, resolve: { status: "idle" } }];
}

export function removeGeoRow(rows: GeoRowModel[], id: string): GeoRowModel[] {
  return rows.filter((row) => row.id !== id);
}

export function shouldApplyGeoResolution(currentLocation: string, requestedLocation: string): boolean {
  return currentLocation.trim() === requestedLocation.trim();
}

/**
 * Write a suggest result onto the row that asked for it. A response for
 * older text is ignored, and a missing id is a no-op, so a late resolve
 * cannot replace the list or land on a row that has since changed.
 */
export function applyGeoResolution(
  rows: GeoRowModel[],
  id: string,
  requestedLocation: string,
  result: GeoResolveMatch | null,
  warning?: string,
): GeoRowModel[] {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) return rows;
  if (!shouldApplyGeoResolution(row.geo.location, requestedLocation)) return rows;
  return rows.map((candidate) => {
    if (candidate.id !== id) return candidate;
    if (!result) {
      return {
        ...candidate,
        geo: { ...candidate.geo, resolved_resource_name: null, resolved_name: null },
        resolve: {
          status: "no_match",
          attempted: requestedLocation.trim(),
          ...(warning ? { warning } : {}),
        },
      };
    }
    return {
      ...candidate,
      geo: {
        ...candidate.geo,
        resolved_resource_name: result.resourceName,
        resolved_name: result.canonicalName,
      },
      resolve: { status: "matched", canonicalName: result.canonicalName },
    };
  });
}

export function setGeoResolveUi(rows: GeoRowModel[], id: string, resolve: GeoResolveUi): GeoRowModel[] {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row || sameResolveUi(row.resolve, resolve)) return rows;
  return rows.map((candidate) => (candidate.id === id ? { ...candidate, resolve } : candidate));
}

function sameResolveUi(a: GeoResolveUi, b: GeoResolveUi): boolean {
  return a.status === b.status && a.canonicalName === b.canonicalName && a.attempted === b.attempted && a.warning === b.warning;
}

/**
 * Keep row ids (and the tick hanging off them) when a save echo comes
 * back without client ids. Rows are matched in order when the location
 * text is unchanged, otherwise by the same location and stored resolution.
 */
export function syncGeoRows(
  prev: GeoRowModel[],
  nextTargets: GoogleSearchGeoTarget[],
  idFactory: () => string = defaultGeoRowId,
): GeoRowModel[] {
  const used = new Set<string>();
  return nextTargets.map((geo, index) => {
    const positional = prev[index];
    const positionalFits = positional != null && !used.has(positional.id) && positional.geo.location === geo.location;
    const match =
      (positionalFits ? positional : undefined) ??
      prev.find(
        (row) =>
          !used.has(row.id) &&
          row.geo.location === geo.location &&
          row.geo.resolved_resource_name === geo.resolved_resource_name &&
          row.geo.resolved_name === geo.resolved_name,
      );
    if (!match) {
      return { id: idFactory(), geo: { ...geo }, resolve: resolveUiForGeo(geo) };
    }
    used.add(match.id);
    const sameResolution =
      match.geo.location === geo.location &&
      match.geo.resolved_resource_name === geo.resolved_resource_name &&
      match.geo.resolved_name === geo.resolved_name;
    return {
      id: match.id,
      geo: { ...geo },
      resolve: sameResolution ? match.resolve : resolveUiForGeo(geo),
    };
  });
}

/**
 * One in-flight suggest per row. `abort` runs on every keystroke and on
 * unmount; `start` aborts again in case a request began before the latest
 * keystroke's abort.
 */
export function createGeoResolveSession() {
  let controller: AbortController | null = null;
  return {
    abort() {
      controller?.abort();
      controller = null;
    },
    start(): AbortController {
      controller?.abort();
      controller = new AbortController();
      return controller;
    },
  };
}
