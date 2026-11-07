import { useEffect, useRef } from "react";

export type MascotPose = "idle" | "think" | "rest" | "sad";

export const MASCOT_MAX_PX = 76;

const EYE_Y = 30.5;
const LOOK_MAX_X = 2.7;
const LOOK_MAX_Y = 2.3;
const LOOK_REACH_PX = 80;

export function Mascot(props: {
  pose?: MascotPose;
  size?: number;
  className?: string;
  title?: string;
  followCursor?: boolean;
}) {
  const pose = props.pose ?? "idle";
  const px = Math.min(Math.max(12, props.size ?? MASCOT_MAX_PX), MASCOT_MAX_PX);
  const labeled = Boolean(props.title);
  const svgRef = useRef<SVGSVGElement>(null);
  const tracking = Boolean(props.followCursor) && pose === "idle";

  useEffect(() => {
    if (!tracking) return;
    if (!svgRef.current) return;
    const svg: SVGSVGElement = svgRef.current;

    function clearLook() {
      svg.style.removeProperty("--mascot-look-x");
      svg.style.removeProperty("--mascot-look-y");
    }

    function onMove(event: PointerEvent | MouseEvent) {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
        clearLook();
        return;
      }
      const rect = svg.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const originX = rect.left + rect.width / 2;
      const originY = rect.top + rect.height * (EYE_Y / 76);
      const dx = event.clientX - originX;
      const dy = event.clientY - originY;
      const x = Math.max(-LOOK_MAX_X, Math.min(LOOK_MAX_X, (dx / LOOK_REACH_PX) * LOOK_MAX_X));
      const y = Math.max(-LOOK_MAX_Y, Math.min(LOOK_MAX_Y, (dy / LOOK_REACH_PX) * LOOK_MAX_Y));
      svg.style.setProperty("--mascot-look-x", `${x.toFixed(2)}px`);
      svg.style.setProperty("--mascot-look-y", `${y.toFixed(2)}px`);
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("blur", clearLook);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("blur", clearLook);
      clearLook();
    };
  }, [tracking]);

  return (
    <svg
      ref={svgRef}
      className={["mascot", props.className].filter(Boolean).join(" ")}
      data-pose={pose}
      data-follow-cursor={tracking ? "true" : undefined}
      data-testid="locus-mascot"
      width={px}
      height={px}
      viewBox="0 0 76 76"
      fill="none"
      role={labeled ? "img" : undefined}
      aria-label={props.title}
      aria-hidden={labeled ? undefined : true}
    >
      <g className="mascot-body">
        <g className="mascot-frame" fill="currentColor">
          <path d="M17 24V14.5A3.5 3.5 0 0 1 20.5 11H30v5.5H22.5V24H17Z" />
          <path d="M59 24V14.5A3.5 3.5 0 0 0 55.5 11H46v5.5h7.5V24H59Z" />
          <path d="M17 40v9.5A3.5 3.5 0 0 0 20.5 53H30v-5.5H22.5V40H17Z" />
          <path d="M59 40v9.5A3.5 3.5 0 0 1 55.5 53H46v-5.5h7.5V40H59Z" />
        </g>
        <g className="mascot-sparks" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path className="spark" d="M61.5 8.5 67 3.2" />
          <path className="spark" d="M63.2 13.8 70 10" />
          <path className="spark" d="M59.8 6.2 63.2 2.4" />
        </g>
        <g className="mascot-gaze">
          <g className="mascot-face pose-idle">
            <g className="mascot-eyes">
              {tracking ? (
                <>
                  <g className="eye mascot-eye-unit">
                    <circle className="mascot-eye-white" cx="32.5" cy="30.5" r="5.2" />
                    <circle className="mascot-pupil" cx="32.5" cy="30.5" r="2.4" />
                  </g>
                  <g className="eye mascot-eye-unit">
                    <circle className="mascot-eye-white" cx="43.5" cy="30.5" r="5.2" />
                    <circle className="mascot-pupil" cx="43.5" cy="30.5" r="2.4" />
                  </g>
                </>
              ) : (
                <>
                  <circle className="mascot-eye eye" cx="32.5" cy="30.5" r="3.4" />
                  <circle className="mascot-eye eye" cx="43.5" cy="30.5" r="3.4" />
                </>
              )}
            </g>
            <rect className="mascot-ink" x="34.2" y="38.2" width="7.6" height="2.3" rx="1.15" />
          </g>
          <g className="mascot-face pose-rest">
            <rect className="mascot-ink" x="27.8" y="28.9" width="9.4" height="3.2" rx="1.6" />
            <rect className="mascot-ink" x="38.8" y="28.9" width="9.4" height="3.2" rx="1.6" />
            <circle className="mascot-ink" cx="38" cy="39.2" r="2.7" />
          </g>
          <g className="mascot-face pose-sad">
            <circle className="mascot-eye" cx="32.5" cy="31.2" r="3.4" />
            <circle className="mascot-eye" cx="43.5" cy="31.2" r="3.4" />
            <path className="mascot-frown" d="M31.6 44.4c2.2-4.6 10.6-4.6 12.8 0" />
            <path
              className="mascot-ink mascot-tear"
              d="M49.2 33.6c0 0 3 4.4 3 6.2a3 3 0 1 1-6 0c0-1.8 3-6.2 3-6.2z"
            />
          </g>
        </g>
      </g>
      <g className="mascot-legs">
        <rect className="mascot-ink" x="31.2" y="54.5" width="3.4" height="9.5" rx="1.7" />
        <rect className="mascot-ink" x="41.4" y="54.5" width="3.4" height="9.5" rx="1.7" />
      </g>
    </svg>
  );
}
