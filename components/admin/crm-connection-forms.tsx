"use client";

import { useActionState } from "react";
import { CheckCircle2, Loader2, PlugZap } from "lucide-react";

import {
  saveBirdConnection,
  saveMailchimpConnection,
  testBirdConnection,
  testMailchimpConnection,
  type CrmFormState,
  type CrmTestState,
} from "@/lib/actions/crm-connections";
import type { CrmConnectionConfig } from "@/lib/admin/crm-schema";

/**
 * components/admin/crm-connection-forms.tsx — Bird + Mailchimp credential
 * forms (OP909 Phase 8). API-key inputs are write-only: never a
 * defaultValue, only a configured/not-configured placeholder.
 */

const FORM_IDLE: CrmFormState = { status: "idle", errors: {} };
const TEST_IDLE: CrmTestState = { status: "idle", detail: null };

function Field({
  label,
  hint,
  error,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">
        {label}
        {optional && (
          <span className="font-normal text-muted-foreground"> (optional)</span>
        )}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

const inputCls =
  "h-10 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm";

function TestPanel({
  action,
  description,
}: {
  action: (prev: CrmTestState, fd: FormData) => Promise<CrmTestState>;
  description: string;
}) {
  const [state, formAction, pending] = useActionState(action, TEST_IDLE);
  return (
    <div className="rounded-md border border-border bg-muted/30 p-4">
      <h3 className="text-sm font-medium">Test connection</h3>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <form action={formAction} className="mt-3">
        <button
          type="submit"
          disabled={pending}
          className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PlugZap className="h-4 w-4" />
          )}
          Test connection
        </button>
      </form>
      {state.status === "ok" && (
        <p className="mt-3 text-sm text-success">{state.detail}</p>
      )}
      {state.status === "error" && (
        <p className="mt-3 text-sm text-destructive">
          Test failed: {state.detail}
        </p>
      )}
    </div>
  );
}

function SaveButton({
  pending,
  saved,
}: {
  pending: boolean;
  saved: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Save
      </button>
      {saved && (
        <span className="flex items-center gap-1.5 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" /> Saved
        </span>
      )}
    </div>
  );
}

export function BirdConnectionForm({ config }: { config: CrmConnectionConfig }) {
  const [state, formAction, pending] = useActionState(
    saveBirdConnection,
    FORM_IDLE,
  );
  const err = state.errors;

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-5">
        {err._form && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err._form}
          </p>
        )}

        <Field
          label="Workspace ID"
          hint="Bird dashboard → Settings → Workspace — a UUID."
          error={err.workspace_id}
        >
          <input
            name="workspace_id"
            type="text"
            defaultValue={config.workspaceId ?? ""}
            placeholder="7f3e9c2a-…"
            className={inputCls}
          />
        </Field>

        <Field
          label="WhatsApp channel ID"
          hint="Channels → your WhatsApp channel — the connector UUID."
          error={err.channel_id}
        >
          <input
            name="channel_id"
            type="text"
            defaultValue={config.channelId ?? ""}
            placeholder="b41d6a58-…"
            className={inputCls}
          />
        </Field>

        <Field
          label="API access key"
          hint="Stored encrypted; never shown again after saving."
          error={err.api_key}
        >
          <input
            name="api_key"
            type="password"
            autoComplete="off"
            placeholder={
              config.apiKeyConfigured
                ? "•••••••• configured — paste to replace"
                : "Paste your Bird workspace access key"
            }
            className={inputCls}
          />
        </Field>

        <Field
          label="Template project ID"
          optional
          hint="The approved WhatsApp template project used for the welcome message."
          error={err.template_project_id}
        >
          <input
            name="template_project_id"
            type="text"
            defaultValue={config.templateProjectId ?? ""}
            placeholder="c92f0d11-…"
            className={inputCls}
          />
        </Field>

        <Field
          label="Template version ID"
          optional
          hint={'A version UUID, or "latest".'}
          error={err.template_version_id}
        >
          <input
            name="template_version_id"
            type="text"
            defaultValue={config.templateVersionId ?? ""}
            placeholder="latest"
            className={inputCls}
          />
        </Field>

        <SaveButton pending={pending} saved={state.status === "saved"} />
      </form>

      <TestPanel
        action={testBirdConnection}
        description="Lists your workspace's channels with the saved key — read-only, nothing is sent to fans."
      />
    </div>
  );
}

export function MailchimpConnectionForm({
  config,
}: {
  config: CrmConnectionConfig;
}) {
  const [state, formAction, pending] = useActionState(
    saveMailchimpConnection,
    FORM_IDLE,
  );
  const err = state.errors;

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-5">
        {err._form && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err._form}
          </p>
        )}

        <Field
          label="API key"
          hint={
            config.serverPrefix
              ? `Stored encrypted (datacenter ${config.serverPrefix}); never shown again after saving.`
              : "Account → Extras → API keys. The server prefix is read from the key's suffix automatically."
          }
          error={err.api_key}
        >
          <input
            name="api_key"
            type="password"
            autoComplete="off"
            placeholder={
              config.apiKeyConfigured
                ? "•••••••• configured — paste to replace"
                : "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-us14"
            }
            className={inputCls}
          />
        </Field>

        <Field
          label="Audience ID"
          optional
          hint="Audience → Settings → Audience name and defaults — where new fan signups are routed."
          error={err.audience_id}
        >
          <input
            name="audience_id"
            type="text"
            defaultValue={config.audienceId ?? ""}
            placeholder="a1b2c3d4e5"
            className={`${inputCls} max-w-xs`}
          />
        </Field>

        <SaveButton pending={pending} saved={state.status === "saved"} />
      </form>

      <TestPanel
        action={testMailchimpConnection}
        description="Pings the Mailchimp API with the saved key — read-only, no emails are sent."
      />
    </div>
  );
}
