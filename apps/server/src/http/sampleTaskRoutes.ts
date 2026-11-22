import type { Hono } from "hono";
import type { SampleTaskInput } from "@locus/shared";
import { startSampleTask, type SampleTaskDeps } from "../session/sampleTask.js";
import { errorJson } from "./sessionJson.js";

/** `POST /api/sample-task`: Host agent on the bundled sample repo with a fix-the-test prompt. */
export function registerSampleTaskRoutes(app: Hono, deps: SampleTaskDeps): void {
  let inflight: Promise<unknown> | undefined;
  app.post("/api/sample-task", async (c) => {
    if (inflight) return c.json({ error: "A sample task is already starting" }, 409);
    const body = (await c.req.json().catch(() => ({}))) as SampleTaskInput;
    const input: SampleTaskInput = {
      providerId: typeof body.providerId === "string" ? body.providerId : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      surface: body.surface === "swarm" || body.surface === "developer" ? body.surface : undefined,
    };
    const work = startSampleTask(deps, input);
    inflight = work;
    try {
      return c.json(await work, 201);
    } catch (err) {
      return errorJson(c, err);
    } finally {
      inflight = undefined;
    }
  });
}
