"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

interface CopyToClipboardProps {
  text: string;
  children: ReactNode;
  className?: string;
  title?: string;
  ariaLabel?: string;
}

export function CopyToClipboard({
  text,
  children,
  className,
  title,
  ariaLabel,
}: CopyToClipboardProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={async (event) => {
          event.stopPropagation();
          await copyText(text);
          setCopied(true);
        }}
        className={className}
        title={title ?? `Copy: ${text}`}
        aria-label={ariaLabel ?? `Copy ${text}`}
      >
        {children}
      </button>
      {copied ? (
        <span
          role="status"
          className="absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded bg-foreground px-2 py-1 text-[11px] font-medium text-background shadow"
        >
          Copied to clipboard
        </span>
      ) : null}
    </span>
  );
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.top = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
}
