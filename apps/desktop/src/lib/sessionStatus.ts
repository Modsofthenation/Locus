/** Operator-facing label for a session or machine status dot. */
export function sessionStatusLabel(status: string | undefined): string {
  switch (status) {
    case "running":
    case "ready":
      return "Running";
    case "provisioning":
      return "Starting";
    case "paused":
      return "Paused";
    case "stopped":
      return "Stopped";
    case "error":
      return "Error";
    case "needs-you":
      return "Needs you";
    case "draft":
      return "Draft";
    case "cmd":
      return "Working";
    case "idle":
    default:
      return "Idle";
  }
}
