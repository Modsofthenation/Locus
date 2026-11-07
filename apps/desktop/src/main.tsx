import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "@/components/layout/CrashScreen";
import { initPhoneAuth } from "@/lib/phoneAuth";
import { initUiShell } from "@/lib/mobileShell";
import "./index.css";

initPhoneAuth();
initUiShell();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
