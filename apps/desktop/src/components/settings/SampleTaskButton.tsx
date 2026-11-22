import { useState } from "react";
import { t, type LocusConfig, type ProductMode } from "@locus/shared";
import { showErrorNotice } from "@/lib/notice";
import { openProviderSettings, runSampleTask, sampleTaskReady } from "@/lib/sampleTask";
import { useStore } from "@/state/store";

/**
 * Try a sample task: a Host agent on the bundled sample repo. Without a provider the
 * button reads Add a provider first and opens Settings → Providers instead.
 */
export function SampleTaskButton(props: {
  className?: string;
  disabled?: boolean;
  productMode?: ProductMode;
  /** Runs first (the wizard saves setup here). Return the config to start with, or null to stop. */
  beforeStart?: () => Promise<LocusConfig | null>;
}) {
  const { state, dispatch } = useStore();
  const [busy, setBusy] = useState(false);
  const className = props.className ?? "btn small";

  if (!sampleTaskReady(state.setup, state.config)) {
    return (
      <button
        type="button"
        className={className}
        data-testid="sample-task-provider"
        disabled={props.disabled}
        onClick={() => openProviderSettings(dispatch)}
      >
        {t("sample.needsProvider")}
      </button>
    );
  }

  async function start() {
    setBusy(true);
    try {
      const config = props.beforeStart ? await props.beforeStart() : state.config;
      if (props.beforeStart && !config) return;
      await runSampleTask({ config, dispatch, productMode: props.productMode });
    } catch (err) {
      showErrorNotice(err, "Could not start the sample task");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      data-testid="sample-task"
      disabled={busy || props.disabled}
      onClick={() => void start()}
    >
      {busy ? t("sample.starting") : t("sample.cta")}
    </button>
  );
}
