"use client";

/**
 * The creatives step's side of From Drive (G4–G7): the batch's fields and
 * per-owner identity for the session, the ads Prepare makes, and the copy
 * loop. It lives in the step, not the dialog, so closing the picker never
 * stops a batch (G6); each ad's slots carry their own states.
 */

import { useCallback, useRef, useState, type MutableRefObject } from "react";

import { createDefaultAssetVariation, createDefaultCreative, defaultCtaForObjective } from "@/lib/campaign-defaults";
import { failedRows, readCopyStream, runBatch, type BatchRow, type CopyOk } from "@/lib/drive/picker-batch";
import { PICKER_WORDS, defaultBatchFields, identityForOwner, type BatchFields, type BatchIdentity, type PickerOwner, type RowState } from "@/lib/drive/picker-model";
import { reuploadStoredAsset } from "@/lib/hooks/useUploadAsset";
import { getAspectRatioSlots } from "@/lib/meta/upload";
import type { AdCreativeDraft, Asset, CTAType, CampaignObjective } from "@/lib/types";

import type { PickerBatchRow, PickerPrepare } from "./drive-picker";

export type DrivePickerSession = ReturnType<typeof useDrivePicker>;

export function useDrivePicker(input: {
  creatives: AdCreativeDraft[];
  creativesRef: MutableRefObject<AdCreativeDraft[]>;
  onChange: (creatives: AdCreativeDraft[]) => void;
  objective: CampaignObjective | undefined;
  eventId: string | null;
  ticketUrl: string | null | undefined;
  adAccountId: string | undefined;
  onAdded?: (firstId: string) => void;
}) {
  const { creativesRef, onChange } = input;
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<BatchFields | null>(null);
  const [rows, setRows] = useState<PickerBatchRow[] | null>(null);
  const memory = useRef<Record<string, BatchIdentity>>({});
  const defaultIdentity = useRef<BatchIdentity>({ pageId: "", instagramAccountId: "" });
  const ownerKey = useRef<string | null>(null);
  const planRows = useRef<BatchRow[]>([]);
  const states = useRef<Map<string, RowState>>(new Map());

  const defaults = useCallback((): BatchFields => {
    const list = creativesRef.current;
    const last = list[list.length - 1];
    return defaultBatchFields({
      ticketUrl: input.ticketUrl,
      lastAd: last ? { destinationUrl: last.destinationUrl, cta: last.cta, identity: last.identity } : null,
      objectiveCta: defaultCtaForObjective(input.objective),
    });
  }, [creativesRef, input.ticketUrl, input.objective]);

  const openPicker = useCallback(() => {
    if (!fields) {
      const first = defaults();
      defaultIdentity.current = first.identity;
      setFields(first);
    }
    setOpen(true);
  }, [fields, defaults]);

  const onOwnerChange = useCallback((owner: PickerOwner | null) => {
    ownerKey.current = owner?.key ?? null;
    setFields((prev) => (prev ? { ...prev, identity: identityForOwner(memory.current, ownerKey.current, defaultIdentity.current) } : prev));
  }, []);

  const onFieldsChange = useCallback((next: BatchFields, picked?: { identity: boolean }) => {
    if (picked?.identity && ownerKey.current) memory.current = { ...memory.current, [ownerKey.current]: next.identity };
    setFields(next);
  }, []);

  const onClearFields = useCallback(() => {
    const cleared = defaults();
    setFields({ ...cleared, identity: identityForOwner(memory.current, ownerKey.current, defaultIdentity.current) });
  }, [defaults]);

  const patchSlot = useCallback(
    (adId: string, variationId: string | null, slotId: string | null, patch: Partial<Asset>) => {
      if (!slotId) return;
      onChange(
        creativesRef.current.map((c) =>
          c.id !== adId
            ? c
            : {
                ...c,
                assetVariations: (c.assetVariations ?? []).map((v) =>
                  v.id !== variationId ? v : { ...v, assets: v.assets.map((a) => (a.id === slotId ? { ...a, ...patch } : a)) },
                ),
              },
        ),
      );
    },
    [creativesRef, onChange],
  );

  const run = useCallback(
    async (batch: BatchRow[]) => {
      const { eventId, adAccountId } = input;
      await runBatch(batch, {
        copy: async (_row, part, onProgress) => {
          const res = await fetch(`/api/events/${eventId}/drive/picker/copy`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileId: part.fileId, role: part.role }),
          });
          if (!res.ok) return { ok: false, code: "copy_failed", reason: PICKER_WORDS.copyFailed };
          return readCopyStream(res, onProgress);
        },
        sendToMeta: async (_row, part, copy: CopyOk) => {
          if (!adAccountId) throw new Error("Choose the ad account first");
          return reuploadStoredAsset({ storagePath: copy.storagePath, storageBucket: copy.storageBucket, type: copy.mediaType, adAccountId, fileName: part.fileName });
        },
        onRow: (rowId, state) => {
          states.current.set(rowId, state);
          setRows((prev) => (prev ? prev.map((r) => (r.rowId === rowId ? { ...r, state } : r)) : prev));
        },
        onUploaded: (row, part, copy, meta) => {
          patchSlot(row.adId!, row.variationId, part.slotAssetId, {
            uploadedUrl: meta.url,
            thumbnailUrl: meta.previewUrl ?? meta.url,
            assetHash: meta.hash,
            videoId: meta.videoId,
            registryAssetId: meta.registryAssetId ?? copy.registryAssetId,
            storagePath: copy.storagePath,
            storageBucket: copy.storageBucket,
            uploadStatus: "uploaded",
            error: undefined,
          });
        },
        onSlotFailed: (row, part, line) => patchSlot(row.adId!, row.variationId, part.slotAssetId, { uploadStatus: "error", error: line }),
      });
    },
    [input, patchSlot],
  );

  const onPrepare = useCallback(
    (plan: PickerPrepare) => {
      if (!fields) return;
      const ads: AdCreativeDraft[] = [];
      const batch: BatchRow[] = [];
      for (const ad of plan.ads) {
        const c = createDefaultCreative(input.objective);
        c.name = ad.name;
        c.nameSource = "operator";
        c.identity = { ...fields.identity };
        c.captions = [{ id: crypto.randomUUID(), text: fields.primaryText }];
        c.headline = fields.headline;
        c.destinationUrl = fields.url;
        c.cta = fields.cta as CTAType;
        c.mediaType = ad.kind === "video" ? "video" : "image";
        c.assetMode = ad.assetMode;
        const variation = createDefaultAssetVariation(getAspectRatioSlots(c.mediaType, ad.assetMode));
        variation.name = "Variation 1";
        const parts = ad.parts.map((part) => {
          const slot = variation.assets.find((a) => a.aspectRatio === part.role) ?? null;
          if (slot) Object.assign(slot, { uploadStatus: "uploading", fileName: part.fileName, driveFileId: part.fileId, sourceLabel: PICKER_WORDS.fromDrivePath(plan.path) } satisfies Partial<Asset>);
          return { ...part, slotAssetId: slot?.id ?? null };
        });
        c.assetVariations = [variation];
        ads.push(c);
        batch.push({ rowId: c.id, name: ad.name, adId: c.id, variationId: variation.id, kind: ad.kind, parts });
      }
      for (const skip of plan.skipped) {
        batch.push({ rowId: `skip-${skip.fileId}-${crypto.randomUUID()}`, name: `${skip.name} (again)`, adId: null, variationId: null, kind: "video", parts: [] });
      }
      onChange([...creativesRef.current, ...ads]);
      if (ads[0]) input.onAdded?.(ads[0].id);
      planRows.current = batch;
      states.current = new Map();
      setRows(batch.map((r) => ({ rowId: r.rowId, name: r.name, state: { kind: "waiting" } })));
      void run(batch);
    },
    [fields, input, creativesRef, onChange, run],
  );

  const onRetryFailed = useCallback(() => {
    const retry = failedRows(planRows.current, states.current);
    if (retry.length === 0) return;
    for (const row of retry) for (const part of row.parts) patchSlot(row.adId!, row.variationId, part.slotAssetId, { uploadStatus: "uploading", error: undefined });
    void run(retry);
  }, [patchSlot, run]);

  const existingDriveIds = new Set<string>();
  for (const c of input.creatives) for (const v of c.assetVariations ?? []) for (const a of v.assets) if (a.driveFileId) existingDriveIds.add(a.driveFileId);

  return {
    open,
    openPicker,
    close: () => setOpen(false),
    fields,
    onFieldsChange,
    onClearFields,
    onOwnerChange,
    onPrepare,
    rows,
    onRetryFailed,
    onDismissBatch: () => setRows(null),
    existingNames: input.creatives.map((c) => c.name),
    existingDriveIds,
  };
}
