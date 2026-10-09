"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Datum, StatusLine } from "@/components/steps/step-surface";
import { Button } from "@/components/ui/button";
import { sha256HexOfBlob } from "@/lib/creatives/sha256-stream";
import {
  INTAKE_BUCKETS,
  META_CROSS_PUBLISH_NOTE,
  intakeSendResultLine,
  intakeUploadProgress,
  matchRefusal,
  type IntakeBucket,
  type IntakeSendReport,
} from "@/lib/plan/creative-intake";
import type { CampaignPlan } from "@/lib/plan/types";
import {
  CAMPAIGN_ASSETS_BUCKET,
  uploadFileToCampaignAssets,
} from "@/lib/tiktok-wizard/campaign-asset-upload";
import { VIZ_TYPE } from "@/lib/viz/tokens";

interface IntakeAsset {
  id: string;
  filename: string;
  mediaKind: "image" | "video";
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  detectedBucket: IntakeBucket;
  override: IntakeBucket | null;
  bucket: IntakeBucket;
  reason: string | null;
  thumbnailUrl: string | null;
  groupId: string | null;
  uploadError: string | null;
}

interface IntakeGroup {
  id: string;
  assetIds: string[];
  stableKey: string;
}

interface IntakeView {
  ok?: boolean;
  tableMissing?: boolean;
  multiPlacement?: boolean;
  assets?: IntakeAsset[];
  groups?: IntakeGroup[];
  error?: string;
}

const COLUMN_LABEL: Record<IntakeBucket, string> = {
  "4:5": "4:5",
  "1:1": "1:1",
  "9:16": "9:16",
  other: "Other",
};

function formatDuration(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function measureFile(file: File): Promise<{ width: number | null; height: number | null; durationSeconds: number | null }> {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("image/")) {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        resolve({ width: image.naturalWidth || null, height: image.naturalHeight || null, durationSeconds: null });
        URL.revokeObjectURL(url);
      };
      image.onerror = () => {
        resolve({ width: null, height: null, durationSeconds: null });
        URL.revokeObjectURL(url);
      };
      image.src = url;
    });
  }
  if (file.type.startsWith("video/")) {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve({
          width: video.videoWidth || null,
          height: video.videoHeight || null,
          durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
        });
        URL.revokeObjectURL(url);
      };
      video.onloadedmetadata = () => {
        if (video.videoWidth && video.videoHeight) finish();
        else {
          try {
            video.currentTime = 0.01;
          } catch {
            finish();
          }
        }
      };
      video.onseeked = () => finish();
      video.onerror = () => {
        if (settled) return;
        settled = true;
        resolve({ width: null, height: null, durationSeconds: null });
        URL.revokeObjectURL(url);
      };
      video.src = url;
    });
  }
  URL.revokeObjectURL(url);
  return Promise.resolve({ width: null, height: null, durationSeconds: null });
}

/**
 * MML ②. Drop once, sort by pixels, drag to fix, Match into a Meta
 * creative, then Send into the linked Meta and TikTok drafts.
 */
export function MmlCreativeIntake({
  planId,
  clientId,
  persisted,
  onLaunches,
}: {
  planId: string;
  clientId: string | null;
  persisted: boolean;
  onLaunches: (launches: CampaignPlan["launches"]) => void;
}) {
  const [view, setView] = useState<IntakeView | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [sendResults, setSendResults] = useState<IntakeSendReport[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/plan/${encodeURIComponent(planId)}/creative-intake`);
    const json = (await res.json()) as IntakeView;
    if (!res.ok || json.ok === false) {
      setError(json.error ?? "Could not load creatives");
      return;
    }
    setView(json);
    setSelected((current) => current.filter((id) => (json.assets ?? []).some((asset) => asset.id === id)));
  }, [planId]);

  useEffect(() => {
    if (!persisted) return;
    void reload();
  }, [persisted, reload]);

  const assets = view?.assets ?? [];
  const groups = view?.groups ?? [];
  const selectedAssets = selected
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is IntakeAsset => Boolean(asset))
    .filter((asset) => !asset.groupId);
  const refusal = selectedAssets.length === 0 ? "Select 2 or 3 assets" : matchRefusal(selectedAssets);

  const crossPublish =
    view?.multiPlacement === false && groups.some((group) => group.assetIds.length >= 2);

  async function post(body: Record<string, unknown>): Promise<IntakeView & { notes?: string[]; ok?: boolean; error?: string }> {
    const res = await fetch(`/api/plan/${encodeURIComponent(planId)}/creative-intake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as IntakeView & { notes?: string[]; view?: IntakeView; error?: string };
    if (!res.ok || json.ok === false) throw new Error(json.error ?? `HTTP ${res.status}`);
    if (json.view?.assets) setView(json.view);
    return json;
  }

  async function takeFiles(files: File[]) {
    const accepted = files.filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
    if (accepted.length === 0) {
      setError("Drop images or videos");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const file of accepted) {
        const measured = await measureFile(file);
        const hashed = await sha256HexOfBlob(file);
        const kind = file.type.startsWith("video/") ? "videos" : "images";
        const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || (kind === "videos" ? "mp4" : "jpg");
        const safe = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "").slice(-40) || ext;
        const storagePath = `${kind}/mml-${crypto.randomUUID()}-${safe}`;
        await uploadFileToCampaignAssets(file, storagePath);
        await post({
          action: "register",
          storagePath,
          storageBucket: CAMPAIGN_ASSETS_BUCKET,
          filename: file.name,
          contentType: file.type,
          contentHash: hashed.contentHash,
          byteSize: hashed.byteSize,
          mediaKind: kind === "videos" ? "video" : "image",
          width: measured.width,
          height: measured.height,
          durationSeconds: measured.durationSeconds,
        });
      }
      setSelected([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function move(assetId: string, bucket: IntakeBucket) {
    setError(null);
    try {
      await post({ action: "override", assetId, bucket });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move that file");
    }
  }

  async function match() {
    if (refusal) return;
    setBusy(true);
    setError(null);
    try {
      await post({ action: "match", assetIds: selectedAssets.map((asset) => asset.id) });
      setSelected([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Match failed");
    } finally {
      setBusy(false);
    }
  }

  async function unmatch(groupId: string) {
    setBusy(true);
    setError(null);
    try {
      const json = await post({ action: "unmatch", groupId });
      setNotes(json.notes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unmatch failed");
    } finally {
      setBusy(false);
    }
  }

  async function prepareDrafts() {
    for (const adapter of ["meta", "tiktok"] as const) {
      const res = await fetch(`/api/plan/${encodeURIComponent(planId)}/prepare-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adapter, clientId }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; launches?: CampaignPlan["launches"] };
      if (!res.ok || json.ok === false) throw new Error(json.error ?? `Could not prepare ${adapter}`);
      if (json.launches) onLaunches(json.launches);
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    setSendResults([]);
    setProgress(null);
    try {
      await prepareDrafts();
      const res = await fetch(`/api/plan/${encodeURIComponent(planId)}/creative-intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ action: "send" }),
      });
      if (!res.body) throw new Error("Send failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let donePayload: {
        ok?: boolean;
        error?: string;
        notes?: string[];
        results?: IntakeSendReport[];
        view?: IntakeView;
      } | null = null;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line) as {
            type?: string;
            index?: number;
            total?: number;
            ok?: boolean;
            error?: string;
            notes?: string[];
            results?: IntakeSendReport[];
            view?: IntakeView;
          };
          if (message.type === "progress" && message.index && message.total) {
            setProgress(intakeUploadProgress(message.index, message.total));
          }
          if (message.type === "done") donePayload = message;
        }
      }
      if (!res.ok && !donePayload) throw new Error(`HTTP ${res.status}`);
      if (!donePayload?.ok) throw new Error(donePayload?.error ?? "Send failed");
      if (donePayload.view?.assets) setView(donePayload.view);
      setNotes(donePayload.notes ?? []);
      setSendResults(donePayload.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const groupedNames = groups.map((group) => ({
    ...group,
    label: group.assetIds
      .map((id) => assets.find((asset) => asset.id === id)?.filename ?? id)
      .join(" + "),
    mode: group.assetIds.length === 3 ? "full" : "dual",
  }));

  if (!persisted) {
    return <StatusLine className={`${VIZ_TYPE.label} text-muted-foreground`}>Save the MML before dropping files.</StatusLine>;
  }

  return (
    <div data-mml-intake className="space-y-3">
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border bg-card px-3 py-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void takeFiles([...event.dataTransfer.files]);
        }}
      >
        <div>
          <Datum className={VIZ_TYPE.body}>Drop every file once</Datum>
          <Datum className={`${VIZ_TYPE.label} text-muted-foreground`}>
            Images and videos. Sorted by their pixels into 4:5, 1:1, 9:16 and Other.
          </Datum>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void takeFiles([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
      </div>

      {view?.tableMissing ? (
        <StatusLine className={`${VIZ_TYPE.label} text-foreground`}>Apply migration 193 before this intake can be saved.</StatusLine>
      ) : null}

      {groupedNames.length > 0 ? (
        <ul className="space-y-1">
          {groupedNames.map((group) => (
            <li key={group.id} className={`flex items-center justify-between gap-2 ${VIZ_TYPE.label}`}>
              <span>
                Matched · {group.mode} · {group.label}
              </span>
              <span className="flex items-center gap-2">
                <button type="button" className="underline" disabled={busy} onClick={() => void unmatch(group.id)}>
                  Unmatch
                </button>
                <Datum className="text-muted-foreground">splits the group. Send updates the drafts.</Datum>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-4">
        {INTAKE_BUCKETS.map((bucket) => (
          <section
            key={bucket}
            data-intake-column={bucket}
            className="min-h-[140px] rounded-md border border-border bg-card p-2"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const assetId = event.dataTransfer.getData("text/plain");
              if (assetId) void move(assetId, bucket);
            }}
          >
            <h3 className={`${VIZ_TYPE.label} mb-2 text-muted-foreground`}>{COLUMN_LABEL[bucket]}</h3>
            <div className="space-y-2">
              {assets
                .filter((asset) => asset.bucket === bucket && !asset.groupId)
                .map((asset) => (
                  <article
                    key={asset.id}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("text/plain", asset.id)}
                    className={`rounded border p-2 ${selected.includes(asset.id) ? "border-foreground" : "border-border"}`}
                  >
                    <button type="button" className="block w-full text-left" onClick={() => {
                      setSelected((current) =>
                        current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id],
                      );
                    }}>
                      {asset.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, not a static asset
                        <img src={asset.thumbnailUrl} alt="" className="mb-1 h-16 w-full rounded object-cover" />
                      ) : (
                        <span className={`mb-1 block h-16 rounded bg-muted ${VIZ_TYPE.label}`} />
                      )}
                      <span className={`block truncate ${VIZ_TYPE.body}`}>{asset.filename}</span>
                      <span className={`block text-muted-foreground ${VIZ_TYPE.label}`}>
                        {asset.mediaKind}
                        {formatDuration(asset.durationSeconds) ? ` · ${formatDuration(asset.durationSeconds)}` : ""}
                        {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
                      </span>
                      {asset.override ? (
                        <span className={`block ${VIZ_TYPE.label}`}>moved by you</span>
                      ) : null}
                      {asset.bucket === "other" && asset.reason ? (
                        <span className={`block text-muted-foreground ${VIZ_TYPE.label}`}>{asset.reason}</span>
                      ) : null}
                      {asset.uploadError ? (
                        <StatusLine tone="alert" className={`text-destructive ${VIZ_TYPE.label}`}>{asset.uploadError}</StatusLine>
                      ) : null}
                    </button>
                  </article>
                ))}
            </div>
          </section>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy || Boolean(refusal)} onClick={() => void match()}>
          Match
        </Button>
        {refusal ? <span className={`${VIZ_TYPE.label} text-muted-foreground`}>{refusal}</span> : null}
        <Button type="button" size="sm" className="ml-auto" disabled={busy || assets.length === 0} onClick={() => void send()}>
          Send to Meta + TikTok
        </Button>
      </div>
      {progress ? <StatusLine className={`${VIZ_TYPE.label} text-foreground`}>{progress}</StatusLine> : null}
      {sendResults.map((result, index) => (
        <StatusLine
          key={`${result.label}-${index}`}
          tone={result.error ? "alert" : "status"}
          className={`${VIZ_TYPE.label} ${result.error ? "text-destructive" : "text-foreground"}`}
        >
          {intakeSendResultLine(result)}
        </StatusLine>
      ))}
      {crossPublish ? <StatusLine className={`${VIZ_TYPE.label} text-muted-foreground`}>{META_CROSS_PUBLISH_NOTE}</StatusLine> : null}
      {notes.map((note) => (
        <StatusLine key={note} className={`${VIZ_TYPE.label} text-muted-foreground`}>{note}</StatusLine>
      ))}
      {error ? <StatusLine tone="alert" className={`${VIZ_TYPE.label} text-destructive`}>{error}</StatusLine> : null}
    </div>
  );
}
