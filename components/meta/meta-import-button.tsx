"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MetaImportPicker } from "@/components/meta/meta-import-picker";

export function MetaImportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Download className="h-3.5 w-3.5" />
        Import from Meta
      </Button>
      <MetaImportPicker open={open} onClose={() => setOpen(false)} />
    </>
  );
}
