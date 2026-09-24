/**
 * Option rows for Meta ad-account and pixel Comboboxes.
 *
 * The saved value is the id the `<select>` already stored. The label is the
 * account name; the id (both `act_` and bare) lives in sublabel + keywords
 * so the existing Combobox filter matches a pasted Ads Manager id.
 */

export const UNNAMED_ACCOUNT_LABEL = "Unnamed account";
export const UNNAMED_PIXEL_LABEL = "Unnamed pixel";

const READ_ONLY_RE = /\(read-only\)/i;

export type AccountPickerRow = {
  value: string;
  label: string;
  sublabel?: string;
  keywords?: string;
  disabled?: boolean;
  dimmed?: boolean;
};

export type AdAccountPickerInput = {
  id: string;
  name?: string | null;
  account_id?: string | null;
};

export type PixelPickerInput = {
  id: string;
  name?: string | null;
};

function bareId(id: string): string {
  return id.replace(/^act_/i, "");
}

function actId(id: string, accountId?: string | null): string {
  if (/^act_/i.test(id)) return id;
  const bare = (accountId ?? id).replace(/^act_/i, "");
  return `act_${bare}`;
}

function nameIsJustTheId(name: string, id: string, accountId?: string | null): boolean {
  const stripped = name.replace(READ_ONLY_RE, "").trim();
  if (!stripped) return true;
  const bare = bareId(id).toLowerCase();
  const forms = new Set(
    [id, bare, accountId ?? "", accountId ? `act_${accountId.replace(/^act_/i, "")}` : "", `act_${bare}`]
      .filter(Boolean)
      .map((form) => form.toLowerCase()),
  );
  return forms.has(stripped.toLowerCase());
}

function idSublabel(idLine: string, unnamed: boolean, readOnly: boolean): string {
  if (unnamed && readOnly) return `${idLine} · (Read-Only)`;
  return idLine;
}

/**
 * Alphabetical by name. Unnamed accounts last, then by id.
 * `(Read-Only)` stays on the row: in the name when Meta put it there,
 * otherwise on the sublabel of an unnamed account.
 */
export function metaAdAccountPickerOptions<T extends AdAccountPickerInput>(
  accounts: readonly T[],
  extra?: (account: T) => {
    sublabel?: string;
    disabled?: boolean;
    dimmed?: boolean;
  },
): AccountPickerRow[] {
  const rows = accounts.map((account) => {
    const name = (account.name ?? "").trim();
    const readOnly = READ_ONLY_RE.test(name);
    const unnamed = nameIsJustTheId(name, account.id, account.account_id);
    const label = unnamed ? UNNAMED_ACCOUNT_LABEL : name;
    const idLine = actId(account.id, account.account_id);
    const more = extra?.(account)?.sublabel?.trim();
    const sublabel = [idSublabel(idLine, unnamed, readOnly), more]
      .filter(Boolean)
      .join(" · ");
    const numeric = bareId(account.account_id || account.id);
    const keywords = [name, account.id, idLine, numeric, readOnly ? "read-only" : ""]
      .filter(Boolean)
      .join(" ");
    return {
      value: account.id,
      label,
      sublabel: sublabel || undefined,
      keywords,
      disabled: extra?.(account)?.disabled,
      dimmed: extra?.(account)?.dimmed,
      unnamed,
    };
  });

  rows.sort((a, b) => {
    if (a.unnamed !== b.unnamed) return a.unnamed ? 1 : -1;
    const byName = a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    if (byName !== 0) return byName;
    return a.value.localeCompare(b.value);
  });

  return rows.map(({ unnamed: _unnamed, ...row }) => row);
}

export function metaPixelPickerOptions(pixels: readonly PixelPickerInput[]): AccountPickerRow[] {
  const rows = pixels.map((pixel) => {
    const name = (pixel.name ?? "").trim();
    const unnamed = !name || name.toLowerCase() === pixel.id.toLowerCase();
    return {
      value: pixel.id,
      label: unnamed ? UNNAMED_PIXEL_LABEL : name,
      sublabel: pixel.id,
      keywords: [name, pixel.id].filter(Boolean).join(" "),
      unnamed,
    };
  });
  rows.sort((a, b) => {
    if (a.unnamed !== b.unnamed) return a.unnamed ? 1 : -1;
    const byName = a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    if (byName !== 0) return byName;
    return a.value.localeCompare(b.value);
  });
  return rows.map(({ unnamed: _unnamed, ...row }) => row);
}

/** Same haystack as `components/ui/combobox.tsx` (label + sublabel + value + keywords). */
export function pickerOptionMatches(option: AccountPickerRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    option.label.toLowerCase().includes(q) ||
    option.value.toLowerCase().includes(q) ||
    (option.sublabel?.toLowerCase().includes(q) ?? false) ||
    (option.keywords?.toLowerCase().includes(q) ?? false)
  );
}
