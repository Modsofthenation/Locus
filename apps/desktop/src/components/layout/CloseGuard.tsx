import { useEffect, useRef, useState } from "react";
import { activeAgents, desktopBridge, shouldConfirmClose } from "@/lib/closeGuard";
import { useStore } from "@/state/store";
import { CloseConfirmModal } from "./CloseConfirmModal";

export function CloseGuard() {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const sessionsRef = useRef(state.sessions);
  sessionsRef.current = state.sessions;
  const armed = shouldConfirmClose(state.sessions);

  useEffect(() => {
    desktopBridge()?.setCloseGuard(armed);
  }, [armed]);

  useEffect(() => {
    return () => desktopBridge()?.setCloseGuard(false);
  }, []);

  useEffect(() => {
    const desktop = desktopBridge();
    if (!desktop) return;
    return desktop.onCloseRequested(() => {
      desktop.ackClosePrompt();
      if (shouldConfirmClose(sessionsRef.current)) {
        setOpen(true);
        return;
      }
      desktop.confirmClose();
    });
  }, []);

  if (!open) return null;
  return (
    <CloseConfirmModal
      agents={activeAgents(state.sessions)}
      onCancel={() => setOpen(false)}
      onConfirm={() => {
        setOpen(false);
        desktopBridge()?.confirmClose();
      }}
    />
  );
}
