import type { SessionSurface } from "./session.js";

/** Prompt sent to the bundled sample repo agent (`POST /api/sample-task`). */
export const SAMPLE_TASK_PROMPT =
  "The test in sum.test.js fails. Find the bug, fix it, and run the tests.";

export const SAMPLE_TASK_TITLE = "Sample task: fix sum";

export interface SampleTaskInput {
  /** Defaults to the first enabled provider. */
  providerId?: string;
  /** Defaults to the provider's default model. */
  model?: string;
  surface?: SessionSurface;
}
