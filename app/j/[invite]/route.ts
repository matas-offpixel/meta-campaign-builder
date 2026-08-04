/**
 * app/j/[invite]/route.ts
 *
 * Public WhatsApp community redirect. Meta rejected (error_subcode 2388081)
 * WhatsApp template buttons pointing at a *variable* chat.whatsapp.com URL
 * (`https://chat.whatsapp.com/{{wa_community_invite}}`) — it can't validate
 * the target at template-review time. Meta accepts a static, approved-domain
 * URL instead, so template buttons now point at
 * `https://app.offpixel.co.uk/j/{{wa_community_invite}}` and this route
 * 302-redirects to the real WhatsApp community invite.
 *
 * Alias indirection (migration 150): when the path segment matches a
 * `wa_community_aliases.slug`, redirect to that alias's current active
 * invite code. Operators can repoint the slug without a new Meta review.
 * Unknown slugs 404; raw invite codes that are not aliases still pass
 * through unchanged so every live template keeps working.
 *
 * CRITICAL: alias lookup is fail-open. Table missing, DB down, timeout —
 * anything — logs and falls through to passthrough. A broken alias subsystem
 * must never break Throwback's (etc.) already-approved raw-invite buttons.
 *
 * No auth — see PUBLIC_PREFIXES in lib/auth/public-routes.ts. There is no
 * user data behind this route. The ops UI at /wa-communities is NOT public.
 */
import { NextResponse, type NextRequest } from "next/server";

import { getAliasLookupBySlug } from "@/lib/db/wa-community-aliases";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  resolveInviteSegment,
  whatsappCommunityRedirectUrl,
} from "@/lib/wa-communities/resolve";
import { lookupAliasFailOpen } from "@/lib/wa-communities/safe-lookup";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ invite: string }> },
) {
  const { invite } = await params;

  const { alias: aliasLookup, lookupError } = await lookupAliasFailOpen(
    invite,
    async (slug) => {
      const service = createServiceRoleClient();
      return getAliasLookupBySlug(service, slug);
    },
  );

  if (lookupError) {
    console.error(
      "[d2c wa-community-redirect] alias lookup failed; falling through to passthrough",
      {
        invite,
        err:
          lookupError instanceof Error
            ? lookupError.message
            : String(lookupError),
      },
    );
  }

  const outcome = resolveInviteSegment(invite, aliasLookup);

  if (outcome.kind === "invalid") {
    return NextResponse.json(
      { error: "Invalid invite code." },
      { status: 400 },
    );
  }

  if (outcome.kind === "not_found") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const resolvedSlug = outcome.kind === "alias" ? outcome.slug : null;

  console.error("[d2c wa-community-redirect]", {
    invite,
    slug: resolvedSlug,
    destination: outcome.inviteCode,
    kind: outcome.kind,
    userAgent: req.headers.get("user-agent"),
    referer: req.headers.get("referer"),
  });

  return NextResponse.redirect(whatsappCommunityRedirectUrl(outcome.inviteCode), {
    status: 302,
  });
}
