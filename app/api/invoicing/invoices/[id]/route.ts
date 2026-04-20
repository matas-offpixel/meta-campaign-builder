import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  buildInvoicePatch,
  getInvoiceById,
  updateInvoice,
} from "@/lib/db/invoicing-server";
import type { InvoiceStatus } from "@/lib/types/invoicing";

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/invoicing/invoices/[id]
//
// Allowed fields: status, issued_date, due_date, paid_date, notes,
// invoice_number.
//
// Status transitions:
//   draft → sent | cancelled
//   sent  → paid | overdue | cancelled
//   paid / overdue / cancelled → cancelled (lets users undo accidental edits)
//
// invoice_number is manually entered post-creation. Pass an empty string
// or null to clear it. Format is enforced as INV-XXXX (1–6 digit suffix).
// ─────────────────────────────────────────────────────────────────────────────

const INVOICE_NUMBER_PATTERN = /^INV-\d{1,6}$/;

const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["sent", "cancelled"],
  sent: ["paid", "overdue", "cancelled"],
  paid: ["cancelled"],
  overdue: ["paid", "cancelled"],
  cancelled: [],
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const existing = await getInvoiceById(id);
  if (!existing || existing.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Body must be a JSON object" },
      { status: 400 },
    );
  }

  const patch = buildInvoicePatch(body as Record<string, unknown>);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No updatable fields. Allowed: status, issued_date, due_date, paid_date, notes, invoice_number.",
      },
      { status: 400 },
    );
  }

  if ("invoice_number" in patch) {
    const raw = patch.invoice_number;
    if (raw == null || (typeof raw === "string" && raw.trim() === "")) {
      patch.invoice_number = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!INVOICE_NUMBER_PATTERN.test(trimmed)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "invoice_number must look like INV-0029 (INV- prefix + up to 6 digits).",
          },
          { status: 400 },
        );
      }
      patch.invoice_number = trimmed;
    } else {
      return NextResponse.json(
        { ok: false, error: "invoice_number must be a string or null." },
        { status: 400 },
      );
    }
  }

  if (patch.status) {
    const next = patch.status as InvoiceStatus;
    const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(next) && next !== existing.status) {
      return NextResponse.json(
        {
          ok: false,
          error: `Cannot transition ${existing.status} → ${next}.`,
        },
        { status: 400 },
      );
    }
    // Convenience side-effects so the UI can flip status without also
    // sending the date — keeps the inline "Mark sent / paid" buttons trivial.
    if (next === "sent" && !patch.issued_date && !existing.issued_date) {
      patch.issued_date = new Date().toISOString().slice(0, 10);
    }
    if (next === "paid" && !patch.paid_date && !existing.paid_date) {
      patch.paid_date = new Date().toISOString().slice(0, 10);
    }
  }

  try {
    const updated = await updateInvoice(id, patch);
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "Update returned no row" },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, invoice: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed.";
    // Postgres unique-violation when a typed-in INV-0029 collides with
    // another invoice's number — surface a clean 409 instead of 500.
    const isUniqueClash =
      /duplicate key value|invoices_invoice_number/i.test(message);
    return NextResponse.json(
      {
        ok: false,
        error: isUniqueClash
          ? "That invoice number is already in use on another invoice."
          : message,
      },
      { status: isUniqueClash ? 409 : 500 },
    );
  }
}
