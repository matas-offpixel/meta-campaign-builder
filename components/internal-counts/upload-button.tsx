"use client";

/**
 * R1a: "Upload a count PDF" as a text button. Picking a file submits it to
 * the same parser as the pull; no raw file input shows.
 */

import { useRef } from "react";

export function UploadCountPdfButton({ className }: { className: string }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action="/api/internal-counts/upload" method="post" encType="multipart/form-data">
      <label className={`${className} cursor-pointer`}>
        Upload a count PDF
        <input
          name="file"
          type="file"
          accept="application/pdf"
          className="sr-only"
          onChange={(e) => {
            if (e.currentTarget.files?.length) form.current?.requestSubmit();
          }}
        />
      </label>
    </form>
  );
}
