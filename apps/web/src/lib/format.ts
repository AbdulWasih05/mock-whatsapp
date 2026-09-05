const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// A fixed locale, not `undefined` — these run during SSR (Node's ICU/OS
// locale) and again on hydration (the browser's locale). A mismatch as
// small as "6:33 PM" vs "6:33 pm" is a real hydration error, not cosmetic.
const LOCALE = "en-US";

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatListTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (isSameDay(date, now)) {
    return date.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Yesterday";

  const daysAgo = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (daysAgo < 7) return WEEKDAYS[date.getDay()]!;
  return date.toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
}

export function formatDayDivider(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (isSameDay(date, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(LOCALE, { weekday: "long", month: "short", day: "numeric" });
}

export function formatBubbleTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
}
