"use client";

import { useState } from "react";
import { Plus, Trash2, Save, AlertCircle, Upload } from "lucide-react";
import type { VenueMappingRow } from "@/lib/db/venue-mappings";

interface Props {
  clientId: string;
  initialMappings: VenueMappingRow[];
}

interface EditRow {
  id?: string;
  sheetLabel: string;
  eventCode: string;
  nationLabel: string;
  notes: string;
  dirty: boolean;
}

function rowToEdit(m: VenueMappingRow): EditRow {
  return {
    id: m.id,
    sheetLabel: m.sheet_label,
    eventCode: m.event_code,
    nationLabel: m.nation_label ?? "",
    notes: m.notes ?? "",
    dirty: false,
  };
}

export function VenueMappingsPanel({ clientId, initialMappings }: Props) {
  const [rows, setRows] = useState<EditRow[]>(initialMappings.map(rowToEdit));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvError, setCsvError] = useState<string | null>(null);
  const [showCsvModal, setShowCsvModal] = useState(false);

  function addRow() {
    setRows((prev) => [...prev, { sheetLabel: "", eventCode: "", nationLabel: "", notes: "", dirty: true }]);
  }

  function updateRow(idx: number, field: keyof Omit<EditRow, "id" | "dirty">, value: string) {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: value, dirty: true } : r));
  }

  async function deleteRow(idx: number) {
    const row = rows[idx];
    if (row.id) {
      await fetch(`/api/clients/${clientId}/venue-mappings/${row.id}`, { method: "DELETE" });
    }
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);

    const toSave = rows
      .filter((r) => r.sheetLabel.trim() && r.eventCode.trim())
      .map((r) => ({
        sheet_label: r.sheetLabel.trim(),
        event_code: r.eventCode.trim(),
        nation_label: r.nationLabel.trim() || undefined,
        notes: r.notes.trim() || undefined,
      }));

    if (toSave.length === 0) {
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/clients/${clientId}/venue-mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: toSave }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Save failed");
        return;
      }
      const data = await res.json();
      setRows((data.mappings as VenueMappingRow[]).map(rowToEdit));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setSaving(false);
    }
  }

  function parseCsv() {
    setCsvError(null);
    const lines = csvText.trim().split("\n").filter(Boolean);
    const parsed: EditRow[] = [];
    for (const line of lines) {
      const parts = line.split(",").map((p) => p.trim());
      if (parts.length < 2) {
        setCsvError(`Bad line: "${line}" — expected "sheet_label, event_code[, nation][, notes]"`);
        return;
      }
      parsed.push({
        sheetLabel: parts[0],
        eventCode: parts[1],
        nationLabel: parts[2] ?? "",
        notes: parts[3] ?? "",
        dirty: true,
      });
    }
    setRows((prev) => {
      const existing = new Map(prev.filter((r) => r.id).map((r) => [r.sheetLabel.toLowerCase(), r]));
      for (const p of parsed) {
        existing.set(p.sheetLabel.toLowerCase(), p);
      }
      return [...existing.values()];
    });
    setShowCsvModal(false);
    setCsvText("");
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={addRow}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" />
          Add row
        </button>
        <button
          onClick={() => setShowCsvModal(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <Upload className="h-3.5 w-3.5" />
          Bulk paste CSV
        </button>
      </div>

      {showCsvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-lg rounded-xl border border-border bg-card p-6">
            <h2 className="mb-2 font-heading text-base tracking-wide">Bulk paste CSV</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              One row per line: <code className="rounded bg-muted px-1 py-0.5">sheet_label, event_code[, nation][, notes]</code>
            </p>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              rows={10}
              placeholder={"Brighton, WC26-BRIGHTON, England\nManchester, UTB0046-NEW, England"}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
            {csvError && <p className="mt-2 text-xs text-destructive">{csvError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setShowCsvModal(false); setCsvText(""); setCsvError(null); }}
                className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={parseCsv}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Sheet label</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Event code</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Nation</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Notes</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No mappings yet. Add rows or paste CSV above.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={row.id ?? idx} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5">
                    <input
                      className="w-full rounded border-0 bg-transparent px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      value={row.sheetLabel}
                      onChange={(e) => updateRow(idx, "sheetLabel", e.target.value)}
                      placeholder="Brighton"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="w-full rounded border-0 bg-transparent px-1 py-0.5 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      value={row.eventCode}
                      onChange={(e) => updateRow(idx, "eventCode", e.target.value)}
                      placeholder="WC26-BRIGHTON"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="w-32 rounded border-0 bg-transparent px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      value={row.nationLabel}
                      onChange={(e) => updateRow(idx, "nationLabel", e.target.value)}
                      placeholder="England"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="w-full rounded border-0 bg-transparent px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      value={row.notes}
                      onChange={(e) => updateRow(idx, "notes", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <button
                      onClick={() => deleteRow(idx)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {success && <p className="text-sm text-green-600 dark:text-green-400">Mappings saved.</p>}

      <button
        onClick={handleSave}
        disabled={saving || rows.every((r) => !r.dirty)}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        <Save className="h-4 w-4" />
        {saving ? "Saving…" : "Save mappings"}
      </button>
    </div>
  );
}
