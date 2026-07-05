import type { ReactNode } from "react";

/**
 * components/admin/ui/section.tsx
 *
 * Hairline-separated content sections + metric stats for the OP909 admin
 * dashboard. Replaces the old bordered/rounded card containers: a section
 * is an uppercase mono eyebrow sitting above a 0.5px black hairline, then
 * content. No bg, no border box, no radius.
 */

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 border-b-[0.5px] border-black pb-2">
      <span className="admin-eyebrow">{title}</span>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-10 first:mt-0">
      <SectionHeader title={title} action={action} />
      <div className="pt-5">{children}</div>
    </section>
  );
}

/**
 * A single metric: uppercase mono label above a Futura Bold Italic number
 * in the client accent. No card — laid out inside MetricGrid, which draws
 * 0.5px hairlines BETWEEN stats (not around them).
 */
export function MetricStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="px-5 py-4 first:pl-0">
      <p className="font-[family-name:var(--admin-mono)] text-[10px] uppercase tracking-[1.5px] text-[#666]">
        {label}
      </p>
      <p
        className="admin-heading mt-2 text-[32px] leading-none"
        style={{ color: accent ?? "var(--admin-accent)" }}
      >
        {value}
      </p>
    </div>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] divide-x-[0.5px] divide-black border-y-[0.5px] border-black">
      {children}
    </div>
  );
}
