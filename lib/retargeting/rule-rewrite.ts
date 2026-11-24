/**
 * RT13's daily rule rewrite (docs/design-record/2026-11-17-retargeting-campaign-2.html):
 * when the show's links differ from the rules a running campaign's audiences
 * were built with, the audience's rules are rewritten, so an outlet switched
 * off on CIRQLIN drops out and a new one comes in.
 *
 * Ops (17 Nov): the same token and the same write path the on-sale refresh
 * uses for running campaigns, behind the same gates; no new token path, never
 * a client's own token.
 *
 *   - Token: the refresh Apply's (app/api/events/[id]/onsale-refresh/apply/route.ts,
 *     the `agencyMetaToken(userId)` line, then the operator's own
 *     `user_facebook_tokens.provider_token` over it), for the event's owner.
 *   - Write: `graphPostWithToken` (passed in), each one through
 *     `withMetaWriteIdempotency` on the show's draft, op kind
 *     `retargeting_audience_rule_update` (migration 257).
 *   - Gates: the deployment's apply gate (RT16: no per-event arm for
 *     Retargeting lines) and the audience-write gate. Only a campaign made by
 *     an accepted, applied Create line is ever touched.
 *
 * An audience is rewritten in place (POST /{audience} { rule }). A per-link
 * audience (RT18) whose link is gone, or a link that's new, changes which
 * audiences a tier holds, not a rule: that's reported, never written here.
 */

import { buildMetaCustomAudiencePayload } from "../meta/audience-payload.ts";
import { agencyMetaToken } from "../meta/agency-token.ts";
import { withMetaWriteIdempotency, type MetaWriteContext } from "../meta/write-idempotency.ts";
import { applyGates, retargetingGates } from "../onsale-refresh/apply-gates.ts";
import { retargetingAudienceDraft, tierAudienceName, type TierAudience, type TierSpec } from "./audiences.ts";

type Db = MetaWriteContext["supabase"];

/** The gates: the deployment's apply gate and the audience-write gate. */
export function ruleRewriteGates(env: Record<string, string | undefined>): { ok: boolean; reason: string | null } {
  const gates = retargetingGates(applyGates(env, "live"));
  if (gates.mode !== "live") return { ok: false, reason: "the apply gate is off" };
  if (!gates.audienceWritesEnabled) return { ok: false, reason: "the audience-write gate is off" };
  return { ok: true, reason: null };
}

/**
 * The refresh Apply's token for a user (the operator who owns the event):
 * the agency token for operators, overridden by their own Facebook token.
 * Never a client's token: client logins hold no Facebook token here.
 */
export async function refreshTokenFor(db: Db, userId: string): Promise<string | null> {
  let token = agencyMetaToken(userId) ?? "";
  try {
    const { data } = await db.from("user_facebook_tokens").select("provider_token").eq("user_id", userId).maybeSingle();
    if ((data as { provider_token?: string } | null)?.provider_token) token = (data as { provider_token: string }).provider_token;
  } catch {
    // the agency token stands
  }
  return token || null;
}

/** The rule JSON the builder writes for a tier audience (the same payload Apply created it with). */
export function ruleFor(code: string, aud: Exclude<TierAudience, { kind: "list" }>, adAccountId: string): string {
  const draft = retargetingAudienceDraft(aud);
  const payload = buildMetaCustomAudiencePayload({
    id: aud.key,
    userId: "",
    clientId: "",
    eventId: null,
    name: tierAudienceName(code, aud),
    funnelStage: "retargeting",
    audienceSubtype: draft.subtype,
    retentionDays: draft.retentionDays,
    sourceId: draft.sourceId,
    sourceMeta: draft.sourceMeta,
    metaAudienceId: null,
    metaAdAccountId: adAccountId,
    status: "ready",
    statusError: null,
    createdAt: "",
    updatedAt: "",
  });
  if (!payload.rule) throw new Error(`no rule for ${aud.key}`);
  return payload.rule;
}

export type RewriteResult = {
  written: string[];
  failed: { key: string; reason: string }[];
  /** Per-link audiences that would need adding or dropping (not a rule change). */
  rebuild: string[];
  /** The rules now on Meta, by key, to store on the Create line. */
  rules: Record<string, string[]>;
};

export async function rewriteRules(
  deps: { post: (path: string, body: Record<string, unknown>) => Promise<unknown>; ledger: MetaWriteContext },
  args: { code: string; adAccountId: string; lineId: string; specs: readonly TierSpec[]; audienceIds: Record<string, string>; changed: readonly string[]; stored: Record<string, string[]> },
): Promise<RewriteResult> {
  const out: RewriteResult = { written: [], failed: [], rebuild: [], rules: { ...args.stored } };
  const current = new Map<string, TierAudience>();
  for (const spec of args.specs) for (const aud of [...spec.includes, ...spec.excludes]) current.set(aud.key, aud);
  for (const key of args.changed) {
    const aud = current.get(key);
    const id = args.audienceIds[key];
    if (!aud || !id || aud.kind === "list" || (aud.kind !== "pixel_url" && aud.kind !== "pixel_event")) {
      out.rebuild.push(key);
      continue;
    }
    try {
      const rule = ruleFor(args.code, aud, args.adAccountId);
      await withMetaWriteIdempotency(deps.ledger, "retargeting_audience_rule_update", { line_id: args.lineId, audience_id: id, rule }, async () => {
        await deps.post(`/${id}`, { rule });
        return id;
      }, { required: true });
      out.written.push(key);
      out.rules[key] = [...aud.urlContains];
    } catch (err) {
      out.failed.push({ key, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  // New per-link audiences (a new link) aren't on the campaign yet: a rebuild, not a rewrite.
  for (const [key, aud] of current) {
    if (aud.kind === "pixel_url" && aud.link && !args.audienceIds[key] && !out.rebuild.includes(key)) out.rebuild.push(key);
  }
  return out;
}
