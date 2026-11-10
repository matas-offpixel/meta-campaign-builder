/**
 * Where an artist card's claim comes from (O23): only an approved
 * ticket_warnings claim for the event that is true now, read live. Nothing
 * here writes to ticket_warnings or approves anything. With no approved
 * claim the card is a draft: watermarked and not exportable.
 */

export type WarningRow = {
  id: string;
  claim: string;
  format: string | null;
  state: string;
  approved_by: string | null;
  approved_at: string | null;
  runs_from: string | null;
  runs_to: string | null;
};

/** States in which an approved claim is not in force: proposed, pulled back, or finished. */
export const NOT_IN_FORCE = ["held", "back_to_held", "done"] as const;

export const WATERMARK = {
  notApproved: "DRAFT · claim not approved",
  sample: "DRAFT · sample claim",
} as const;

/** The roll-call fixture for the sample draft (H25 (b)): the roll-call as O12 and issue 3 write it (the PSD keys "2nd & 3rd" in lower case under an All Caps style). Always "DRAFT · sample claim". */
export const SAMPLE_ROLL_CALL = "EARLY BIRD, 1ST, 2ND & 3RD RELEASE SOLD OUT\nFINAL RELEASE RUNNING LOW";

export type ClaimSource =
  | { kind: "approved"; id: string; claim: string; format: string | null; approvedAt: string }
  | { kind: "none"; why: string }
  | { kind: "sample"; claim: string }
  | { kind: "off" };

/** The newest approved claim in force at `now`, or why there is none. Any format: the words are the same. */
export function approvedClaim(rows: readonly WarningRow[], now: Date): ClaimSource {
  const t = now.getTime();
  const live = rows.filter(
    (r) =>
      !!r.approved_by &&
      !!r.approved_at &&
      !(NOT_IN_FORCE as readonly string[]).includes(r.state) &&
      (!r.runs_from || Date.parse(r.runs_from) <= t) &&
      (!r.runs_to || Date.parse(r.runs_to) > t) &&
      r.claim.trim().length > 0,
  );
  if (!live.length) {
    const held = rows.filter((r) => r.state === "held").length;
    return { kind: "none", why: rows.length ? `${rows.length} claim${rows.length === 1 ? "" : "s"} for the event, none approved and in force (${held} held)` : "no claims for the event" };
  }
  const best = [...live].sort((a, b) => Date.parse(b.approved_at!) - Date.parse(a.approved_at!))[0]!;
  return { kind: "approved", id: best.id, claim: best.claim, format: best.format, approvedAt: best.approved_at! };
}

/** The watermark a card carries for its claim source: none only for an approved claim, or for a card drawn without a claim. */
export function watermarkFor(source: ClaimSource): string | null {
  if (source.kind === "approved" || source.kind === "off") return null;
  return source.kind === "sample" ? WATERMARK.sample : WATERMARK.notApproved;
}

export class NotExportableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotExportableError";
  }
}

/** A watermarked card can't be filed or exported. */
export function assertExportable(card: { watermark: string | null }): void {
  if (card.watermark) throw new NotExportableError(`This card is a draft (${card.watermark}); it can't be filed or exported.`);
}

type Db = { from(table: string): { select(cols: string): { eq(col: string, v: string): { range(a: number, b: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> } } } };

/** Read the event's claims (select only). */
export async function loadClaimSource(db: Db, eventId: string, now: Date = new Date()): Promise<ClaimSource> {
  const res = await db.from("ticket_warnings").select("id, claim, format, state, approved_by, approved_at, runs_from, runs_to").eq("event_id", eventId).range(0, 999);
  if (res.error) throw new Error(`ticket_warnings: ${res.error.message}`);
  return approvedClaim((res.data ?? []) as WarningRow[], now);
}
