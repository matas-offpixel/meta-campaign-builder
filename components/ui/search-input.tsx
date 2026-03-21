"use client";

import { type InputHTMLAttributes, forwardRef } from "react";
import { Search } from "lucide-react";

interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  onClear?: () => void;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className = "", value, onClear, ...props }, ref) => {
    return (
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={ref}
          type="search"
          value={value}
          className={`h-9 w-full rounded-md border border-border-strong bg-background pl-9 pr-3 text-sm text-foreground
            placeholder:text-muted-foreground
            focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring
            ${className}`}
          {...props}
        />
        {value && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        )}
      </div>
    );
  }
);

SearchInput.displayName = "SearchInput";
