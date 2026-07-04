import { UTM_ALLOWLIST } from "./signup-schema.ts";

/**
 * lib/landing-pages/attribution.ts
 *
 * Client-side attribution capture for the landing pages. Pure functions +
 * an injectable Storage so node:test covers the logic without a browser.
 *
 * First-touch semantics: the attribution persisted in sessionStorage on
 * first landing wins — a fan who arrives from a Meta ad, browses, loses the
 * query string on a soft navigation, and submits later still carries the
 * original utm_* payload.
 */

export interface CapturedAttribution {
  utm: Record<string, string>;
  referrer_url: string | null;
}

const STORAGE_KEY = "lp_attribution_v1";

/** Minimal Storage slice (sessionStorage-compatible) for testability. */
export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Parse allowlisted attribution params out of a location.search string. */
export function captureAttribution(
  search: string,
  referrer: string | null | undefined,
): CapturedAttribution {
  const utm: Record<string, string> = {};
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search ?? "");
  } catch {
    params = new URLSearchParams();
  }
  for (const key of UTM_ALLOWLIST) {
    const value = params.get(key);
    if (value && value.trim().length > 0) {
      utm[key] = value.trim().slice(0, 300);
    }
  }
  const ref = (referrer ?? "").trim();
  return {
    utm,
    referrer_url: ref.length > 0 && ref.length <= 2000 ? ref : null,
  };
}

/**
 * Persist with first-touch-wins: an existing stored payload with any utm
 * keys is kept; an empty capture never clobbers a meaningful one.
 */
export function persistAttribution(
  storage: StringStorage,
  captured: CapturedAttribution,
): CapturedAttribution {
  const existing = readAttribution(storage);
  if (existing && Object.keys(existing.utm).length > 0) {
    return existing;
  }
  const winner =
    Object.keys(captured.utm).length > 0 || !existing ? captured : existing;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(winner));
  } catch {
    // Storage full / privacy mode — attribution is best-effort.
  }
  return winner;
}

export function readAttribution(
  storage: StringStorage,
): CapturedAttribution | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CapturedAttribution;
    if (!parsed || typeof parsed !== "object" || typeof parsed.utm !== "object") {
      return null;
    }
    return {
      utm: parsed.utm ?? {},
      referrer_url:
        typeof parsed.referrer_url === "string" ? parsed.referrer_url : null,
    };
  } catch {
    return null;
  }
}
