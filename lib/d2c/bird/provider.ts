/**
 * lib/d2c/bird/provider.ts
 *
 * Bird.com adapter — SMS + WhatsApp Cloud API provider. Real implementation
 * behind the 3-of-3 dry-run gate (global flag + per-connection live_enabled +
 * approved_by_matas), identical to the Mailchimp gate.
 *
 * Credentials shape: { api_key, workspace_id, channel_id }.
 *   - api_key      — workspace access key (long-lived).
 *   - workspace_id — the Bird workspace UUID.
 *   - channel_id   — the WhatsApp/SMS channel connector id.
 *
 * All HTTP goes through ./client.ts.
 */

import { performDryRun } from "../dry-run.ts";
import { birdJson } from "./client.ts";
import {
  contactPhoneIdentifiers,
  findGroupByName,
  listContactsInList,
  type BirdGroupClientConfig,
} from "./groups/client.ts";
import { substituteTemplateVariables } from "../event-variables.ts";
import {
  shouldD2CDryRun,
  d2cDryRunGates,
  type D2CConnection,
  type D2CMessage,
  type D2CProvider,
  type SendResult,
  type ValidateD2CCredentialsResult,
} from "../types.ts";

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export interface BirdTemplateInfo {
  projectId: string;
  versionId: string;
  locale: string;
}

export interface ResolvedBirdListId {
  listId: string | null;
  /** True when `listId` came from resolving `audience.tag` via `findGroupByName` (not a direct `audience.list_id`). */
  resolvedFromTag: boolean;
}

/**
 * 2026-07-14 bug: `d2c_scheduled_sends.audience` rows built from the tag
 * picker persist `{ tag }` (the human-facing selection) but never `list_id`
 * — Bird's actual send-time identifier. Live-verified failure: the
 * T26-ALGARVE WA DM reminder 422'd with "Bird sends require
 * audience.recipients[] or audience.list_id" even though `audience.tag` was
 * present throughout. `audience.list_id` still wins when both are present
 * (an explicit override, e.g. a future send that targets a different Bird
 * group than its own tag name). Pure network call, no DB access — the
 * resolved id is NOT written back to the row from here (this module has no
 * supabase handle, matches the layer 7/8 helpers' separation of concerns);
 * callers that want write-back should read `resolvedFromTag` off
 * `SendResult.details.resolvedAudiencePatch` (see `send()` below) and
 * persist it themselves, same pattern as `resolveEventArtwork`'s write-back
 * being the resolver's job, not the provider's.
 */
export async function resolveBirdListId(
  cfg: BirdGroupClientConfig,
  audience: Record<string, unknown>,
): Promise<ResolvedBirdListId> {
  const direct = readString(audience, "list_id");
  if (direct) return { listId: direct, resolvedFromTag: false };
  const tag = readString(audience, "tag");
  if (!tag) return { listId: null, resolvedFromTag: false };
  const group = await findGroupByName(cfg, tag);
  return { listId: group?.id ?? null, resolvedFromTag: true };
}

/**
 * Bug B fix (2026-07-08): resolve WhatsApp template identity from BOTH
 * conventions live in this codebase — `audience.project_id`/`template_id`
 * (what this provider originally assumed, and what `fire.ts`'s real
 * webhook/poll autoresp path still spreads `send.audience` into) and
 * `variables.bird_template_project_id`/`bird_template_version_id` (what WA
 * `d2c_scheduled_sends` rows actually persist for announce/reminder/
 * presale_live/gen_sale/autoresp_setup — verified live against the
 * Throwback Algarve event). Audience wins when both are present (explicit
 * per-send override, e.g. a future test-send that deliberately swaps
 * templates). Without this, `isTemplateSend` was ALWAYS false for every
 * real WA send in production — every fire silently downgraded to the empty
 * body-text path (see Bug A) instead of firing the approved WhatsApp
 * template. Exported so both this provider and the test-send route (which
 * copies the resolved ids onto its ephemeral audience as defence-in-depth)
 * share one resolution rule. Pure.
 */
export function resolveBirdTemplateInfo(
  audience: Record<string, unknown>,
  variables: Record<string, unknown>,
): BirdTemplateInfo | null {
  const projectId =
    readString(audience, "project_id") ??
    readString(variables, "bird_template_project_id");
  const versionId =
    readString(audience, "template_id") ??
    readString(variables, "bird_template_version_id");
  if (!projectId || !versionId) return null;
  const locale =
    readString(audience, "locale") ?? readString(variables, "locale") ?? "en";
  return { projectId, versionId, locale };
}

/**
 * Layers 6 & 9 of the 2026-07-01 direct-fire incident — RECONCILED 2026-07-02
 * against `.scratch/bird-runtime-send-capture.txt`, then Layer 6 SUPERSEDED
 * 2026-07-14 (see below).
 *
 * Provenance note: that file is NOT a DevTools capture. Bird's own UI test-send
 * flow does not surface the payload in the Network panel (suspected server
 * action / batched dispatch), so the shape below is sourced from Bird's public
 * API docs (channels-api/message-types/template, send-batch-messages) instead.
 * That is real, official-source evidence — not a derived-from-conventions
 * guess.
 *
 * What was wrong (layer 6): `receiver: { contacts: { listId } }` sent contacts
 * as an OBJECT; Bird requires an array — `422 "value must be an array"`. The
 * 2026-07-02 follow-up fix (`{ contacts: [{ listId }] }`) was itself a
 * docs-derived best-guess that was NEVER live-tested. On the 2026-07-14 live
 * smoke test it 422'd again — `property "listId" is unsupported`: Bird's
 * channels /messages endpoint has NO list-targeting field at all (its docs
 * only ever show phone-identifier receivers because that is the only shape
 * that exists). List-targeted sends are now fanned out to individual
 * `identifierValue` receivers via a preflight GET on the list — see `send()`.
 *
 * What was wrong (layer 9): the template body was nested under `body.template`
 * with `{ name, locale, components: [...] }` — the WhatsApp Cloud API (Meta
 * direct) shape. Bird's own `/messages` endpoint instead wants `template` as a
 * TOP-LEVEL sibling of `receiver` (no `body` field for template sends), keyed
 * by `projectId` + `version` (not `name`), with a FLAT `parameters` array
 * (`{ type, key, value }`) — no `components` wrapper.
 */
export const BIRD_RUNTIME_SEND_VERIFIED = true;

/** Pacing/backoff (ms) for the single 429 retry added around fan-out sends. */
const BIRD_FANOUT_RETRY_DELAY_MS = 2_000;

/** Best-effort read of an HTTP status off a thrown Bird client error (BirdHttpError carries `status`). */
function birdErrorStatus(e: unknown): number | null {
  if (e && typeof e === "object" && "status" in e) {
    const s = (e as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return null;
}

/**
 * The base client (client.ts) already retries 5xx once but NOT 429. Add a
 * single rate-limit retry here for the fan-out, which can burst N sends.
 */
async function sendWithRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (birdErrorStatus(e) === 429) {
      await new Promise((r) => setTimeout(r, BIRD_FANOUT_RETRY_DELAY_MS));
      return await fn();
    }
    throw e;
  }
}

/** Exposed for tests + the connections UI — mirrors the Mailchimp helper. */
export function birdDryRunGatesBlockLiveSend(connection: D2CConnection): {
  featureOff: boolean;
  liveDisabled: boolean;
  notMatasApproved: boolean;
} {
  return d2cDryRunGates(connection);
}

export class BirdProvider implements D2CProvider {
  readonly name = "bird" as const;

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<ValidateD2CCredentialsResult> {
    const apiKey = readString(credentials, "api_key");
    const workspaceId = readString(credentials, "workspace_id");
    if (!apiKey || !workspaceId) {
      return {
        ok: false,
        error: "api_key and workspace_id are required.",
      };
    }
    try {
      await birdJson<unknown>(
        apiKey,
        `/workspaces/${workspaceId}/channels`,
        { method: "GET" },
      );
      return { ok: true, externalAccountId: workspaceId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Bird channel check failed.";
      return { ok: false, error: msg };
    }
  }

  async send(
    connection: D2CConnection,
    message: D2CMessage,
  ): Promise<SendResult> {
    if (shouldD2CDryRun(connection)) {
      return performDryRun(this.name, message);
    }

    const creds =
      connection.credentials && typeof connection.credentials === "object"
        ? (connection.credentials as Record<string, unknown>)
        : {};
    const apiKey = readString(creds, "api_key");
    const workspaceId = readString(creds, "workspace_id");
    // Per-send override for multi-brand-per-client setups (e.g. Throwback +
    // Hop on the Top share one d2c_connections row — UNIQUE(user_id,
    // client_id, provider) forbids a second Bird row per client — but each
    // brand's sends carry their own WhatsApp channel in audience.channel_id).
    // Falls back to the connection-level credential for legacy single-brand
    // clients that never set a per-send channel_id.
    const channelId =
      readString(
        (message.audience ?? {}) as Record<string, unknown>,
        "channel_id",
      ) ?? readString(creds, "channel_id");
    if (!apiKey || !workspaceId || !channelId) {
      return {
        ok: false,
        dryRun: false,
        error: "Missing Bird api_key, workspace_id or channel_id on connection.",
      };
    }

    // Layers 6 & 9: retained as a live re-gating point. Currently a no-op
    // (BIRD_RUNTIME_SEND_VERIFIED = true) — flip back to false if a future
    // shape regression is discovered before it can be reconciled.
    if (message.channel === "whatsapp" && !BIRD_RUNTIME_SEND_VERIFIED) {
      return {
        ok: false,
        dryRun: false,
        error:
          "BIRD_RUNTIME_UNVERIFIED: live WhatsApp send blocked — BIRD_RUNTIME_SEND_VERIFIED is false. " +
          "See docs/D2C_LIVE_FIRE_RUNBOOK.md.",
      };
    }

    const audience = message.audience ?? {};
    const variables = Object.fromEntries(
      Object.entries(message.variables ?? {}).map(([k, v]) => [
        k,
        v === null || v === undefined ? "" : String(v),
      ]),
    );

    // Recipients: provider-specific. Accept either an explicit list of
    // identifiers or a Bird list/segment id on the audience descriptor.
    const recipients = Array.isArray(audience.recipients)
      ? (audience.recipients as unknown[]).map((r) => String(r))
      : [];

    // Bug (2026-07-14): tag-scoped sends (built by the tag picker) persist
    // `audience.tag` but never `audience.list_id`. Resolve at send time via
    // Bird's group lookup when no explicit list_id/recipients were given.
    let listId: string | null = null;
    let listIdResolvedFromTag = false;
    if (recipients.length === 0) {
      const resolved = await resolveBirdListId(
        { apiKey, workspaceId },
        audience as Record<string, unknown>,
      );
      listId = resolved.listId;
      listIdResolvedFromTag = resolved.resolvedFromTag;
    }
    if (recipients.length === 0 && !listId) {
      const tag = readString(audience as Record<string, unknown>, "tag");
      return {
        ok: false,
        dryRun: false,
        error: tag
          ? `Bird sends require audience.recipients[] or audience.list_id — no Bird group named "${tag}" was found in the workspace to resolve audience.tag against.`
          : "Bird sends require audience.recipients[] or audience.list_id.",
      };
    }

    // WhatsApp template identity: Bird templates are addressed by
    // projectId + version (the Studio project + published version UUID),
    // NOT by name. `template_id` here maps to Bird's `version` field — same
    // naming Cursor already uses for the draft-campaign flow
    // (OrchestrationInput.bird.projectId / .templateId, see orchestration/index.ts).
    // See resolveBirdTemplateInfo's doc for why this checks both audience AND
    // variables (Bug B, 2026-07-08).
    const templateInfo = resolveBirdTemplateInfo(
      audience as Record<string, unknown>,
      message.variables ?? {},
    );

    const renderedBody = substituteTemplateVariables(
      message.bodyMarkdown,
      variables,
    );

    const isTemplateSend = message.channel === "whatsapp" && templateInfo !== null;

    // Build the Bird `/messages` body for a given receiver. Template sends and
    // plain-text sends are mutually exclusive top-level shapes: template sends
    // carry `template` (no `body` field); non-template sends carry `body` (no
    // `template` field). Never both. (Layer 9.)
    const makeBody = (
      receiver: Record<string, unknown>,
    ): Record<string, unknown> =>
      isTemplateSend
        ? {
            receiver,
            template: {
              projectId: templateInfo!.projectId,
              version: templateInfo!.versionId,
              locale: templateInfo!.locale,
              // Flat parameter array — Bird's own abstraction over the
              // WhatsApp Cloud API's nested components[].parameters[] shape.
              parameters: Object.entries(variables).map(([key, value]) => ({
                type: "string",
                key,
                value,
              })),
            },
          }
        : {
            receiver,
            body: { type: "text", text: { text: renderedBody } },
          };

    const messagesPath = `/workspaces/${workspaceId}/channels/${channelId}/messages`;
    const postMessage = (receiver: Record<string, unknown>) =>
      birdJson<{ id?: string }>(apiKey, messagesPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeBody(receiver)),
      });

    // ── Explicit-recipients path (unchanged, docs-verified shape) ───────────
    // A caller-supplied identifier list sends as a single message whose
    // receiver carries every identifier — the shape byte-verified by
    // provider.integration.test.ts against Bird's capture example.
    if (recipients.length > 0) {
      try {
        const res = await postMessage({
          contacts: recipients.map((id) => ({ identifierValue: id })),
        });
        return {
          ok: true,
          dryRun: false,
          providerJobId: res.id ?? null,
          details: res,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Bird send failed.";
        return { ok: false, dryRun: false, error: msg };
      }
    }

    // ── List-targeted path: fan-out (2026-07-14) ────────────────────────────
    // Bird's channels /messages endpoint has NO list-targeting field: a
    // `receiver.contacts[].listId` is rejected 422 "property listId is
    // unsupported" (live-verified 2026-07-14, T26-ALGARVE). Replaces the prior
    // docs-derived, never-live-tested `{ contacts: [{ listId }] }` receiver.
    // Preflight GET on the list resolves members to individual phone
    // identifiers; then one message per identifier. `listId` is guaranteed
    // non-null here (the early return above covers no-recipients + no-listId).
    let contacts;
    try {
      contacts = await listContactsInList({ apiKey, workspaceId }, listId!);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      return {
        ok: false,
        dryRun: false,
        error: `Bird list-contacts preflight failed for list ${listId}: ${msg}`,
      };
    }

    const seenPhones = new Set<string>();
    const targetPhones: string[] = [];
    for (const c of contacts) {
      for (const phone of contactPhoneIdentifiers(c)) {
        if (!seenPhones.has(phone)) {
          seenPhones.add(phone);
          targetPhones.push(phone);
        }
      }
    }

    if (targetPhones.length === 0) {
      return {
        ok: false,
        dryRun: false,
        error: `Bird list ${listId} resolved to 0 phone-reachable contacts (${contacts.length} member(s) fetched, none with a phone identifier).`,
      };
    }

    const perRecipient: {
      identifierValue: string;
      ok: boolean;
      providerJobId?: string | null;
      error?: string;
    }[] = [];
    for (const phone of targetPhones) {
      try {
        const res = await sendWithRateLimitRetry(() =>
          postMessage({ contacts: [{ identifierValue: phone }] }),
        );
        perRecipient.push({
          identifierValue: phone,
          ok: true,
          providerJobId: res.id ?? null,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Bird send failed.";
        perRecipient.push({ identifierValue: phone, ok: false, error: msg });
      }
    }

    const sent = perRecipient.filter((r) => r.ok);
    const failed = perRecipient.filter((r) => !r.ok);
    // Conservative: a partial fan-out reports ok:false so the cron marks the
    // row `failed` (with the full per-recipient breakdown in result_jsonb) for
    // manual review rather than silently declaring success. No auto-retry.
    const allOk = failed.length === 0 && sent.length > 0;

    const details: Record<string, unknown> = {
      mode: "list_fanout",
      listId,
      // Runbook: cache resolved members on the result for auditability.
      preflight: {
        membersFetched: contacts.length,
        phoneReachable: targetPhones.length,
      },
      attempted: perRecipient.length,
      sent: sent.length,
      failed: failed.length,
      results: perRecipient,
    };
    // Cache the tag→list_id resolution back for audit + retry skip (same
    // channel as the pre-fan-out single-send path used).
    if (listIdResolvedFromTag && listId) {
      details.resolvedAudiencePatch = { list_id: listId };
    }

    return {
      ok: allOk,
      dryRun: false,
      providerJobId: sent[0]?.providerJobId ?? null,
      details,
      ...(allOk
        ? {}
        : {
            error: `Bird list fan-out incomplete: ${sent.length}/${perRecipient.length} sent, ${failed.length} failed${
              failed[0]?.error ? ` — first error: ${failed[0].error}` : ""
            }.`,
          }),
    };
  }
}

export const birdProvider = new BirdProvider();
