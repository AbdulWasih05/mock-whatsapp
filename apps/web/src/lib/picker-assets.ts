// Local sample packs standing in for a real Tenor/Giphy integration — no
// API key was available in this environment (see DECISIONS.md Phase 6).
// Swapping in real GIF search means replacing `searchGifs` below with a
// fetch to Tenor/Giphy's search endpoint; everything downstream (the grid,
// lazy loading, fixed-dimension sends) is provider-agnostic already.
export type PickerAsset = { url: string; width: number; height: number; tags: string[] };

export const GIF_PACK: PickerAsset[] = [
  { url: "/gifs/lol.gif", width: 200, height: 200, tags: ["lol", "laugh", "funny", "haha"] },
  { url: "/gifs/wow.gif", width: 200, height: 260, tags: ["wow", "surprised", "shock"] },
  { url: "/gifs/yes.gif", width: 160, height: 200, tags: ["yes", "agree", "ok"] },
  { url: "/gifs/no.gif", width: 200, height: 200, tags: ["no", "disagree", "nope"] },
  { url: "/gifs/clap.gif", width: 200, height: 240, tags: ["clap", "applause", "nice", "bravo"] },
  { url: "/gifs/thumbsup.gif", width: 200, height: 200, tags: ["thumbsup", "like", "good", "ok"] },
  { url: "/gifs/heart.gif", width: 160, height: 220, tags: ["heart", "love"] },
  { url: "/gifs/fire.gif", width: 200, height: 200, tags: ["fire", "lit", "hot", "cool"] },
  { url: "/gifs/cry.gif", width: 200, height: 260, tags: ["cry", "sad", "tears"] },
  { url: "/gifs/shrug.gif", width: 200, height: 200, tags: ["shrug", "idk", "whatever"] },
  { url: "/gifs/wave.gif", width: 160, height: 200, tags: ["wave", "hi", "hello", "bye"] },
  { url: "/gifs/party.gif", width: 200, height: 240, tags: ["party", "celebrate", "yay"] },
];

export const STICKER_PACK: PickerAsset[] = [
  { url: "/stickers/sticker-star.webp", width: 120, height: 120, tags: ["star"] },
  { url: "/stickers/sticker-heart.webp", width: 120, height: 120, tags: ["heart"] },
  { url: "/stickers/sticker-check.webp", width: 120, height: 120, tags: ["check", "done"] },
  { url: "/stickers/sticker-bolt.webp", width: 120, height: 120, tags: ["bolt", "fast"] },
  { url: "/stickers/sticker-flame.webp", width: 120, height: 120, tags: ["flame", "fire"] },
  { url: "/stickers/sticker-note.webp", width: 120, height: 120, tags: ["note", "music"] },
  { url: "/stickers/sticker-sun.webp", width: 120, height: 120, tags: ["sun"] },
  { url: "/stickers/sticker-moon.webp", width: 120, height: 120, tags: ["moon", "night"] },
];

export function searchGifs(query: string): PickerAsset[] {
  const q = query.trim().toLowerCase();
  if (!q) return GIF_PACK;
  return GIF_PACK.filter((g) => g.tags.some((t) => t.includes(q)));
}

export const EMOJI_LIST = [
  "😀", "😂", "😅", "😊", "😍", "🤔", "😎", "😭", "😡", "🙄",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "🤝", "✌️", "👋", "🤷",
  "❤️", "🔥", "🎉", "✨", "💯", "😴", "🥳", "😬", "🤯", "🫠",
];
