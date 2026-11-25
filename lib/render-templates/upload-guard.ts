/**
 * lib/render-templates/upload-guard.ts — a render file that failed a check
 * can't be uploaded (RT2): the campaign tree's Add creatives to… and the
 * connector's paths refuse it with "Failed {checks}, so it can't be
 * uploaded.". A file that passed goes on with no further step (RY1: the yes
 * already approved its upload).
 *
 * The file is known by its Drive id (the tree's and the connector's From
 * Drive), its Storage path or its 25 Nov name; any one that matches a
 * package file decides. A file no package made isn't this guard's.
 *
 * M3's add_creatives_to_stage calls refusedUploads with the files it is
 * about to add, before any Meta call (RT hand-back to the M3 builder).
 *
 * Relative imports only (node:test).
 */

import type { Db } from "./load.ts";
import { blockedLine } from "./report.ts";
import type { CheckKey } from "./words.ts";

export type UploadFile = { driveFileId?: string | null; storagePath?: string | null; fileName?: string | null };
export type Refused = { file: UploadFile; fileName: string; failed: CheckKey[]; line: string };

type Row = { file_name: string | null; drive_file_id: string | null; storage_path: string | null; status: string; checks: { passed?: boolean; failed?: CheckKey[] } | null };

async function matching(db: Db, column: "drive_file_id" | "storage_path" | "file_name", values: string[]): Promise<Row[]> {
  if (!values.length) return [];
  const res = await db
    .from("creative_lab_renders")
    .select("file_name, drive_file_id, storage_path, status, checks")
    .not("recipe", "is", null)
    .in(column, values)
    .range(0, 999);
  if (res.error) {
    // Before migration 270 there are no package files to refuse.
    if (/recipe|column|does not exist|schema cache/i.test(res.error.message)) return [];
    throw new Error(`creative_lab_renders: ${res.error.message}`);
  }
  return (res.data ?? []) as Row[];
}

/** The files a package made that can't be uploaded: failed a check, or not rendered. */
export async function refusedUploads(db: Db, files: readonly UploadFile[]): Promise<Refused[]> {
  const ids = [...new Set(files.map((f) => f.driveFileId).filter((v): v is string => Boolean(v)))];
  const paths = [...new Set(files.map((f) => f.storagePath).filter((v): v is string => Boolean(v)))];
  const names = [...new Set(files.map((f) => f.fileName).filter((v): v is string => Boolean(v)))];
  const rows = [...(await matching(db, "drive_file_id", ids)), ...(await matching(db, "storage_path", paths)), ...(await matching(db, "file_name", names))];
  const out: Refused[] = [];
  for (const file of files) {
    const row = rows.find(
      (r) => (file.driveFileId && r.drive_file_id === file.driveFileId) || (file.storagePath && r.storage_path === file.storagePath) || (file.fileName && r.file_name === file.fileName),
    );
    if (!row) continue;
    if (row.status === "done" && row.checks?.passed === true) continue;
    const failed = row.checks?.failed?.length ? row.checks.failed : (["format"] as CheckKey[]);
    out.push({ file, fileName: row.file_name ?? "", failed, line: blockedLine(failed) });
  }
  return out;
}

/** Every asset slot of a creative list (the bulk-attach body, a draft's creatives) as upload files. */
export function uploadFilesOf(creatives: readonly unknown[]): UploadFile[] {
  const out: UploadFile[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const v = value as Record<string, unknown>;
    if (typeof v.driveFileId === "string" || typeof v.storagePath === "string") {
      out.push({ driveFileId: (v.driveFileId as string) ?? null, storagePath: (v.storagePath as string) ?? null, fileName: typeof v.fileName === "string" ? v.fileName : null });
    }
    for (const child of Object.values(v)) if (child && typeof child === "object") visit(child);
  };
  creatives.forEach(visit);
  return out;
}
