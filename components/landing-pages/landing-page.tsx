import type { CSSProperties } from "react";

import { buildLandingPageView } from "@/lib/landing-pages/view";
import type { LandingPageView } from "@/lib/landing-pages/view";
import type { LandingPageContext } from "@/lib/landing-pages/types";

import styles from "./landing-page.module.css";
import { BottomMedia } from "./bottom-media";
import { CountdownBlock } from "./countdown-block";
import { HeroCarousel } from "./hero-carousel";
import { MetaPixel } from "./meta-pixel";
import { SignupForm } from "./signup-form";

/**
 * components/landing-pages/landing-page.tsx
 *
 * The /l renderer — PR 6 Supreme rewrite. Server component; the client
 * islands are the carousel, countdown, form, and bottom media. Consumes
 * ONLY the LandingPageView built from the context — the tenant-isolation
 * seam (see lib/landing-pages/view.ts) — exactly as in PR 2/3.
 *
 * Layout (mobile-first, desktop max-width 480px centered):
 *   header (box logo | wordmark + LDN timestamp)
 *   hero carousel (falls back to single artwork image)
 *   countdown (only when a future target is set)
 *   event block (title + lowercase dot-separated details)
 *   signup form
 *   description
 *   bottom media (YouTube lite-embed + image grid)
 *   footer (only when show_off_pixel_attribution)
 *
 * The tenant accent arrives as --accent on the root (resolveAccent:
 * artwork palette → client primary → default) alongside the legacy
 * --lp-* variables — CSS custom properties inherit downward only, so the
 * PR-2 scoping/isolation mechanism is unchanged.
 */

export function LandingPage({
  context,
  turnstileSiteKey,
}: {
  context: LandingPageContext;
  turnstileSiteKey: string | null;
}) {
  const view = buildLandingPageView(context);
  const rootStyle = {
    ...view.themeStyle,
    "--accent": view.accent,
  } as CSSProperties;

  return (
    <div className={styles.root} style={rootStyle}>
      {/* Per-tenant pixel — id comes ONLY from the view-model seam. */}
      <MetaPixel pixelId={view.metaPixelId} />
      <div className={styles.page}>
        <HeaderBlock view={view} />

        {view.heroImages.length > 0 ? (
          <HeroCarousel images={view.heroImages} alt={view.headline} />
        ) : (
          <div className={styles.heroPlaceholder} aria-hidden="true">
            <span>{view.headline}</span>
          </div>
        )}

        {view.countdown ? (
          <CountdownBlock
            targetAt={view.countdown.targetAt}
            label={view.countdown.label}
            accent={view.accent}
          />
        ) : null}

        <EventBlock view={view} />

        <SignupForm
          clientSlug={view.clientSlug}
          eventSlug={view.eventSlug}
          clientName={view.clientName}
          eventName={view.headline}
          thankYouMessage={view.thankYouMessage}
          privacyPolicyUrl={view.privacyPolicyUrl}
          turnstileSiteKey={turnstileSiteKey}
          metaPixelId={view.metaPixelId}
        />

        {view.description ? (
          <p className={styles.description}>{view.description}</p>
        ) : null}

        <BottomMedia
          videoId={view.youtubeVideoId}
          images={view.bottomImages}
          eventName={view.headline}
        />

        {view.showOffPixelAttribution ? <FooterBlock view={view} /> : null}
      </div>
    </div>
  );
}

/** "dd.MM.yyyy HH:mm ldn" — always Europe/London (UK agency, by design). */
function formatLondonTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")} ldn`;
}

function HeaderBlock({ view }: { view: LandingPageView }) {
  if (view.logoStyle === "wordmark") {
    return (
      <header className={styles.header}>
        <span className={styles.wordmark}>{view.clientName}</span>
        <span className={styles.timestamp}>
          {formatLondonTimestamp(new Date())}
        </span>
      </header>
    );
  }
  return (
    <header className={styles.header}>
      <span className={styles.boxLogo}>{view.boxLogoText}</span>
      <span className={styles.timestamp}>
        {formatLondonTimestamp(new Date())}
      </span>
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
  })
    .format(parsed)
    .toLowerCase();
}

function EventBlock({ view }: { view: LandingPageView }) {
  const details: string[] = [];
  if (view.venueName || view.venueCity) {
    details.push(
      [view.venueName, view.venueCity].filter(Boolean).join(", "),
    );
  }
  if (view.eventDate) details.push(formatEventDate(view.eventDate));
  if (view.presaleInfo) details.push(view.presaleInfo);
  if (view.capacity) details.push(`${view.capacity} capacity`);

  return (
    <section className={styles.eventBlock} aria-label="Event details">
      <h1 className={styles.eventTitle}>{view.headline}</h1>
      {view.subtitle ? (
        <p className={styles.eventDetails}>{view.subtitle}</p>
      ) : null}
      {details.length > 0 ? (
        <p className={styles.eventDetails}>{details.join(" \u00b7 ")}</p>
      ) : null}
    </section>
  );
}

function FooterBlock({ view }: { view: LandingPageView }) {
  return (
    <footer className={styles.footer}>
      {view.socialLinks.length > 0 ? (
        <div className={styles.footerLinks}>
          {view.socialLinks.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noreferrer"
            >
              {link.label}
            </a>
          ))}
        </div>
      ) : null}
      <div className={styles.footerMade}>~ made with off/pixel ~</div>
    </footer>
  );
}
