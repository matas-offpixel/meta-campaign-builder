"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requireClientContext } from "@/lib/auth/get-client-context";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { parsePixelConfigForm, buildTestEventInput } from "@/lib/admin/meta-pixel-schema";
import {
  buildCapiEventPayload,
  sendCapiEvent,
} from "@/lib/landing-pages/meta-capi";

/**
 * lib/actions/meta-pixel.ts — self-service Meta Pixel + CAPI setup
 * (OP909 Phase 7). Replaces the operator SQL flow
 * (`select set_landing_page_capi_token(…)`).
 *
 * Token hygiene: the raw token exists only inside saveMetaPixelConfig's
 * scope on its way into the set_landing_page_capi_token RPC (pgcrypto,
 * migration 135) and inside sendTestPixelEvent's scope on its way out of
 * get_landing_page_capi_token into the Graph URL. It is never logged,
 * never returned in action state, never stored client-side.
 */

export interface PixelConfigState {
  status: "idle" | "saved" | "error";
  errors: Record<string, string>;
}

export interface TestEventState {
  status: "idle" | "ok" | "error";
  fbtraceId: string | null;
  error: string | null;
}

function requireTokenKey(): string {
  const key = process.env.LANDING_PAGES_TOKEN_KEY;
  if (!key || key.length < 8) {
    throw new Error("[admin-pixel] LANDING_PAGES_TOKEN_KEY missing/short");
  }
  return key;
}

export async function saveMetaPixelConfig(
  _prev: PixelConfigState,
  formData: FormData,
): Promise<PixelConfigState> {
  const membership = await requireClientContext();

  const parsed = parsePixelConfigForm({
    pixel_id: formData.get("pixel_id"),
    capi_token: formData.get("capi_token"),
    clear_token: formData.get("clear_token"),
    test_event_code: formData.get("test_event_code"),
  });
  if (!parsed.ok) return { status: "error", errors: parsed.errors };
  const value = parsed.value;

  const db = createServiceRoleClient();

  const { data: existing, error: readError } = await db
    .from("client_landing_pages")
    .select("id, meta_pixel_id")
    .eq("client_id", membership.clientId)
    .maybeSingle();
  if (readError) {
    return {
      status: "error",
      errors: { _form: `Could not load config: ${readError.message}` },
    };
  }
  if (!existing) {
    // Branding settings (Phase 2) upsert this row; pixel setup without
    // a landing-page config makes no sense, so point them there.
    return {
      status: "error",
      errors: {
        _form:
          "No landing-page configuration exists for this client yet — save your brand settings first.",
      },
    };
  }

  // Changing/clearing the pixel invalidates any previous verification.
  const pixelChanged = value.pixelId !== existing.meta_pixel_id;
  const { error: updateError } = await db
    .from("client_landing_pages")
    .update({
      meta_pixel_id: value.pixelId,
      meta_test_event_code: value.testEventCode,
      ...(pixelChanged ? { meta_pixel_id_verified_at: null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", membership.clientId);
  if (updateError) {
    return {
      status: "error",
      errors: { _form: `Save failed: ${updateError.message}` },
    };
  }

  if (value.tokenAction !== "keep") {
    const { error: tokenError } = await db.rpc("set_landing_page_capi_token", {
      p_client_id: membership.clientId,
      p_token: value.tokenAction === "set" ? value.token : null,
      p_key: requireTokenKey(),
    });
    if (tokenError) {
      // RPC error messages never contain the token (only key-length or
      // row-missing failures) — safe to surface.
      return {
        status: "error",
        errors: { capi_token: `Token save failed: ${tokenError.message}` },
      };
    }
  }

  revalidatePath(`/admin/${membership.clientSlug}/integrations/meta-pixel`);
  revalidatePath(`/admin/${membership.clientSlug}/insights`);
  return { status: "saved", errors: {} };
}

export async function sendTestPixelEvent(
  // useActionState signature — neither input drives the test event.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: TestEventState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData,
): Promise<TestEventState> {
  const membership = await requireClientContext();
  const db = createServiceRoleClient();

  const { data: row, error: readError } = await db
    .from("client_landing_pages")
    .select("meta_pixel_id, meta_test_event_code")
    .eq("client_id", membership.clientId)
    .maybeSingle();
  if (readError || !row) {
    return {
      status: "error",
      fbtraceId: null,
      error: readError?.message ?? "No landing-page configuration found.",
    };
  }
  const pixelId = (row as { meta_pixel_id: string | null }).meta_pixel_id;
  if (!pixelId) {
    return {
      status: "error",
      fbtraceId: null,
      error: "Save a Pixel ID first.",
    };
  }

  const tokenKey = requireTokenKey();
  const { data: token, error: tokenError } = await db.rpc(
    "get_landing_page_capi_token",
    { p_client_id: membership.clientId, p_key: tokenKey },
  );
  if (tokenError) {
    return {
      status: "error",
      fbtraceId: null,
      error: `Token lookup failed: ${tokenError.message}`,
    };
  }
  if (typeof token !== "string" || token.length === 0) {
    return {
      status: "error",
      fbtraceId: null,
      error: "No CAPI access token configured — save one first.",
    };
  }

  // The logged-in client user's own email seeds user_data (hashed by the
  // payload builder, same as a real signup).
  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();

  const input = buildTestEventInput({
    uuid: randomUUID(),
    email: user?.email ?? null,
    nowMs: Date.now(),
    pageUrl: `https://app.offpixel.co.uk/admin/${membership.clientSlug}/integrations/meta-pixel`,
  });
  const payload = buildCapiEventPayload(
    input,
    (row as { meta_test_event_code: string | null }).meta_test_event_code,
  );
  const outcome = await sendCapiEvent(payload, {
    pixelId,
    accessToken: token,
    testEventCode: null, // already baked into the payload above
  });

  if (!outcome.ok) {
    return {
      status: "error",
      fbtraceId: outcome.fbtrace_id ?? null,
      error: outcome.error ?? "Meta rejected the event.",
    };
  }

  const { error: verifyError } = await db
    .from("client_landing_pages")
    .update({ meta_pixel_id_verified_at: new Date().toISOString() })
    .eq("client_id", membership.clientId);
  if (verifyError) {
    console.error(
      `[admin-pixel] verified_at update failed: ${verifyError.message}`,
    );
  }

  revalidatePath(`/admin/${membership.clientSlug}/integrations/meta-pixel`);
  return {
    status: "ok",
    fbtraceId: outcome.fbtrace_id ?? null,
    error: null,
  };
}
