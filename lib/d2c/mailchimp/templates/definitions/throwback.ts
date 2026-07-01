/**
 * lib/d2c/mailchimp/templates/definitions/throwback.ts
 *
 * Throwback brand email templates (English primary). Same 5 kinds as Jackies.
 * ES variants can be added as locale-suffixed definitions (e.g.
 * throwback_announcement_es) — kept EN-only here for the initial ship.
 *
 * NOTE: logoUrl / footerImageUrl are PLACEHOLDERS — replace before live.
 */

import type { MailchimpBrandConfig, MailchimpTemplateDefinition } from "../types.ts";

const FOOTER_EN = "You're receiving this because you signed up to a Throwback event. *|UNSUB|*";

const templates: MailchimpTemplateDefinition[] = [
  {
    name: "throwback_announcement",
    kind: "announcement",
    locale: "en",
    subject: "🎟️ *|EVENT_NAME|* — tickets coming soon",
    preheader: "Sign up for early presale access.",
    headline: "*|EVENT_NAME|*",
    paragraphs: [
      "*|EVENT_DATE|* · *|EVENT_VENUE|*, *|EVENT_CITY|*",
      "Presale opens *|PRESALE_DAY|* at *|PRESALE_TIME|*. Join the WhatsApp community to get the link 30 minutes before everyone else.",
    ],
    cta: { label: "Join WhatsApp community", url: "*|WA_COMMUNITY_URL|*" },
    showArtwork: true,
    footerNote: FOOTER_EN,
  },
  {
    name: "throwback_presale_reminder",
    kind: "presale_reminder",
    locale: "en",
    subject: "Reminder: *|EVENT_NAME|* presale starts tomorrow",
    preheader: "30-minute early access below.",
    headline: "Presale starts tomorrow",
    paragraphs: [
      "*|EVENT_NAME|*: presale starts *|PRESALE_DAY|* at *|PRESALE_TIME|*.",
      "For 30-minute early access, join the community below.",
    ],
    cta: { label: "Join WhatsApp community", url: "*|WA_COMMUNITY_URL|*" },
    showArtwork: true,
    footerNote: FOOTER_EN,
  },
  {
    name: "throwback_presale_live",
    kind: "presale_live",
    locale: "en",
    subject: "🔴 *|EVENT_NAME|* presale is live",
    preheader: "Grab your ticket before prices rise.",
    headline: "Presale is live",
    paragraphs: [
      "The presale for *|EVENT_NAME|* is now live.",
      "Secure your ticket before prices rise or they sell out.",
    ],
    cta: { label: "Buy tickets", url: "*|TICKET_URL|*" },
    showArtwork: true,
    footerNote: FOOTER_EN,
  },
  {
    name: "throwback_autoresp",
    kind: "autoresp",
    locale: "en",
    subject: "Thanks for signing up to *|EVENT_NAME|*",
    preheader: "We'll let you know before presale opens.",
    headline: "Thanks for signing up!",
    paragraphs: [
      "Thanks for signing up to *|EVENT_NAME|* on *|EVENT_DATE|*. Presale opens *|PRESALE_DAY|* at *|PRESALE_TIME|*.",
      "To get the link 30 minutes before everyone else, join the WhatsApp community below.",
    ],
    cta: { label: "Join WhatsApp community", url: "*|WA_COMMUNITY_URL|*" },
    showArtwork: true,
    footerNote: FOOTER_EN,
  },
  {
    name: "throwback_gen_sale",
    kind: "gen_sale",
    locale: "en",
    subject: "General tickets for *|EVENT_NAME|* are on sale",
    preheader: "General sale is open.",
    headline: "General sale is open",
    paragraphs: [
      "General tickets for *|EVENT_NAME|* are on sale from *|GEN_SALE_DAY|* at *|GEN_SALE_TIME|*.",
      "Grab yours before they're gone.",
    ],
    cta: { label: "Buy tickets", url: "*|TICKET_URL|*" },
    showArtwork: true,
    footerNote: FOOTER_EN,
  },
];

export const throwbackMailchimpConfig: MailchimpBrandConfig = {
  brand: "throwback",
  theme: {
    bgColor: "#111111",
    fgColor: "#FFFFFF",
    logoUrl: "https://mcusercontent.com/PLACEHOLDER/throwback-logo.png",
    ctaBg: "#FFFFFF",
    ctaColor: "#000000",
    footerImageUrl: "https://mcusercontent.com/PLACEHOLDER/throwback-footer.png",
  },
  templates,
};
