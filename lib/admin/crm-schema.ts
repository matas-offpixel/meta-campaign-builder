/**
 * lib/admin/crm-schema.ts — pure validation + credential-blob building
 * for the self-service CRM integrations (OP909 Phase 8: Bird WhatsApp +
 * Mailchimp email).
 *
 * No imports from next/supabase — unit-testable under the react-server
 * node:test condition. The API keys handled here are write-only: blank
 * input means "keep the stored key" (only allowed when one is already
 * configured), mirroring the Meta Pixel token tri-state.
 *
 * The blobs built here MUST stay shape-compatible with what the D2C
 * providers read at send time (lib/d2c/bird/provider.ts reads api_key /
 * workspace_id / channel_id; lib/d2c/mailchimp/provider.ts +
 * credentials.ts read api_key / server_prefix). Template + audience ids
 * are stored alongside for the orchestration layer.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mailchimp keys look like `<hex>-us14` — the suffix is the server prefix. */
const MAILCHIMP_KEY_RE = /^[a-z0-9]{10,}-([a-z]{2}\d{1,3})$/i;

function asTrimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export interface BirdConnectionFormValues {
  workspaceId: string;
  channelId: string;
  /** null = keep the stored key. */
  apiKey: string | null;
  templateProjectId: string | null;
  /** UUID or the literal "latest". */
  templateVersionId: string | null;
}

export type ParseBirdResult =
  | { ok: true; value: BirdConnectionFormValues }
  | { ok: false; errors: Record<string, string> };

export function parseBirdConnectionForm(
  values: {
    workspace_id: unknown;
    channel_id: unknown;
    api_key: unknown;
    template_project_id: unknown;
    template_version_id: unknown;
  },
  opts: { apiKeyConfigured: boolean },
): ParseBirdResult {
  const errors: Record<string, string> = {};

  const workspaceId = asTrimmed(values.workspace_id);
  if (!UUID_RE.test(workspaceId)) {
    errors.workspace_id = "Workspace ID must be a UUID (from Bird → Settings).";
  }

  const channelId = asTrimmed(values.channel_id);
  if (!UUID_RE.test(channelId)) {
    errors.channel_id = "Channel ID must be a UUID (your WhatsApp channel).";
  }

  const apiKeyRaw = asTrimmed(values.api_key);
  let apiKey: string | null = null;
  if (apiKeyRaw.length === 0) {
    if (!opts.apiKeyConfigured) {
      errors.api_key = "Paste your Bird access key.";
    }
  } else if (apiKeyRaw.length < 24) {
    // Bird workspace access keys are long — a short paste is a truncation.
    errors.api_key = "That looks too short to be a Bird access key.";
  } else {
    apiKey = apiKeyRaw;
  }

  const templateProjectRaw = asTrimmed(values.template_project_id);
  let templateProjectId: string | null = null;
  if (templateProjectRaw.length > 0) {
    if (!UUID_RE.test(templateProjectRaw)) {
      errors.template_project_id = "Template project ID must be a UUID.";
    } else {
      templateProjectId = templateProjectRaw;
    }
  }

  const templateVersionRaw = asTrimmed(values.template_version_id);
  let templateVersionId: string | null = null;
  if (templateVersionRaw.length > 0) {
    if (
      templateVersionRaw.toLowerCase() !== "latest" &&
      !UUID_RE.test(templateVersionRaw)
    ) {
      errors.template_version_id =
        'Template version must be a UUID or "latest".';
    } else {
      templateVersionId =
        templateVersionRaw.toLowerCase() === "latest"
          ? "latest"
          : templateVersionRaw;
    }
  }
  if (templateVersionId && !templateProjectId) {
    errors.template_project_id =
      "A template version needs a template project ID.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      workspaceId,
      channelId,
      apiKey,
      templateProjectId,
      templateVersionId,
    },
  };
}

export interface MailchimpConnectionFormValues {
  /** null = keep the stored key (server prefix kept with it). */
  apiKey: string | null;
  /** Derived from the key's `-dc` suffix when apiKey is set; else null. */
  serverPrefix: string | null;
  audienceId: string | null;
}

export type ParseMailchimpResult =
  | { ok: true; value: MailchimpConnectionFormValues }
  | { ok: false; errors: Record<string, string> };

export function parseMailchimpConnectionForm(
  values: { api_key: unknown; audience_id: unknown },
  opts: { apiKeyConfigured: boolean },
): ParseMailchimpResult {
  const errors: Record<string, string> = {};

  const apiKeyRaw = asTrimmed(values.api_key);
  let apiKey: string | null = null;
  let serverPrefix: string | null = null;
  if (apiKeyRaw.length === 0) {
    if (!opts.apiKeyConfigured) {
      errors.api_key = "Paste your Mailchimp API key.";
    }
  } else {
    const m = MAILCHIMP_KEY_RE.exec(apiKeyRaw);
    if (!m) {
      errors.api_key =
        "Mailchimp keys end in a datacenter suffix, e.g. …-us14 — paste the full key.";
    } else {
      apiKey = apiKeyRaw;
      serverPrefix = m[1].toLowerCase();
    }
  }

  const audienceRaw = asTrimmed(values.audience_id);
  let audienceId: string | null = null;
  if (audienceRaw.length > 0) {
    if (!/^[a-z0-9]{6,20}$/i.test(audienceRaw)) {
      errors.audience_id =
        "Audience ID is the short alphanumeric ID from Audience → Settings.";
    } else {
      audienceId = audienceRaw;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { apiKey, serverPrefix, audienceId } };
}

export type BuildCredentialsResult =
  | { ok: true; blob: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Merge parsed Bird form values over the existing decrypted blob.
 * `api_key` survives from `existing` when the form kept it blank.
 * Output is the FULL blob to hand to set_d2c_credentials (the RPC
 * replaces, not patches).
 */
export function buildBirdCredentials(
  existing: Record<string, unknown> | null,
  v: BirdConnectionFormValues,
): BuildCredentialsResult {
  const apiKey =
    v.apiKey ??
    (typeof existing?.api_key === "string" && existing.api_key.trim()
      ? existing.api_key.trim()
      : null);
  if (!apiKey) return { ok: false, error: "No API key available — paste one." };
  const blob: Record<string, unknown> = {
    api_key: apiKey,
    workspace_id: v.workspaceId,
    channel_id: v.channelId,
  };
  if (v.templateProjectId) blob.template_project_id = v.templateProjectId;
  if (v.templateVersionId) blob.template_version_id = v.templateVersionId;
  return { ok: true, blob };
}

/** Same merge semantics for Mailchimp. */
export function buildMailchimpCredentials(
  existing: Record<string, unknown> | null,
  v: MailchimpConnectionFormValues,
): BuildCredentialsResult {
  const apiKey =
    v.apiKey ??
    (typeof existing?.api_key === "string" && existing.api_key.trim()
      ? existing.api_key.trim()
      : null);
  if (!apiKey) return { ok: false, error: "No API key available — paste one." };
  const serverPrefix =
    v.serverPrefix ??
    (typeof existing?.server_prefix === "string" && existing.server_prefix.trim()
      ? existing.server_prefix.trim()
      : null);
  if (!serverPrefix) {
    return {
      ok: false,
      error: "Could not determine the server prefix — re-paste the key.",
    };
  }
  const blob: Record<string, unknown> = {
    api_key: apiKey,
    server_prefix: serverPrefix,
  };
  if (v.audienceId) blob.audience_id = v.audienceId;
  return { ok: true, blob };
}

/** Non-secret slice of a decrypted blob, safe to render in the admin UI. */
export interface CrmConnectionConfig {
  apiKeyConfigured: boolean;
  workspaceId: string | null;
  channelId: string | null;
  templateProjectId: string | null;
  templateVersionId: string | null;
  serverPrefix: string | null;
  audienceId: string | null;
}

export function toPublicConfig(
  blob: Record<string, unknown> | null,
): CrmConnectionConfig {
  const str = (k: string): string | null => {
    const v = blob?.[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  return {
    apiKeyConfigured: Boolean(str("api_key")),
    workspaceId: str("workspace_id"),
    channelId: str("channel_id"),
    templateProjectId: str("template_project_id"),
    templateVersionId: str("template_version_id"),
    serverPrefix: str("server_prefix"),
    audienceId: str("audience_id"),
  };
}
