import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/auth/public-routes";
import {
  adminClientSlugFromPath,
  isAdminPath,
  isAdminPublicPath,
  isOperatorAdminPath,
} from "@/lib/auth/admin-routes";

/**
 * Supabase SSR session refresh + route protection.
 * Uses getUser() (JWT validation via Supabase) — never raw cookie names like
 * sb-access-token.
 *
 * Two protected surfaces share this proxy:
 *   - The internal operator app (everything outside /admin/{clientSlug})
 *     — session required, redirect to /login.
 *   - The client admin dashboard (/admin/{clientSlug}/*, OP909 arc) —
 *     session required AND client_users membership must match the slug.
 *     Slug mismatch is a 403 (NOT a redirect) so a client probing another
 *     tenant's URL gets an explicit denial, never a silent bounce that
 *     could be mistaken for "page moved".
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // ── Client admin dashboard (/admin/*) ────────────────────────────────
  if (isAdminPath(pathname) && !isOperatorAdminPath(pathname)) {
    if (isAdminPublicPath(pathname)) {
      // /admin/login while already authed with a membership → straight to
      // the dashboard. Keep error states (?error=...) visible.
      if (
        user &&
        pathname === "/admin/login" &&
        !request.nextUrl.searchParams.has("error")
      ) {
        const slug = await lookupMembershipSlug(supabase, user.id);
        if (slug) {
          const url = request.nextUrl.clone();
          url.pathname = `/admin/${slug}`;
          url.search = "";
          return NextResponse.redirect(url);
        }
      }
      return supabaseResponse;
    }

    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "";
      return NextResponse.redirect(url);
    }

    const membershipSlug = await lookupMembershipSlug(supabase, user.id);
    if (!membershipSlug) {
      // Authed but no client_users row — operators and revoked clients.
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "?error=no-client";
      return NextResponse.redirect(url);
    }

    const urlSlug = adminClientSlugFromPath(pathname);
    if (!urlSlug) {
      // Bare /admin → the member's own dashboard.
      const url = request.nextUrl.clone();
      url.pathname = `/admin/${membershipSlug}`;
      url.search = "";
      return NextResponse.redirect(url);
    }

    if (urlSlug !== membershipSlug) {
      // Cross-tenant probe: explicit 403, not a redirect.
      return new NextResponse("Forbidden", { status: 403 });
    }

    return supabaseResponse;
  }

  // ── Internal operator app (existing behaviour) ───────────────────────
  const publicRoute = isPublicPath(pathname, request.nextUrl.searchParams);

  if (!user && !publicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

/**
 * Resolve the caller's client slug through client_users (RLS: self-read
 * policy, migration 137). Returns null for operators / revoked users.
 * Failure-closed: a query error yields null (→ login redirect), never a
 * pass-through.
 */
async function lookupMembershipSlug(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("client_users")
    .select("clients (slug)")
    .eq("user_id", userId);
  if (error || !data || data.length !== 1) return null;
  const clients = (data[0] as { clients: unknown }).clients;
  const client = Array.isArray(clients) ? clients[0] : clients;
  const slug =
    client && typeof client === "object" && "slug" in client
      ? (client as { slug: unknown }).slug
      : null;
  return typeof slug === "string" && slug.length > 0 ? slug : null;
}
