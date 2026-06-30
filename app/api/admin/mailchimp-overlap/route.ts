import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { getMailchimpCredentials } from "@/lib/mailchimp/credentials";
import {
  getAudienceSegments,
  getAllSegmentMemberIds,
} from "@/lib/mailchimp/client";

export const maxDuration = 300;

function isAuthorized(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret || !authHeader) return false;
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim() === secret.trim();
  }
  return false;
}

/**
 * POST /api/admin/mailchimp-overlap
 *
 * Computes how many contacts in an "anchor" tag also appear in each of the
 * supplied "comparison" tags. Returns an overlap matrix in a single call.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (ops / curl only).
 *
 * Body:
 *   client_id       – UUID of the client row whose Mailchimp account to use
 *   anchor_tag      – tag name whose members form the reference set
 *   comparison_tags – array of tag names to intersect against the anchor
 *
 * Member IDs are Mailchimp's MD5-hashed email addresses (subscriber_hash),
 * so set intersection is purely in-memory and very fast even at 10k+ contacts.
 * Each segment pull pages via getAllSegmentMemberIds; the safety cap is 50k.
 * Comparison-tag member sets are cached so each tag is fetched exactly once
 * (the spec's second loop for total_unique_across_all_tags would otherwise
 * double-fetch every comparison tag).
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    client_id: clientId,
    anchor_tag: anchorTag,
    comparison_tags: comparisonTags,
  } = body as Record<string, unknown>;

  if (
    typeof clientId !== "string" ||
    typeof anchorTag !== "string" ||
    !Array.isArray(comparisonTags) ||
    comparisonTags.length === 0
  ) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid client_id, anchor_tag, or comparison_tags" },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;

  const { data: client } = await sb
    .from("clients")
    .select("mailchimp_account_id, mailchimp_audience_id")
    .eq("id", clientId)
    .maybeSingle();

  if (!client?.mailchimp_account_id || !client?.mailchimp_audience_id) {
    return NextResponse.json(
      { ok: false, error: "Client has no Mailchimp account / audience configured" },
      { status: 400 },
    );
  }

  const creds = await getMailchimpCredentials(supabase, client.mailchimp_account_id);
  if (!creds) {
    return NextResponse.json(
      { ok: false, error: "No Mailchimp credentials found" },
      { status: 500 },
    );
  }

  const segmentsResp = await getAudienceSegments(
    creds.dc,
    client.mailchimp_audience_id,
    creds.apiKey,
    { type: "static", count: 1000 },
  );
  const segments = segmentsResp.segments ?? [];

  const anchorSegment = segments.find((s) => s.name === anchorTag);
  if (!anchorSegment) {
    return NextResponse.json(
      { ok: false, error: `Anchor tag "${anchorTag}" not found in audience` },
      { status: 404 },
    );
  }

  const anchorMembers = await getAllSegmentMemberIds(
    creds.dc,
    client.mailchimp_audience_id,
    anchorSegment.id,
    creds.apiKey,
  );
  const anchorSet = new Set(anchorMembers.map((m) => m.id));
  console.error(`[mailchimp-overlap] anchor="${anchorTag}" members=${anchorSet.size}`);

  // Cache comparison-tag member sets so each tag is fetched exactly once —
  // the set is reused for both the per-tag overlap computation and the
  // total_unique_across_all_tags dedup without a second API round-trip.
  const tagSetCache = new Map<string, Set<string>>();

  const overlapPerTag: Array<{
    tag: string;
    segment_id: number | null;
    tag_total: number;
    overlap_with_anchor: number;
    pct_of_anchor: string;
    pct_of_tag: string;
  }> = [];

  for (const tagName of comparisonTags as string[]) {
    const segment = segments.find((s) => s.name === tagName);
    if (!segment) {
      overlapPerTag.push({
        tag: tagName,
        segment_id: null,
        tag_total: 0,
        overlap_with_anchor: 0,
        pct_of_anchor: "0.0%",
        pct_of_tag: "0.0%",
      });
      continue;
    }

    const tagMembers = await getAllSegmentMemberIds(
      creds.dc,
      client.mailchimp_audience_id,
      segment.id,
      creds.apiKey,
    );
    const tagSet = new Set(tagMembers.map((m) => m.id));
    tagSetCache.set(tagName, tagSet);

    const overlap = [...tagSet].filter((id) => anchorSet.has(id)).length;
    const pctOfAnchor = anchorSet.size > 0
      ? ((overlap / anchorSet.size) * 100).toFixed(1) + "%"
      : "0.0%";
    const pctOfTag = tagSet.size > 0
      ? ((overlap / tagSet.size) * 100).toFixed(1) + "%"
      : "0.0%";

    overlapPerTag.push({
      tag: tagName,
      segment_id: segment.id,
      tag_total: tagSet.size,
      overlap_with_anchor: overlap,
      pct_of_anchor: pctOfAnchor,
      pct_of_tag: pctOfTag,
    });

    console.error(
      `[mailchimp-overlap] tag="${tagName}" total=${tagSet.size} overlap=${overlap}`,
    );
  }

  // Unique contact count across anchor + all found comparison tags (deduped).
  const totalUniqueSet = new Set<string>(anchorSet);
  for (const [, tagSet] of tagSetCache) {
    for (const id of tagSet) totalUniqueSet.add(id);
  }

  return NextResponse.json({
    ok: true,
    summary: {
      anchor_tag: anchorTag,
      anchor_total: anchorSet.size,
      total_unique_across_all_tags: totalUniqueSet.size,
    },
    overlap_per_tag: overlapPerTag,
  });
}
