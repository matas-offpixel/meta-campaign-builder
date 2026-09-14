"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TikTokImportPicker } from "@/components/tiktok/tiktok-import-picker";

export function TikTokImportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Download className="h-3.5 w-3.5" />
        Import from TikTok
      </Button>
      <TikTokImportPicker open={open} onClose={() => setOpen(false)} />
    </>
  );
}
