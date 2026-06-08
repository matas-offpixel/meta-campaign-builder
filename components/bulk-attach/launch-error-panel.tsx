"use client";

import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

interface LaunchErrorPanelProps {
  message: string;
  details?: string[];
  onBackToCreatives?: () => void;
}

export function LaunchErrorPanel({
  message,
  details = [],
  onBackToCreatives,
}: LaunchErrorPanelProps) {
  return (
    <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{message}</p>
          {details.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
              {details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {onBackToCreatives && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 border-destructive/30 text-destructive hover:bg-destructive/10"
          onClick={onBackToCreatives}
        >
          Back to Configure Creatives
        </Button>
      )}
    </div>
  );
}
