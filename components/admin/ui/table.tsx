import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

/**
 * components/admin/ui/table.tsx
 *
 * OP909 admin table system (Sprint 1, Goal 8), aligned with the fan-facing
 * LP + the Pages list rows: no zebra, no rounded card box, 0.5px black
 * hairline between rows, mono 12px cells with 14px vertical padding, and an
 * uppercase mono eyebrow header. Hover changes text colour only (no bg fill).
 *
 * Composable, presentational, server-safe (no "use client"): drop
 * <AdminTable> around a <thead>/<tbody> built from <AdminTh>/<AdminTd> and
 * <AdminTr>. Small colored status pills stay (Supreme-approved) via
 * <AdminStatusPill>.
 */

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function AdminTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto border-y-[0.5px] border-black">
      <table className="w-full border-collapse text-left font-[family-name:var(--admin-mono)] text-[12px]">
        {children}
      </table>
    </div>
  );
}

type CellAlign = "left" | "right" | "center";

const ALIGN: Record<CellAlign, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function AdminTh({
  align = "left",
  className,
  children,
  ...rest
}: { align?: CellAlign } & ThHTMLAttributes<HTMLTableCellElement> & {
    children?: ReactNode;
  }) {
  return (
    <th
      className={cx(
        "border-b-[0.5px] border-black px-4 py-2.5 align-bottom text-[10px] font-normal uppercase tracking-[1.5px] text-[#666]",
        ALIGN[align],
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function AdminTr({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <tr className={cx("border-b-[0.5px] border-black last:border-b-0", className)}>
      {children}
    </tr>
  );
}

export function AdminTd({
  align = "left",
  className,
  children,
  ...rest
}: { align?: CellAlign } & TdHTMLAttributes<HTMLTableCellElement> & {
    children?: ReactNode;
  }) {
  return (
    <td
      className={cx(
        "px-4 py-3.5 align-middle text-black",
        ALIGN[align],
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}

/**
 * Small colored status pill — Supreme keeps these for "new"/status badges.
 * `tone` picks a soft bg + readable ink; falls back to neutral grey. Matches
 * the palette used by the Pages-list rows so both surfaces read the same.
 */
export type PillTone = "positive" | "warning" | "neutral" | "muted";

const PILL: Record<PillTone, string> = {
  positive: "bg-[#e8f5e9] text-[#1b5e20]",
  warning: "bg-[#fff8e1] text-[#8d6e00]",
  neutral: "bg-[#eef3ff] text-[#28407a]",
  muted: "bg-[#f0f0f0] text-[#666]",
};

export function AdminStatusPill({
  tone = "muted",
  children,
}: {
  tone?: PillTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex px-1.5 py-0.5 text-[10px] uppercase tracking-[0.5px]",
        PILL[tone],
      )}
    >
      {children}
    </span>
  );
}
