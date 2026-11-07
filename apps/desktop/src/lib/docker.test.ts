import { describe, expect, it, vi, afterEach } from "vitest";
import type { DockerContainer } from "@locus/shared";
import {
  compactDockerAge,
  confirmDockerContainerAction,
  confirmRestartContainers,
  confirmStopContainers,
  countDockerLogLevels,
  dockerGroup,
  dockerInspectPayload,
  dockerStatusLabel,
  formatLogTime,
  groupDockerContainers,
  liveDockerContainers,
  loadDockerExplorerExpanded,
  parseDockerLogLine,
  parseDockerLogs,
  runStopContainers,
  saveDockerExplorerExpanded,
  shortContainerId,
  DOCKER_EXPLORER_EXPANDED_KEY,
  DOCKER_EXPLORER_POLL_MS,
} from "./docker";

function row(
  partial: Partial<DockerContainer> & Pick<DockerContainer, "id" | "name" | "state">,
): DockerContainer {
  return {
    image: "nginx",
    status: partial.state,
    createdAt: "2020-01-01T00:00:00.000Z",
    locus: false,
    ...partial,
  };
}

describe("liveDockerContainers", () => {
  it("keeps running, paused, and restarting rows", () => {
    expect(
      liveDockerContainers([
        row({ id: "a", name: "web", state: "running" }),
        row({ id: "b", name: "api", state: "paused" }),
        row({ id: "c", name: "job", state: "restarting" }),
        row({ id: "d", name: "old", state: "exited" }),
        row({ id: "e", name: "off", state: "stopped" }),
      ]).map((item) => item.id),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("confirmStopContainers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists names and linked agents", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    expect(
      confirmStopContainers([
        row({ id: "a", name: "web", state: "running" }),
        row({
          id: "b",
          name: "locus-1",
          state: "running",
          sessionTitle: "Fix login",
          locus: true,
        }),
      ]),
    ).toBe(true);
    expect(confirm.mock.calls[0]?.[0]).toMatch(/Stop 2 containers/);
    expect(confirm.mock.calls[0]?.[0]).toMatch(/web/);
    expect(confirm.mock.calls[0]?.[0]).toMatch(/locus-1 is the Fix login agent/);
  });

  it("returns false when there is nothing to stop", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    expect(confirmStopContainers([])).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("confirmDockerContainerAction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the container and linked agent", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    expect(
      confirmDockerContainerAction(
        "stop",
        row({ id: "b", name: "locus-1", state: "running", sessionTitle: "Fix login", locus: true }),
      ),
    ).toBe(true);
    expect(confirm.mock.calls[0]?.[0]).toMatch(/Stop locus-1\? This is the Fix login agent/);
    expect(
      confirmDockerContainerAction("restart", row({ id: "a", name: "web", state: "running" })),
    ).toBe(true);
    expect(confirm.mock.calls[1]?.[0]).toMatch(/Restart web\?/);
  });
});

describe("confirmRestartContainers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists names before restarting", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    expect(confirmRestartContainers([row({ id: "a", name: "web", state: "running" })])).toBe(true);
    expect(confirm.mock.calls[0]?.[0]).toMatch(/Restart 1 container/);
    expect(confirm.mock.calls[0]?.[0]).toMatch(/web/);
  });
});

describe("groupDockerContainers", () => {
  it("buckets live, stopped, and exited rows", () => {
    const grouped = groupDockerContainers([
      row({ id: "a", name: "web", state: "running" }),
      row({ id: "b", name: "api", state: "paused" }),
      row({ id: "c", name: "off", state: "stopped" }),
      row({ id: "d", name: "old", state: "exited" }),
      row({ id: "e", name: "dead", state: "dead" }),
      row({ id: "f", name: "new", state: "created" }),
    ]);
    expect(grouped.running.map((item) => item.id)).toEqual(["a", "b"]);
    expect(grouped.stopped.map((item) => item.id)).toEqual(["c", "f"]);
    expect(grouped.exited.map((item) => item.id)).toEqual(["d", "e"]);
    expect(dockerGroup("unknown")).toBe("stopped");
  });
});

describe("shortContainerId", () => {
  it("keeps the first 12 hex characters", () => {
    expect(shortContainerId("e502d6a0b282abcdef")).toBe("e502d6a0b282");
    expect(shortContainerId("vm-1")).toBe("vm-1");
  });
});

describe("compactDockerAge", () => {
  it("compacts docker status durations", () => {
    expect(compactDockerAge("Up 10 hours")).toBe("10h");
    expect(compactDockerAge("Exited (0) 2 days ago")).toBe("2d");
    expect(compactDockerAge("Up 3 minutes")).toBe("3m");
  });

  it("falls back to createdAt", () => {
    const now = Date.parse("2020-01-01T10:00:00.000Z");
    expect(compactDockerAge("running", "2020-01-01T00:00:00.000Z", now)).toBe("10h");
  });
});

describe("dockerStatusLabel", () => {
  it("shows uptime for live containers", () => {
    expect(
      dockerStatusLabel(row({ id: "a", name: "web", state: "running", status: "Up 10 hours" })),
    ).toBe("running · up 10h");
  });
});

describe("parseDockerLogs", () => {
  it("splits timestamp, level, and message", () => {
    const lines = parseDockerLogs(
      [
        "2026-08-23T20:31:02.000Z INFO listening on :7801",
        "2026-08-23 20:31:04 | WARN | retrying upstream",
        "ERROR boom",
        "plain line",
        "[2026-08-23 20:31:06,123: INFO/Beat] Scheduler: Sending due task",
      ].join("\n"),
    );
    expect(lines).toHaveLength(5);
    expect(parseDockerLogLine(lines[0]!.raw)).toMatchObject({
      time: "2026-08-23T20:31:02.000Z",
      level: "info",
      message: "listening on :7801",
    });
    expect(lines[1]).toMatchObject({ level: "warn", message: "retrying upstream" });
    expect(lines[2]).toMatchObject({ level: "error", message: "boom" });
    expect(lines[3]).toMatchObject({ level: "other", time: "", message: "plain line" });
    expect(lines[4]).toMatchObject({
      level: "info",
      message: "Scheduler: Sending due task",
    });
    expect(countDockerLogLevels(lines)).toEqual({ errors: 1, warnings: 1 });
  });
});

describe("formatLogTime", () => {
  it("renders ISO timestamps as compact UTC clock time", () => {
    expect(formatLogTime("2026-08-23T20:31:02.000Z")).toBe("20:31:02");
    expect(formatLogTime("")).toBe("");
    expect(formatLogTime("not-a-date")).toBe("not-a-date");
  });
});

describe("runStopContainers", () => {
  it("stops, refreshes, and returns stopped ids", async () => {
    const web = row({ id: "c1", name: "web", state: "running" });
    const job = row({ id: "c2", name: "job", state: "running" });
    const confirm = vi.fn(() => true);
    const stop = vi.fn(async () => ({
      stopped: [web],
      errors: [{ id: "c2", error: "busy" }],
    }));
    const list = vi.fn(async () => ({ containers: [job] }));
    const result = await runStopContainers([web, job], { stop, list, confirm });
    expect(stop).toHaveBeenCalledWith(["c1", "c2"]);
    expect(result?.containers).toEqual([job]);
    expect(result?.stoppedIds.has("c1")).toBe(true);
    expect(result?.errors).toEqual([{ id: "c2", error: "busy" }]);
  });

  it("returns null when the operator cancels", async () => {
    const result = await runStopContainers([row({ id: "c1", name: "web", state: "running" })], {
      stop: vi.fn(),
      list: vi.fn(),
      confirm: () => false,
    });
    expect(result).toBeNull();
  });
});

describe("dockerInspectPayload", () => {
  it("serializes container facts for the inspect pane", () => {
    expect(
      dockerInspectPayload(
        row({
          id: "vm-1",
          name: "locus-vm-1",
          state: "running",
          containerId: "abc123def456",
          sessionTitle: "Fix login",
          locus: true,
        }),
      ),
    ).toEqual({
      name: "locus-vm-1",
      id: "abc123def456",
      image: "nginx",
      state: "running",
      status: "running",
      createdAt: "2020-01-01T00:00:00.000Z",
      locus: true,
      sessionId: null,
      sessionTitle: "Fix login",
      stats: null,
    });
  });
});

describe("docker explorer expand preference", () => {
  it("defaults to expanded and remembers collapse", () => {
    const storage = new Map<string, string>();
    const mem = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    expect(loadDockerExplorerExpanded(mem)).toBe(true);
    expect(DOCKER_EXPLORER_POLL_MS).toBe(5000);
    saveDockerExplorerExpanded(false, mem);
    expect(storage.get(DOCKER_EXPLORER_EXPANDED_KEY)).toBe("0");
    expect(loadDockerExplorerExpanded(mem)).toBe(false);
  });
});
