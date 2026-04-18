"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createClient as createSupabase } from "@/lib/supabase/client";
import {
  type ClientRow,
  type ClientType,
  CLIENT_TYPES,
  CLIENT_STATUSES,
  type ClientStatus,
  createClientRow,
  updateClientRow,
  slugify,
} from "@/lib/db/clients";

type Mode = "create" | "edit";

interface Props {
  mode: Mode;
  initial?: ClientRow;
}

const TYPE_OPTIONS = CLIENT_TYPES.map((t) => ({
  value: t,
  label: t.charAt(0).toUpperCase() + t.slice(1),
}));

const STATUS_OPTIONS = CLIENT_STATUSES.map((s) => ({
  value: s,
  label: s.charAt(0).toUpperCase() + s.slice(1),
}));

export function ClientForm({ mode, initial }: Props) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(initial?.slug));
  const [primaryType, setPrimaryType] = useState<ClientType>(
    (initial?.primary_type as ClientType | undefined) ?? "promoter",
  );
  const [types, setTypes] = useState<ClientType[]>(
    (initial?.types as ClientType[] | undefined) ?? [],
  );
  const [status, setStatus] = useState<ClientStatus>(
    (initial?.status as ClientStatus | undefined) ?? "active",
  );
  const [contactName, setContactName] = useState(initial?.contact_name ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.contact_email ?? "");
  const [contactWhatsapp, setContactWhatsapp] = useState(
    initial?.contact_whatsapp ?? "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  useEffect(() => {
    async function init() {
      const supabase = createSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
    }
    init();
  }, []);

  // Auto-fill slug from name until user edits it explicitly
  useEffect(() => {
    if (mode === "create" && !slugTouched) {
      setSlug(slugify(name));
    }
  }, [name, slugTouched, mode]);

  const toggleType = (t: ClientType) => {
    setTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId && mode === "create") {
      setError("Not signed in.");
      return;
    }
    setSubmitting(true);
    setError(null);

    // Ensure primary_type is part of types[]
    const finalTypes = Array.from(new Set([primaryType, ...types]));

    try {
      if (mode === "create" && userId) {
        const created = await createClientRow({
          user_id: userId,
          name: name.trim(),
          slug: slug || slugify(name),
          primary_type: primaryType,
          types: finalTypes,
          status,
          contact_name: contactName || null,
          contact_email: contactEmail || null,
          contact_whatsapp: contactWhatsapp || null,
          notes: notes || null,
        });
        if (created) router.push(`/clients/${created.id}`);
      } else if (mode === "edit" && initial) {
        await updateClientRow(initial.id, {
          name: name.trim(),
          slug: slug || slugify(name),
          primary_type: primaryType,
          types: finalTypes,
          status,
          contact_name: contactName || null,
          contact_email: contactEmail || null,
          contact_whatsapp: contactWhatsapp || null,
          notes: notes || null,
        });
        router.push(`/clients/${initial.id}`);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save client.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          id="client-name"
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Louder, Jackies, Junction 2"
        />
        <Input
          id="client-slug"
          label="Slug"
          required
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTouched(true);
          }}
          placeholder="louder"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          id="client-primary-type"
          label="Primary type"
          value={primaryType}
          onChange={(e) => setPrimaryType(e.target.value as ClientType)}
          options={TYPE_OPTIONS}
        />
        <Select
          id="client-status"
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as ClientStatus)}
          options={STATUS_OPTIONS}
        />
      </div>

      <div>
        <p className="text-sm font-medium text-foreground mb-1.5">
          Additional types
        </p>
        <p className="text-xs text-muted-foreground mb-2">
          Select any extra roles this client spans (a venue can also promote,
          etc).
        </p>
        <div className="flex flex-wrap gap-1.5">
          {CLIENT_TYPES.map((t) => {
            const checked = types.includes(t) || primaryType === t;
            const isPrimary = primaryType === t;
            return (
              <button
                key={t}
                type="button"
                disabled={isPrimary}
                onClick={() => toggleType(t)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors
                  ${
                    checked
                      ? "bg-primary-light text-foreground border border-border-strong"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }
                  ${isPrimary ? "cursor-default opacity-60" : ""}`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {isPrimary && " · primary"}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Input
          id="client-contact-name"
          label="Contact name"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
        />
        <Input
          id="client-contact-email"
          label="Contact email"
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
        />
        <Input
          id="client-contact-whatsapp"
          label="Contact WhatsApp"
          value={contactWhatsapp}
          onChange={(e) => setContactWhatsapp(e.target.value)}
          placeholder="+44…"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="client-notes" className="text-sm font-medium">
          Notes
        </label>
        <textarea
          id="client-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm
            focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={submitting || !name.trim()}>
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {mode === "create" ? "Create client" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
