import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { canvasFitScale } from "@/lib/mobileShell";

export function MobileFitPane(props: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const prev = el.style.zoom;
      el.style.zoom = "1";
      const next = canvasFitScale(el.clientWidth, el.scrollWidth);
      el.style.zoom = prev;
      setScale((current) => (Math.abs(current - next) < 0.02 ? current : next));
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [props.children]);

  const style: CSSProperties | undefined =
    scale < 1 ? ({ zoom: String(scale) } as CSSProperties) : undefined;

  return (
    <div
      ref={ref}
      className={["mobile-fit", props.className].filter(Boolean).join(" ")}
      data-testid="mobile-fit"
      data-scale={scale < 1 ? scale.toFixed(2) : undefined}
      style={style}
    >
      {props.children}
    </div>
  );
}
