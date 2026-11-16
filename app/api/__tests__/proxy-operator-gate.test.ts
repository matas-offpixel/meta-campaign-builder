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
const MEMBER = "7d0c3f52-1b6e-4a9d-8e21-5f4a3c2b1d0e"; // invented client_users member
const ID = "a1b2c3d4-0000-4000-8000-000000000001";

const state = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }) },
    from: () => {
      const q = { select: () => q, eq: async () => ({ data: [], error: null }) };
      return q;
    },
  }),
}));

const { updateSession } = await import("@/lib/supabase/proxy");

const call = (path: string, method = "POST") => updateSession(new NextRequest(`http://localhost${path}`, { method }));

beforeEach(() => {
  state.userId = null;
});

describe("signed-in client_users member", () => {
  it.each([
    "/api/meta/launch-campaign",
    "/api/internal-counts/upload",
    "/api/venues/enrich",
    `/api/plan/${ID}/resume`,
    "/api/meta/bulk-attach-ads",
    "/api/internal/refresh-active-creatives",
    `/api/events/${ID}/rollup/sync`,
  ])("gets 403 JSON on %s", async (path) => {
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
  ])("passes %s", async (path) => {
    state.userId = MEMBER;
    const res = await call(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("operator", () => {
  it.each(["/api/meta/launch-campaign", "/api/internal-counts/upload", `/api/plan/${ID}/resume`])(
    "passes %s",
    async (path) => {
      state.userId = OPERATOR;
      const res = await call(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    },
  );
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
