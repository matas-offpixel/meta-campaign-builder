"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { shareEventFolder, stopSharingEventFolder } from "@/lib/actions/drive-share";
import {
  UPLOAD_A_FILE,
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

export type DrivePreview = {
  folderName: string;
  place: string;
  treePath: string;
  shared: boolean;
  clientName: string;
  contactEmail: string | null;
  rows: View["rows"];
  openUrl: string | null;
};

export function DriveHeaderButton(props: {
  eventId: string;
  eventName: string;
  hasFolder: boolean;
  preview?: DrivePreview | null;
  initialOpen?: boolean;
  initialPhase?: SharePhase;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(props.initialOpen));
  const [view, setView] = useState<View | null>(props.preview ? previewView(props.eventName, props.preview) : null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SharePhase>(props.initialPhase ?? "idle");

  const load = useCallback(async () => {
    if (props.preview) return;
    const res = await fetch(`/api/events/${props.eventId}/drive`);
    const json = (await res.json()) as View;
    if (!res.ok || json.ok === false) {
      setError(json.error ?? null);
      return;
    }
    setView(json);
  }, [props.eventId, props.preview]);

  useEffect(() => {
    if (!props.hasFolder || props.preview) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, props.hasFolder, props.preview]);

  const client = view?.clientName || props.preview?.clientName || "";
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event: MouseEvent) {
      const root = rootRef.current;
      if (!root || root.contains(event.target as Node)) return;
      if (window.matchMedia("(max-width: 700px)").matches) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  async function onAsk() {
    if (view?.shared || !client || phase === "asking") return;
    setPhase(nextSharePhase(phase, "share").phase);
  }

  async function onConfirm() {
    const next = nextSharePhase("asking", "share");
    setPhase(next.phase);
    if (next.call !== "share" || props.preview) return;
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
    if (next.call !== "stop" || props.preview) return;
    const result = await stopSharingEventFolder({ eventId: props.eventId });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await load();
    router.refresh();
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 whitespace-nowrap"
        onClick={() => {
          if (!props.hasFolder) {
            document.getElementById("event-drive")?.scrollIntoView({ block: "start" });
            return;
          }
          setOpen((value) => !value);
        }}
      >
        {driveHeaderLabel(props.hasFolder)}
      </Button>
      {open && view ? (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-30 hidden bg-black/30 max-[700px]:block" onClick={() => setOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label={view.folderName || props.eventName} className="absolute right-0 top-full z-40 mt-1 w-[340px] max-[700px]:fixed max-[700px]:inset-x-0 max-[700px]:bottom-0 max-[700px]:top-auto max-[700px]:z-40 max-[700px]:mt-0 max-[700px]:w-auto">
            <DrivePanel
              folderName={view.folderName || props.eventName}
              place={view.place}
              rows={view.rows}
              openUrl={view.openUrl}
              stateLine={shareStateLine(client, view.shared)}
              shared={view.shared}
              asking={phase === "asking" ? shareConfirm(client) : null}
              onShare={() => void onAsk()}
              onConfirm={() => void onConfirm()}
              onCancel={() => setPhase(nextSharePhase(phase, "dismiss").phase)}
              onStop={() => void onStop()}
              error={error}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function previewView(eventName: string, preview: DrivePreview): View {
  return {
    ok: true,
    folderId: "frame",
    place: preview.place,
    treePath: preview.treePath,
    shared: preview.shared,
    contactEmail: preview.contactEmail,
    clientName: preview.clientName,
    misses: [],
    rows: preview.rows,
    openUrl: preview.openUrl,
    today: "2026-11-17",
    status: "on_sale",
    eventDate: "2026-12-27",
    folderName: preview.folderName || eventName,
  };
}

export function DriveLive(props: {
  eventId: string;
  eventName: string;
  hasFolder: boolean;
  artists: { id: string; name: string }[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <div id="event-drive" className="space-y-3">
      {view?.misses.map((sentence) => (
        <p key={sentence} className="text-sm">{sentence}</p>
      ))}
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
        <>
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
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
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            {UPLOAD_A_FILE}
          </Button>
        </>
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
      {error && props.hasFolder ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function driveLinkLabel(hasFolder: boolean): string {
  return driveHeaderLabel(hasFolder);
}
