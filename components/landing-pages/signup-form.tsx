"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  captureAttribution,
  persistAttribution,
  type CapturedAttribution,
} from "@/lib/landing-pages/attribution";
import { formatPresaleNotifyDate } from "@/lib/landing-pages/format-datetime";
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
 * over the default country. parsePhoneNumberFromString already strips a
 * national trunk "0" for every supported numbering plan — see the
 * comment in signup-schema.ts (PR 7); no extra sanitiser lives here.
 *
 * PR 7: Share moved out of the pre-submit view (single-CTA discipline —
 * only "sign up" is visible before a submit) into the post-signup
 * confirmation card, alongside a "sign up another" reset link. Resetting
 * unmounts-then-remounts the form, which also unmounts-then-remounts the
 * Turnstile container div — the widget-mount logic below is a ref
 * CALLBACK (not a plain ref + one-shot effect) specifically so a fresh
 * widget attaches to the new container node on remount.
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
  onSaleAt,
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
  /**
   * view.onSaleAt (presale_at ?? general_sale_at) — PR 7's confirmation
   * card shows "we'll notify you when presale opens on …" when set,
   * falling back to thankYouMessage when null.
   */
  onSaleAt: string | null;
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

  /**
   * Renders into whatever container is CURRENTLY attached — called both
   * from the script-load effect and from the container ref callback, so
   * a remount (the "sign up another" reset path) attaches a fresh widget
   * even though this component instance never unmounts.
   */
  const renderTurnstileWidget = useCallback(() => {
    const container = turnstileContainerRef.current;
    if (
      !container ||
      !turnstileSiteKey ||
      !window.turnstile ||
      turnstileWidgetIdRef.current
    ) {
      return;
    }
    try {
      turnstileWidgetIdRef.current = window.turnstile.render(container, {
        sitekey: turnstileSiteKey,
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
  }, [turnstileSiteKey]);

  useEffect(() => {
    if (!turnstileSiteKey) return;
    if (window.turnstile) {
      renderTurnstileWidget();
      return;
    }
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = renderTurnstileWidget;
    document.head.appendChild(script);
  }, [turnstileSiteKey, renderTurnstileWidget]);

  function attachTurnstileContainer(node: HTMLDivElement | null) {
    turnstileContainerRef.current = node;
    if (node) renderTurnstileWidget();
  }

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

  /**
   * "Sign up another" — clears the form and the Turnstile refs so the
   * container-ref callback mounts a genuinely fresh widget on the next
   * render. No explicit `.remove()` call here: by this point the success
   * view has already unmounted the OLD container div, and Turnstile
   * self-destructs widgets whose container leaves the DOM (calling
   * `.remove()` on an already-self-cleaned id just logs a harmless
   * "Cannot find Widget" warning — verified via manual browser testing).
   */
  function resetForNewSignup() {
    turnstileWidgetIdRef.current = null;
    turnstileTokenRef.current = null;
    setEmail("");
    setPhone("");
    setSocialPlatform("instagram");
    setSocialHandle("");
    setConsent(false);
    setFieldErrors({});
    setShareState("idle");
    setState({ phase: "idle" });
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
        <h2 className={styles.successTitle}>you&apos;re in.</h2>
        <p className={styles.successBody}>
          {onSaleAt
            ? `we'll notify you when presale opens on ${formatPresaleNotifyDate(onSaleAt)} uk.`
            : thankYouMessage}
        </p>
        {state.deduplicated ? (
          <p className={styles.successBody}>
            (looks like you&apos;d already signed up — you&apos;re all set.)
          </p>
        ) : null}
        <div className={styles.successActions}>
          <button
            type="button"
            className={styles.ctaSecondary}
            onClick={handleShare}
          >
            {shareState === "copied" ? "link copied" : "share"}
          </button>
          <button
            type="button"
            className={styles.ctaGhost}
            onClick={resetForNewSignup}
          >
            sign up another
          </button>
        </div>
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
            placeholder="7700 900123"
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
        <div className={styles.socialInputWrap}>
          <span className={styles.socialAtPrefix} aria-hidden="true">
            @
          </span>
          <input
            id="lp-social"
            className={styles.socialInputField}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="handle"
            value={socialHandle}
            onChange={(e) => setSocialHandle(e.target.value)}
          />
        </div>
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
      {turnstileSiteKey ? <div ref={attachTurnstileContainer} /> : null}

      {/* Single-CTA discipline pre-submit — Share moves into the
          post-signup confirmation card below. */}
      <button
        type="submit"
        className={styles.ctaPrimary}
        disabled={state.phase === "submitting"}
      >
        {state.phase === "submitting" ? "signing you up" : "sign up"}
      </button>
    </form>
  );
}
