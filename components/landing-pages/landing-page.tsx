import type { CSSProperties } from "react";

import { formatEventDateShort } from "@/lib/landing-pages/format-datetime";
import { buildLandingPageView } from "@/lib/landing-pages/view";
import type { LandingPageView } from "@/lib/landing-pages/view";
import type { LandingPageContext } from "@/lib/landing-pages/types";

import styles from "./landing-page.module.css";
import { BottomMedia } from "./bottom-media";
import { BrandSocials } from "./brand-socials";
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
 *   header (box logo | wordmark + event date · venue meta, PR 8)
 *   hero carousel (falls back to single artwork image)
 *   event block (title + subtitle tagline only — no auto-rendered
 *     venue/date line, PR 8 Goal 1)
 *   countdown (only when a future target is set; static "Presale: …"
 *     line above a compact ticker, PR 8, reordered + shrunk PR 9)
 *   signup form
 *   description
 *   bottom media (YouTube lite-embed + image grid)
 *   brand socials (Instagram/TikTok row, PR 8)
 *   footer (single mono attribution line, only when
 *     show_off_pixel_attribution, PR 8)
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

        <EventBlock view={view} />

        {/* PR 9: moved below the event block (was between the hero and
            the title) — reads as a lead-in to the form now, not its own
            heavy mid-page section. */}
        {view.countdown ? (
          <CountdownBlock
            targetAt={view.countdown.targetAt}
            label={view.countdown.label}
            accent={view.accent}
          />
        ) : null}

        <SignupForm
          clientSlug={view.clientSlug}
          eventSlug={view.eventSlug}
          clientName={view.clientName}
          eventName={view.headline}
          thankYouMessage={view.thankYouMessage}
          privacyPolicyUrl={view.privacyPolicyUrl}
          turnstileSiteKey={turnstileSiteKey}
          metaPixelId={view.metaPixelId}
          onSaleAt={view.onSaleAt}
          confirmation={view.confirmation}
        />

        {view.description ? (
          <p className={styles.description}>{view.description}</p>
        ) : null}

        <BottomMedia
          videoId={view.youtubeVideoId}
          images={view.bottomImages}
          eventName={view.headline}
        />

        <BrandSocials
          instagramUrl={view.brandInstagramUrl}
          tiktokUrl={view.brandTiktokUrl}
        />

        {view.showOffPixelAttribution ? <FooterBlock /> : null}
      </div>
    </div>
  );
}

/**
 * PR 8: the header meta row now shows "{event date} · {venue short}"
 * (e.g. "Sun 16 Aug · Costa da Caparica") instead of the PR-7 on-sale
 * timestamp — that info now lives ONLY in the countdown block's static
 * "Presale: …" line, so it isn't duplicated. Renders whichever of the
 * two parts is present; hides the row entirely when NEITHER is set.
 */
function HeaderMeta({ view }: { view: LandingPageView }) {
  const parts: string[] = [];
  if (view.eventStartAt) parts.push(formatEventDateShort(view.eventStartAt));
  if (view.venueShort) parts.push(view.venueShort);
  if (parts.length === 0) return null;
  return (
    <span className={styles.timestamp}>{parts.join(" \u00b7 ")}</span>
  );
}

function HeaderBlock({ view }: { view: LandingPageView }) {
  if (view.logoStyle === "wordmark") {
    return (
      <header className={styles.header}>
        <span className={styles.wordmark}>{view.clientName}</span>
        <HeaderMeta view={view} />
      </header>
    );
  }
  return (
    <header className={styles.header}>
      <span className={styles.boxLogo}>{view.boxLogoText}</span>
      <HeaderMeta view={view} />
    </header>
  );
}

/**
 * PR 8, Goal 1: the auto-rendered "venue, city · date" line is gone —
 * it duplicated the header meta row (date) and top-right venue, and
 * frequently ran long/lowercased oddly for real-world venue names (e.g.
 * "es bosq, recinto mallorca live, calvià, mallorca · sunday, 16 august
 * 2026"). The subtitle (content.subtitle) is now the ONLY sub-title
 * text — a pure marketing tagline, never auto-appended data.
 */
function EventBlock({ view }: { view: LandingPageView }) {
  return (
    <section className={styles.eventBlock} aria-label="Event details">
      <h1 className={styles.eventTitle}>{view.headline}</h1>
      {view.subtitle ? (
        <p className={styles.eventDetails}>{view.subtitle}</p>
      ) : null}
    </section>
  );
}

/**
 * PR 8, Goal 6: the black bar + social nav row are gone — a single mono
 * attribution line (superseded by the new brand-socials row above it
 * for IG/TikTok). Still gated on showOffPixelAttribution, unchanged.
 */
function FooterBlock() {
  return (
    <footer className={styles.footer}>
      Product by{" "}
      <a
        href="https://www.offpixel.co.uk"
        target="_blank"
        rel="noopener noreferrer"
      >
        Off/Pixel
      </a>
    </footer>
  );
}
