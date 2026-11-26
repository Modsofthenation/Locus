export type InterfaceMode = "lite" | "full";

const INTERFACE_MODE_KEY = "locus.interfaceMode";

export function loadInterfaceMode(): InterfaceMode {
  try {
    return window.localStorage.getItem(INTERFACE_MODE_KEY) === "full" ? "full" : "lite";
  } catch {
    return "lite";
  }
}

export function saveInterfaceMode(mode: InterfaceMode): void {
  try {
    window.localStorage.setItem(INTERFACE_MODE_KEY, mode);
  } catch {
    // The interface can still switch when storage is unavailable.
  }
}
