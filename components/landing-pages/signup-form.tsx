"use client";

import { useEffect, useRef, useState } from "react";

import {
  captureAttribution,
  persistAttribution,
  type CapturedAttribution,
} from "@/lib/landing-pages/attribution";
import {
  buildCompleteRegistrationCommand,
  completeRegistrationEventId,
  getOrCreateEventBase,
  runPixelCommand,
} from "@/lib/landing-pages/pixel-events";
import { parseSignupSubmission } from "@/lib/landing-pages/signup-schema";
import type {
  SignupFormValues,
  SubmitSignupResult,
} from "@/lib/landing-pages/types";

import styles from "./landing-page.module.css";

/**
 * components/landing-pages/signup-form.tsx
 *
 * PR-6 Supreme signup form (replaces signup-form-block.tsx). Minimal
 * fields: email, phone, ONE social handle behind a segmented
 * Instagram/TikTok toggle, one consent checkbox. The write-defence
 * plumbing from PR 2/3 is unchanged: shared schema validation,
 * Cloudflare Turnstile (interaction-only), first-touch attribution, and
 * the shared browser/CAPI CompleteRegistration event id.
 *
 * Social mutex: the active pill decides which of ig_handle / tt_handle
 * is sent — the other is ALWAYS null (the server rejects both-set).
 * Handles are @-stripped + lowercased by the shared schema module.
 *
 * Phone: the country cell renders a static "uk +44" (text only — Supreme
 * discipline, no flag emoji) and parsing defaults to GB; international
 * fans can still type a full +XX number, which E.164 parsing honours
 * over the default country.
 */

interface TurnstileLike {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
      appearance?: "always" | "execute" | "interaction-only";
    },
  ): string;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileLike;
  }
}

type SubmitState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "success"; deduplicated: boolean }
  | { phase: "error"; message: string };

type SocialPlatform = "instagram" | "tiktok";

export function SignupForm({
  clientSlug,
  eventSlug,
  clientName,
  eventName,
  thankYouMessage,
  privacyPolicyUrl,
  turnstileSiteKey,
  metaPixelId,
}: {
  clientSlug: string;
  eventSlug: string;
  clientName: string;
  eventName: string;
  thankYouMessage: string;
  /** client_landing_pages.privacy_policy_url — null renders plain text. */
  privacyPolicyUrl: string | null;
  turnstileSiteKey: string | null;
  /**
   * Tenant pixel from the view-model seam — CompleteRegistration fires
   * ONLY into this.
   */
  metaPixelId: string | null;
}) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [socialPlatform, setSocialPlatform] =
    useState<SocialPlatform>("instagram");
  const [socialHandle, setSocialHandle] = useState("");
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<SubmitState>({ phase: "idle" });
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");

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

  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const turnstileTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!turnstileSiteKey) return;

    function renderWidget() {
      const container = turnstileContainerRef.current;
      if (!container || !window.turnstile || turnstileWidgetIdRef.current) return;
      try {
        turnstileWidgetIdRef.current = window.turnstile.render(container, {
          sitekey: turnstileSiteKey as string,
          appearance: "interaction-only",
          callback: (token) => {
            turnstileTokenRef.current = token;
          },
          "expired-callback": () => {
            turnstileTokenRef.current = null;
          },
          "error-callback": () => {
            turnstileTokenRef.current = null;
          },
        });
      } catch {
        // Widget failure must never block the form — the server's
        // TURNSTILE_REQUIRED gate decides whether a missing token is fatal.
      }
    }

    if (window.turnstile) {
      renderWidget();
      return;
    }
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = renderWidget;
    document.head.appendChild(script);
  }, [turnstileSiteKey]);

  /** Tokens are single-use — mint a fresh one after a failed submit. */
  function resetTurnstile() {
    turnstileTokenRef.current = null;
    if (window.turnstile && turnstileWidgetIdRef.current) {
      try {
        window.turnstile.reset(turnstileWidgetIdRef.current);
      } catch {
        // Best-effort.
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state.phase === "submitting") return;

    // The toggle enforces the social mutex client-side: only the active
    // platform's field is populated, the other is always null.
    const values: SignupFormValues = {
      email,
      phone,
      phone_country: "GB",
      ig_handle: socialPlatform === "instagram" ? socialHandle : null,
      tt_handle: socialPlatform === "tiktok" ? socialHandle : null,
      consent_gdpr: consent,
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
      // Same event_id travels client-side (CompleteRegistration below)
      // and server-side (CAPI) — Meta dedups the pair on
      // (event_name, event_id).
      const capiEventId = completeRegistrationEventId(
        getOrCreateEventBase(window.sessionStorage),
      );

      const response = await fetch(
        `/api/l/${encodeURIComponent(clientSlug)}/${encodeURIComponent(eventSlug)}/signup`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...values,
            captcha_token: turnstileTokenRef.current,
            capi_event_id: capiEventId,
          }),
        },
      );
      const result = (await response.json()) as SubmitSignupResult;
      if (result.ok) {
        // Fire the browser-side CompleteRegistration only for NEW signups
        // (a repeat signup firing a fresh-id event would inflate
        // conversion counts) and ONLY into the tenant pixel via
        // trackSingle.
        if (!result.deduplicated && metaPixelId) {
          runPixelCommand(
            buildCompleteRegistrationCommand(metaPixelId, capiEventId),
          );
        }
        setState({ phase: "success", deduplicated: result.deduplicated });
        return;
      }
      resetTurnstile();
      if (result.field_errors) setFieldErrors(result.field_errors);
      setState({
        phase: "error",
        message: result.error || "Something went wrong — please try again.",
      });
    } catch {
      resetTurnstile();
      setState({
        phase: "error",
        message: "Couldn't reach the server — check your connection and try again.",
      });
    }
  }

  async function handleShare() {
    const url = window.location.href;
    try {
      await navigator.share({ title: eventName, url });
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        setShareState("copied");
        setTimeout(() => setShareState("idle"), 2_000);
      } catch {
        // Neither share nor clipboard available — nothing sensible to do.
      }
    }
  }

  if (state.phase === "success") {
    return (
      <section className={styles.success} aria-live="polite">
        <h2 className={styles.successTitle}>you&apos;re on the list</h2>
        <p className={styles.successBody}>{thankYouMessage}</p>
        {state.deduplicated ? (
          <p className={styles.successBody}>
            (looks like you&apos;d already signed up — you&apos;re all set.)
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
      <div>
        <label className={styles.fieldLabel} htmlFor="lp-email">
          email address
        </label>
        <input
          id="lp-email"
          className={styles.input}
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {err("email")}
      </div>

      <div>
        <label className={styles.fieldLabel} htmlFor="lp-phone">
          phone number
        </label>
        <div className={styles.phoneGrid}>
          <span className={styles.phoneCountry} aria-hidden="true">
            uk +44
          </span>
          <input
            id="lp-phone"
            className={styles.input}
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

      <div>
        <div
          className={styles.socialToggle}
          role="radiogroup"
          aria-label="Social platform"
        >
          <button
            type="button"
            role="radio"
            aria-checked={socialPlatform === "instagram"}
            className={`${styles.socialPill} ${
              socialPlatform === "instagram" ? styles.socialPillActive : ""
            }`}
            onClick={() => setSocialPlatform("instagram")}
          >
            instagram
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={socialPlatform === "tiktok"}
            className={`${styles.socialPill} ${
              socialPlatform === "tiktok" ? styles.socialPillActive : ""
            }`}
            onClick={() => setSocialPlatform("tiktok")}
          >
            tiktok
          </button>
        </div>
        <label className={styles.fieldLabel} htmlFor="lp-social">
          {socialPlatform === "instagram" ? "instagram" : "tiktok"}{" "}
          <span className={styles.fieldLabelMuted}>(optional)</span>
        </label>
        <input
          id="lp-social"
          className={styles.input}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={socialHandle}
          onChange={(e) => setSocialHandle(e.target.value)}
        />
        {err("ig_handle")}
        {err("tt_handle")}
        {err("social")}
      </div>

      <div>
        <label className={styles.consentRow}>
          <input
            type="checkbox"
            className={styles.consentCheckbox}
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span className={styles.consentText}>
            add me to {clientName}&apos;s mailing list. see{" "}
            {privacyPolicyUrl ? (
              <a href={privacyPolicyUrl} target="_blank" rel="noreferrer">
                privacy policy
              </a>
            ) : (
              "privacy policy"
            )}
            .
          </span>
        </label>
        {err("consent_gdpr")}
      </div>

      <p className={styles.legalNote}>
        by signing up, you consent to receive marketing and communications
        regarding {eventName}. you can unsubscribe at any time.
      </p>

      {state.phase === "error" ? (
        <p className={styles.formError} role="alert">
          {state.message}
        </p>
      ) : null}

      {/* Turnstile mounts here; interaction-only stays invisible unless a
          challenge is required. */}
      {turnstileSiteKey ? <div ref={turnstileContainerRef} /> : null}

      <button
        type="submit"
        className={styles.ctaPrimary}
        disabled={state.phase === "submitting"}
      >
        {state.phase === "submitting" ? "signing you up" : "sign up"}
      </button>
      <button
        type="button"
        className={styles.ctaSecondary}
        onClick={handleShare}
      >
        {shareState === "copied" ? "link copied" : "share"}
      </button>
    </form>
  );
}
