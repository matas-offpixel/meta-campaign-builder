"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bookmark, Check, Loader2, Settings2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Datum, StatusLine } from "@/components/steps/step-surface";
import {
  evidenceLine,
  findClusterForInterests,
  addClusterToGroups,
  isClusterInGroups,
  sortClusters,
  visibleClusters,
  type ClusterSort,
  type ClusterVertical,
  type InterestCluster,
  type InterestClusterInterest,
} from "@/lib/interest-clusters";
import type { InterestGroup } from "@/lib/types";

export const NOT_SEEDED_HELP =
  "The single-interest Techno, Tech house and House music clusters are not seeded: they run ~40% worse than the branded clusters on the same account.";

type ClusterPatch = { name?: string; archived?: boolean; interests?: InterestClusterInterest[] };

export interface InterestClustersState {
  clusters: InterestCluster[];
  vertical: ClusterVertical | null;
  loading: boolean;
  error: string | null;
  tableMissing: boolean;
  markUsed: (cluster: InterestCluster) => void;
  save: (name: string, interests: InterestClusterInterest[]) => Promise<{ ok: true } | { ok: false; error: string }>;
  update: (id: string, patch: ClusterPatch) => Promise<{ ok: true } | { ok: false; error: string }>;
}

function groupInterests(group: InterestGroup): InterestClusterInterest[] {
  return group.interests.map((i) => ({ id: i.id, name: i.name }));
}

export function useInterestClusters(clientId: string | undefined): InterestClustersState {
  const [clusters, setClusters] = useState<InterestCluster[]>([]);
  const [vertical, setVertical] = useState<ClusterVertical | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const requestKey = clientId ?? "";
  const loading = loadedFor !== requestKey;

  useEffect(() => {
    let cancelled = false;
    const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
    fetch(`/api/interest-clusters${qs}`)
      .then(async (res) => {
        const json = (await res.json()) as {
          ok: boolean;
          clusters?: InterestCluster[];
          vertical?: ClusterVertical | null;
          error?: string;
          tableMissing?: boolean;
        };
        if (cancelled) return;
        if (!json.ok) {
          setTableMissing(Boolean(json.tableMissing));
          setError(json.error ?? "Could not load saved clusters");
          return;
        }
        setClusters(json.clusters ?? []);
        setVertical(json.vertical ?? null);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load saved clusters");
      })
      .finally(() => {
        if (!cancelled) setLoadedFor(clientId ?? "");
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const replace = useCallback((next: InterestCluster) => {
    setClusters((prev) => {
      const found = prev.some((c) => c.id === next.id);
      return found ? prev.map((c) => (c.id === next.id ? next : c)) : [...prev, next];
    });
  }, []);

  const markUsed = useCallback(
    (cluster: InterestCluster) => {
      replace({ ...cluster, useCount: cluster.useCount + 1, lastUsedAt: new Date().toISOString() });
      void fetch("/api/interest-clusters/use", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cluster.id }),
      });
    },
    [replace],
  );

  const send = useCallback(
    async (method: "POST" | "PATCH", body: Record<string, unknown>) => {
      const res = await fetch("/api/interest-clusters", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; cluster?: InterestCluster; error?: string };
      if (!json.ok || !json.cluster) return { ok: false as const, error: json.error ?? "Request failed" };
      replace(json.cluster);
      return { ok: true as const };
    },
    [replace],
  );

  const save = useCallback(
    (name: string, interests: InterestClusterInterest[]) => send("POST", { name, interests, clientId }),
    [send, clientId],
  );
  const update = useCallback((id: string, patch: ClusterPatch) => send("PATCH", { id, ...patch }), [send]);

  return { clusters, vertical, loading, error, tableMissing, markUsed, save, update };
}

// ─── Strip ────────────────────────────────────────────────────────────────────

export function SavedClustersStrip({
  state,
  groups,
  onAddGroup,
}: {
  state: InterestClustersState;
  groups: InterestGroup[];
  onAddGroup: (group: InterestGroup) => void;
}) {
  const [sort, setSort] = useState<ClusterSort>("most_used");
  const [manageOpen, setManageOpen] = useState(false);
  const shown = useMemo(
    () => sortClusters(visibleClusters(state.clusters, state.vertical), sort),
    [state.clusters, state.vertical, sort],
  );

  if (state.tableMissing) return null;

  return (
    <div className="rounded-md border border-border bg-card/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">Saved clusters</span>
          {state.vertical && <Badge variant="outline">{state.vertical}</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <div className="flex rounded border border-border text-[11px]" role="group" aria-label="Sort clusters">
            {(
              [
                ["most_used", "Most used"],
                ["best_cpr", "Best CPR"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSort(value)}
                aria-pressed={sort === value}
                className={`px-2 py-1 ${sort === value ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setManageOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" />
            Manage clusters
          </Button>
        </div>
      </div>

      {state.loading ? (
        <Datum className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading saved clusters…
        </Datum>
      ) : state.error ? (
        <StatusLine className="text-[11px] text-warning">{state.error}</StatusLine>
      ) : shown.length === 0 ? (
        <Datum className="text-[11px] text-muted-foreground">
          No saved clusters{state.vertical ? ` for ${state.vertical}` : ""} yet. Use “Save as cluster” on a group.
        </Datum>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {shown.map((cluster) => {
            const added = isClusterInGroups(cluster, groups);
            const line = evidenceLine(cluster.evidence);
            return (
              <button
                key={cluster.id}
                type="button"
                disabled={added}
                onClick={() => {
                  const { added: group } = addClusterToGroups(groups, cluster, crypto.randomUUID());
                  if (!group) return;
                  onAddGroup(group);
                  state.markUsed(cluster);
                }}
                title={cluster.interests.map((i) => i.name).join(", ")}
                className={`w-56 shrink-0 rounded-md border p-2.5 text-left transition-colors ${
                  added
                    ? "cursor-default border-success/40 bg-success/5"
                    : "border-border bg-background hover:border-primary/50 hover:bg-muted/40"
                }`}
              >
                <div className="flex items-start justify-between gap-1.5">
                  <span className="text-xs font-semibold leading-tight">{cluster.name}</span>
                  {added && <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Added" />}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Badge variant="primary" className="text-[10px]">
                    {cluster.interests.length} interest{cluster.interests.length === 1 ? "" : "s"}
                  </Badge>
                  {cluster.evidence?.confidence === "thin" && (
                    <Badge variant="warning" className="text-[10px]">
                      {cluster.evidence.adSets} ad sets
                    </Badge>
                  )}
                </div>
                {line && <Datum className="mt-1.5 text-[10px] leading-snug text-muted-foreground">{line}</Datum>}
              </button>
            );
          })}
        </div>
      )}

      <ManageClustersDialog open={manageOpen} onClose={() => setManageOpen(false)} state={state} groups={groups} />
    </div>
  );
}

// ─── Per-group save ───────────────────────────────────────────────────────────

export function GroupClusterAction({ state, group }: { state: InterestClustersState; group: InterestGroup }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.tableMissing || state.loading || group.interests.length === 0) return null;
  const match = findClusterForInterests(state.clusters, group.interests);
  if (match) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-success" onClick={(e) => e.stopPropagation()}>
        <Check className="h-3 w-3" /> Saved as {match.name}
      </span>
    );
  }

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    const result = await state.save(trimmed, groupInterests(group));
    setSaving(false);
    if (result.ok) setOpen(false);
    else setError(result.error);
  };

  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setName(group.name);
          setError(null);
          setOpen(true);
        }}
      >
        <Bookmark className="h-3.5 w-3.5" />
        Save as cluster
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogContent>
          <DialogHeader onClose={() => setOpen(false)}>
            <DialogTitle>Save as cluster</DialogTitle>
            <DialogDescription>
              {group.interests.length} interests. Saved clusters appear in the strip above the interest groups.
            </DialogDescription>
          </DialogHeader>
          <Input
            label="Cluster name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
          {error && <StatusLine className="mt-2 text-xs text-destructive">{error}</StatusLine>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={!name.trim() || saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}

// ─── Manage ───────────────────────────────────────────────────────────────────

function ManageRow({
  cluster,
  groups,
  update,
}: {
  cluster: InterestCluster;
  groups: InterestGroup[];
  update: InterestClustersState["update"];
}) {
  const [name, setName] = useState(cluster.name);
  const [replaceFrom, setReplaceFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = groups.filter((g) => g.interests.length > 0);
  const archived = Boolean(cluster.archivedAt);

  const run = async (patch: ClusterPatch) => {
    setBusy(true);
    setError(null);
    const result = await update(cluster.id, patch);
    setBusy(false);
    if (!result.ok) setError(result.error);
  };

  const line = evidenceLine(cluster.evidence);
  return (
    <li className={`rounded-md border border-border p-3 space-y-2 ${archived ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2">
        <input
          aria-label={`Name of ${cluster.name}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={archived}
          className="h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 text-sm"
        />
        {name.trim() && name.trim() !== cluster.name && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run({ name: name.trim() })}>
            Rename
          </Button>
        )}
        <Badge variant="outline" className="text-[10px]">
          {cluster.vertical}
        </Badge>
        {archived ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run({ archived: false })}>
            Unarchive
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ archived: true })}>
            Archive
          </Button>
        )}
      </div>
      <Datum className="text-[11px] text-muted-foreground">
        {cluster.interests.map((i) => i.name).join(", ")}
        {line ? ` — ${line}` : ""}
        {cluster.evidence?.confidence === "thin" ? " · thin evidence" : ""}
      </Datum>
      {cluster.evidence?.dropped?.map((d) => (
        <StatusLine key={d.id} className="text-[11px] text-warning">
          {d.name} was dropped from this cluster — {d.reason}.
        </StatusLine>
      ))}
      {!archived && filled.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            aria-label={`Replace ${cluster.name} with a group`}
            value={replaceFrom}
            onChange={(e) => setReplaceFrom(e.target.value)}
            className="h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs"
          >
            <option value="">Replace with current group…</option>
            {filled.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name || "Untitled Group"} ({g.interests.length})
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={!replaceFrom || busy}
            onClick={() => {
              const group = filled.find((g) => g.id === replaceFrom);
              if (group) void run({ interests: groupInterests(group) });
              setReplaceFrom("");
            }}
          >
            Replace with current group
          </Button>
        </div>
      )}
      {error && <StatusLine className="text-xs text-destructive">{error}</StatusLine>}
    </li>
  );
}

export function ManageClustersDialog({
  open,
  onClose,
  state,
  groups,
}: {
  open: boolean;
  onClose: () => void;
  state: InterestClustersState;
  groups: InterestGroup[];
}) {
  const ordered = useMemo(
    () => [
      ...sortClusters(state.clusters.filter((c) => !c.archivedAt), "most_used"),
      ...sortClusters(state.clusters.filter((c) => c.archivedAt), "most_used"),
    ],
    [state.clusters],
  );
  return (
    <Dialog open={open} onClose={onClose} panelClassName="max-w-2xl">
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader onClose={onClose}>
          <DialogTitle>Manage clusters</DialogTitle>
          <DialogDescription>
            Rename, archive, or replace a cluster&apos;s interests with one of this draft&apos;s groups. Replacing clears the
            evidence, which measured the old set. Clusters are archived, never deleted.
          </DialogDescription>
        </DialogHeader>
        {ordered.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground space-y-1">
            <Datum>No saved clusters yet. Use “Save as cluster” on an interest group.</Datum>
            <Datum>{NOT_SEEDED_HELP}</Datum>
          </div>
        ) : (
          <ul className="space-y-2">
            {ordered.map((c) => (
              <ManageRow key={`${c.id}:${c.updatedAt}`} cluster={c} groups={groups} update={state.update} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
