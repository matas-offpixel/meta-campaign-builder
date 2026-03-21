"use client";

import { type InputHTMLAttributes, forwardRef } from "react";
import { Check } from "lucide-react";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className = "", label, id, checked, onChange, ...props }, ref) => {
    return (
      <label
        htmlFor={id}
        className={`inline-flex cursor-pointer items-center gap-2 text-sm ${className}`}
      >
        <div className="relative">
          <input
            ref={ref}
            type="checkbox"
            id={id}
            checked={checked}
            onChange={onChange}
            className="peer sr-only"
            {...props}
          />
          <div
            className="flex h-4.5 w-4.5 items-center justify-center rounded border border-border-strong
              peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
          >
            {checked && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
          </div>
        </div>
        {label && <span className="text-foreground">{label}</span>}
      </label>
    );
  }
);

Checkbox.displayName = "Checkbox";
