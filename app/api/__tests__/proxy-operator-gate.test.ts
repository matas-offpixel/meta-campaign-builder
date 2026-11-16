// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { MATAS_USER_IDS } from "@/lib/auth/operator-allowlist";

/**
 * The proxy's /api operator gate, end to end through updateSession with the
 * Supabase client mocked. A signed-in client_users member gets 403 JSON on
 * operator routes before any route runs; operators pass; requests with no
 * session keep today's behaviour (public routes pass, the rest redirect).
 */

const OPERATOR = MATAS_USER_IDS[0]!;
const STAFF_OPERATOR = "4aa59005-5c1d-495c-8029-8c9453950c4d";
const SLUG = "harbour-promotions"; // invented client fixture, standing in for the GMC dashboard
const MEMBER = "7d0c3f52-1b6e-4a9d-8e21-5f4a3c2b1d0e"; // invented client_users member
const ID = "a1b2c3d4-0000-4000-8000-000000000001";

const state = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }) },
    // client_users membership lookup (lib/supabase/proxy.ts lookupMembershipSlug)
    from: () => {
      const q = {
        select: () => q,
        eq: async () => ({
          data: state.userId === MEMBER ? [{ clients: { slug: SLUG } }] : [],
          error: null,
        }),
      };
      return q;
    },
  }),
}));

const { updateSession } = await import("@/lib/supabase/proxy");

const call = (path: string, method = "POST") => updateSession(new NextRequest(`http://localhost${path}`, { method }));

beforeEach(() => {
  state.userId = null;
});

const WORST = [
  "/api/meta/launch-campaign",
  "/api/meta/create-adsets",
  "/api/meta/create-creatives-and-ads",
  "/api/meta/bulk-attach-ads",
  `/api/plan/${ID}/resume`,
  "/api/internal-counts/upload",
  `/api/internal-counts/items/${ID}`,
  "/api/audiences",
  `/api/audiences/${ID}`,
  `/api/audiences/${ID}/write`,
  "/api/audiences/batch-write",
  "/api/audiences/bulk/create",
  "/api/audiences/lookalike/create",
  "/api/audiences/bulk-website/create",
  "/api/audiences/bulk-page/create",
  "/api/audiences/saved-audience/clone",
  "/api/meta/customer-audience-upload",
  "/api/meta/lookalikes/retry",
  "/api/venues/enrich",
  "/api/internal/refresh-active-creatives",
  `/api/events/${ID}/rollup/sync`,
];

/**
 * Every page under app/admin/[clientSlug] (the client dashboard), with
 * fixture ids. The dashboard calls no /api route: its data comes from
 * server components and its writes are server actions, which POST to these
 * same page URLs. lib/auth/__tests__/api-access.test.ts walks the page
 * tree and fails if an /api call ever appears there.
 */
const CLIENT_DASHBOARD_PAGES = [
  `/admin/${SLUG}`,
  `/admin/${SLUG}/fans`,
  `/admin/${SLUG}/fans/${ID}`,
  `/admin/${SLUG}/insights`,
  `/admin/${SLUG}/integrations`,
  `/admin/${SLUG}/integrations/bird`,
  `/admin/${SLUG}/integrations/mailchimp`,
  `/admin/${SLUG}/integrations/meta-pixel`,
  `/admin/${SLUG}/pages`,
  `/admin/${SLUG}/pages/new`,
  `/admin/${SLUG}/pages/${ID}/edit`,
  `/admin/${SLUG}/sales`,
  `/admin/${SLUG}/settings`,
];

describe("client dashboard still loads and works for its member", () => {
  it.each(CLIENT_DASHBOARD_PAGES)("GET %s → 200", async (path) => {
    state.userId = MEMBER;
    const res = await call(path, "GET");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(CLIENT_DASHBOARD_PAGES)("server action POST %s → 200", async (path) => {
    state.userId = MEMBER;
    const res = await call(path, "POST");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("another client's dashboard is still 403", async () => {
    state.userId = MEMBER;
    const res = await call("/admin/some-other-client", "GET");
    expect(res.status).toBe(403);
  });
});

describe("signed-in client_users member", () => {
  it.each(WORST)("gets 403 JSON on %s", async (path) => {
    state.userId = MEMBER;
    const res = await call(path);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "Operator access required" });
  });

  it.each([
    "/api/share/report/tok123",
    "/api/cron/d2c-send",
    "/api/venues/by-share-token/tok123/additional-spend",
    "/api/webhooks/ticketing/fourthefans",
    "/api/l/client/event/signup",
    "/api/auth/facebook-token",
  ])("passes %s", async (path) => {
    state.userId = MEMBER;
    const res = await call(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("operator", () => {
  it.each(WORST)("passes %s", async (path) => {
    state.userId = OPERATOR;
    const res = await call(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(["/api/meta/launch-campaign", `/api/plan/${ID}/resume`])("the staff operator passes %s", async (path) => {
    state.userId = STAFF_OPERATOR;
    const res = await call(path);
    expect(res.status).toBe(200);
  });
});

describe("no session", () => {
  it.each([
    "/api/cron/d2c-send",
    "/api/share/report/tok123",
    `/api/webhooks/mailchimp/${ID}/abc123`,
    "/api/webhooks/ticketing/fourthefans",
  ])("public route %s reaches the handler", async (path) => {
    const res = await call(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("an operator route still redirects to /login", async () => {
    const res = await call("/api/meta/launch-campaign");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });
});
