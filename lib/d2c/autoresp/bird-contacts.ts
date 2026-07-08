/**
 * lib/d2c/autoresp/bird-contacts.ts
 *
 * Pure parser for the Bird list-contacts endpoint, used by the autoresponder
 * poll cron (Goal 3). Bird's contacts response shape is NOT captured/verified
 * for this PR (per the user's decision to skip the Bird webhook investigation
 * and go straight to polling) — reference_bird_uses_flat_shape_not_meta warns
 * against assuming a Meta-like shape, so this parser reads DEFENSIVELY across
 * the field names Bird is known to use and returns only cleanly-extractable
 * contacts. Anything it can't parse is dropped (never fired), so an unexpected
 * shape degrades to a safe no-op rather than a mis-fire.
 *
 * A live capture of `GET /workspaces/{ws}/lists/{listId}/contacts` should be
 * dropped into `.scratch/` and this parser tightened once the true shape is
 * known — flagged in the PR body.
 */

import { normaliseE164 } from "./helpers.ts";

export interface ParsedBirdContact {
  phone: string; // E.164
  createdAtMs: number | null;
}

function extractPhone(contact: Record<string, unknown>): string | null {
  // 1. Flat top-level identifier fields.
  const flat =
    firstString(
      contact.phoneNumber,
      contact.phonenumber,
      contact.phone,
      contact.identifierValue,
      contact.msisdn,
    ) ?? null;
  if (flat) return normaliseE164(flat);

  // 2. identifiers: [{ type/key: 'phonenumber', value/identifierValue }]
  const identifiers = contact.identifiers ?? contact.identifierValues;
  if (Array.isArray(identifiers)) {
    for (const raw of identifiers) {
      if (!raw || typeof raw !== "object") continue;
      const idObj = raw as Record<string, unknown>;
      const kind = String(idObj.type ?? idObj.key ?? "").toLowerCase();
      const value = firstString(idObj.value, idObj.identifierValue);
      if (value && (kind.includes("phone") || kind === "" || kind.includes("msisdn"))) {
        const e164 = normaliseE164(value);
        if (e164) return e164;
      }
    }
  }

  // 3. attributes.{phonenumber|phone}
  const attrs = contact.attributes;
  if (attrs && typeof attrs === "object") {
    const a = attrs as Record<string, unknown>;
    const attrPhone = firstString(a.phonenumber, a.phoneNumber, a.phone);
    if (attrPhone) return normaliseE164(attrPhone);
  }
  return null;
}

function extractCreatedAtMs(contact: Record<string, unknown>): number | null {
  const iso = firstString(
    contact.createdAt,
    contact.created_at,
    contact.createdDateTime,
    contact.addedAt,
  );
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Extract usable contacts from a Bird list-contacts envelope. Reads the rows
 * from `results` | `data` | `contacts` and pulls a valid E.164 phone from each.
 */
export function parseBirdContacts(envelope: unknown): ParsedBirdContact[] {
  if (!envelope || typeof envelope !== "object") return [];
  const env = envelope as Record<string, unknown>;
  const rows =
    (Array.isArray(env.results) && env.results) ||
    (Array.isArray(env.data) && env.data) ||
    (Array.isArray(env.contacts) && env.contacts) ||
    [];
  const out: ParsedBirdContact[] = [];
  for (const raw of rows as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const phone = extractPhone(raw as Record<string, unknown>);
    if (!phone) continue;
    out.push({ phone, createdAtMs: extractCreatedAtMs(raw as Record<string, unknown>) });
  }
  return out;
}

/**
 * Filter parsed contacts to those created strictly after `sinceMs`. Contacts
 * with an unknown createdAt are INCLUDED (dedup then guards against re-firing) —
 * better to attempt-then-dedup than to silently miss a signup.
 */
export function contactsCreatedAfter(
  contacts: ParsedBirdContact[],
  sinceMs: number | null,
): ParsedBirdContact[] {
  if (sinceMs == null) return contacts;
  return contacts.filter((c) => c.createdAtMs == null || c.createdAtMs > sinceMs);
}
