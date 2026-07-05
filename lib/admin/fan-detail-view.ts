/**
 * lib/admin/fan-detail-view.ts — pure transforms for the fan detail view
 * (OP909 admin Sprint 2 PR 6). The service-role read (lib/db/fan-detail.ts)
 * decrypts PII + fetches the raw rows; everything shaped here is deterministic
 * and node:test-able with fixtures. No IO, no decryption.
 */

import { formatCountry } from "./country-names.ts";

// ─── Status ──────────────────────────────────────────────────────────────────

export type FanStatus = "active" | "deleted" | "anonymized";

/** Anonymised takes precedence over deleted (it's the stronger, irreversible state). */
export function fanStatus(
  deletedAt: string | null | undefined,
  anonymizedAt: string | null | undefined,
): FanStatus {
  if (anonymizedAt) return "anonymized";
  if (deletedAt) return "deleted";
  return "active";
}

// ─── Attribution / click ids ───────────────────────────────────────────────────

export interface ClickIds {
  fbclid: string | null;
  ttclid: string | null;
  gclid: string | null;
}

/**
 * Meta/TikTok/Google click ids ride along in the utm jsonb (allowlisted by
 * signup-schema UTM_ALLOWLIST). fbc/fbp browser cookies are NOT persisted —
 * fbclid is the closest stored Meta attribution signal.
 */
export function extractClickIds(
  utm: Record<string, string> | null | undefined,
): ClickIds {
  const u = utm ?? {};
  const pick = (k: string) => {
    const v = u[k];
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  };
  return { fbclid: pick("fbclid"), ttclid: pick("ttclid"), gclid: pick("gclid") };
}

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

export interface UtmPair {
  key: string;
  value: string;
}

/** The utm_* params (not the click ids), in a stable display order. */
export function utmParams(
  utm: Record<string, string> | null | undefined,
): UtmPair[] {
  const u = utm ?? {};
  const pairs: UtmPair[] = [];
  for (const key of UTM_KEYS) {
    const v = u[key];
    if (typeof v === "string" && v.trim().length > 0) {
      pairs.push({ key, value: v.trim() });
    }
  }
  return pairs;
}

// ─── Geo ───────────────────────────────────────────────────────────────────────

/**
 * IP-derived location as a single human string, e.g.
 * "London, ENG · United Kingdom (GB)". Falls back gracefully as parts drop
 * out; "—" when there's no geo at all. Raw IP is never stored (ip_hash only).
 */
export function formatGeo(
  country: string | null | undefined,
  region: string | null | undefined,
  city: string | null | undefined,
): string {
  const locality = [city, region].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  const countryLabel = country ? formatCountry(country) : null;
  const localityStr = locality.join(", ");
  if (localityStr && countryLabel) return `${localityStr} · ${countryLabel}`;
  if (countryLabel) return countryLabel;
  if (localityStr) return localityStr;
  return "—";
}

// ─── Meta event correlation (derived — no event log table exists) ───────────────

/**
 * The CompleteRegistration event_id the signup pipeline sends to Meta CAPI
 * (and the browser pixel fires the matching pair). Deterministic per signup:
 * `${signupId}-cr` — this is the fallback the server uses when the browser
 * didn't supply its own capi_event_id (which is NOT persisted). This is the
 * correlation key to look the fan up in Meta Events Manager; there is no
 * per-event delivery log stored on our side.
 */
export function completeRegistrationEventId(signupId: string): string {
  return `${signupId}-cr`;
}

// ─── Timeline ───────────────────────────────────────────────────────────────────

export interface TimelineInputRow {
  createdAt: string;
  eventName: string;
  isRepeat: boolean;
}

export interface TimelineEntry {
  at: string;
  eventName: string;
  kind: "signup" | "repeat";
}

/**
 * Merge the canonical signup with its repeat/attribution touches into one
 * timeline, newest first. Rows with an unparseable timestamp are dropped.
 */
export function buildTimeline(rows: TimelineInputRow[]): TimelineEntry[] {
  return rows
    .filter((r) => !Number.isNaN(new Date(r.createdAt).getTime()))
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((r) => ({
      at: r.createdAt,
      eventName: r.eventName,
      kind: r.isRepeat ? "repeat" : "signup",
    }));
}
