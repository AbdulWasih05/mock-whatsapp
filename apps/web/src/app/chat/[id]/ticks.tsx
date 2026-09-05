// The message state machine, visible: sending (0.6 opacity bubble, no
// tick) → sent (single tick) → delivered (double tick) → read (double
// tick, accent). 150ms fade between states (CLAUDE.md §8).
export type TickStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export function Ticks(props: { status: TickStatus }) {
  if (props.status === "sending" || props.status === "failed") return null;

  const doubleTick = props.status === "delivered" || props.status === "read";
  const colorClass = props.status === "read" ? "text-accent" : "text-muted-2";

  return (
    <svg
      width={doubleTick ? 18 : 14}
      height="10"
      viewBox={doubleTick ? "0 0 18 10" : "0 0 14 10"}
      fill="none"
      className={`shrink-0 transition-colors duration-150 ${colorClass}`}
    >
      {doubleTick ? (
        <>
          <path d="M1 5L5 9L10 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 5L9 9L18 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <path d="M1 5L5 9L13 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}
