/**
 * lib/d2c/audience/brief-routing.ts
 *
 * Resolve the audience routing a brief declares, against the live APIs.
 *
 * A brief names three things:
 *
 *   mailchimp_list  the Mailchimp AUDIENCE          e.g. "Throwback"
 *   mailchimp_tag   a static segment in it          e.g. "T26-LISBOA-MONSTANTOS"
 *   bird_list       the Bird list/group             e.g. "T26-LISBOA-MONSTANTOS"
 *
 * ── These strings are VERBATIM identifiers ─────────────────────────────────
 *
 * They are never derived from the event name and never normalised. Case is
 * significant. Misspellings are significant: `T26-LISBOA-MONSTANTOS` is
 * misspelled ("MONSTANTOS" vs the venue's "Monsantos") and that spelling is
 * CORRECT, because it is what exists live in Mailchimp, in Bird, and in the
 * landing-page config. The workspace contains other such names
 * (`T26-HALLOLWEEN`). "Correcting" one silently routes signups to a list
 * nothing reads.
 *
 * So: exact match only. No fuzzy matching, no case-insensitive fallback, no
 * closest-name substitution, and never create a missing list. A name that does
 * not resolve means the BRIEF is wrong and must be fixed by a human.
 *
 * Near-miss candidates ARE surfaced in error messages — that is diagnosis, to
 * make a typo obvious. Nothing in this module ever acts on them.
 *
 * ── Resource notes ─────────────────────────────────────────────────────────
 *
 *  - **Bird list == group.** `/lists/{id}` and `/groups/{id}` return the same
 *    object (verified). So `bird_list` resolves to the `groupId` that the
 *    journey trigger (`contact-added-to-group`) will need once the journey
 *    capture lands. We record it now so it does not have to be re-derived.
 *
 *  - **A Mailchimp tag IS a static segment**, sharing one numeric id. Resolve
 *    it once to that id rather than re-deriving per send.
 *
 *  - **Bird's list filters lie.** `?identifierValue=` / `?phonenumber=` /
 *    `?query=` on collection endpoints return 200 with an UNFILTERED page 1.
 *    So we page through everything and compare names ourselves — never trust a
 *    filtered 200.
 *
 * ── Live verification (read-only, 2026-07-29) ──────────────────────────────
 *
 * Both halves verified against the real Throwback workspaces, zero writes:
 *
 *   bird_list      "T26-LISBOA-MONSTANTOS" → group e3c51596-95fa-462c-a939-6cf943604823
 *                  (123 lists scanned — past one page)
 *   mailchimp_list "Throwback"             → audience c2b4d77acb
 *   mailchimp_tag  "T26-LISBOA-MONSTANTOS" → static segment 8800465, 9 members
 *                  (175 tags scanned)
 *
 * The Bird group id is the same one already bound to that event's journey
 * trigger, so the two independently agree.
 *
 * In both systems the "corrected" venue spelling (`…-MONSANTOS`) and the
 * lowercase variant are REJECTED, with the near miss reported as diagnosis
 * only. Live behaviour matched the unit-test mocks exactly — no assertion or
 * mock needed adjusting.
 */

import { listAllBirdPages } from "../bird/paginate.ts";
import { mailchimpJson } from "../mailchimp/client.ts";
import { getAudienceTags } from "./tag-registry.ts";

/** The routing block a brief must supply. All three are required. */
export interface BriefAudienceRouting {
  mailchimp_list: string;
  mailchimp_tag: string;
  bird_list: string;
}

export interface ResolvedAudienceRouting {
  /** Mailchimp audience id (the `list_id` its API uses). */
  mailchimpListId: string;
  mailchimpListName: string;
  /** Static-segment id — the tag's numeric id. */
  mailchimpSegmentId: number;
  mailchimpTagName: string;
  /** Bird group id. Same value as the Bird list id — one resource, two names. */
  birdGroupId: string;
  birdListName: string;
}

export class AudienceRoutingError extends Error {
  readonly code = "D2C_AUDIENCE_ROUTING_UNRESOLVED";
  readonly problems: string[];
  constructor(problems: string[]) {
    super(
      `Audience routing could not be resolved (${problems.length} problem(s)):\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
    this.name = "AudienceRoutingError";
    this.problems = problems;
  }
}

/**
 * Exact, verbatim comparison. Trims surrounding whitespace only — that is
 * transport noise, not spelling. Case and internal characters must match.
 */
function sameName(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/** Names that differ ONLY by case/whitespace — reported to expose typos, never used. */
function nearMisses(target: string, candidates: string[]): string[] {
  const t = target.trim().toLowerCase();
  return candidates.filter((c) => c.trim().toLowerCase() === t && !sameName(c, target));
}

/**
 * The tag and the Bird list must be spelled identically.
 *
 * They are the two halves of one audience: contacts tagged in Mailchimp are
 * the contacts expected in the Bird group. If the spellings diverge, signups
 * land in one place and sends read from another — silently, with no error at
 * send time. That is why this is an ERROR and not a warning.
 *
 * `mailchimp_list` is deliberately NOT compared: it names the parent audience
 * ("Throwback"), a genuinely different thing from the per-event segment.
 */
export function assertRoutingSpellingsAgree(routing: BriefAudienceRouting): void {
  const problems: string[] = [];
  for (const [field, value] of Object.entries(routing)) {
    if (!String(value ?? "").trim()) problems.push(`${field} is empty — the brief must supply it.`);
  }
  if (problems.length) throw new AudienceRoutingError(problems);

  if (!sameName(routing.mailchimp_tag, routing.bird_list)) {
    throw new AudienceRoutingError([
      `mailchimp_tag ${JSON.stringify(routing.mailchimp_tag)} and bird_list ` +
        `${JSON.stringify(routing.bird_list)} are spelled differently. They address the same ` +
        "audience, so a divergence means signups land where nothing reads. Fix the brief — " +
        "do not assume either one is the 'correct' spelling.",
    ]);
  }
}

interface MailchimpListsResponse {
  lists?: Array<{ id?: string; name?: string }>;
}

/** Resolve a Mailchimp audience by exact name. Never creates one. */
export async function resolveMailchimpAudience(
  serverPrefix: string,
  apiKey: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const res = await mailchimpJson<MailchimpListsResponse>(
    serverPrefix,
    apiKey,
    "/3.0/lists?count=1000&fields=lists.id,lists.name",
    { method: "GET" },
  );
  const lists = (res.lists ?? []).filter(
    (l): l is { id: string; name: string } =>
      typeof l.id === "string" && typeof l.name === "string",
  );
  const exact = lists.filter((l) => sameName(l.name, name));
  if (exact.length === 1) return { id: exact[0].id, name: exact[0].name };

  if (exact.length > 1) {
    throw new AudienceRoutingError([
      `mailchimp_list ${JSON.stringify(name)} matches ${exact.length} audiences ` +
        `(ids ${exact.map((l) => l.id).join(", ")}) — ambiguous, cannot choose.`,
    ]);
  }
  const near = nearMisses(name, lists.map((l) => l.name));
  throw new AudienceRoutingError([
    `mailchimp_list ${JSON.stringify(name)} does not exist in Mailchimp.` +
      (near.length ? ` Did the brief mean ${near.map((n) => JSON.stringify(n)).join(" or ")}? ` +
        "(Not substituted — fix the brief.)" : "") +
      ` ${lists.length} audience(s) available.`,
  ]);
}

/** Resolve a Mailchimp tag (static segment) to its numeric id. Never creates one. */
export async function resolveMailchimpTag(
  serverPrefix: string,
  apiKey: string,
  listId: string,
  tagName: string,
): Promise<{ id: number; name: string }> {
  const tags = await getAudienceTags(serverPrefix, apiKey, listId);
  const exact = tags.filter((t) => sameName(t.name, tagName));
  if (exact.length === 1) return { id: exact[0].id, name: exact[0].name };

  if (exact.length > 1) {
    throw new AudienceRoutingError([
      `mailchimp_tag ${JSON.stringify(tagName)} matches ${exact.length} static segments ` +
        `(ids ${exact.map((t) => t.id).join(", ")}) in audience ${listId} — ambiguous.`,
    ]);
  }
  const near = nearMisses(tagName, tags.map((t) => t.name));
  throw new AudienceRoutingError([
    `mailchimp_tag ${JSON.stringify(tagName)} does not exist as a static segment in audience ` +
      `${listId}.` +
      (near.length ? ` Did the brief mean ${near.map((n) => JSON.stringify(n)).join(" or ")}? ` +
        "(Not substituted — fix the brief.)" : "") +
      ` ${tags.length} tag(s) available.`,
  ]);
}

export interface BirdRoutingConfig {
  apiKey: string;
  workspaceId: string;
}

interface BirdList {
  id: string;
  name?: string;
}

/**
 * Resolve a Bird list by exact name and return its id — which IS the group id
 * the journey trigger will use.
 *
 * Pages through the whole collection and matches locally. Bird's query filters
 * silently return unfiltered results, so a "filtered" lookup would appear to
 * succeed while pointing at an arbitrary row.
 */
export async function resolveBirdGroup(
  cfg: BirdRoutingConfig,
  name: string,
): Promise<{ id: string; name: string }> {
  const lists = await listAllBirdPages<BirdList>(
    cfg.apiKey,
    `/workspaces/${cfg.workspaceId}/lists`,
  );
  const named = lists.filter((l): l is { id: string; name: string } => typeof l.name === "string");
  const exact = named.filter((l) => sameName(l.name, name));
  if (exact.length === 1) return { id: exact[0].id, name: exact[0].name };

  if (exact.length > 1) {
    throw new AudienceRoutingError([
      `bird_list ${JSON.stringify(name)} matches ${exact.length} Bird lists ` +
        `(ids ${exact.map((l) => l.id).join(", ")}) — ambiguous, cannot choose. ` +
        "Duplicate names exist in this workspace; a human must disambiguate.",
    ]);
  }
  const near = nearMisses(name, named.map((l) => l.name));
  throw new AudienceRoutingError([
    `bird_list ${JSON.stringify(name)} does not exist in Bird.` +
      (near.length ? ` Did the brief mean ${near.map((n) => JSON.stringify(n)).join(" or ")}? ` +
        "(Not substituted — fix the brief.)" : "") +
      ` ${named.length} list(s) scanned.`,
  ]);
}

export interface ResolveRoutingDeps {
  bird: BirdRoutingConfig;
  mailchimp: { serverPrefix: string; apiKey: string };
}

/**
 * Resolve all three identifiers against the live APIs, aggregating every
 * problem so a wrong brief can be fixed in one pass rather than one error at a
 * time. Throws `AudienceRoutingError` if anything is unresolved.
 *
 * Resolution only — this NEVER attaches an audience to anything.
 */
export async function resolveAudienceRouting(
  deps: ResolveRoutingDeps,
  routing: BriefAudienceRouting,
): Promise<ResolvedAudienceRouting> {
  // Spelling agreement is checked first: if the two names disagree, resolving
  // them individually could "succeed" against two different real audiences.
  assertRoutingSpellingsAgree(routing);

  const problems: string[] = [];

  let audience: { id: string; name: string } | null = null;
  try {
    audience = await resolveMailchimpAudience(
      deps.mailchimp.serverPrefix,
      deps.mailchimp.apiKey,
      routing.mailchimp_list,
    );
  } catch (e) {
    problems.push(...(e instanceof AudienceRoutingError ? e.problems : [String(e)]));
  }

  let tag: { id: number; name: string } | null = null;
  if (audience) {
    try {
      tag = await resolveMailchimpTag(
        deps.mailchimp.serverPrefix,
        deps.mailchimp.apiKey,
        audience.id,
        routing.mailchimp_tag,
      );
    } catch (e) {
      problems.push(...(e instanceof AudienceRoutingError ? e.problems : [String(e)]));
    }
  } else {
    problems.push(
      `mailchimp_tag ${JSON.stringify(routing.mailchimp_tag)} not checked — its audience did not resolve.`,
    );
  }

  let group: { id: string; name: string } | null = null;
  try {
    group = await resolveBirdGroup(deps.bird, routing.bird_list);
  } catch (e) {
    problems.push(...(e instanceof AudienceRoutingError ? e.problems : [String(e)]));
  }

  if (problems.length || !audience || !tag || !group) {
    throw new AudienceRoutingError(problems);
  }

  return {
    mailchimpListId: audience.id,
    mailchimpListName: audience.name,
    mailchimpSegmentId: tag.id,
    mailchimpTagName: tag.name,
    birdGroupId: group.id,
    birdListName: group.name,
  };
}
