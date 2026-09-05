"use client";

import { useEffect, useState } from "react";
import { EMOJI_LIST, GIF_PACK, STICKER_PACK, searchGifs, type PickerAsset } from "@/lib/picker-assets";
import { LazyImage } from "./lazy-image";

type Tab = "emoji" | "gif" | "sticker";

export function Picker(props: {
  onClose: () => void;
  onPickEmoji: (emoji: string) => void;
  onPickAsset: (asset: PickerAsset, type: "GIF" | "STICKER") => void;
}) {
  const [tab, setTab] = useState<Tab>("gif");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") props.onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gifResults: PickerAsset[] = tab === "gif" ? searchGifs(debouncedQuery) : [];

  return (
    <div className="flex h-[45vh] flex-col border-t border-border bg-background md:h-80">
      <div className="flex border-b border-border">
        {(["emoji", "gif", "sticker"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-sm capitalize focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
              tab === t ? "border-b-2 border-accent font-medium text-foreground" : "text-muted"
            }`}
          >
            {t}
          </button>
        ))}
        <button onClick={props.onClose} aria-label="Close picker" className="px-4 text-muted hover:text-foreground">
          ✕
        </button>
      </div>

      {tab === "gif" && (
        <div className="flex flex-1 min-h-0 flex-col">
          <div className="p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search GIFs"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
            <div className="columns-2 gap-2">
              {gifResults.map((g) => (
                <button
                  key={g.url}
                  onClick={() => props.onPickAsset(g, "GIF")}
                  className="mb-2 block w-full break-inside-avoid focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <LazyImage src={g.url} width={g.width} height={g.height} alt="" className="w-full rounded-lg" />
                </button>
              ))}
              {gifResults.length === 0 && <p className="col-span-2 py-6 text-center text-sm text-muted">No GIFs found</p>}
            </div>
          </div>
        </div>
      )}

      {tab === "sticker" && (
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          <div className="grid grid-cols-4 gap-2">
            {STICKER_PACK.map((s) => (
              <button
                key={s.url}
                onClick={() => props.onPickAsset(s, "STICKER")}
                className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <LazyImage src={s.url} width={s.width} height={s.height} alt="" className="w-full rounded-lg" />
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "emoji" && (
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          <div className="grid grid-cols-8 gap-1">
            {EMOJI_LIST.map((e) => (
              <button
                key={e}
                onClick={() => props.onPickEmoji(e)}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-xl hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
