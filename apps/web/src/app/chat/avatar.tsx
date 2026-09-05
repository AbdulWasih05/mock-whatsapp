export function Avatar(props: { name: string; online?: boolean; size?: number }) {
  const size = props.size ?? 40;
  const initial = props.name.charAt(0).toUpperCase();

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="flex h-full w-full items-center justify-center rounded-full bg-border font-semibold text-muted"
        style={{ fontSize: size * 0.4 }}
      >
        {initial}
      </div>
      {props.online !== undefined && (
        <span
          className={`absolute bottom-0 right-0 rounded-full ring-2 ring-background ${
            props.online ? "bg-green-500" : "bg-muted-2"
          }`}
          style={{ width: size * 0.28, height: size * 0.28 }}
        />
      )}
    </div>
  );
}
