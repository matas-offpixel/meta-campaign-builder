/**
 * lib/d2c/bird/templates/definitions/jackies.ts
 *
 * Jackies brand WhatsApp templates (es_ES only). Data-only — no I/O.
 *
 * NB the artwork sample is a MessageBird nest JWT-signed URL. If Bird rejects
 * it at publish time, upload a Jackies poster to a Bird media endpoint and
 * swap ARTWORK_SAMPLE for the resulting media.api.bird.com URL (see audit §f).
 */

import type { BrandTemplateDefinition } from "../types.ts";

const ARTWORK_SAMPLE =
  "https://media.nest.messagebird.com/media/eyJhbGciOiJIUzI1NiIsImtpZCI6ImZpbGUvMjAyMy0wNy0xN1QxNS0wNi0xNSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJtZWRpYSIsInN1YiI6IjljMzA4Zjc3LWM1ZWQtNDRkMy05NzE0LTlkYTAxN2M3NTM2YzplNTliMzQ1MS1jM2FmLTQ3YWMtOTExMy1hZWY1ZGExY2NmMzIiLCJhdWQiOlsibWVkaWEvcHJvZHVjdGlvbiJdLCJpYXQiOjE3MzA4OTAxMTF9.MkP_Cm6MN-CjYyYtpsrh7unrnj7BtFXR-Jvpsl02A9U";
const COMMUNITY_INVITE_SAMPLE = "IPCpHTE8JMu9JT5DenZglv";
const EVENT_NAME_SAMPLE = "Jackies - Malaga";

const VARIABLE_DESCRIPTIONS: Record<string, string> = {
  event_artwork_url: "Public URL of the event artwork shown in the WhatsApp header",
  event_name: "Display name of the event",
  event_date: "Human-readable event date",
  presale_day: "Human-readable presale open day",
  presale_time: "Presale open time (venue local)",
  event_url_suffix: "Path appended to the base ticket URL",
  wa_community_invite: "WhatsApp community invite code (suffix of chat.whatsapp.com/…)",
};

const presale_live: BrandTemplateDefinition = {
  name: "jackies_presale_live",
  category: "MARKETING",
  locales: ["es_ES"],
  body: {
    es_ES:
      "La preventa para {{event_name}} ya está activa.\n\nAsegura tu entrada antes de que suban los precios o se agoten.",
  },
  footer: { es_ES: "Responde STOP para darte de baja." },
  button: {
    text: { es_ES: "COMPRAR ENTRADAS" },
    url: "https://ra.co/events/{{event_url_suffix}}",
  },
  variableDescriptions: VARIABLE_DESCRIPTIONS,
  variableExamples: {
    event_artwork_url: { es_ES: ARTWORK_SAMPLE },
    event_name: { es_ES: EVENT_NAME_SAMPLE },
    event_url_suffix: { es_ES: "2375157" },
  },
};

const autoresp: BrandTemplateDefinition = {
  name: "jackies_autoresp",
  category: "UTILITY",
  locales: ["es_ES"],
  body: {
    es_ES:
      "Gracias por registrarte a {{event_name}} el {{event_date}}. La preventa empieza el {{presale_day}} a las {{presale_time}}. Para recibir el enlace 30 minutos antes que el resto, únete a la comunidad de WhatsApp abajo.",
  },
  footer: { es_ES: "Responde STOP para darte de baja." },
  button: {
    text: { es_ES: "UNIRTE A LA COMUNIDAD" },
    // Static approved-domain redirect (Meta 2388081 fix) — see
    // app/j/[invite]/route.ts. Variable name unchanged, URL prefix only.
    url: "https://app.offpixel.co.uk/j/{{wa_community_invite}}",
  },
  variableDescriptions: VARIABLE_DESCRIPTIONS,
  variableExamples: {
    event_artwork_url: { es_ES: ARTWORK_SAMPLE },
    event_name: { es_ES: EVENT_NAME_SAMPLE },
    event_date: { es_ES: "sábado 14 junio" },
    presale_day: { es_ES: "martes 10 junio" },
    presale_time: { es_ES: "12:00" },
    wa_community_invite: { es_ES: COMMUNITY_INVITE_SAMPLE },
  },
};

const presale_reminder: BrandTemplateDefinition = {
  name: "jackies_presale_reminder",
  category: "MARKETING",
  locales: ["es_ES"],
  body: {
    es_ES:
      "Recordatorio — la preventa de {{event_name}} empieza mañana a las {{presale_time}}. Para acceso anticipado 30 minutos antes, únete a la comunidad abajo.",
  },
  footer: { es_ES: "Responde STOP para darte de baja." },
  button: {
    text: { es_ES: "UNIRTE A LA COMUNIDAD" },
    // Static approved-domain redirect (Meta 2388081 fix) — see
    // app/j/[invite]/route.ts. Variable name unchanged, URL prefix only.
    url: "https://app.offpixel.co.uk/j/{{wa_community_invite}}",
  },
  variableDescriptions: VARIABLE_DESCRIPTIONS,
  variableExamples: {
    event_artwork_url: { es_ES: ARTWORK_SAMPLE },
    event_name: { es_ES: EVENT_NAME_SAMPLE },
    presale_time: { es_ES: "12:00" },
    wa_community_invite: { es_ES: COMMUNITY_INVITE_SAMPLE },
  },
};

export const jackiesTemplates: BrandTemplateDefinition[] = [
  presale_live,
  autoresp,
  presale_reminder,
];
