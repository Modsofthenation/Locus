import type { Dispatch } from "react";
import {
  parseProductMode,
  surfaceForProductMode,
  type AgentSession,
  type LocusConfig,
  type ProductMode,
  type SetupStatus,
} from "@locus/shared";
import { api } from "@/lib/api";
import { loadLastAgent, resolveAgentDefaults } from "@/lib/lastAgent";
import { openSettings, type Action } from "@/state/store";

/** A provider that can answer chat. The sample task needs nothing else (it runs on Host). */
export function sampleTaskReady(
  setup: SetupStatus | null | undefined,
  config: LocusConfig | null | undefined,
): boolean {
  return setup?.hasProvider ?? Boolean(config?.providers.some((row) => row.enabled));
}

/** Close the wizard if it is open and land on Settings → Providers. */
export function openProviderSettings(dispatch: Dispatch<Action>): void {
  dispatch({ type: "setupOpen", open: false });
  openSettings(dispatch, "providers");
}

/** Start the bundled sample task and select the new agent. */
export async function runSampleTask(opts: {
  config: LocusConfig | null | undefined;
  dispatch: Dispatch<Action>;
  productMode?: ProductMode;
}): Promise<AgentSession> {
  const { config, dispatch } = opts;
  const defaults = resolveAgentDefaults(config ?? null, "ubuntu", loadLastAgent());
  const mode = parseProductMode(opts.productMode ?? config?.productMode);
  const session = await api.startSampleTask({
    ...(defaults.providerId ? { providerId: defaults.providerId } : {}),
    ...(defaults.model ? { model: defaults.model } : {}),
    surface: surfaceForProductMode(mode),
  });
  dispatch({ type: "session", session });
  dispatch({ type: "section", section: "agents" });
  dispatch({ type: "select", id: session.id });
  if (config?.setupFirstTask === "pending") {
    void api
      .saveConfig({ ...config, setupFirstTask: "done" })
      .then((saved) => dispatch({ type: "config", config: saved }))
      .catch(() => undefined);
  }
  return session;
}
