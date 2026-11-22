/** Ends `runCli` with a specific exit code (audit verify → 1, `ci run` → 0/1/2/3). */
export class CliExitError extends Error {
  constructor(
    readonly code: number,
    message = "",
  ) {
    super(message);
    this.name = "CliExitError";
  }
}
