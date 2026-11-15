/**
 * Read the bits Suggest is allowed to use from an HTML page: title, meta
 * description, Open Graph, and a JSON-LD Event. The fact-check corpus is
 * that text plus a stripped body, capped. Emails are removed before the
 * text is stored or sent on.
 */

import { type CopyEventFacts, expandIsoDate, factCorpus } from "./copy-facts.ts";

export const PAGE_TEXT_CAP = 8000;

export interface ScrapedEvent {
  name: string;
  startDate: string;
  location: string;
  price: string;
  priceCurrency: string;
  performer: string;
}

export interface ScrapedPage {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  event: ScrapedEvent | null;
  /** Capped, emails removed. This is what the fact check and the model see. */
  text: string;
}

function decode(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, key: string, attr: "name" | "property"): string {
  const pattern = new RegExp(
    `<meta[^>]*${attr}=["']${key}["'][^>]*content=["']([^"']*)["'][^>]*>|<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${key}["'][^>]*>`,
    "i",
  );
  const match = pattern.exec(html);
  return decode(match?.[1] || match?.[2] || "");
}

function asType(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function isEvent(node: Record<string, unknown>): boolean {
  return asType(node["@type"]).some((type) => type.toLowerCase() === "event");
}

function nameOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(nameOf).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.name === "string") return record.name.trim();
  }
  return "";
}

function offerOf(value: unknown): { price: string; currency: string } {
  const offer = Array.isArray(value) ? value[0] : value;
  if (!offer || typeof offer !== "object") return { price: "", currency: "" };
  const record = offer as Record<string, unknown>;
  const price = record.price == null ? "" : String(record.price).trim();
  const currency = typeof record.priceCurrency === "string" ? record.priceCurrency.trim() : "";
  return { price, currency };
}

function readEvent(node: Record<string, unknown>): ScrapedEvent {
  const offer = offerOf(node.offers);
  return {
    name: nameOf(node.name),
    startDate: typeof node.startDate === "string" ? node.startDate.trim() : "",
    location: nameOf(node.location),
    price: offer.price,
    priceCurrency: offer.currency,
    performer: nameOf(node.performer),
  };
}

function walk(value: unknown, found: ScrapedEvent[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, found);
    return;
  }
  const node = value as Record<string, unknown>;
  if (isEvent(node)) found.push(readEvent(node));
  if (node["@graph"]) walk(node["@graph"], found);
}

export function jsonLdEvents(html: string): ScrapedEvent[] {
  const found: ScrapedEvent[] = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      walk(JSON.parse(match[1] ?? ""), found);
    } catch {
      /* a broken block is skipped; the rest of the page still counts */
    }
  }
  return found;
}

function stripEmails(text: string): string {
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "").replace(/\s+/g, " ").trim();
}

function bodyText(html: string): string {
  const without = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  return decode(without);
}

export function scrapeHtml(html: string): ScrapedPage {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = decode(titleMatch?.[1] ?? "");
  const description = metaContent(html, "description", "name");
  const ogTitle = metaContent(html, "og:title", "property");
  const ogDescription = metaContent(html, "og:description", "property");
  const ogImage = metaContent(html, "og:image", "property");
  const event = jsonLdEvents(html)[0] ?? null;
  const eventLines = event
    ? [event.name, event.startDate, ...expandIsoDate(event.startDate), event.location, event.performer, event.price, event.priceCurrency]
    : [];
  const text = stripEmails(
    [title, description, ogTitle, ogDescription, ...eventLines, bodyText(html)].filter(Boolean).join("\n"),
  ).slice(0, PAGE_TEXT_CAP);
  return { title, description, ogTitle, ogDescription, ogImage, event, text };
}

export function corpusFor(page: ScrapedPage | null, event: CopyEventFacts): string {
  return factCorpus(page?.text ?? "", event);
}
