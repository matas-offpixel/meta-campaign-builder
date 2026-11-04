"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClientReportCard } from "@/lib/client-reports/access";

interface Props {
  clientId: string;
  initialReports: ClientReportCard[];
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function londonLabel(iso: string | null): string {
  if (!iso) return "No expiry";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "No expiry";
  return date.toLocaleString("en-GB", { timeZone: "Europe/London" });
}

export function ClientReportsCard({ clientId, initialReports }: Props) {
  const router = useRouter();
  const [reports, setReports] = useState(initialReports);
  const [title, setTitle] = useState("");
  const [season, setSeason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setReports(initialReports);
  }, [initialReports]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const replaceReport = (next: ClientReportCard) => {
    setReports((current) => {
      const without = current.filter((report) => report.id !== next.id);
      return [next, ...without].sort((a, b) =>
        a.created_at < b.created_at ? 1 : -1,
      );
    });
  };

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError("Choose an .html file.");
      return;
    }
    setWorking("create");
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("season", season);
      body.set("title", title);
      const res = await fetch(`/api/clients/${clientId}/reports`, {
        method: "POST",
        body,
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        report?: ClientReportCard;
      } | null;
      if (!res.ok || !json?.ok || !json.report) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      replaceReport(json.report);
      setTitle("");
      setSeason("");
      setFile(null);
      setFormKey((current) => current + 1);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setWorking(null);
    }
  };

  const patch = async (
    reportId: string,
    payload: { enabled?: boolean; expires_at?: string | null; regenerate?: boolean },
  ) => {
    setWorking(reportId);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        report?: ClientReportCard;
      } | null;
      if (!res.ok || !json?.ok || !json.report) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      replaceReport(json.report);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setWorking(null);
    }
  };

  const onReplace = async (reportId: string, nextFile: File) => {
    setWorking(reportId);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", nextFile);
      const res = await fetch(`/api/clients/${clientId}/reports/${reportId}`, {
        method: "POST",
        body,
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        report?: ClientReportCard;
      } | null;
      if (!res.ok || !json?.ok || !json.report) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      replaceReport(json.report);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replace failed");
    } finally {
      setWorking(null);
    }
  };

  const onCopy = async (report: ClientReportCard) => {
    const url = `${origin}/share/season/${report.share_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(report.id);
      setTimeout(() => setCopied((current) => (current === report.id ? null : current)), 2000);
    } catch {
      setError("Couldn't copy to clipboard");
    }
  };

  return (
    <section className="rounded-md border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-heading text-base tracking-wide">Reports</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Upload a self-contained HTML season report. The link is a separate
        token from the ticket-input portal, and it can be turned off or
        expired. Files must be 4.5 MB or smaller.
      </p>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 p-2 text-xs text-destructive"
        >
          {error}
        </div>
      ) : null}

      <form key={formKey} onSubmit={onCreate} className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Title</span>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={120}
            placeholder="Ironworks Season 1"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Season</span>
          <Input
            value={season}
            onChange={(event) => setSeason(event.target.value)}
            required
            maxLength={64}
            placeholder="Season 1"
          />
        </label>
        <label className="space-y-1 text-xs sm:col-span-2">
          <span className="text-muted-foreground">HTML file</span>
          <Input
            type="file"
            accept=".html,text/html"
            required
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <div>
          <Button type="submit" size="sm" disabled={working !== null}>
            {working === "create" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Uploading…
              </>
            ) : (
              "Upload report"
            )}
          </Button>
        </div>
      </form>

      {reports.length > 0 ? (
        <ul className="space-y-3">
          {reports.map((report) => {
            const url = `${origin}/share/season/${report.share_token}`;
            const busy = working === report.id;
            return (
              <li
                key={report.id}
                className="space-y-2 rounded-md border border-border p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{report.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {report.season}
                      {" · "}
                      {report.enabled ? "Enabled" : "Disabled"}
                      {" · "}
                      {londonLabel(report.expires_at)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onCopy(report)}
                    disabled={!origin}
                  >
                    {copied === report.id ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy link
                      </>
                    )}
                  </Button>
                </div>
                <Input readOnly value={url} className="font-mono text-xs" aria-label={`${report.title} link`} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || working !== null}
                    onClick={() => patch(report.id, { enabled: !report.enabled })}
                  >
                    {report.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || working !== null}
                    onClick={() => {
                      if (window.confirm("Replace the link? The current URL will stop working.")) {
                        void patch(report.id, { regenerate: true });
                      }
                    }}
                  >
                    Regenerate token
                  </Button>
                  <label className="text-xs text-muted-foreground">
                    Replace file
                    <input
                      type="file"
                      accept=".html,text/html"
                      className="ml-2 text-xs"
                      disabled={working !== null}
                      onChange={(event) => {
                        const next = event.target.files?.[0];
                        event.target.value = "";
                        if (next) void onReplace(report.id, next);
                      }}
                    />
                  </label>
                </div>
                <form
                  key={report.expires_at ?? "none"}
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    const value = String(data.get("expiry") ?? "");
                    void patch(report.id, { expires_at: value === "" ? null : value });
                  }}
                >
                  <label className="space-y-1 text-xs">
                    <span className="text-muted-foreground">Expiry</span>
                    <Input
                      type="datetime-local"
                      name="expiry"
                      defaultValue={toLocalInput(report.expires_at)}
                      className="w-auto"
                    />
                  </label>
                  <Button type="submit" variant="outline" size="sm" disabled={working !== null}>
                    Save expiry
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={working !== null || !report.expires_at}
                    onClick={() => patch(report.id, { expires_at: null })}
                  >
                    Clear expiry
                  </Button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No reports yet.</p>
      )}
    </section>
  );
}
