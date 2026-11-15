import "server-only";

import { randomUUID } from "node:crypto";

import {
  seasonReportStoragePath,
  storagePathBelongsToClient,
  validateSeasonReportMeta,
  validateSeasonReportUpload,
  type ClientReportCard,
  type SeasonReportListItem,
} from "@/lib/client-reports/access";
import { generateShareToken } from "@/lib/db/report-shares";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/db/database.types";

export type ClientReportRow = Tables<"client_reports">;

export type { ClientReportCard };

const BUCKET = "client-reports";
const CARD_COLUMNS =
  "id, season, title, share_token, enabled, expires_at, created_at" as const;

export class ClientReportError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ClientReportError";
  }
}

function migrationMessage(error: { code?: string; message?: string }): string | null {
  const message = error.message ?? "";
  if (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /client_reports|schema cache/i.test(message)
  ) {
    return "Season reports are not available yet. Migration 196 (client_reports) has not been applied.";
  }
  if (/bucket not found|Bucket not found/i.test(message)) {
    return "Season reports are not available yet. Migration 196 (the client-reports bucket) has not been applied.";
  }
  return null;
}

function toCard(row: {
  id: string;
  season: string;
  title: string;
  share_token: string;
  enabled: boolean;
  expires_at: string | null;
  created_at: string;
}): ClientReportCard {
  return {
    id: row.id,
    season: row.season,
    title: row.title,
    share_token: row.share_token,
    enabled: row.enabled,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

export async function listOwnedClientReports(
  clientId: string,
): Promise<ClientReportCard[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("client_reports")
      .select(CARD_COLUMNS)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("[client-reports] list failed:", error.message);
      return [];
    }
    return (data ?? []).map(toCard);
  } catch (err) {
    console.warn(
      "[client-reports] list failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/** Service-role read for the public portal. The caller has already resolved the client token. */
export async function listClientSeasonReports(
  clientId: string,
): Promise<SeasonReportListItem[]> {
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("client_reports")
      .select("client_id, season, title, share_token, enabled, expires_at")
      .eq("client_id", clientId);
    if (error) {
      console.warn("[client-reports] portal list failed:", error.message);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.warn(
      "[client-reports] portal list failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export async function getSeasonReportByToken(token: string): Promise<{
  id: string;
  client_id: string;
  enabled: boolean;
  expires_at: string | null;
  storage_path: string;
} | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("client_reports")
    .select("id, client_id, enabled, expires_at, storage_path")
    .eq("share_token", token)
    .maybeSingle();
  if (error) {
    console.warn("[client-reports] token lookup failed:", error.message);
    return null;
  }
  return data;
}

export async function openSeasonReportBody(
  storagePath: string,
): Promise<ReadableStream<Uint8Array> | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    console.warn(
      "[client-reports] storage read failed:",
      error?.message ?? "empty object",
    );
    return null;
  }
  return data.stream();
}

async function putObject(
  path: string,
  bytes: Uint8Array,
  upsert: boolean,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: "text/html",
    upsert,
  });
  if (error) {
    throw new ClientReportError(
      migrationMessage(error) ?? `Could not store the report. ${error.message}`,
      502,
    );
  }
}

function headOf(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 512));
}

export function assertHtmlUpload(filename: string, bytes: Uint8Array): void {
  const result = validateSeasonReportUpload({
    filename,
    byteLength: bytes.byteLength,
    head: headOf(bytes),
  });
  if (!result.ok) throw new ClientReportError(result.error, result.status);
}

export async function createOwnedClientReport(input: {
  clientId: string;
  season: string;
  title: string;
  filename: string;
  bytes: Uint8Array;
}): Promise<ClientReportCard> {
  const metaError = validateSeasonReportMeta(input.season, input.title);
  if (metaError) throw new ClientReportError(metaError, 400);
  assertHtmlUpload(input.filename, input.bytes);

  const season = input.season.trim();
  const title = input.title.trim();
  const id = randomUUID();
  const storagePath = seasonReportStoragePath(input.clientId, season, id);
  const supabase = await createClient();

  let lastError: { code?: string; message: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const shareToken = generateShareToken();
    const { data, error } = await supabase
      .from("client_reports")
      .insert({
        id,
        client_id: input.clientId,
        season,
        title,
        storage_path: storagePath,
        share_token: shareToken,
        enabled: true,
      })
      .select(CARD_COLUMNS)
      .single();
    if (!error && data) {
      try {
        await putObject(storagePath, input.bytes, false);
      } catch (uploadError) {
        const { error: deleteError } = await supabase
          .from("client_reports")
          .delete()
          .eq("id", id);
        if (deleteError) {
          console.warn("[client-reports] rollback failed:", deleteError.message);
        }
        throw uploadError;
      }
      return toCard(data);
    }
    lastError = error;
    if (error?.code !== "23505") break;
  }

  throw new ClientReportError(
    migrationMessage(lastError ?? {}) ??
      lastError?.message ??
      "Could not save the report.",
    migrationMessage(lastError ?? {}) ? 503 : 400,
  );
}

export async function updateOwnedClientReport(input: {
  clientId: string;
  reportId: string;
  enabled?: boolean;
  expiresAt?: string | null;
  regenerate?: boolean;
}): Promise<ClientReportCard> {
  const supabase = await createClient();
  const patch: {
    enabled?: boolean;
    expires_at?: string | null;
    share_token?: string;
  } = {};
  if (typeof input.enabled === "boolean") patch.enabled = input.enabled;
  if (input.expiresAt !== undefined) patch.expires_at = input.expiresAt;
  if (input.regenerate) patch.share_token = generateShareToken();
  if (Object.keys(patch).length === 0) {
    throw new ClientReportError("Nothing to update.", 400);
  }

  const { data, error } = await supabase
    .from("client_reports")
    .update(patch)
    .eq("id", input.reportId)
    .eq("client_id", input.clientId)
    .select(CARD_COLUMNS)
    .maybeSingle();
  if (error) {
    throw new ClientReportError(
      migrationMessage(error) ?? error.message,
      migrationMessage(error) ? 503 : 400,
    );
  }
  if (!data) throw new ClientReportError("Report not found.", 404);
  return toCard(data);
}

export async function replaceOwnedClientReportFile(input: {
  clientId: string;
  reportId: string;
  filename: string;
  bytes: Uint8Array;
}): Promise<ClientReportCard> {
  assertHtmlUpload(input.filename, input.bytes);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_reports")
    .select("id, storage_path, client_id, season, title, share_token, enabled, expires_at, created_at")
    .eq("id", input.reportId)
    .eq("client_id", input.clientId)
    .maybeSingle();
  if (error) {
    throw new ClientReportError(
      migrationMessage(error) ?? error.message,
      migrationMessage(error) ? 503 : 400,
    );
  }
  if (!data) throw new ClientReportError("Report not found.", 404);
  if (!storagePathBelongsToClient(data.storage_path, input.clientId)) {
    throw new ClientReportError("Report file path is not valid.", 409);
  }
  await putObject(data.storage_path, input.bytes, true);
  return toCard(data);
}
