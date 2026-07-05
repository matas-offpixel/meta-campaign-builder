"use server";

import { revalidatePath } from "next/cache";

import { requireClientContext } from "@/lib/auth/get-client-context";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  buildBirdCredentials,
  buildMailchimpCredentials,
  parseBirdConnectionForm,
  parseMailchimpConnectionForm,
} from "@/lib/admin/crm-schema";
import {
  getCrmConnectionSummary,
  getDecryptedCrmCredentials,
  recordCrmTestOutcome,
  saveCrmConnection,
  type CrmProvider,
} from "@/lib/db/crm-connections";
import { BirdProvider } from "@/lib/d2c/bird/provider";
import { MailchimpProvider } from "@/lib/d2c/mailchimp/provider";

/**
 * lib/actions/crm-connections.ts — self-service Bird + Mailchimp
 * credential entry (OP909 Phase 8).
 *
 * Key hygiene mirrors the Meta Pixel action: raw API keys exist only in
 * the action scope on their way into set_d2c_credentials / out of
 * get_d2c_credentials into the provider's Authorization header. Never
 * logged, never in action state.
 *
 * "Test connection" runs the provider's validateCredentials — a real,
 * READ-ONLY API round trip (Bird: GET /workspaces/{id}/channels;
 * Mailchimp: GET /3.0/ping). No message is ever sent from here; live
 * sends remain behind the 3-of-3 D2C gate which clients cannot toggle.
 */

export interface CrmFormState {
  status: "idle" | "saved" | "error";
  errors: Record<string, string>;
}

export interface CrmTestState {
  status: "idle" | "ok" | "error";
  detail: string | null;
}

const providers = {
  bird: new BirdProvider(),
  mailchimp: new MailchimpProvider(),
} as const;

export async function saveBirdConnection(
  _prev: CrmFormState,
  formData: FormData,
): Promise<CrmFormState> {
  const membership = await requireClientContext();
  const db = createServiceRoleClient();

  const existing = await getCrmConnectionSummary(db, membership.clientId, "bird");
  const parsed = parseBirdConnectionForm(
    {
      workspace_id: formData.get("workspace_id"),
      channel_id: formData.get("channel_id"),
      api_key: formData.get("api_key"),
      template_project_id: formData.get("template_project_id"),
      template_version_id: formData.get("template_version_id"),
    },
    { apiKeyConfigured: existing?.config.apiKeyConfigured ?? false },
  );
  if (!parsed.ok) return { status: "error", errors: parsed.errors };

  const existingBlob = existing
    ? await getDecryptedCrmCredentials(db, existing.id).catch(() => null)
    : null;
  const built = buildBirdCredentials(existingBlob, parsed.value);
  if (!built.ok) {
    return { status: "error", errors: { api_key: built.error } };
  }

  const saved = await saveCrmConnection(db, {
    clientId: membership.clientId,
    userId: membership.userId,
    provider: "bird",
    credentials: built.blob,
    externalAccountId: parsed.value.workspaceId,
  });
  if (!saved.ok) return { status: "error", errors: { _form: saved.error } };

  revalidatePath(`/admin/${membership.clientSlug}/integrations/bird`);
  revalidatePath(`/admin/${membership.clientSlug}/integrations`);
  return { status: "saved", errors: {} };
}

export async function saveMailchimpConnection(
  _prev: CrmFormState,
  formData: FormData,
): Promise<CrmFormState> {
  const membership = await requireClientContext();
  const db = createServiceRoleClient();

  const existing = await getCrmConnectionSummary(
    db,
    membership.clientId,
    "mailchimp",
  );
  const parsed = parseMailchimpConnectionForm(
    {
      api_key: formData.get("api_key"),
      audience_id: formData.get("audience_id"),
    },
    { apiKeyConfigured: existing?.config.apiKeyConfigured ?? false },
  );
  if (!parsed.ok) return { status: "error", errors: parsed.errors };

  const existingBlob = existing
    ? await getDecryptedCrmCredentials(db, existing.id).catch(() => null)
    : null;
  const built = buildMailchimpCredentials(existingBlob, parsed.value);
  if (!built.ok) {
    return { status: "error", errors: { api_key: built.error } };
  }

  const saved = await saveCrmConnection(db, {
    clientId: membership.clientId,
    userId: membership.userId,
    provider: "mailchimp",
    credentials: built.blob,
    externalAccountId:
      typeof built.blob.server_prefix === "string"
        ? built.blob.server_prefix
        : null,
  });
  if (!saved.ok) return { status: "error", errors: { _form: saved.error } };

  revalidatePath(`/admin/${membership.clientSlug}/integrations/mailchimp`);
  revalidatePath(`/admin/${membership.clientSlug}/integrations`);
  return { status: "saved", errors: {} };
}

async function testConnection(provider: CrmProvider): Promise<CrmTestState> {
  const membership = await requireClientContext();
  const db = createServiceRoleClient();

  const existing = await getCrmConnectionSummary(db, membership.clientId, provider);
  if (!existing) {
    return { status: "error", detail: "Save the connection first." };
  }

  let creds: Record<string, unknown> | null;
  try {
    creds = await getDecryptedCrmCredentials(db, existing.id);
  } catch (e) {
    return {
      status: "error",
      detail: e instanceof Error ? e.message : "Credential decryption failed.",
    };
  }
  if (!creds) {
    return { status: "error", detail: "No credentials stored — save them first." };
  }

  const result = await providers[provider].validateCredentials(creds);
  await recordCrmTestOutcome(db, existing.id, {
    ok: result.ok,
    error: result.ok ? null : result.error ?? "Validation failed.",
  });

  revalidatePath(`/admin/${membership.clientSlug}/integrations/${provider}`);
  revalidatePath(`/admin/${membership.clientSlug}/integrations`);

  if (!result.ok) {
    return { status: "error", detail: result.error ?? "Validation failed." };
  }
  return {
    status: "ok",
    detail: result.externalAccountId
      ? `Connected (account ${result.externalAccountId}).`
      : "Connected.",
  };
}

export async function testBirdConnection(
  // useActionState signature — inputs don't drive the test.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: CrmTestState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData,
): Promise<CrmTestState> {
  return testConnection("bird");
}

export async function testMailchimpConnection(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: CrmTestState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData,
): Promise<CrmTestState> {
  return testConnection("mailchimp");
}
