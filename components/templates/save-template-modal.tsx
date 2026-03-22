"use client";

import { useState, useRef, useEffect } from "react";
import { X, Tag, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SaveTemplateModalProps {
  open: boolean;
  saving?: boolean;
  onClose: () => void;
  onSave: (name: string, description: string, tags: string[]) => void;
}

export function SaveTemplateModal({ open, saving = false, onClose, onSave }: SaveTemplateModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setTags([]);
      setTagInput("");
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const addTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput("");
  };

  const removeTag = (tag: string) => setTags(tags.filter((t) => t !== tag));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (tagInput.trim()) {
        addTag();
      } else if (name.trim()) {
        onSave(name.trim(), description.trim(), tags);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-md border border-border bg-background p-6 shadow-md">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-heading text-xl tracking-wide">Save as Template</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <Input
            ref={nameRef}
            label="Template Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Premium Event — Purchase"
            onKeyDown={handleKeyDown}
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes about this template..."
              rows={2}
              className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground
                placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring
                resize-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Tags</label>
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addTag(); }
                }}
                placeholder="Add tag..."
                className="h-9 flex-1 rounded-md border border-border-strong bg-background px-3 text-sm text-foreground
                  placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button variant="outline" size="sm" onClick={addTag} disabled={!tagInput.trim()}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-primary/15 text-foreground"
                  >
                    <Tag className="h-2.5 w-2.5" />
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="ml-0.5 rounded-full hover:bg-foreground/10"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            onClick={() => onSave(name.trim(), description.trim(), tags)}
            disabled={!name.trim() || saving}
          >
            {saving ? "Saving…" : "Save Template"}
          </Button>
        </div>
      </div>
    </div>
  );
}
