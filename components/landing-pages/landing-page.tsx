import type { CSSProperties } from "react";

import { buildLandingPageView } from "@/lib/landing-pages/view";
import type { LandingPageView } from "@/lib/landing-pages/view";
import type { LandingPageContext } from "@/lib/landing-pages/types";

import styles from "./landing-page.module.css";
import { SignupFormBlock } from "./signup-form-block";

/**
 * components/landing-pages/landing-page.tsx
 *
 * The themed /l renderer (PR 2). Server component; only SignupFormBlock is
 * a client island. Consumes ONLY the LandingPageView built from the
 * context — the tenant-isolation seam (see lib/landing-pages/view.ts).
 *
 * Theme scoping: the resolved --lp-* custom properties are set INLINE on
 * the root element. CSS variables inherit downward only; combined with
 * hashed CSS-module class names, tenant theming has no code path into
 * global styles or another tenant's page.
 */

export function LandingPage({
  context,
  recaptchaSiteKey,
}: {
  context: LandingPageContext;
  recaptchaSiteKey: string | null;
}) {
  const view = buildLandingPageView(context);

  return (
    <div className={styles.root} style={view.themeStyle as CSSProperties}>
      <div className={styles.inner}>
        <HeroBlock view={view} />
        <EventCardBlock view={view} />
        <SignupFormBlock
          clientSlug={view.clientSlug}
          eventSlug={view.eventSlug}
          thankYouMessage={view.thankYouMessage}
          recaptchaSiteKey={recaptchaSiteKey}
        />
        <FooterBlock view={view} />
      </div>
    </div>
  );
}

function HeroBlock({ view }: { view: LandingPageView }) {
  return (
    <header className={styles.hero}>
      {view.theme.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- external,
        // operator-provided URL; next/image would require remotePatterns
        // per client domain.
        <img
          className={styles.heroLogo}
          src={view.theme.logo_url}
          alt={view.clientName}
        />
      ) : null}
      {view.artworkUrl ? (
        <div className={styles.heroArtwork}>
          {/* eslint-disable-next-line @next/next/no-img-element -- same as logo */}
          <img src={view.artworkUrl} alt={view.headline} />
        </div>
      ) : (
        <div className={styles.heroArtworkPlaceholder} aria-hidden="true">
          <span>{view.headline}</span>
        </div>
      )}
      <h1 className={styles.heroTitle}>{view.headline}</h1>
      {view.subtitle ? <p className={styles.heroSubtitle}>{view.subtitle}</p> : null}
    </header>
  );
}

function formatEventDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function EventCardBlock({ view }: { view: LandingPageView }) {
  const hasAnything =
    view.venueName || view.venueCity || view.eventDate || view.presaleInfo;
  if (!hasAnything) return null;

  return (
    <section className={styles.eventCard} aria-label="Event details">
      {view.venueName || view.venueCity ? (
        <div className={styles.eventCardRow}>
          <span className={styles.eventCardLabel}>Where</span>
          <span>
            {view.venueName}
            {view.venueName && view.venueCity ? ", " : ""}
            {view.venueCity}
          </span>
        </div>
      ) : null}
      {view.eventDate ? (
        <div className={styles.eventCardRow}>
          <span className={styles.eventCardLabel}>When</span>
          <span>{formatEventDate(view.eventDate)}</span>
        </div>
      ) : null}
      {view.presaleInfo ? <p className={styles.presale}>{view.presaleInfo}</p> : null}
    </section>
  );
}

function FooterBlock({ view }: { view: LandingPageView }) {
  return (
    <footer className={styles.footer}>
      <span>
        © {new Date().getUTCFullYear()} {view.clientName}. By signing up you
        agree to be contacted about this event.
      </span>
      {/* Invisible-brand line — Off/Pixel stays out of the fan's eyeline. */}
      <span>Event pages by O/P.</span>
    </footer>
  );
}
