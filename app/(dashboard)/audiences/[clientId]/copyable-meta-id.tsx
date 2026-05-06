"use client";

import { useState } from "react";

export function CopyableMetaId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(id);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className="text-xs text-primary-hover hover:underline"
      title={id}
    >
      {copied ? "Copied" : `${id.slice(0, 8)}...${id.slice(-4)}`}
    </button>
  );
}
