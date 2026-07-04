"use client";

import { useEffect, useRef, useState } from "react";

import {
  captureAttribution,
  persistAttribution,
  type CapturedAttribution,
} from "@/lib/landing-pages/attribution";
import {
  parseSignupSubmission,
  SIGNUP_PHONE_COUNTRIES,
} from "@/lib/landing-pages/signup-schema";
import type {
  SignupFormValues,
  SubmitSignupResult,
} from "@/lib/landing-pages/types";

import styles from "./landing-page.module.css";

/**
 * components/landing-pages/signup-form-block.tsx
 *
 * The signup form (client island). Validation runs the SAME shared schema
 * as the API route (lib/landing-pages/signup-schema.ts) so client and
 * server can never drift; the server remains authoritative.
 *
 * Attribution: utm_* / click-ids + referrer are captured on mount with
 * first-touch-wins sessionStorage persistence, so a fan who navigates
 * around before submitting still carries the ad attribution they landed
 * with.
 *
 * reCAPTCHA v3 (invisible): loaded only when a site key is configured
 * (passed down from the server component — the env var stays server-side).
 * When absent the form submits without a token; the server decides whether
 * that is acceptable (dev) or fatal (LANDING_PAGES_RECAPTCHA_REQUIRED=1).
 */

interface GrecaptchaLike {
  ready(cb: () => void): void;
  execute(siteKey: string, opts: { action: string }): Promise<string>;
}

declare global {
  interface Window {
    grecaptcha?: GrecaptchaLike;
  }
}

type SubmitState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "success"; deduplicated: boolean }
  | { phase: "error"; message: string };

export function SignupFormBlock({
  clientSlug,
  eventSlug,
  thankYouMessage,
  recaptchaSiteKey,
}: {
  clientSlug: string;
  eventSlug: string;
  thankYouMessage: string;
  recaptchaSiteKey: string | null;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState("GB");
  const [city, setCity] = useState("");
  const [igHandle, setIgHandle] = useState("");
  const [ttHandle, setTtHandle] = useState("");
  const [consentGdpr, setConsentGdpr] = useState(false);
  const [consentWa, setConsentWa] = useState(false);
  const [socialsOpen, setSocialsOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<SubmitState>({ phase: "idle" });

  const attributionRef = useRef<CapturedAttribution>({
    utm: {},
    referrer_url: null,
  });

  useEffect(() => {
    try {
      attributionRef.current = persistAttribution(
        window.sessionStorage,
        captureAttribution(window.location.search, document.referrer),
      );
    } catch {
      // Best-effort — attribution loss must never break the form.
    }
  }, []);

  useEffect(() => {
    if (!recaptchaSiteKey || window.grecaptcha) return;
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(recaptchaSiteKey)}`;
    script.async = true;
    document.head.appendChild(script);
  }, [recaptchaSiteKey]);

  async function captchaToken(): Promise<string | null> {
    if (!recaptchaSiteKey || !window.grecaptcha) return null;
    const grecaptcha = window.grecaptcha;
    try {
      await new Promise<void>((resolve) => grecaptcha.ready(resolve));
      return await grecaptcha.execute(recaptchaSiteKey, { action: "lp_signup" });
    } catch {
      return null;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state.phase === "submitting") return;

    const values: SignupFormValues = {
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      phone_country: phoneCountry,
      city,
      ig_handle: igHandle,
      tt_handle: ttHandle,
      consent_gdpr: consentGdpr,
      consent_wa_opt_in: consentWa,
      utm: attributionRef.current.utm,
      referrer_url: attributionRef.current.referrer_url,
    };

    const parsed = parseSignupSubmission(values);
    if (!parsed.ok) {
      setFieldErrors(parsed.field_errors);
      setState({ phase: "idle" });
      return;
    }
    setFieldErrors({});
    setState({ phase: "submitting" });

    try {
      const response = await fetch(
        `/api/l/${encodeURIComponent(clientSlug)}/${encodeURIComponent(eventSlug)}/signup`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...values, captcha_token: await captchaToken() }),
        },
      );
      const result = (await response.json()) as SubmitSignupResult;
      if (result.ok) {
        setState({ phase: "success", deduplicated: result.deduplicated });
        return;
      }
      if (result.field_errors) setFieldErrors(result.field_errors);
      setState({
        phase: "error",
        message: result.error || "Something went wrong — please try again.",
      });
    } catch {
      setState({
        phase: "error",
        message: "Couldn't reach the server — check your connection and try again.",
      });
    }
  }

  if (state.phase === "success") {
    return (
      <section className={styles.success} aria-live="polite">
        <h2 className={styles.successTitle}>You're on the list 🎉</h2>
        <p className={styles.successBody}>{thankYouMessage}</p>
        {state.deduplicated ? (
          <p className={styles.successBody}>
            (Looks like you'd already signed up — you're all set.)
          </p>
        ) : null}
      </section>
    );
  }

  const err = (key: string) =>
    fieldErrors[key] ? (
      <p className={styles.fieldError} role="alert">
        {fieldErrors[key]}
      </p>
    ) : null;

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <h2 className={styles.formTitle}>Sign up for updates</h2>
      <p className={styles.formIntro}>
        Be first to hear about tickets, line-ups and presale access.
      </p>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label htmlFor="lp-first-name">First name *</label>
          <input
            id="lp-first-name"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          {err("first_name")}
        </div>
        <div className={styles.field}>
          <label htmlFor="lp-last-name">Last name *</label>
          <input
            id="lp-last-name"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
          {err("last_name")}
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="lp-email">Email</label>
        <input
          id="lp-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {err("email")}
      </div>

      <div className={styles.field}>
        <label htmlFor="lp-phone">Phone</label>
        <div className={styles.phoneRow}>
          <select
            aria-label="Phone country"
            value={phoneCountry}
            onChange={(e) => setPhoneCountry(e.target.value)}
          >
            {SIGNUP_PHONE_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} {c.dial}
              </option>
            ))}
          </select>
          <input
            id="lp-phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        {err("phone")}
        {err("contact")}
      </div>

      <div className={styles.field}>
        <label htmlFor="lp-city">City</label>
        <input
          id="lp-city"
          autoComplete="address-level2"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
        {err("city")}
      </div>

      <button
        type="button"
        className={styles.socialsToggle}
        onClick={() => setSocialsOpen((open) => !open)}
        aria-expanded={socialsOpen}
      >
        {socialsOpen ? "▾" : "▸"} Add socials for early access perks?
      </button>

      {socialsOpen ? (
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label htmlFor="lp-ig">Instagram</label>
            <input
              id="lp-ig"
              placeholder="@yourhandle"
              autoComplete="off"
              value={igHandle}
              onChange={(e) => setIgHandle(e.target.value)}
            />
            {err("ig_handle")}
          </div>
          <div className={styles.field}>
            <label htmlFor="lp-tt">TikTok</label>
            <input
              id="lp-tt"
              placeholder="@yourhandle"
              autoComplete="off"
              value={ttHandle}
              onChange={(e) => setTtHandle(e.target.value)}
            />
            {err("tt_handle")}
          </div>
        </div>
      ) : null}

      <label className={`${styles.consent} ${styles.consentProminent}`}>
        <input
          type="checkbox"
          checked={consentGdpr}
          onChange={(e) => setConsentGdpr(e.target.checked)}
        />
        <span>
          I agree to receive updates about this event and understand my data
          will be handled per the privacy policy. *
        </span>
      </label>
      {err("consent_gdpr")}

      {phone.trim().length > 0 ? (
        <label className={styles.consent}>
          <input
            type="checkbox"
            checked={consentWa}
            onChange={(e) => setConsentWa(e.target.checked)}
          />
          <span>Also send me updates on WhatsApp.</span>
        </label>
      ) : null}

      {state.phase === "error" ? (
        <p className={styles.formError} role="alert">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        className={styles.submit}
        disabled={state.phase === "submitting"}
      >
        {state.phase === "submitting" ? "Signing you up…" : "Sign up"}
      </button>
    </form>
  );
}
