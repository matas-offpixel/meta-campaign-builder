"use client";

import { useState } from "react";

import { Datum, StatusLine } from "@/components/steps/step-surface";
import {
  metaImportCountsLine,
  metaImportNotCarriedLine,
} from "@/components/meta/meta-import-flow";
import type { MetaImportDropped, MetaImportMeta } from "@/lib/meta/import/types";

function droppedLine(row: MetaImportDropped): string {
  const where = row.adSetName ?? row.creativeId ?? row.adSetId ?? "";
  return where ? `${row.field} (${where})` : row.field;
}

/** What the mapper could not carry. Same block in the dialog and the drawer. */
export function MetaImportReport({
  meta,
  adSetCount,
}: {
  meta: MetaImportMeta;
  adSetCount: number;
}) {
  const [droppedOpen, setDroppedOpen] = useState(false);
  const notCarried = meta.notCarried ?? [];
  return (
    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
      <StatusLine>{metaImportCountsLine({ ...meta, adSetCount })}</StatusLine>
      {notCarried.length > 0 ? (
        <ul className="space-y-1">
          {notCarried.map((row) => (
            <li key={`${row.id}:${row.reason}`}>
              <Datum>{metaImportNotCarriedLine(row)}</Datum>
            </li>
          ))}
        </ul>
      ) : (
        <Datum>Everything requested was carried.</Datum>
      )}
      {meta.dropped.length > 0 ? (
        <div>
          <button
            type="button"
            className="text-left"
            aria-expanded={droppedOpen}
            onClick={() => setDroppedOpen((open) => !open)}
          >
            <Datum>
              {droppedOpen ? "▾" : "▸"} {meta.dropped.length} targeting{" "}
              {meta.dropped.length === 1 ? "field" : "fields"} the draft cannot hold
            </Datum>
          </button>
          {droppedOpen ? (
            <ul className="mt-1 space-y-1">
              {meta.dropped.map((row, index) => (
                <li key={`${row.field}:${row.adSetId ?? ""}:${index}`}>
                  <Datum>{droppedLine(row)}</Datum>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
