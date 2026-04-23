"use client";

import { useMemo, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type {
  D2CConnection,
  D2CScheduledSend,
  D2CScheduledSendApprovalStatus,
  D2CScheduledSendStatus,
  D2CTemplate,
} from "@/lib/d2c/types";

/**
 * Per-event comms planner — scheduled sends require operator approval before
 * the cron runner can perform live Mailchimp delivery.
 */

interface SafeConnection extends Omit<D2CConnection, "credentials"> {
  credentials: null;
}

interface Props {
  eventId: string;
  clientId: string;
  connections: SafeConnection[];
  templates: D2CTemplate[];
  initialSends: D2CScheduledSend[];
  canApproveD2C: boolean;
}

const STATUS_LABELS: Record<D2CScheduledSendStatus, string> = {
  scheduled: "Scheduled",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
};

const APPROVAL_LABELS: Record<D2CScheduledSendApprovalStatus, string> = {
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
};

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function EventCommsPanel({
  eventId,
  connections,
  templates,
  initialSends,
  canApproveD2C,
}: Props) {
  const [sends, setSends] = useState<D2CScheduledSend[]>(initialSends);
  const [templateId, setTemplateId] = useState<string>(
    templates[0]?.id ?? "",
  );
  const [connectionId, setConnectionId] = useState<string>(
    connections[0]?.id ?? "",
  );
  const [scheduledFor, setScheduledFor] = useState<string>(() =>
    new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16),
  );
  const [listId, setListId] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [fromName, setFromName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );
  const compatibleConnections = useMemo(() => {
    if (!selectedTemplate) return [] as SafeConnection[];
    if (selectedTemplate.channel === "email") {
      return connections.filter((c) =>
        ["mailchimp", "klaviyo"].includes(c.provider),
      );
    }
    if (selectedTemplate.channel === "sms") {
      return connections.filter((c) =>
        ["bird", "firetext"].includes(c.provider),
      );
    }
    return connections.filter((c) => c.provider === "bird");
  }, [selectedTemplate, connections]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMessage(null);
    if (!templateId) {
      setError("Pick a template.");
      return;
    }
    if (!connectionId) {
      setError("Pick a connection.");
      return;
    }
    if (!scheduledFor) {
      setError("Set a schedule.");
      return;
    }
    const conn = connections.find((c) => c.id === connectionId);
    if (conn?.provider === "mailchimp") {
      if (!listId.trim() || !replyTo.trim()) {
        setError("Mailchimp sends need audience list id and reply-to email.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const audience: Record<string, unknown> = {};
      if (conn?.provider === "mailchimp") {
        audience.list_id = listId.trim();
        audience.reply_to = replyTo.trim();
        if (fromName.trim()) audience.from_name = fromName.trim();
      }
      const res = await fetch("/api/d2c/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          templateId,
          connectionId,
          scheduledFor: new Date(scheduledFor).toISOString(),
          audience,
          variables: {},
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        send?: D2CScheduledSend;
        dryRun?: boolean;
      };
      if (!res.ok || !json.ok || !json.send) {
        setError(json.error ?? "Failed to schedule the send.");
        return;
      }
      setSends((prev) => [...prev, json.send!].sort((a, b) =>
        a.scheduled_for.localeCompare(b.scheduled_for),
      ));
      setOkMessage(
        "Presale reminder scheduled — pending operator approval before send.",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove(id: string) {
    setError(null);
    setApprovingId(id);
    try {
      const res = await fetch(`/api/d2c/scheduled/${id}/approve`, {
        method: "PATCH",
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        send?: D2CScheduledSend;
      };
      if (!res.ok || !json.ok || !json.send) {
        setError(json.error ?? "Approval failed.");
        return;
      }
      setSends((prev) =>
        prev.map((s) => (s.id === json.send!.id ? json.send! : s)),
      );
      setOkMessage("Send approved for cron delivery.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed.");
    } finally {
      setApprovingId(null);
    }
  }

  async function handleCancel(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/d2c/scheduled/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        send?: D2CScheduledSend;
      };
      if (!res.ok || !json.send) {
        setError(json.error ?? "Failed to cancel.");
        return;
      }
      setSends((prev) =>
        prev.map((s) => (s.id === json.send!.id ? json.send! : s)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  const noTemplates = templates.length === 0;
  const noConnections = connections.length === 0;
  const selectedConn = connections.find((c) => c.id === connectionId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>D2C comms</CardTitle>
        <CardDescription>
          Schedule a presale reminder email; an operator must approve before
          the cron job sends via Mailchimp. Live delivery requires{" "}
          <code className="rounded bg-muted px-1">FEATURE_D2C_LIVE</code>, per-
          connection live flags, and Matas approval on the connection.
        </CardDescription>
      </CardHeader>

      <div className="space-y-6">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Scheduled
          </h4>
          {sends.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing scheduled yet.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {sends.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                      <span className="capitalize">{s.channel}</span>
                      <StatusPill status={s.status} />
                      <ApprovalPill status={s.approval_status} />
                      {s.dry_run ? <DryRunBadge /> : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatTimestamp(s.scheduled_for)} · template{" "}
                      <code className="rounded bg-muted px-1">
                        {s.template_id.slice(0, 8)}
                      </code>{" "}
                      · connection{" "}
                      <code className="rounded bg-muted px-1">
                        {s.connection_id.slice(0, 8)}
                      </code>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {s.status === "scheduled" &&
                    s.approval_status === "pending_approval" &&
                    canApproveD2C ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleApprove(s.id)}
                        disabled={approvingId === s.id}
                      >
                        {approvingId === s.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Approve & schedule"
                        )}
                      </Button>
                    ) : null}
                    {s.status === "scheduled" ? (
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => void handleCancel(s.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {noTemplates || noConnections ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {noTemplates
              ? "No templates yet — create one on the client D2C tab before scheduling."
              : "No D2C connections on this client — add one in client settings before scheduling."}
          </p>
        ) : (
          <form className="space-y-3" onSubmit={handleSubmit}>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Schedule presale reminder
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-muted-foreground">Template</span>
                <Select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  options={templates.map((t) => ({
                    value: t.id,
                    label: `${t.name} (${t.channel})`,
                  }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-muted-foreground">
                  Provider connection
                </span>
                <Select
                  value={connectionId}
                  onChange={(e) => setConnectionId(e.target.value)}
                  options={compatibleConnections.map((c) => ({
                    value: c.id,
                    label: `${c.provider} · ${c.status}`,
                  }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-muted-foreground">When</span>
                <Input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                />
              </label>
            </div>

            {selectedConn?.provider === "mailchimp" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Mailchimp list id
                  </span>
                  <Input
                    value={listId}
                    onChange={(e) => setListId(e.target.value)}
                    placeholder="abc123"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Reply-to email
                  </span>
                  <Input
                    type="email"
                    value={replyTo}
                    onChange={(e) => setReplyTo(e.target.value)}
                    placeholder="hello@example.com"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-muted-foreground">
                    From name (optional)
                  </span>
                  <Input
                    value={fromName}
                    onChange={(e) => setFromName(e.target.value)}
                    placeholder="Jackies"
                  />
                </label>
              </div>
            ) : null}

            {error ? (
              <p className="inline-flex items-center gap-1 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </p>
            ) : null}
            {okMessage ? (
              <p className="inline-flex items-center gap-1 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                {okMessage}
              </p>
            ) : null}

            <div>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scheduling…
                  </>
                ) : (
                  "Schedule presale reminder"
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

function StatusPill({ status }: { status: D2CScheduledSendStatus }) {
  const tone =
    status === "sent"
      ? "bg-emerald-100 text-emerald-800"
      : status === "failed"
        ? "bg-destructive/10 text-destructive"
        : status === "cancelled"
          ? "bg-muted text-muted-foreground"
          : "bg-amber-100 text-amber-900";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function ApprovalPill({
  status,
}: {
  status: D2CScheduledSendApprovalStatus;
}) {
  const tone =
    status === "approved"
      ? "bg-emerald-50 text-emerald-800"
      : status === "rejected"
        ? "bg-destructive/10 text-destructive"
        : "bg-slate-100 text-slate-800";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {APPROVAL_LABELS[status]}
    </span>
  );
}

function DryRunBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-orange-900">
      Dry run
    </span>
  );
}
