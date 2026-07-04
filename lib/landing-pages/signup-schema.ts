import { parsePhoneNumberFromString } from "libphonenumber-js";

import type { SignupFormValues, SignupSubmission } from "./types.ts";

/**
 * lib/landing-pages/signup-schema.ts
 *
 * SHARED validation + normalisation for the signup form. Imported by BOTH
 * the client form component and the API route — one schema, two enforcement
 * points, so client and server can never drift.
 *
 * Deliberately dependency-free except libphonenumber-js (already a repo
 * dependency; used for E.164). The repo has no zod — adding it mid-PR
 * violates the no-new-deps rule; this module carries the same
 * parse-don't-validate contract with a zod-compatible result shape so a
 * future swap is mechanical. See the PR-2 judgment-call notes.
 */

export const SIGNUP_MAX_HANDLE_LENGTH = 30;

/** Countries offered by the phone dropdown (extend freely). */
export const SIGNUP_PHONE_COUNTRIES: ReadonlyArray<{
  code: string;
  label: string;
  dial: string;
}> = [
  { code: "GB", label: "United Kingdom", dial: "+44" },
  { code: "ES", label: "Spain", dial: "+34" },
  { code: "IE", label: "Ireland", dial: "+353" },
  { code: "FR", label: "France", dial: "+33" },
  { code: "DE", label: "Germany", dial: "+49" },
  { code: "IT", label: "Italy", dial: "+39" },
  { code: "NL", label: "Netherlands", dial: "+31" },
  { code: "PT", label: "Portugal", dial: "+351" },
  { code: "US", label: "United States", dial: "+1" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HANDLE_RE = /^[a-z0-9._]{1,30}$/;

export type ParseSignupResult =
  | { ok: true; data: SignupSubmission }
  | { ok: false; field_errors: Record<string, string> };

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Strip a leading @, lowercase, trim. Returns null for empty input. */
export function normalizeHandle(raw: unknown): string | null {
  const value = asTrimmedString(raw).replace(/^@+/, "").toLowerCase();
  return value.length === 0 ? null : value;
}

export function normalizeEmail(raw: unknown): string | null {
  const value = asTrimmedString(raw).toLowerCase();
  return value.length === 0 ? null : value;
}

/**
 * Parse + normalise an untrusted submission. Collects ALL field errors in
 * one pass (the form shows them inline; the API returns them as
 * field_errors).
 */
export function parseSignupSubmission(
  values: SignupFormValues,
): ParseSignupResult {
  const errors: Record<string, string> = {};

  // PR 6: first_name / last_name / city no longer exist. Legacy payloads
  // still carrying them are IGNORED (never rejected) — a stale cached
  // bundle mid-deploy must not 400 a fan's signup.

  const email = normalizeEmail(values.email);
  if (email !== null && (!EMAIL_RE.test(email) || email.length > 254)) {
    errors.email = "Enter a valid email address.";
  }

  // PR 7 note (E.164 trunk-prefix stripping): parsePhoneNumberFromString
  // ALREADY strips a national trunk "0" (GB "07700…", FR "06…", DE "030…"
  // etc.) when given the right defaultCountry — verified directly against
  // this exact libphonenumber-js version before writing this comment.
  // A hand-rolled "strip a leading 0" pass on top would be redundant at
  // best and wrong at worst (some numbering plans use a leading 0 as part
  // of the subscriber number, not a trunk prefix — libphonenumber's
  // per-country metadata already knows the difference; a blind string
  // strip does not). No separate sanitiser was added; see
  // signup-schema.test.ts's "trunk-zero" describe block for the pinned
  // behaviour (07700…, 7700…, +447700… → the same E.164).
  const rawPhone = asTrimmedString(values.phone);
  const phoneCountry = asTrimmedString(values.phone_country).toUpperCase();
  let phoneE164: string | null = null;
  let phoneCountryCode: string | null = null;
  if (rawPhone.length > 0) {
    const parsed = parsePhoneNumberFromString(
      rawPhone,
      /^[A-Z]{2}$/.test(phoneCountry)
        ? { defaultCountry: phoneCountry as never }
        : undefined,
    );
    if (!parsed || !parsed.isValid()) {
      errors.phone = "Enter a valid phone number.";
    } else {
      phoneE164 = parsed.number; // E.164
      phoneCountryCode = parsed.country ?? phoneCountry ?? null;
    }
  }

  if (email === null && rawPhone.length === 0) {
    errors.contact = "Provide an email address or a phone number.";
  }

  const igHandle = normalizeHandle(values.ig_handle);
  if (igHandle !== null && !HANDLE_RE.test(igHandle)) {
    errors.ig_handle =
      "Instagram handle: letters, numbers, dots and underscores only (max 30).";
  }
  const ttHandle = normalizeHandle(values.tt_handle);
  if (ttHandle !== null && !HANDLE_RE.test(ttHandle)) {
    errors.tt_handle =
      "TikTok handle: letters, numbers, dots and underscores only (max 30).";
  }

  // PR 6 mutex: the form's segmented toggle sends exactly one platform;
  // both set means a bypassed/broken client → reject rather than guess
  // which identity the fan meant.
  if (igHandle !== null && ttHandle !== null) {
    errors.social = "Provide an Instagram or a TikTok handle, not both.";
  }

  if (values.consent_gdpr !== true) {
    errors.consent_gdpr = "You must agree to the privacy policy to sign up.";
  }

  // WA opt-in is only meaningful with a phone number — silently drop it
  // otherwise (the form hides the checkbox, but never trust the client).
  const consentWaOptIn = values.consent_wa_opt_in === true && phoneE164 !== null;

  // Attribution: allowlisted keys only, values clamped.
  const utm: Record<string, string> = {};
  if (values.utm && typeof values.utm === "object" && !Array.isArray(values.utm)) {
    for (const key of UTM_ALLOWLIST) {
      const v = (values.utm as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim().length > 0) {
        utm[key] = v.trim().slice(0, 300);
      }
    }
  }
  const referrerRaw = asTrimmedString(values.referrer_url);
  const referrerUrl =
    referrerRaw.length > 0 && referrerRaw.length <= 2000 ? referrerRaw : null;

  // PR 3: Meta event id for client/server dedup. Invalid or missing values
  // degrade to null (server generates one) — never a field error, because
  // ad-tracking hygiene must not block a fan's signup.
  const capiEventIdRaw = asTrimmedString(values.capi_event_id);
  const capiEventId = CAPI_EVENT_ID_RE.test(capiEventIdRaw)
    ? capiEventIdRaw
    : null;

  if (Object.keys(errors).length > 0) {
    return { ok: false, field_errors: errors };
  }

  return {
    ok: true,
    data: {
      email,
      phone_e164: phoneE164,
      phone_country_code: phoneCountryCode,
      ig_handle: igHandle,
      tt_handle: ttHandle,
      consent_wa_opt_in: consentWaOptIn,
      utm,
      referrer_url: referrerUrl,
      source: inferSignupSource(utm),
      capi_event_id: capiEventId,
    },
  };
}

/**
 * Meta event_id charset — mirrors isValidCapiEventId in pixel-events.ts
 * (kept as a literal here so this module stays dependency-free for the
 * client bundle).
 */
const CAPI_EVENT_ID_RE = /^[A-Za-z0-9._:-]{8,64}$/;

export const UTM_ALLOWLIST = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "ttclid",
  "gclid",
] as const;

/**
 * Coarse source bucket from attribution. Heuristic on purpose — analytics
 * refinement is PR 6's job; this just gives Matas a usable split now.
 */
export function inferSignupSource(utm: Record<string, string>): string | null {
  const source = (utm.utm_source ?? "").toLowerCase();
  if (/facebook|instagram|meta|ig\b/.test(source) || utm.fbclid) {
    return "paid_meta";
  }
  if (/tiktok/.test(source) || utm.ttclid) return "paid_tiktok";
  if (/google|youtube/.test(source) || utm.gclid) return "paid_google";
  if (source.length > 0) return `other_${source.slice(0, 40)}`;
  return Object.keys(utm).length === 0 ? "organic" : null;
}
