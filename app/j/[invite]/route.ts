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
 * No auth — see PUBLIC_PREFIXES in lib/auth/public-routes.ts. The invite code
 * is validated before use; there is no user data behind this route.
 */
import { NextResponse, type NextRequest } from "next/server";

const INVITE_RE = /^[A-Za-z0-9]{8,30}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ invite: string }> },
) {
  const { invite } = await params;

  if (!INVITE_RE.test(invite)) {
    return NextResponse.json(
      { error: "Invalid invite code." },
      { status: 400 },
    );
  }

  console.error("[d2c wa-community-redirect]", {
    invite,
    userAgent: req.headers.get("user-agent"),
    referer: req.headers.get("referer"),
  });

  return NextResponse.redirect(
    `https://chat.whatsapp.com/${invite}?mode=gi_t`,
    { status: 302 },
  );
}
