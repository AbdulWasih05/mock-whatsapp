"use client";

import { useEffect, useRef, useState } from "react";

// IntersectionObserver-based lazy load (CLAUDE.md §6/§8) for picker grids —
// width/height are always known up front, so reserving the box never
// causes layout shift even before the image is in view.
export function LazyImage(props: { src: string; width: number; height: number; alt: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: props.width, height: props.height }} className={`bg-surface ${props.className ?? ""}`}>
      {visible && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={props.src} alt={props.alt} width={props.width} height={props.height} className="h-full w-full object-cover" />
      )}
    </div>
  );
}
