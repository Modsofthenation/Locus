import type { ToolResult } from "./types.js";

export const CDP_CAPABILITY_OBSERVATION = ["browser_snapshot", "screenshot"] as const;
export const CDP_CAPABILITY_ACTIONS = [
  "browser_action",
  "browser_click",
  "browser_type",
  "key",
] as const;

/** Shared computer_capabilities payload for Host and Docker CDP adapters. */
export function computerCapabilitiesResult(input: {
  browser: boolean;
  nativeDesktop?: boolean;
  note: string;
}): ToolResult {
  return {
    ok: true,
    output: JSON.stringify({
      backend: "cdp",
      browser: input.browser,
      nativeDesktop: input.nativeDesktop ?? false,
      observation: [...CDP_CAPABILITY_OBSERVATION],
      actions: [...CDP_CAPABILITY_ACTIONS],
      note: input.note,
    }),
  };
}
