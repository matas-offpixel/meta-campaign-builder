/**
 * The versions a Puzzle draft round carries (Matas, 10 Nov): Puzzle has been
 * on sale for weeks and is on its 3rd release, so a round has exactly two
 * versions, for T1 on a clip, T2 and the artist card alike.
 *
 *   1. No CTA: the lockup, the name and the date (O54 on clips), no claim.
 *   2. The selling-fast roll-call, from the event's live tiers through the
 *      roll-call generator (O60), "EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT" over
 *      "3RD RELEASE SELLING FAST" for Puzzle 4th Birthday.
 *
 * "General sale live" is out of date and isn't drawn. The stress fixtures
 * (longest, six releases) stay in the tests, never on a draft sheet.
 */

import { rollCallWords } from "../releases/roll-call.ts";
import type { Release } from "../releases/types.ts";
import { WATERMARK, approvedClaim, type WarningRow } from "./claim-approval.ts";

export type DraftVersion = {
  id: "v1-no-cta" | "v2-roll-call";
  title: string;
  /** The claim's words, verbatim, or null (no CTA). */
  claim: string | null;
  /** The stamp the draft carries, or null: a no-CTA card has no claim to approve, and an approved claim in force needs none. */
  watermark: string | null;
  why: string;
};

/** An event_releases row (select *) as the generator's Release. */
export function releaseFromRow(r: Record<string, unknown>): Release {
  return {
    id: String(r.id),
    eventId: String(r.event_id),
    position: Number(r.position),
    name: String(r.name),
    communityAt: (r.community_at as string) ?? null,
    listAt: (r.list_at as string) ?? null,
    state: r.state as Release["state"],
    stateAt: (r.state_at as string) ?? null,
    stateSource: (r.state_source as Release["stateSource"]) ?? null,
    stateSetBy: (r.state_set_by as string) ?? null,
    price: (r.price as number) ?? null,
    capacity: (r.capacity as number) ?? null,
    sold: (r.sold as number) ?? null,
    remaining: (r.remaining as number) ?? null,
  };
}

const same = (a: string, b: string) => a.replace(/\r\n?/g, "\n").trim().toUpperCase() === b.replace(/\r\n?/g, "\n").trim().toUpperCase();

/**
 * The round's two versions. Version 2's stamp follows its claim's
 * ticket_warnings row: none if that claim is approved and in force,
 * "DRAFT · claim not approved" if it is held, else "DRAFT · sample claim".
 * Throws when the tiers don't make a roll-call: there is nothing true to draw.
 */
export function draftVersions(tiers: readonly Release[], warnings: readonly WarningRow[], now: Date = new Date()): DraftVersion[] {
  const words = rollCallWords([...tiers]);
  if (!words.met) throw new Error(`the event's tiers don't make a roll-call: ${words.because}`);
  const approved = approvedClaim(warnings, now);
  const inForce = approved.kind === "approved" && same(approved.claim, words.claim);
  const held = warnings.find((w) => w.state === "held" && same(w.claim, words.claim));
  return [
    { id: "v1-no-cta", title: "No CTA", claim: null, watermark: null, why: "the lockup, the name and the date, no claim" },
    {
      id: "v2-roll-call",
      title: "Selling-fast roll-call",
      claim: words.claim,
      watermark: inForce ? null : held ? WATERMARK.notApproved : WATERMARK.sample,
      why: inForce ? `approved ticket_warnings ${(approved as { id: string }).id}` : held ? `held ticket_warnings ${held.id.slice(0, 8)}, not approved` : "the event's tiers through the roll-call generator, no claim row (sample)",
    },
  ];
}
