"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ExternalLink, Mail, MessageCircle, Radio, Zap } from "lucide-react";

import { armAutoresponder, disarmAutoresponder } from "@/lib/actions/d2c-sends";
import {
  buildCustomerJourneyChecklist,
  readAutorespConfig,
} from "@/lib/d2c/autoresp/helpers";
import type { AutorespFireSummary } from "@/lib/db/d2c-autoresp";

/**
 * components/dashboard/d2c/autoresp-panel.tsx
 *
 * Autoresponder card body for an `autoresp_setup` send (Goal 6). Renders on both
 * the operator page and the public share (read-only). Shows:
 *   - armed/inactive badge (teal / grey) with the armed-since date,
 *   - a fire-stats row (X email · Y WhatsApp · Z dry-run),
 *   - a collapsible recent-fires timeline (last 20),
 *   - operator-only Arm / Disarm actions.
 *
 * 2026-07-09 pivot (PR #704): the EMAIL autoresp is delivered by a Mailchimp
 * Customer Journey (`tag-added` trigger), NOT by our per-fire sends. So for the
 * email channel, arming just gates an operator checklist ("confirm the Journey
 * exists") — no backfill button, and the fire-stats reflect audit history only
 * (they no longer grow). The WhatsApp channel is unchanged: Bird poll cron
 * still fires per new contact, and the "fire for existing tagged members"
 * backfill still applies.
 */

function fmt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso ?? "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export interface AutorespPanelProps {
  sendId: string;
  eventId: string;
  /** The send's result_jsonb — config is read from it (pure, client-safe). */
  resultJsonb: unknown;
  fires: AutorespFireSummary | null;
  readOnly: boolean;
  canApprove: boolean;
  /** Send channel — email uses the Customer Journey model, whatsapp the Bird poll. */
  channel?: "email" | "whatsapp";
  /** Signup tag (the Journey's tag-added trigger) — used in the email checklist. */
  signupTag?: string | null;
  /** Mailchimp DC prefix (e.g. "us7") for the Customer Journeys deep link. */
  serverPrefix?: string | null;
}

export function AutorespPanel({
  sendId,
  eventId,
  resultJsonb,
  fires,
  readOnly,
  canApprove,
  channel = "email",
  signupTag = null,
  serverPrefix = null,
}: AutorespPanelProps) {
  const config = readAutorespConfig(resultJsonb);
  const armed = config?.enabled === true;
  const summary = fires ?? { email: 0, whatsapp: 0, dryRun: 0, total: 0, recent: [] };
  const isEmail = channel === "email";

  return (
    <div className="mb-3 rounded-lg border border-teal-200 bg-teal-50/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white" style={{ backgroundColor: armed ? "#0d9488" : "#9ca3af" }}>
          <Radio size={11} aria-hidden />
          Autoresponder
        </span>
        <span className="rounded bg-white/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-teal-700">
          {isEmail ? "Email · Customer Journey" : "WhatsApp · Bird"}
        </span>
        {armed ? (
          <span className="text-xs font-medium text-teal-800">
            Armed{config?.armed_at ? ` since ${fmt(config.armed_at)}` : ""}
          </span>
        ) : (
          <span className="text-xs font-medium text-neutral-500">Inactive</span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="text-foreground">
          Fires: {summary.email} email · {summary.whatsapp} WhatsApp · {summary.dryRun} dry-run
        </span>
        {isEmail && (
          <span className="text-[11px] text-muted-foreground">
            (email fires are historical — the Customer Journey sends new ones now)
          </span>
        )}
      </div>

      {isEmail && armed && (
        <CustomerJourneyChecklist signupTag={signupTag} serverPrefix={serverPrefix} />
      )}

      {summary.recent.length > 0 && (
        <RecentFires recent={summary.recent} readOnly={readOnly} />
      )}

      {!readOnly && canApprove && (
        <AutorespControls
          sendId={sendId}
          eventId={eventId}
          armed={armed}
          isEmail={isEmail}
        />
      )}
    </div>
  );
}

/**
 * Operator checklist shown when an EMAIL autoresp is armed. Our system no
 * longer sends the email — a Mailchimp Customer Journey does — so this confirms
 * the Journey is set up and warns against double-sending.
 */
function CustomerJourneyChecklist({
  signupTag,
  serverPrefix,
}: {
  signupTag: string | null;
  serverPrefix: string | null;
}) {
  const { tag, suggestedJourneyName, journeysUrl } = buildCustomerJourneyChecklist(
    signupTag,
    serverPrefix,
  );
  return (
    <div className="mt-2 rounded-md border border-teal-300/70 bg-white/70 p-2.5 text-xs text-teal-900">
      <p className="font-semibold">Email is sent by a Mailchimp Customer Journey</p>
      <ol className="mt-1.5 list-decimal space-y-1 pl-4">
        <li>
          In Mailchimp → Customer Journeys, confirm a Journey exists named{" "}
          <span className="font-mono font-medium">
            {suggestedJourneyName ?? "T26-{CITY}-AUTO"}
          </span>{" "}
          with a <span className="font-medium">tag-added</span> trigger on{" "}
          {tag ? (
            <span className="font-mono font-medium">{tag}</span>
          ) : (
            <span className="italic">this event&apos;s signup tag</span>
          )}
          .
        </li>
        <li>Confirm the Journey status is <span className="font-medium">Sending / On</span>.</li>
        <li className="font-medium text-amber-800">
          Confirm no double-send: EITHER the Journey sends the email OR our
          system does — never both. (Our per-fire email send is now disabled, so
          the Journey is the single sender.)
        </li>
      </ol>
      <a
        href={journeysUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 font-medium text-teal-700 hover:underline"
      >
        Open Customer Journeys
        <ExternalLink size={11} aria-hidden />
      </a>
      {tag && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Filter/search the Journeys list for <span className="font-mono">{tag}</span>.
        </p>
      )}
    </div>
  );
}

interface FireRow {
  id: string;
  provider: "mailchimp" | "bird";
  member_identifier: string;
  fired_at: string;
  dry_run: boolean;
  error: string | null;
}

/** Mask an email / phone for the public share view (no PII). */
function maskIdentifier(id: string, provider: "mailchimp" | "bird"): string {
  if (!id) return "•••";
  if (provider === "mailchimp") {
    const [local, domain] = id.split("@");
    if (!domain) return "•••";
    const head = local.slice(0, 1);
    return `${head}${"•".repeat(Math.max(2, local.length - 1))}@${domain}`;
  }
  const tail = id.slice(-3);
  return `••••••${tail}`;
}

function RecentFires({ recent, readOnly }: { recent: FireRow[]; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-teal-700 hover:underline"
      >
        {open ? "Hide" : "Show"} recent fires ({recent.length})
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {recent.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {r.provider === "mailchimp" ? (
                <Mail size={11} aria-hidden />
              ) : (
                <MessageCircle size={11} aria-hidden />
              )}
              <span className="tabular-nums">{fmt(r.fired_at)}</span>
              <span className="text-foreground">
                {readOnly ? maskIdentifier(r.member_identifier, r.provider) : r.member_identifier}
              </span>
              {r.dry_run && (
                <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-sky-800">
                  dry-run
                </span>
              )}
              {r.error && <span className="text-red-600">{r.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const BTN =
  "rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-50";

function AutorespControls({
  sendId,
  eventId,
  armed,
  isEmail,
}: {
  sendId: string;
  eventId: string;
  armed: boolean;
  isEmail: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      setMessage(res.ok ? ok : res.error ?? "Action failed.");
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-teal-200/60 pt-3">
      {!armed ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => armAutoresponder(sendId, eventId), "Autoresponder armed.")}
          className={`${BTN} border-teal-400 bg-teal-600 text-white hover:bg-teal-700`}
        >
          <span className="inline-flex items-center gap-1">
            <Zap size={13} aria-hidden />
            Arm autoresponder
          </span>
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => disarmAutoresponder(sendId, eventId), "Autoresponder disarmed.")}
          className={`${BTN} border-amber-300 text-amber-800 hover:bg-amber-50`}
        >
          Disarm
        </button>
      )}
      {armed && !isEmail && <BackfillButton sendId={sendId} />}
      {message && (
        <span className="text-xs text-muted-foreground" role="status">
          {message}
        </span>
      )}
    </div>
  );
}

interface BackfillState {
  status: "pending" | "running" | "done" | "failed";
  processed: number;
  total: number | null;
  fired: number;
  skipped: number;
  error?: string;
}

/**
 * "Fire for existing tagged members" — starts the resumable backfill and polls
 * status every 3s until done/failed. Progress bar reflects processed/total.
 */
function BackfillButton({ sendId }: { sendId: string }) {
  const [state, setState] = useState<BackfillState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/d2c/scheduled-sends/${sendId}/autoresp-backfill/status`);
      const json = await res.json();
      if (json.ok && json.state) {
        setState(json.state as BackfillState);
        if (json.state.status === "done" || json.state.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch {
      /* transient — keep polling */
    }
  }, [sendId]);

  useEffect(() => {
    // Resume polling if a backfill is already running when the card mounts.
    void poll();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [poll]);

  const onStart = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/d2c/scheduled-sends/${sendId}/autoresp-backfill/start`, {
        method: "POST",
      });
      const json = await res.json();
      if (json.ok) {
        setState(json.state as BackfillState);
        if (!pollRef.current) pollRef.current = setInterval(() => void poll(), 3000);
      } else {
        setError(json.error ?? "Could not start backfill");
      }
    } catch {
      setError("Could not start backfill");
    } finally {
      setStarting(false);
    }
  };

  const running = state?.status === "pending" || state?.status === "running";
  const pct =
    state && state.total && state.total > 0
      ? Math.min(100, Math.round((state.processed / state.total) * 100))
      : running
        ? 5
        : 0;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onStart}
        disabled={starting || running}
        className={BTN}
        title="Fire the autoresponder for everyone already tagged / in the list"
      >
        {running ? "Backfilling…" : "Fire for existing tagged members"}
      </button>
      {state && (
        <div className="min-w-[180px]">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full bg-teal-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {state.status} · {state.processed}
            {state.total != null ? `/${state.total}` : ""} processed · {state.fired} fired
            {state.error ? ` · ${state.error}` : ""}
          </p>
        </div>
      )}
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}
