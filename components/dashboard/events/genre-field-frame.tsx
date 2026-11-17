"use client";

import { useState } from "react";

import { GenreField } from "@/components/dashboard/events/genre-field";
import type { GenreFamilyKey, GenreSuggestion } from "@/lib/learning/genre/families";

/** Frames G1–G2: the Genre field with local state, nothing saved. */
export function GenreFieldFrame(props: { value: GenreFamilyKey | null; suggestion: GenreSuggestion | null; openList: boolean }) {
  const [value, setValue] = useState(props.value);
  return <GenreField value={value} onChange={setValue} suggestion={props.suggestion} openList={props.openList} />;
}
