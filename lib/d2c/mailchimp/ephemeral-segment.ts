/**
 * lib/d2c/mailchimp/ephemeral-segment.ts
 *
 * Mailchimp has no native single-recipient campaign send (no Mandrill/
 * transactional key is configured on this account — verified 2026-07-08). To
 * autorespond to ONE new member we create a throwaway static segment holding
 * just that member, send a regular campaign to it, then delete the segment.
 *
 * `POST /lists/{id}/segments` with a `static_segment` array creates the segment
 * AND snapshots membership synchronously, so the subsequent campaign send
 * resolves the recipient immediately; deleting the segment afterwards is safe.
 * Delete is best-effort — a leaked segment is cosmetic, never a mis-send.
 */

import { mailchimpJson } from "./client.ts";

export interface EphemeralSegment {
  id: number;
  name: string;
}

/** Create a static segment containing exactly `email`. Returns its numeric id. */
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
      body: JSON.stringify({ name, static_segment: [email] }),
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
