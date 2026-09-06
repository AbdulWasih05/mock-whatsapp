// The message state machine, visible: sending (0.6 opacity bubble, no
// tick) → sent (single tick) → delivered (double tick) → read (double
// tick, accent). 150ms fade between states (CLAUDE.md §8).
export type TickStatus = "sending" | "sent" | "delivered" | "read" | "failed";

// One checkmark glyph, drawn once or twice. Sharing the path keeps the two
// states the same weight and size, so sent → delivered reads as a second
// tick sliding in rather than the mark changing shape.
const CHECK = "M1 5L4.5 8.5L10 2";
const CHECK_OFFSET = 5;

export function Ticks(props: { status: TickStatus }) {
  if (props.status === "sending" || props.status === "failed") return null;

  const doubleTick = props.status === "delivered" || props.status === "read";
  const colorClass = props.status === "read" ? "text-accent" : "text-muted-2";

  return (
    <svg
      width={doubleTick ? 16 : 11}
      height="10"
      viewBox={doubleTick ? "0 0 16 10" : "0 0 11 10"}
      fill="none"
      className={`shrink-0 transition-colors duration-150 ${colorClass}`}
    >
      {/* Rear tick first so the front one overlaps it, as in the familiar mark. */}
      {doubleTick && (
        <path
          d={CHECK}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <path
        d={CHECK}
        transform={doubleTick ? `translate(${CHECK_OFFSET} 0)` : undefined}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
