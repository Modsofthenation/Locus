import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "@/components/layout/CrashScreen";
import { initPhoneAuth } from "@/lib/phoneAuth";
import { initUiShell } from "@/lib/mobileShell";
import "./index.css";
import "./styles/phone.css";
import "./styles/swarm.css";
import "./styles/ux.css";

initPhoneAuth();
initUiShell();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
