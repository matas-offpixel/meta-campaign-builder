"use client";

import type { ReactNode } from "react";

interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onTabChange, className = "" }: TabsProps) {
  return (
    <div className={`flex gap-0 border-b border-border ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onTabChange(tab.id)}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors
            ${
              activeTab === tab.id
                ? "border-b-2 border-foreground text-foreground -mb-px"
                : "text-muted-foreground hover:text-foreground"
            }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs
                ${activeTab === tab.id ? "bg-primary/20 text-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

interface TabPanelProps {
  active: boolean;
  children: ReactNode;
}

export function TabPanel({ active, children }: TabPanelProps) {
  if (!active) return null;
  return <div>{children}</div>;
}
