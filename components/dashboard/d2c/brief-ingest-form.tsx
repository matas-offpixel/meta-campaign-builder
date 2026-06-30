"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { D2CBriefIngestJob } from "@/lib/d2c/types";

/**
 * components/dashboard/d2c/brief-ingest-form.tsx
 *
 * Uploads a PDF brief (or pasted text) to /api/d2c/ingest-brief, then polls the
 * job status. On success it redirects to the event orchestration page.
 */

export interface BriefIngestFormProps {
  clients: { id: string; name: string }[];
}

type Phase = "idle" | "submitting" | "processing" | "done" | "error";

const POLL_MS = 2000;

export function BriefIngestForm({ clients }: BriefIngestFormProps) {
  const router = useRouter();
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [mode, setMode] = useState<"pdf" | "manual">("pdf");
  const [file, setFile] = useState<File | null>(null);
  const [briefText, setBriefText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  async function pollJob(id: string) {
    try {
      const res = await fetch(`/api/d2c/ingest-brief/${id}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setPhase("error");
        setError(json.error ?? "Failed to read job status.");
        return;
      }
      const job = json.job as D2CBriefIngestJob;
      if (job.status === "succeeded" && job.result_event_id) {
        setPhase("done");
        router.push(`/d2c/event/${job.result_event_id}`);
        return;
      }
      if (job.status === "failed") {
        setPhase("error");
        setError(job.error ?? "Brief processing failed.");
        return;
      }
      pollRef.current = setTimeout(() => pollJob(id), POLL_MS);
    } catch {
      pollRef.current = setTimeout(() => pollJob(id), POLL_MS);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!clientId) {
      setError("Pick a client.");
      return;
    }
    if (mode === "pdf" && !file) {
      setError("Choose a PDF brief.");
      return;
    }
    if (mode === "manual" && !briefText.trim()) {
      setError("Paste the brief text.");
      return;
    }

    setPhase("submitting");
    try {
      let res: Response;
      if (mode === "pdf" && file) {
        const form = new FormData();
        form.set("client_id", clientId);
        form.set("file", file);
        res = await fetch("/api/d2c/ingest-brief", { method: "POST", body: form });
      } else {
        res = await fetch("/api/d2c/ingest-brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, brief_text: briefText }),
        });
      }
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setPhase("error");
        setError(json.error ?? "Failed to start ingest.");
        return;
      }
      const job = json.job as D2CBriefIngestJob;
      setJobId(job.id);
      setPhase("processing");
      pollJob(job.id);
    } catch {
      setPhase("error");
      setError("Network error starting ingest.");
    }
  }

  const busy = phase === "submitting" || phase === "processing";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="client" className="block text-sm font-medium text-foreground">
          Client
        </label>
        <select
          id="client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {clients.length === 0 && <option value="">No clients</option>}
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="mode"
            checked={mode === "pdf"}
            onChange={() => setMode("pdf")}
          />
          PDF upload
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="mode"
            checked={mode === "manual"}
            onChange={() => setMode("manual")}
          />
          Paste text
        </label>
      </div>

      {mode === "pdf" ? (
        <div>
          <label htmlFor="file" className="block text-sm font-medium text-foreground">
            Brief PDF
          </label>
          <input
            id="file"
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 w-full text-sm"
          />
        </div>
      ) : (
        <div>
          <label htmlFor="brief-text" className="block text-sm font-medium text-foreground">
            Brief text
          </label>
          <textarea
            id="brief-text"
            value={briefText}
            onChange={(e) => setBriefText(e.target.value)}
            rows={10}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Paste the event brief here…"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
      >
        {phase === "submitting"
          ? "Uploading…"
          : phase === "processing"
            ? "Parsing brief…"
            : "Ingest brief"}
      </button>

      {phase === "processing" && (
        <p className="text-xs text-muted-foreground" role="status">
          Parsing the brief and building the campaign{jobId ? ` (job ${jobId.slice(0, 8)})` : ""}…
          this can take up to a minute.
        </p>
      )}
      {error && (
        <p className="text-xs text-rose-600" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
