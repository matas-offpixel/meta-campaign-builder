"use client";

import { useState } from "react";

import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { postedLabel } from "@/lib/creative-lab/voice-fixtures";
import type { CardVoicePage } from "@/lib/creative-lab/voice-store";
import { traitRows, voiceChipLabel, VOICE_FLOOR } from "@/lib/creative-lab/voice-traits";

type Save = (body: Record<string, unknown>) => Promise<{ ok: boolean; json: Record<string, unknown> } | undefined>;

export function VoicePanel({
  lab,
  angle,
  artistId,
  busy,
  onSave,
}: {
  lab: CreativeLabCardData;
  angle: string;
  artistId: string;
  busy: boolean;
  onSave: Save;
}) {
  const [open, setOpen] = useState(false);
  const artist = lab.voice?.artists.find((item) => item.id === artistId) ?? lab.voice?.artists[0] ?? null;
  const artistPage = angle === "artist_first_person";
  const page: CardVoicePage | null = artistPage ? artist : lab.voice?.promoter ?? null;
  const handle = page?.handle ?? null;
  const sampleN = page?.sampleN ?? 0;
  const error = page?.error ?? null;
  const label = !handle && artistPage
    ? "No posts read yet — Read posts"
    : voiceChipLabel({ handle, sampleN, error });
  const ready = sampleN >= VOICE_FLOOR && !error;
  const traits = page?.traits ? traitRows(page.traits, "wide") : [];
  const shown = (page?.exemplars ?? []).slice(0, 4);

  return (
    <div className="space-y-2">
      <button
        type="button"
        className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-sm ${ready ? "border-border bg-muted" : "border-dashed border-border text-muted-foreground"}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: ready ? "#B0607A" : "#A86B12" }} />
        {label}
      </button>
      {open ? (
        <div className="space-y-3 rounded border border-border bg-muted p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <b>{ready && handle ? `Sounds like @${handle}` : "House voice"}</b>
            <button type="button" className="text-muted-foreground" onClick={() => setOpen(false)}>Close</button>
          </div>
          {traits.length ? traits.map((row) => (
            <p key={row.label}><b>{row.label}.</b> {row.value} <span className="text-muted-foreground">{row.evidence}</span></p>
          )) : (
            <p>{sampleN > 0 && sampleN < VOICE_FLOOR
              ? `Not enough posts yet · ${sampleN} of ${VOICE_FLOOR}`
              : error || "No posts read yet — Read posts"}</p>
          )}
          {shown.map((sample) => (
            <p key={sample.permalink ?? sample.caption} className="whitespace-pre-line border-t border-border pt-2">
              {sample.caption}
              <span className="mt-1 block text-xs text-muted-foreground">{postedLabel(sample.postedAt)} · ♥ {sample.likes ?? 0}</span>
            </p>
          ))}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={lab.voice?.hashtagsEnabled === true}
              disabled={busy}
              onChange={(event) => void onSave({ action: "voiceHashtags", hashtags: event.target.checked })}
            />
            Write hashtags in the primary text
          </label>
          <button
            type="button"
            className="rounded border border-border px-2 py-1"
            disabled={busy}
            onClick={() => void onSave({
              action: "readVoice",
              pageKind: artistPage ? "artist" : "promoter",
              artistId: artistPage ? artistId : undefined,
            })}
          >
            {artistPage ? "Find clips" : "Read posts"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
