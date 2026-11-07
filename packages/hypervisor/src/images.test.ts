import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCUS_AGENT_IMAGE } from "@locus/shared";
import { ensureLocusAgentImage, resolveAgentImageContext } from "./images.js";
import type { CommandRunner, ExecResult } from "./runner.js";

describe("locus agent images", () => {
  it("resolves the repo images/agent Dockerfile", () => {
    const context = resolveAgentImageContext();
    expect(context).toMatch(/images[/\\]agent$/);
  });

  it("skips public images and rebuilds only when the tag is missing", async () => {
    const calls: string[][] = [];
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async (_cmd, args) => {
        calls.push(args);
        if (args[0] === "image")
          return { stdout: "", stderr: "missing", code: 1 } satisfies ExecResult;
        return { stdout: "built\n", stderr: "", code: 0 } satisfies ExecResult;
      },
      spawn: () => {
        throw new Error("unused");
      },
    };
    await ensureLocusAgentImage(runner, "/usr/bin/docker", "python:3.12-bookworm");
    expect(calls).toEqual([]);
    const dir = await mkdtemp(join(tmpdir(), "locus-img-"));
    await writeFile(join(dir, "Dockerfile"), "FROM scratch\n");
    await ensureLocusAgentImage(runner, "/usr/bin/docker", "locus/agent", undefined, dir);
    expect(calls).toEqual([
      ["image", "inspect", LOCUS_AGENT_IMAGE],
      ["build", "--progress=plain", "-t", LOCUS_AGENT_IMAGE, dir],
    ]);
    calls.length = 0;
    const present: CommandRunner = {
      ...runner,
      exec: async (_cmd, args) => {
        calls.push(args);
        return { stdout: "ok\n", stderr: "", code: 0 } satisfies ExecResult;
      },
    };
    await ensureLocusAgentImage(present, "/usr/bin/docker", "locus/node", undefined, dir);
    expect(calls).toEqual([["image", "inspect", LOCUS_AGENT_IMAGE]]);
  });

  it("errors when the Dockerfile context is missing", async () => {
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async () => ({ stdout: "", stderr: "missing", code: 1 }),
      spawn: () => {
        throw new Error("unused");
      },
    };
    const empty = await mkdtemp(join(tmpdir(), "locus-img-empty-"));
    await mkdir(join(empty, "nested"));
    await expect(
      ensureLocusAgentImage(
        runner,
        "/usr/bin/docker",
        "locus/agent",
        undefined,
        join(empty, "missing"),
      ),
    ).rejects.toThrow(/Dockerfile is missing/);
  });

  it("streams docker build output into logs and progress", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-img-stream-"));
    await writeFile(join(dir, "Dockerfile"), "FROM scratch\n");
    const logs: string[] = [];
    const progress: Array<{ percent: number; phase: string; done?: boolean }> = [];
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async (_cmd, args, opts) => {
        if (args[0] === "image")
          return { stdout: "", stderr: "missing", code: 1 } satisfies ExecResult;
        opts?.onOutput?.("#4 [2/6] RUN apt-get update && apt-get install -y git\n");
        return { stdout: "", stderr: "", code: 0 } satisfies ExecResult;
      },
      spawn: () => {
        throw new Error("unused");
      },
    };
    await ensureLocusAgentImage(
      runner,
      "/usr/bin/docker",
      "locus/agent",
      (chunk) => logs.push(chunk),
      dir,
      (row) => progress.push(row),
    );
    expect(logs.join("")).toMatch(/Building locus\/agent:0\.1/);
    expect(logs.join("")).toMatch(/RUN apt-get update/);
    expect(progress[0]).toEqual({ percent: 0, phase: "Starting" });
    expect(progress.some((row) => row.phase === "RUN apt-get update" && row.percent === 30)).toBe(
      true,
    );
    expect(progress.at(-1)).toEqual({ percent: 100, phase: "Done", done: true });
  });
});
