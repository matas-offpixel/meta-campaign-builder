"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FolderPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  eventId: string;
  eventName: string;
  clientName: string | null;
  /** Stored on events.google_drive_folder_id (migration 015). */
  folderId: string | null;
  /** Stored on events.google_drive_folder_url (migration 015). */
  folderUrl: string | null;
}

/**
 * Per-event Google Drive folder card.
 *
 * Two states:
 *   - folderUrl present → show "Open Drive folder" linking out
 *   - no folder yet     → show "Create Drive folder" which POSTs to the
 *                         scaffold API. The API currently returns
 *                         `{ ok: false, error: 'Google Drive not
 *                         configured' }` until the integration lands —
 *                         we surface that as an inline status line.
 *
 * Toast UX: the codebase doesn't have a toast primitive yet, so we
 * surface success/error inline beneath the buttons. Easy to swap for a
 * toast hook later without changing the API contract.
 */
export function GoogleDriveCard({
  eventId,
  eventName,
  clientName,
  folderId,
  folderUrl,
}: Props) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<"success" | "error" | null>(
    null,
  );

  const handleCreate = async () => {
    setWorking(true);
    setStatusMessage(null);
    setStatusKind(null);
    try {
      const res = await fetch(
        "/api/integrations/google-drive/create-folder",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            eventId,
            eventName,
            clientName: clientName ?? "",
          }),
        },
      );
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        folderUrl?: string;
      } | null;

      if (!json || !res.ok || json.ok === false) {
        setStatusKind("error");
        setStatusMessage(
          json?.error ?? "Drive not connected yet. Try again later.",
        );
        return;
      }

      setStatusKind("success");
      setStatusMessage("Drive folder created.");
      router.refresh();
    } catch {
      setStatusKind("error");
      setStatusMessage("Network error — couldn't reach the integration.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-heading text-base tracking-wide">
            Google Drive
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Working folder for briefs, creative assets and exports tied
            to this event.
          </p>
        </div>
      </div>

      {folderUrl ? (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={folderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-border-strong"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Drive folder
          </a>
          {folderId && (
            <span className="text-[11px] text-muted-foreground">
              ID: <code className="font-mono">{folderId}</code>
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleCreate}
            disabled={working}
            size="sm"
            variant="outline"
          >
            {working ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderPlus className="h-3.5 w-3.5" />
            )}
            Create Drive folder
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Provisions a folder under the client&rsquo;s shared drive once
            the integration is connected.
          </span>
        </div>
      )}

      {statusMessage && (
        <p
          className={`mt-3 text-xs ${
            statusKind === "success"
              ? "text-foreground"
              : "text-destructive"
          }`}
        >
          {statusMessage}
        </p>
      )}
    </section>
  );
}
