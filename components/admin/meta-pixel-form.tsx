"use client";

import { useActionState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";

import {
  saveMetaPixelConfig,
  sendTestPixelEvent,
  type PixelConfigState,
  type TestEventState,
} from "@/lib/actions/meta-pixel";

/**
 * components/admin/meta-pixel-form.tsx — Pixel ID / CAPI token / test
 * event code form + the "Send test event" button (OP909 Phase 7). The
 * token input is write-only: it never receives a defaultValue and the
 * page only ever passes a configured/not-configured boolean.
 */

const CONFIG_IDLE: PixelConfigState = { status: "idle", errors: {} };
const TEST_IDLE: TestEventState = { status: "idle", fbtraceId: null, error: null };

export function MetaPixelForm({
  pixelId,
  tokenConfigured,
  testEventCode,
}: {
  pixelId: string | null;
  tokenConfigured: boolean;
  testEventCode: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    saveMetaPixelConfig,
    CONFIG_IDLE,
  );
  const [testState, testAction, testPending] = useActionState(
    sendTestPixelEvent,
    TEST_IDLE,
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

        <div>
          <label
            htmlFor="pixel_id"
            className="mb-1 block text-sm font-medium"
          >
            Pixel ID
          </label>
          <input
            id="pixel_id"
            name="pixel_id"
            type="text"
            inputMode="numeric"
            defaultValue={pixelId ?? ""}
            placeholder="1475359374117271"
            className="h-10 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm tabular-nums"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            The 15–16 digit dataset ID from Meta Events Manager. Leave blank
            to disconnect.
          </p>
          {err.pixel_id && (
            <p className="mt-1 text-xs text-destructive">{err.pixel_id}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="capi_token"
            className="mb-1 block text-sm font-medium"
          >
            Conversions API access token
          </label>
          <input
            id="capi_token"
            name="capi_token"
            type="password"
            autoComplete="off"
            placeholder={
              tokenConfigured
                ? "•••••••• configured — paste to replace"
                : "Paste the token from Events Manager → Settings"
            }
            className="h-10 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Stored encrypted; never shown again after saving.
          </p>
          {tokenConfigured && (
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="clear_token" className="h-3.5 w-3.5" />
              Remove the stored token
            </label>
          )}
          {err.capi_token && (
            <p className="mt-1 text-xs text-destructive">{err.capi_token}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="test_event_code"
            className="mb-1 block text-sm font-medium"
          >
            Test event code{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="test_event_code"
            name="test_event_code"
            type="text"
            defaultValue={testEventCode ?? ""}
            placeholder="TEST12345"
            className="h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm uppercase"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            While set, events go to the Test events tab instead of the live
            pipeline. Clear it to go live.
          </p>
          {err.test_event_code && (
            <p className="mt-1 text-xs text-destructive">
              {err.test_event_code}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
          {state.status === "saved" && (
            <span className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> Saved
            </span>
          )}
        </div>
      </form>

      {/* ── Test event (separate form — must not submit the config) ──── */}
      <div className="rounded-md border border-border bg-muted/30 p-4">
        <h3 className="text-sm font-medium">Send a test event</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Fires a CompleteRegistration through the Conversions API using
          your saved credentials — check Events Manager for it (event ID
          starts with <code>test-</code>).
        </p>
        <form action={testAction} className="mt-3">
          <button
            type="submit"
            disabled={testPending}
            className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"
          >
            {testPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send test event
          </button>
        </form>
        {testState.status === "ok" && (
          <p className="mt-3 text-sm text-success">
            Event accepted by Meta
            {testState.fbtraceId ? (
              <span className="text-muted-foreground">
                {" "}
                (fbtrace {testState.fbtraceId})
              </span>
            ) : null}
            . Pixel marked verified.
          </p>
        )}
        {testState.status === "error" && (
          <p className="mt-3 text-sm text-destructive">
            Test failed: {testState.error}
            {testState.fbtraceId ? ` (fbtrace ${testState.fbtraceId})` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
