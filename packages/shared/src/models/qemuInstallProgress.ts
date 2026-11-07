export interface QemuInstallProgress {
  phase: string;
  log: string;
  percent: number;
  done?: boolean;
  error?: string;
}

export function qemuInstallStartProgress(): QemuInstallProgress {
  return { phase: "Starting", log: "", percent: 0 };
}

export function qemuInstallDoneProgress(log: string, error?: string): QemuInstallProgress {
  return {
    phase: error ? "Failed" : "Done",
    log,
    percent: 100,
    done: true,
    error,
  };
}
