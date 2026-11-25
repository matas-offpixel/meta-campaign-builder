import { Fragment, type ReactNode } from "react";

/** "{n} ad sets", "1 ad set", "{n} of {m} ad sets", "{n} of 1 ad set". */
const COUNT = /\d+ of \d+ ad sets?|\d+ ad sets?/g;

/**
 * Design #1364: an ad set count never breaks from its unit. Each count is a
 * nowrap span, so the line wraps before it ("6" / "ad sets" never happens).
 */
export function keepCounts(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(COUNT)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <span key={at} className="whitespace-nowrap" data-count="">
        {m[0]}
      </span>,
    );
    last = at + m[0].length;
  }
  if (parts.length === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}
