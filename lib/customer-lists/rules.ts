/**
 * The signup sync's rules (SU1, SU2): when a show's list is made, which ad
 * account it lives in, what Meta is sent, and how errors are kept free of
 * person data.
 *
 * Pure. No `@/` imports, so node --test loads it.
 */

import { CIRQLIN_PAGE_MAX, type HashedEntry } from "./cirqlin-hashed.ts";

export const CUSTOMER_LIST_WRITES_ENV = "OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED";

/** Exactly "true"; unset or anything else keeps every Meta write off. */
export function customerListWritesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[CUSTOMER_LIST_WRITES_ENV] === "true";
}

/** Meta's limit per /users call, and the spec's batch. */
export const USERS_BATCH_MAX = CIRQLIN_PAGE_MAX;
/** CIRQLIN pages read per list per run, so a backlog can't hold the cron past its time. */
export const PAGES_PER_RUN_MAX = 20;

export const USERS_SCHEMA = ["EMAIL_SHA256", "PHONE_SHA256"] as const;

/** "{code} · Signups": the name Retargeting's Bottom tier and RT15 expect. */
export function showListName(code: string): string {
  return `${code} · Signups`;
}

// ─── Time ────────────────────────────────────────────────────────────────────

const LONDON = "Europe/London";

/** The London calendar day of an instant, "YYYY-MM-DD". */
export function londonDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function londonHour(at: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", hour12: false }).format(at));
}

/** The cron acts on the "0 7,8 * * *" UTC run that is 08:00 London. */
export function isEightLondon(now: Date): boolean {
  return londonHour(now) === 8;
}

/** 08:00 London on a London day (07:00 UTC in summer, 08:00 in winter). */
export function eightLondonOn(day: string): Date {
  for (const utcHour of ["07", "08"]) {
    const at = new Date(`${day}T${utcHour}:00:00Z`);
    if (londonHour(at) === 8 && londonDate(at) === day) return at;
  }
  throw new Error(`no 08:00 London on ${day}`);
}

export type SaleDates = { presale_at: string | null; general_sale_at: string | null; event_date: string | null };

/** Presale day 08:00 London, else general-sale day 08:00 London, else null. */
export function listTriggerAt(event: SaleDates): Date | null {
  const sale = event.presale_at ?? event.general_sale_at;
  if (!sale) return null;
  const at = new Date(sale);
  if (Number.isNaN(at.getTime())) return null;
  return eightLondonOn(londonDate(at));
}

export type SyncState =
  | { state: "no_sale_date" }
  | { state: "waiting"; triggerAt: Date }
  | { state: "show_passed"; triggerAt: Date }
  | { state: "active"; triggerAt: Date };

/**
 * Active from the trigger (or at once when it's already passed) to the end
 * of show day, London. Waiting before it; nothing after the show.
 */
export function syncState(event: SaleDates, now: Date): SyncState {
  const triggerAt = listTriggerAt(event);
  if (!triggerAt) return { state: "no_sale_date" };
  if (now.getTime() < triggerAt.getTime()) return { state: "waiting", triggerAt };
  if (event.event_date && londonDate(now) > event.event_date.slice(0, 10)) return { state: "show_passed", triggerAt };
  return { state: "active", triggerAt };
}

// ─── Ad account ──────────────────────────────────────────────────────────────

/** "606252931141334" or "act_606252931141334" → "act_606252931141334"; anything else null. */
export function normaliseAccount(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  const m = /^(?:act_)?(\d+)$/.exec(v);
  return m ? `act_${m[1]}` : null;
}

export type AccountPick = {
  /** events.meta_ad_account_id as stored. */
  eventAccount: string | null;
  /** The venue's meta_ad_account_id (venues by venue_id, else the client's venue with this venue_key). */
  venueAccount: string | null;
  chosen: string | null;
  source: "event" | "venue" | "none";
};

/** The event's account, else its venue's. Never the client's pixel, never a draft's account. */
export function pickAccount(eventAccount: string | null, venueAccount: string | null): AccountPick {
  const ev = normaliseAccount(eventAccount);
  if (ev) return { eventAccount, venueAccount, chosen: ev, source: "event" };
  const ve = normaliseAccount(venueAccount);
  if (ve) return { eventAccount, venueAccount, chosen: ve, source: "venue" };
  return { eventAccount, venueAccount, chosen: null, source: "none" };
}

/**
 * The venue's high-value list, by ad account and name. Resolved to a Meta id
 * by a read (a meta_custom_audiences row, else the account's listing), never
 * by an id written here. NX Newcastle's ads run in NX Promoter.
 */
export const HIGH_VALUE_LIST_BY_ACCOUNT: Readonly<Record<string, string>> = {
  act_606252931141334: "NX LOVES DATA CSV",
};

// ─── Meta payloads ───────────────────────────────────────────────────────────

export type UsersPayload = { schema: readonly string[]; data: string[][] };

/** [EMAIL_SHA256, PHONE_SHA256] rows, "" for a missing key, in batches of 10,000. */
export function usersBatches(entries: HashedEntry[], size = USERS_BATCH_MAX): UsersPayload[] {
  const rows = entries.filter((e) => e.em || e.ph).map((e) => [e.em ?? "", e.ph ?? ""]);
  const out: UsersPayload[] = [];
  for (let i = 0; i < rows.length; i += size) out.push({ schema: USERS_SCHEMA, data: rows.slice(i, i + size) });
  return out;
}

export function showListCreateBody(code: string): Record<string, unknown> {
  return {
    name: showListName(code),
    subtype: "CUSTOM",
    customer_file_source: "USER_PROVIDED_ONLY",
    description: `${code} signups from CIRQLIN (consented), kept current by Off/Pixel`,
  };
}

// ─── No person data in errors ────────────────────────────────────────────────

const HEX64_RUN = /[0-9a-fA-F]{64}/g;

/** Any 64-hex run (a SHA-256) replaced; also cut to 300 characters. */
export function redactHashes(text: string): string {
  return text.replace(HEX64_RUN, "[hash]").slice(0, 300);
}

/** An error as a short, hash-free string: Meta's code when it has one, then the message. */
export function safeError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown; name?: unknown };
    const code = typeof e.code === "number" || typeof e.code === "string" ? `code=${e.code} ` : "";
    const msg = typeof e.message === "string" ? e.message : String(err);
    return redactHashes(`${code}${msg}`);
  }
  return redactHashes(String(err));
}
