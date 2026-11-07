import { describe, expect, it } from "vitest";
import {
  errorMessage,
  notFoundErrorStatus,
  routeErrorStatus,
  sessionErrorStatus,
} from "./sessionJson.js";

describe("routeErrorStatus", () => {
  it("maps not-found / conflict / validation / server failures", () => {
    expect(routeErrorStatus("Session not found: abc")).toBe(404);
    expect(routeErrorStatus("Project not found")).toBe(404);
    expect(sessionErrorStatus("Queue is full (32 prompts)")).toBe(422);
    expect(routeErrorStatus("Workers are Docker-only")).toBe(400);
    expect(routeErrorStatus("Invalid path")).toBe(400);
    expect(routeErrorStatus("Max concurrent VMs reached (4)")).toBe(409);
    expect(routeErrorStatus("Brain needs Node.js with SQLite FTS5")).toBe(500);
    expect(routeErrorStatus("ENOENT: no such file or directory")).toBe(404);
    expect(routeErrorStatus("EMFILE: too many open files, open 'src/app.ts'")).toBe(503);
    expect(notFoundErrorStatus("Invalid path")).toBe(400);
    expect(notFoundErrorStatus("Workspace file not found")).toBe(404);
  });

  it("maps automation webhook failures", () => {
    expect(routeErrorStatus("Invalid webhook secret")).toBe(401);
    expect(routeErrorStatus("Too many webhook requests")).toBe(429);
    expect(routeErrorStatus("Webhook payload is too large")).toBe(413);
  });
});

describe("errorMessage", () => {
  it("keeps Error messages and avoids a bare Failed", () => {
    expect(errorMessage(new Error("Queue is full (32 prompts)"))).toBe(
      "Queue is full (32 prompts)",
    );
    expect(errorMessage("not an error object")).toBe("not an error object");
    expect(errorMessage(undefined)).toBe("Something went wrong");
  });
});
