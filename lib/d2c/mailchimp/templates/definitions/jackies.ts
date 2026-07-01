/**
 * lib/d2c/mailchimp/templates/definitions/jackies.ts
 *
 * Jackies brand email templates (Spanish). Visual reference: red #E63329
 * background, logo header, full-width artwork, body copy, black CTA button,
 * brand footer image.
 *
 * NOTE: logoUrl / footerImageUrl are PLACEHOLDERS — replace with the real
 * hosted Jackies assets before going live (flagged for Ops).
 */

import type { MailchimpBrandConfig, MailchimpTemplateDefinition } from "../types.ts";

const FOOTER_ES = "Recibes este correo porque te registraste en un evento de Jackies. *|UNSUB|*";

const templates: MailchimpTemplateDefinition[] = [
  {
    name: "jackies_announcement",
    kind: "announcement",
    locale: "es",
    subject: "🎟️ *|EVENT_NAME|* — entradas muy pronto",
    preheader: "Regístrate para el acceso anticipado a la preventa.",
    headline: "*|EVENT_NAME|*",
    paragraphs: [
      "*|EVENT_DATE|* · *|EVENT_VENUE|*, *|EVENT_CITY|*",
      "La preventa empieza el *|PRESALE_DAY|* a las *|PRESALE_TIME|*. Únete a la comunidad de WhatsApp para recibir el enlace 30 minutos antes que el resto.",
    ],
    cta: { label: "Unirme a la comunidad", url: "*|WA_COMMUNITY_URL|*" },
    showArtwork: true,
    footerNote: FOOTER_ES,
  },
  {
    name: "jackies_presale_reminder",
    kind: "presale_reminder",
    locale: "es",
    subject: "Recordatorio: la preventa de *|EVENT_NAME|* empieza mañana",
    preheader: "Acceso anticipado 30 minutos antes.",
    headline: "La preventa empieza mañana",
    paragraphs: [
      "*|EVENT_NAME|*: la preventa empieza el *|PRESALE_DAY|* a las *|PRESALE_TIME|*.",
      "Para acceso anticipado 30 minutos antes que el resto, únete a la comunidad de WhatsApp.",
    ],
    cta: { label: "Unirme a la comunidad", url: "*|WA_COMMUNITY_URL|*" },
    showArtwork: true,
    footerNote: FOOTER_ES,
  },
  {
    name: "jackies_presale_live",
    kind: "presale_live",
    locale: "es",
    subject: "🔴 La preventa de *|EVENT_NAME|* ya está activa",
    preheader: "Asegura tu entrada antes de que suban los precios.",
    headline: "La preventa ya está activa",
    paragraphs: [
      "La preventa para *|EVENT_NAME|* ya está activa.",
      "Asegura tu entrada antes de que suban los precios o se agoten.",
    ],
    cta: { label: "Comprar entradas", url: "*|TICKET_URL|*" },
    showArtwork: true,
    footerNote: FOOTER_ES,
  },
  {
    name: "jackies_autoresp",
    kind: "autoresp",
    locale: "es",
    subject: "Gracias por registrarte a *|EVENT_NAME|*",
    preheader: "Te avisamos antes de que abra la preventa.",
    headline: "¡Gracias por registrarte!",
    paragraphs: [
      "Gracias por registrarte a *|EVENT_NAME|* el *|EVENT_DATE|*. La preventa empieza el *|PRESALE_DAY|* a las *|PRESALE_TIME|*.",
      "Para recibir el enlace 30 minutos antes que el resto, únete a la comunidad de WhatsApp abajo.",
    ],
    cta: { label: "Unirme a la comunidad", url: "*|WA_COMMUNITY_URL|*" },
    showArtwork: true,
    footerNote: FOOTER_ES,
  },
  {
    name: "jackies_gen_sale",
    kind: "gen_sale",
    locale: "es",
    subject: "Entradas generales para *|EVENT_NAME|* ya a la venta",
    preheader: "Venta general abierta.",
    headline: "Venta general abierta",
    paragraphs: [
      "Las entradas generales para *|EVENT_NAME|* ya están a la venta desde el *|GEN_SALE_DAY|* a las *|GEN_SALE_TIME|*.",
      "Consíguelas antes de que se agoten.",
    ],
    cta: { label: "Comprar entradas", url: "*|TICKET_URL|*" },
    showArtwork: true,
    footerNote: FOOTER_ES,
  },
];

export const jackiesMailchimpConfig: MailchimpBrandConfig = {
  brand: "jackies",
  theme: {
    bgColor: "#E63329",
    fgColor: "#FFFFFF",
    logoUrl: "https://mcusercontent.com/PLACEHOLDER/jackies-logo.png",
    ctaBg: "#000000",
    ctaColor: "#FFFFFF",
    footerImageUrl: "https://mcusercontent.com/PLACEHOLDER/jackies-footer.png",
  },
  templates,
};
