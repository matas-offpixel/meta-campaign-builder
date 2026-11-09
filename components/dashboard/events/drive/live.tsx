"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { shareEventFolder, stopSharingEventFolder } from "@/lib/actions/drive-share";
import {
  driveHeaderLabel,
  formatFileSize,
  nextSharePhase,
  preselectFolder,
  shareConfirm,
  shareStateLine,
  usualFolders,
  type FolderChoice,
  type SharePhase,
} from "@/lib/drive/panel";

import { DrivePanel, DriveSetup, WhichFolder } from "./ui";

type View = {
  ok: boolean;
  error?: string;
  folderId: string | null;
  place: string;
  treePath: string;
  shared: boolean;
  contactEmail: string | null;
  clientName: string;
  misses: string[];
  rows: { key: string; name: string; folderId: string | null; now: string | null; trailing: string }[];
  openUrl: string | null;
  today: string;
  status: string | null;
  eventDate: string | null;
  folderName: string;
};

export function DriveLive(props: {
  eventId: string;
  eventName: string;
  hasFolder: boolean;
  open: boolean;
  artists: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SharePhase>("idle");
  const [link, setLink] = useState("");
  const [resolved, setResolved] = useState<{ id: string; name: string; fileCount: number; place: string } | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [choice, setChoice] = useState<FolderChoice | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/events/${props.eventId}/drive`);
    const json = (await res.json()) as View;
    if (!res.ok || json.ok === false) {
      setError(json.error ?? null);
      return;
    }
    setView(json);
  }, [props.eventId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${props.eventId}/drive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; id?: string; name?: string; fileCount?: number; place?: string };
      if (!res.ok || json.ok === false) {
        setError(json.error ?? null);
        return json;
      }
      return json;
    } finally {
      setBusy(false);
    }
  }

  const client = view?.clientName || "";

  async function onShare() {
    if (view?.shared || !client) return;
    const next = nextSharePhase(phase, "share");
    setPhase(next.phase);
    if (next.call !== "share") return;
    const result = await shareEventFolder({ eventId: props.eventId, email: view?.contactEmail ?? "" });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await load();
    router.refresh();
  }

  async function onStop() {
    const next = nextSharePhase(phase, "stop");
    setPhase(next.phase);
    if (next.call !== "stop") return;
    const result = await stopSharingEventFolder({ eventId: props.eventId });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await load();
    router.refresh();
  }

  const folderName = view?.folderName || props.eventName;

  return (
    <div id="event-drive" className="space-y-3">
      {view?.misses.map((sentence) => (
        <p key={sentence} className="text-sm">{sentence}</p>
      ))}
      {props.hasFolder && props.open && view ? (
        <DrivePanel
          folderName={folderName}
          place={view.place}
          rows={view.rows}
          openUrl={view.openUrl}
          stateLine={shareStateLine(client, view.shared)}
          asking={phase === "asking" ? shareConfirm(client) : null}
          onShare={() => void onShare()}
          onStop={() => void onStop()}
          error={error}
        />
      ) : null}
      {!props.hasFolder ? (
        <DriveSetup
          treePath={view?.treePath ?? ""}
          resolved={resolved}
          error={resolveError ?? error}
          link={link}
          busy={busy}
          onLinkChange={(value) => {
            setLink(value);
            setResolved(null);
            setResolveError(null);
          }}
          onResolve={() => {
            if (!link.trim()) return;
            void post({ action: "resolve", link }).then((json) => {
              if (!json) return;
              if (json.ok === false || !json.name) {
                setResolved(null);
                setResolveError(json.error ?? null);
                return;
              }
              setResolved({ id: json.id ?? "", name: json.name, fileCount: json.fileCount ?? 0, place: json.place ?? "" });
              setResolveError(null);
            });
          }}
          onLink={() => {
            if (!resolved) return;
            void post({ action: "link", folderId: resolved.id }).then((json) => {
              if (json?.ok) router.refresh();
            });
          }}
          onCreate={() => {
            void post({ action: "create" }).then((json) => {
              if (json?.ok) router.refresh();
            });
          }}
        />
      ) : null}
      {props.hasFolder ? (
        <input
          type="file"
          aria-label="Which folder?"
          onChange={(event) => {
            const picked = event.target.files?.[0];
            event.target.value = "";
            if (!picked || !view) return;
            const next = preselectFolder(
              { name: picked.name, artistId: props.artists.length === 1 ? props.artists[0]?.id : null },
              { artists: props.artists, status: view.status, eventDate: view.eventDate, today: view.today },
            );
            setFile(picked);
            setChoice(next);
          }}
        />
      ) : null}
      {file && choice && view ? (
        <WhichFolder
          fileLabel={`${file.name} · ${formatFileSize(file.size)}`}
          choices={usualFolders({ artists: props.artists, status: view.status, eventDate: view.eventDate, today: view.today }, choice)}
          selectedKey={choice.key}
          artists={props.artists}
          busy={busy}
          onSelect={setChoice}
          onCancel={() => { setFile(null); setChoice(null); }}
          onUpload={() => {
            const body = new FormData();
            body.set("file", file);
            body.set("key", choice.key);
            if (choice.artistName) body.set("artistName", choice.artistName);
            setBusy(true);
            void fetch(`/api/events/${props.eventId}/drive/upload`, { method: "POST", body })
              .then(async (res) => {
                const json = (await res.json()) as { ok?: boolean; error?: string };
                if (!res.ok || json.ok === false) setError(json.error ?? null);
                else {
                  setFile(null);
                  setChoice(null);
                  router.refresh();
                }
              })
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
    </div>
  );
}

export function driveLinkLabel(hasFolder: boolean): string {
  return driveHeaderLabel(hasFolder);
}
