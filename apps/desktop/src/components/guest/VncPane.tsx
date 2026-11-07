import { useEffect, useRef } from "react";
import type RFB from "@novnc/novnc";
import { displayWsUrl } from "@/lib/api";

export function VncPane({ vmId, onFail }: { vmId: string; onFail: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const fail = useRef(onFail);
  fail.current = onFail;

  useEffect(() => {
    const target = host.current;
    if (!target) return;
    let cancelled = false;
    let rfb: RFB | undefined;

    void import("@novnc/novnc").then(({ default: RFBClient }) => {
      if (cancelled || host.current !== target) return;
      const session = new RFBClient(target, displayWsUrl(vmId));
      if (cancelled) {
        try {
          session.disconnect();
        } catch {
          /* already torn down */
        }
        return;
      }
      rfb = session;
      session.scaleViewport = true;
      session.clipViewport = true;
      session.background =
        getComputedStyle(document.documentElement).getPropertyValue("--desktop").trim() ||
        "#0b0d12";
      session.addEventListener("connect", () => {
        const canvas = target.querySelector("canvas");
        canvas?.focus({ preventScroll: true });
      });
      session.addEventListener("disconnect", (ev) => {
        if (!cancelled && !ev.detail?.clean) fail.current();
      });
      session.addEventListener("securityfailure", () => {
        if (!cancelled) fail.current();
      });
    });

    return () => {
      cancelled = true;
      try {
        rfb?.disconnect();
      } catch {
        /* already torn down */
      }
    };
  }, [vmId]);

  return <div ref={host} className="vnc-surface" />;
}
