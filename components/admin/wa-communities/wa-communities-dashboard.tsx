"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MessageCircle, Plus, Check } from "lucide-react";

import type { WaCommunityAliasWithDestinations } from "@/lib/wa-communities/types";

type ClientOption = { id: string; name: string };

interface Props {
  initialAliases: WaCommunityAliasWithDestinations[];
  clients: ClientOption[];
  appOrigin: string;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function publicUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, "")}/j/${slug}`;
}

export function WaCommunitiesDashboard({
  initialAliases,
  clients,
  appOrigin,
}: Props) {
  const router = useRouter();
  const [aliases, setAliases] = useState(initialAliases);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Create form
  const [slug, setSlug] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [brand, setBrand] = useState("");
  const [clientId, setClientId] = useState("");
  const [notes, setNotes] = useState("");
  const [label, setLabel] = useState("Group 1");

  // Per-alias "add destination" draft
  const [addDrafts, setAddDrafts] = useState<
    Record<string, { invite: string; label: string }>
  >({});

  function replaceAlias(next: WaCommunityAliasWithDestinations) {
    setAliases((prev) => {
      const idx = prev.findIndex((a) => a.id === next.id);
      if (idx === -1) return [...prev, next].sort((a, b) => a.slug.localeCompare(b.slug));
      const copy = [...prev];
      copy[idx] = next;
      return copy;
    });
  }

  async function createAlias(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/wa-communities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          invite_code: inviteCode,
          brand: brand || null,
          client_id: clientId || null,
          notes: notes || null,
          label: label || null,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        alias?: WaCommunityAliasWithDestinations;
      };
      if (!json.ok || !json.alias) {
        setError(json.error ?? "Create failed");
        return;
      }
      replaceAlias(json.alias);
      setSlug("");
      setInviteCode("");
      setBrand("");
      setClientId("");
      setNotes("");
      setLabel("Group 1");
      router.refresh();
    });
  }

  async function activate(aliasId: string, destinationId: string) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/wa-communities/${aliasId}/destinations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activate_destination_id: destinationId }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        alias?: WaCommunityAliasWithDestinations;
      };
      if (!json.ok || !json.alias) {
        setError(json.error ?? "Repoint failed");
        return;
      }
      replaceAlias(json.alias);
      router.refresh();
    });
  }

  async function addDestination(aliasId: string) {
    const draft = addDrafts[aliasId] ?? { invite: "", label: "" };
    if (!draft.invite.trim()) {
      setError("Paste an invite code or WhatsApp URL to stage a group.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/wa-communities/${aliasId}/destinations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invite_code: draft.invite,
          label: draft.label || null,
          activate: false,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        alias?: WaCommunityAliasWithDestinations;
      };
      if (!json.ok || !json.alias) {
        setError(json.error ?? "Could not add destination");
        return;
      }
      replaceAlias(json.alias);
      setAddDrafts((prev) => ({ ...prev, [aliasId]: { invite: "", label: "" } }));
      router.refresh();
    });
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <MessageCircle className="h-5 w-5" aria-hidden />
          <span className="text-xs font-medium uppercase tracking-wide">Ops</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          WA Community Aliases
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Stable <code className="text-xs">/j/{"{slug}"}</code> links for Meta
          template buttons. When a group fills up, activate the next staged
          invite — no new template review.
        </p>
      </header>

      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      <section className="mb-10 border-t border-border pt-6">
        <h2 className="text-sm font-semibold tracking-tight">Create alias</h2>
        <form
          onSubmit={createAlias}
          className="mt-4 grid gap-3 sm:grid-cols-2"
        >
          <label className="block text-sm">
            <span className="text-muted-foreground">Slug</span>
            <input
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="throwback-madrid"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Invite code or URL</span>
            <input
              required
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="https://chat.whatsapp.com/…"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Brand label</span>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="Throwback"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Client</span>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">— optional —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Group label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Group 1"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="text-muted-foreground">Notes</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ops notes"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Create alias
            </button>
          </div>
        </form>
      </section>

      <section className="border-t border-border pt-6">
        <h2 className="text-sm font-semibold tracking-tight">
          Aliases ({aliases.length})
        </h2>
        {aliases.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No aliases yet. Create one above — then put{" "}
            <code className="text-xs">/j/your-slug</code> in the Meta template
            button.
          </p>
        ) : (
          <ul className="mt-4 space-y-6">
            {aliases.map((alias) => {
              const draft = addDrafts[alias.id] ?? { invite: "", label: "" };
              const activeDest = alias.destinations.find((d) => d.is_active);
              return (
                <li
                  key={alias.id}
                  className="border-b border-border pb-6 last:border-0"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="font-medium tracking-tight">
                        /j/{alias.slug}
                        {!alias.is_active ? (
                          <span className="ml-2 text-xs font-normal text-amber-700">
                            inactive
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[alias.brand, alias.client_name].filter(Boolean).join(" · ") ||
                          "No brand/client"}
                        {" · "}
                        <a
                          href={publicUrl(appOrigin, alias.slug)}
                          className="underline underline-offset-2"
                          target="_blank"
                          rel="noreferrer"
                        >
                          open link
                        </a>
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Last changed {formatWhen(alias.updated_at)}
                    </p>
                  </div>

                  <p className="mt-3 text-sm">
                    <span className="text-muted-foreground">Current destination: </span>
                    <code className="text-xs">
                      {alias.active_invite_code ?? "—"}
                    </code>
                    {activeDest?.label ? (
                      <span className="text-muted-foreground">
                        {" "}
                        ({activeDest.label})
                      </span>
                    ) : null}
                  </p>

                  <ul className="mt-3 space-y-2">
                    {alias.destinations.map((dest) => (
                      <li
                        key={dest.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm"
                      >
                        <div className="min-w-0">
                          <span className="font-medium">
                            {dest.label || "Group"}
                          </span>
                          <code className="ml-2 text-xs text-muted-foreground">
                            {dest.invite_code}
                          </code>
                          {dest.is_active ? (
                            <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-emerald-700">
                              <Check className="h-3 w-3" aria-hidden />
                              active
                              {dest.activated_at
                                ? ` · since ${formatWhen(dest.activated_at)}`
                                : null}
                            </span>
                          ) : null}
                        </div>
                        {!dest.is_active ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => activate(alias.id, dest.id)}
                            className="rounded-md border border-input px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                          >
                            Make active
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <label className="block min-w-[12rem] flex-1 text-xs">
                      <span className="text-muted-foreground">Stage next group</span>
                      <input
                        value={draft.invite}
                        onChange={(e) =>
                          setAddDrafts((prev) => ({
                            ...prev,
                            [alias.id]: { ...draft, invite: e.target.value },
                          }))
                        }
                        placeholder="Invite code or URL"
                        className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="block w-28 text-xs">
                      <span className="text-muted-foreground">Label</span>
                      <input
                        value={draft.label}
                        onChange={(e) =>
                          setAddDrafts((prev) => ({
                            ...prev,
                            [alias.id]: { ...draft, label: e.target.value },
                          }))
                        }
                        placeholder={`Group ${alias.destinations.length + 1}`}
                        className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => addDestination(alias.id)}
                      className="rounded-md border border-input px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>

                  {alias.notes ? (
                    <p className="mt-2 text-xs text-muted-foreground">{alias.notes}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
