/**
 * lib/mcp/audit/words.ts — what strict_audit (M3d-d) tells Claude.
 *
 * Ruled: design's corrected rows for #1392 (26 Nov verdict) are asked,
 * meta_now and unknown_client, first below. Every other string is still
 * PENDING DESIGN, listed with its key in the PR body's "For design" table
 * (overnight 26 Nov). "No event with code {code}." is M1's own answer
 * (get_event, get_learnings), reused as is.
 *
 * Names, counts, ids and links only: never a Meta error or a token.
 * Relative imports only (node:test).
 */

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export const STRICT_WORDS = {
  // ── Ruled (design's corrected rows, 26 Nov verdict on #1392) ──
  /** claude.mcp.strict.asked: what the draft asked for, one line per hit. Singular "1 audience" / "1 interest as a suggestion"; "ages {min}–{max}" as in launch.adset.age_widened. */
  asked: (audiences: number, interests: number, ageMin: number | null, ageMax: number | null) => {
    const parts = ["Advantage+ on"];
    if (audiences > 0) parts.push(audiences === 1 ? "1 audience as a suggestion" : `${audiences} audiences as suggestions`);
    if (interests > 0) parts.push(interests === 1 ? "1 interest as a suggestion" : `${interests} interests as suggestions`);
    if (ageMin != null && ageMax != null) parts.push(`ages ${ageMin}–${ageMax} as a suggestion`);
    return `The draft asked for: ${parts.join(", ")}.`;
  },
  /** claude.mcp.strict.meta_now */
  metaNow: "Meta now: Advantage+ audience off, so these are hard limits.",
  /** claude.mcp.strict.unknown_client */
  unknownClient: (name: string) => `No client called ${name}.`,

  // ── PENDING DESIGN ──
  /** PENDING DESIGN claude.mcp.strict.found / .found.one */
  found: (n: number) =>
    n === 1
      ? "1 live ad set runs strict while its draft asked for Advantage+ suggestions."
      : `${n} live ad sets run strict while their drafts asked for Advantage+ suggestions.`,
  /** PENDING DESIGN claude.mcp.strict.none */
  none: "No live ad set runs strict where its draft asked for Advantage+ suggestions.",
  /** PENDING DESIGN claude.mcp.strict.checked */
  checked: (n: number, gets: number) => `Checked ${count(n, "ad set", "ad sets")} on Meta in ${count(gets, "read", "reads")}.`,
  /** PENDING DESIGN claude.mcp.strict.not_read / .not_read.one */
  notRead: (n: number) =>
    n === 1
      ? "1 ad set couldn’t be read from Meta this time, so it isn’t in the list. Try again."
      : `${n} ad sets couldn’t be read from Meta this time, so they aren’t in the list. Try again.`,
  /** M1's row (get_event). */
  unknownEvent: (code: string) => `No event with code ${code}.`,
  /** PENDING DESIGN claude.mcp.strict.both */
  both: "Give a client or an event, not both.",
  /** PENDING DESIGN claude.mcp.strict.no_meta: the route has no Meta read wired, or the operator's token couldn't be found. */
  noMeta: "Meta couldn’t be read, so the audit didn’t run. Try again.",
  /** PENDING DESIGN claude.mcp.strict.failed: the server's failedText. */
  failed: "The audit couldn’t run. Try again.",
} as const;
