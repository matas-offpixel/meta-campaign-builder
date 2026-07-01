/**
 * lib/d2c/bird/templates/definitions/throwback.ts
 *
 * Throwback brand WhatsApp templates (en + es_ES). Data-only — no I/O.
 * Sample values are Meta-review examples; at send time the real values are
 * bound via the D2C event variables.
 *
 * `presale_live` mirrors the already-approved production template in the
 * Throwback master project (idempotency will skip it if present).
 */

import type { BrandTemplateDefinition } from "../types.ts";

const ARTWORK_SAMPLE =
  "https://media.api.bird.com/workspaces/9c308f77-c5ed-44d3-9714-9da017c7536c/projects/08bab722-597a-41dd-b415-aa256d78325f/media/2e522bf5-ae4e-4000-ac4d-1abc315fd8ab";
const COMMUNITY_INVITE_SAMPLE = "BEkbaKi9HUS3Tjl1ULBbe1";
const EVENT_NAME_SAMPLE = "Throwback - PORTO";

const VARIABLE_DESCRIPTIONS: Record<string, string> = {
  event_artwork_url: "Public URL of the event artwork shown in the WhatsApp header",
  event_name: "Display name of the event",
  event_date: "Human-readable event date",
  presale_day: "Human-readable presale open day",
  presale_time: "Presale open time (venue local)",
  event_url_suffix: "Path appended to the base ticket URL",
  wa_community_invite: "WhatsApp community invite code (suffix of chat.whatsapp.com/…)",
};

const autoresp: BrandTemplateDefinition = {
  name: "throwback_autoresp",
  category: "UTILITY",
  locales: ["en", "es_ES"],
  body: {
    en: "Thanks for signing up to {{event_name}} on {{event_date}}. Presale opens {{presale_day}} at {{presale_time}}. To get the link 30 minutes before everyone else, join the WhatsApp community below.",
    es_ES:
      "Gracias por registrarte a {{event_name}} el {{event_date}}. La preventa empieza el {{presale_day}} a las {{presale_time}}. Para recibir el enlace 30 minutos antes que el resto, únete a la comunidad de WhatsApp abajo.",
  },
  footer: {
    en: "Reply STOP to unsubscribe.",
    es_ES: "Responde STOP para darte de baja.",
  },
  button: {
    text: { en: "JOIN WHATSAPP COMMUNITY", es_ES: "UNIRTE A LA COMUNIDAD" },
    url: "https://chat.whatsapp.com/{{wa_community_invite}}",
  },
  variableDescriptions: VARIABLE_DESCRIPTIONS,
  variableExamples: {
    event_artwork_url: { en: ARTWORK_SAMPLE, es_ES: ARTWORK_SAMPLE },
    event_name: { en: EVENT_NAME_SAMPLE, es_ES: EVENT_NAME_SAMPLE },
    event_date: { en: "Saturday 6 June", es_ES: "sábado 6 junio" },
    presale_day: { en: "Tuesday 3 June", es_ES: "martes 3 junio" },
    presale_time: { en: "12:00", es_ES: "12:00" },
    wa_community_invite: { en: COMMUNITY_INVITE_SAMPLE, es_ES: COMMUNITY_INVITE_SAMPLE },
  },
};

const presale_reminder: BrandTemplateDefinition = {
  name: "throwback_presale_reminder",
  category: "MARKETING",
  locales: ["en", "es_ES"],
  body: {
    en: "Reminder — {{event_name}} presale starts tomorrow at {{presale_time}}. For 30-minute early access, join the community below.",
    es_ES:
      "Recordatorio — la preventa de {{event_name}} empieza mañana a las {{presale_time}}. Para acceso anticipado 30 minutos antes, únete a la comunidad abajo.",
  },
  footer: {
    en: "Reply STOP to unsubscribe.",
    es_ES: "Responde STOP para darte de baja.",
  },
  button: {
    text: { en: "JOIN WHATSAPP COMMUNITY", es_ES: "UNIRTE A LA COMUNIDAD" },
    url: "https://chat.whatsapp.com/{{wa_community_invite}}",
  },
  variableDescriptions: VARIABLE_DESCRIPTIONS,
  variableExamples: {
    event_artwork_url: { en: ARTWORK_SAMPLE, es_ES: ARTWORK_SAMPLE },
    event_name: { en: EVENT_NAME_SAMPLE, es_ES: EVENT_NAME_SAMPLE },
    presale_time: { en: "12:00", es_ES: "12:00" },
    wa_community_invite: { en: COMMUNITY_INVITE_SAMPLE, es_ES: COMMUNITY_INVITE_SAMPLE },
  },
};

// Mirrors the live approved production template (project 08bab722).
const presale_live: BrandTemplateDefinition = {
  name: "throwback_presale_live",
  category: "MARKETING",
  locales: ["en", "es_ES"],
  body: {
    en: "Presale is now live for {{event_name}}. Lock in your ticket before prices go up or they sell out.",
    es_ES:
      "La preventa para {{event_name}} ya está activa. Asegura tu entrada antes de que suban los precios o se agoten.",
  },
  footer: {
    en: "Reply STOP to unsubscribe.",
    es_ES: "Responde STOP para darte de baja.",
  },
  button: {
    text: { en: "ACCESS TICKETS", es_ES: "COMPRAR ENTRADAS" },
    url: "https://ra.co/events/{{event_url_suffix}}",
  },
  variableDescriptions: VARIABLE_DESCRIPTIONS,
  variableExamples: {
    event_artwork_url: { en: ARTWORK_SAMPLE, es_ES: ARTWORK_SAMPLE },
    event_name: { en: EVENT_NAME_SAMPLE, es_ES: EVENT_NAME_SAMPLE },
    event_url_suffix: { en: "2123456", es_ES: "2123456" },
  },
};

export const throwbackTemplates: BrandTemplateDefinition[] = [
  autoresp,
  presale_reminder,
  presale_live,
];
