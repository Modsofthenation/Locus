import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DockerCliEngine, createDockerEngine } from "@locus/hypervisor";
import { DockerGuestRuntime } from "@locus/guest-agent";

async function dockerAvailable(): Promise<boolean> {
  const engine = await createDockerEngine(await mkdtemp(join(tmpdir(), "locus-docker-probe-")));
  return engine.kind === "docker";
}

describe("docker coding eval", () => {
  it("writes, patches, and commits inside a real container", async () => {
    if (!(await dockerAvailable())) return;
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-eval-"));
    const engine = await createDockerEngine(dir);
    if (!(engine instanceof DockerCliEngine)) return;
    if (!(await engine.available())) return;
    const vm = await engine.create({
      sessionId: "eval",
      name: "eval",
      image: "alpine:3.21",
      os: "ubuntu",
    });
    try {
      await engine.start(vm.id);
      const guest = new DockerGuestRuntime(engine.get(vm.id)!);
      const prep = await guest.execute({
        name: "exec",
        args: {
          command:
            "apk add --no-cache git patch && git init && git config --global --add safe.directory /workspace && git config user.email eval@locus.dev && git config user.name Locus",
        },
      });
      expect(prep.ok, prep.output).toBe(true);
      const wrote = await guest.execute({
        name: "file_write",
        args: { path: "/workspace/hello.txt", content: "hello\n" },
      });
      expect(wrote.ok).toBe(true);
      const patched = await guest.execute({
        name: "apply_patch",
        args: {
          patch: [
            "--- a/hello.txt",
            "+++ b/hello.txt",
            "@@ -1 +1 @@",
            "-hello",
            "+hello world",
            "",
          ].join("\n"),
        },
      });
      expect(patched.ok, patched.output).toBe(true);
      const read = await guest.execute({
        name: "file_read",
        args: { path: "/workspace/hello.txt" },
      });
      expect(read.output).toContain("hello world");
      const commit = await guest.execute({
        name: "git_commit",
        args: { message: "eval: greet the world" },
      });
      expect(commit.ok).toBe(true);
    } finally {
      await engine.destroy(vm.id);
    }
  }, 180_000);
});
