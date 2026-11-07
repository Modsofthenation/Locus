import { describe, expect, it } from "vitest";
import { formatWorkerAddBlob } from "@locus/shared";
import { formatWorkerAddBlobs, workerAddStdout } from "./advertise.js";

const fp = `sha256:${"ab".repeat(32)}`;

describe("worker add stdout", () => {
  it("prints one pasteable blob per advertised URL and includes token only on first create", () => {
    const first = workerAddStdout({
      engineKind: "mock",
      name: "studio",
      dataDir: "/home/x/.locus-worker",
      bindHost: "192.168.1.8",
      bindPort: 7421,
      fingerprint: fp,
      token: "once-secret",
      tokenCreated: true,
      tokenFromEnv: false,
      hostname: "studio",
    });
    expect(first).toContain("Locus worker (mock) studio");
    expect(first).toContain("printed once in the add line");
    expect(first).toContain("locus config workers add");
    expect(first).toContain("does not scan the LAN");
    const blob = formatWorkerAddBlob({
      url: "https://192.168.1.8:7421",
      fingerprint: fp,
      name: "studio",
      token: "once-secret",
    });
    expect(first).toContain(blob);

    const again = workerAddStdout({
      engineKind: "mock",
      name: "studio",
      dataDir: "/home/x/.locus-worker",
      bindHost: "192.168.1.8",
      fingerprint: fp,
      token: "once-secret",
      tokenCreated: false,
      tokenFromEnv: false,
      hostname: "studio",
    });
    expect(again).toContain("not reprinted");
    expect(again).not.toContain("once-secret");

    const quiet = workerAddStdout({
      engineKind: "mock",
      name: "studio",
      dataDir: "/home/x/.locus-worker",
      bindHost: "192.168.1.8",
      bindPort: 7421,
      fingerprint: fp,
      token: "once-secret",
      tokenCreated: true,
      tokenFromEnv: false,
      hostname: "studio",
      printToken: false,
    });
    expect(quiet).toContain("stdout is not a TTY");
    expect(quiet).not.toContain("once-secret");
    expect(again).toContain(
      formatWorkerAddBlob({
        url: "https://192.168.1.8:7421",
        fingerprint: fp,
        name: "studio",
      }),
    );
  });

  it("emits one blob per URL", () => {
    expect(
      formatWorkerAddBlobs({
        urls: ["https://192.168.1.8:7421", "https://10.0.0.4:7421"],
        fingerprint: fp,
        name: "box",
        token: "t",
      }),
    ).toHaveLength(2);
  });
});
