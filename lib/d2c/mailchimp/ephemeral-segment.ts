/**
 * lib/d2c/mailchimp/ephemeral-segment.ts
 *
 * Mailchimp has no native single-recipient campaign send (no Mandrill/
 * transactional key is configured on this account — verified 2026-07-08). To
 * autorespond to ONE new member we create a throwaway segment holding just
 * that member, send a regular campaign to it, then delete the segment.
 *
 * **2026-07-09 fix — do NOT use `static_segment` here.** Mailchimp merged
 * "static segments" into "tags" years ago: the API still calls the concept
 * a static segment, but every one you create this way is rendered in the
 * modern UI's Audience → **Tags** panel, not Segments (confirmed —
 * `lib/d2c/audience/tag-registry.ts`'s own doc comment: "a tag IS a static
 * segment sharing the same id space", and it enumerates tags via
 * `GET /lists/{id}/segments?type=static`). The original implementation here
 * used `static_segment: [email]`, so every autoresp/test-send fire minted a
 * throwaway `d2c-autoresp-<ts>` / `d2c-test-<ts>` **tag** that persisted in
 * the audience's Tags list after the segment delete (deleting a `type:
 * "static"` segment removes it from `/segments`, but Matas saw these
 * specifically in the Tags UI while they existed — live-verified against
 * Throwback's audience `c2b4d77acb` and explicitly flagged).
 *
 * Fix: create a **saved** (query-based) segment instead — a single
 * `EmailAddress` condition matching exactly this member. Saved segments are
 * a distinct `type` from static segments/tags and never appear in the Tags
 * panel. `recipients.segment_opts.saved_segment_id` on the campaign-create
 * call (`lib/d2c/mailchimp/provider.ts`) works identically regardless of
 * whether the referenced segment is static or saved — Mailchimp resolves
 * membership at send time either way, so no downstream change was needed.
 * Delete is still best-effort — a leaked segment is cosmetic, never a
 * mis-send, and (being a saved segment, not a tag) is invisible in the Tags
 * UI even if cleanup ever fails.
 */

import { mailchimpJson } from "./client.ts";

export interface EphemeralSegment {
  id: number;
  name: string;
}

/**
 * Create a saved (query-based) segment matching exactly `email`. NOT a
 * static segment / tag — see the module doc above for why that distinction
 * matters. Returns its numeric id.
 */
export async function createMemberSegment(
  serverPrefix: string,
  apiKey: string,
  listId: string,
  email: string,
  opts?: { namePrefix?: string; nowMs?: number },
): Promise<EphemeralSegment> {
  const name = `${opts?.namePrefix ?? "d2c-autoresp"}-${opts?.nowMs ?? Date.now()}`;
  const created = await mailchimpJson<{ id: number; name: string }>(
    serverPrefix,
    apiKey,
    `/3.0/lists/${listId}/segments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        options: {
          match: "any",
          conditions: [
            { condition_type: "EmailAddress", field: "merge0", op: "is", value: email },
          ],
        },
      }),
    },
  );
  return { id: created.id, name: created.name ?? name };
}

/** Best-effort delete of an ephemeral segment. Never throws. */
export async function deleteSegment(
  serverPrefix: string,
  apiKey: string,
  listId: string,
  segmentId: number,
): Promise<void> {
  try {
    await mailchimpJson<unknown>(
      serverPrefix,
      apiKey,
      `/3.0/lists/${listId}/segments/${segmentId}`,
      { method: "DELETE" },
    );
  } catch (e) {
    console.warn(
      `[d2c ephemeral-segment] delete ${segmentId} failed:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}
