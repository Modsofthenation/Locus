import { describe, expect, it } from "vitest";
import { LOCUS_AGENT_IMAGE } from "./vm.js";
import {
  formatImageBuildPhase,
  imageBuildDoneNote,
  imageBuildDoneProgress,
  imageBuildStartNote,
  imageBuildStartProgress,
  isImageBuildStartNote,
  isImageBuildWaiting,
  latestImageBuildStartMessageId,
  parseDockerBuildProgress,
} from "./imageBuildProgress.js";

const BUILDKIT = `
#0 building with "default" instance using docker driver

#1 [internal] load build definition from Dockerfile
#1 transferring dockerfile: 2.13kB done
#1 DONE 0.0s

#2 [internal] load metadata for docker.io/library/node:22-bookworm
#2 DONE 1.4s

#3 [1/6] FROM docker.io/library/node:22-bookworm@sha256:abc
#3 DONE 0.0s

#4 [2/6] RUN apt-get update && apt-get install -y git ffmpeg
#4 1.234 Get:1 http://deb.debian.org/debian bookworm InRelease
#4 DONE 45.2s

#5 [3/6] RUN ARCH="$(case "\${TARGETARCH:-amd64}" in arm64) echo arm64 ;; *) echo amd64 ;; esac)"
#5 CACHED

#6 [4/6] COPY git-credential-locus /usr/local/bin/git-credential-locus
#6 DONE 0.1s

#7 exporting to image
#7 exporting layers done
#7 naming to docker.io/library/locus/agent:0.1 done
#7 DONE 0.3s
`;

describe("parseDockerBuildProgress", () => {
  it("maps BuildKit step numbers onto a percent and a short phase", () => {
    const parsed = parseDockerBuildProgress(BUILDKIT);
    expect(parsed?.phase).toBe("Tagging image");
    expect(parsed?.percent).toBeGreaterThanOrEqual(90);
  });

  it("keeps the current RUN step before export", () => {
    const parsed = parseDockerBuildProgress(`
#4 [2/6] RUN apt-get update && apt-get install -y git ffmpeg
#4 1.234 Get:1 http://deb.debian.org/debian bookworm InRelease
`);
    expect(parsed).toEqual({
      percent: 30,
      phase: "RUN apt-get update",
      step: 2,
      total: 6,
    });
  });

  it("parses classic docker Step N/M lines", () => {
    expect(
      parseDockerBuildProgress("Step 3/9 : RUN curl -fsSL https://example.com | tar -xz\n"),
    ).toEqual({
      percent: 30,
      phase: "RUN curl -fsSL https://example.com | tar -xz",
      step: 3,
      total: 9,
    });
  });

  it("surfaces image metadata pull before the first layer", () => {
    expect(
      parseDockerBuildProgress(
        "#2 [internal] load metadata for docker.io/library/node:22-bookworm\n",
      ),
    ).toEqual({
      percent: 6,
      phase: "Pulling image metadata",
      detail: "node:22-bookworm",
    });
  });

  it("interpolates layer download size onto the current step", () => {
    const parsed = parseDockerBuildProgress(
      "#3 [1/6] FROM docker.io/library/node:22-bookworm\n#3 sha256:abc downloading 64.00MB/128.00MB\n",
    );
    expect(parsed?.phase).toBe("Pulling base image");
    expect(parsed?.detail).toBe("64.00MB/128.00MB");
    expect(parsed?.percent).toBeGreaterThan(10);
    expect(parsed?.percent).toBeLessThan(30);
  });

  it("marks a cached layer", () => {
    const parsed = parseDockerBuildProgress("#5 [3/6] RUN ARCH=arm64\n#5 CACHED\n");
    expect(parsed?.cached).toBe(true);
    expect(parsed?.step).toBe(3);
    expect(parsed?.total).toBe(6);
  });

  it("ignores noise", () => {
    expect(
      parseDockerBuildProgress("DEPRECATED: The legacy builder is deprecated.\n"),
    ).toBeUndefined();
  });
});

describe("formatImageBuildPhase", () => {
  it("includes step counts and cache", () => {
    expect(
      formatImageBuildPhase({
        percent: 30,
        phase: "RUN apt-get update",
        step: 2,
        total: 6,
      }),
    ).toBe("RUN apt-get update · 2/6");
    expect(
      formatImageBuildPhase({
        percent: 45,
        phase: "Cached layer",
        step: 3,
        total: 6,
        cached: true,
      }),
    ).toBe("Cached layer · 3/6 · cached");
    expect(formatImageBuildPhase(imageBuildDoneProgress())).toBe("Done");
  });
});

describe("image build notes", () => {
  it("matches the docker log line and finds the latest Building note", () => {
    const note = imageBuildStartNote();
    expect(note).toBe(
      `Building ${LOCUS_AGENT_IMAGE} (git, Node, Chromium/Xvfb, ffmpeg, code-server)…`,
    );
    expect(isImageBuildStartNote(note)).toBe(true);
    expect(isImageBuildStartNote("Starting the container.")).toBe(false);
    expect(imageBuildDoneNote()).toMatch(/^Built locus\/agent:0\.1/);
    expect(
      latestImageBuildStartMessageId([
        { id: "a", role: "system", content: note },
        { id: "b", role: "system", content: "Starting the container." },
        { id: "c", role: "system", content: note },
      ]),
    ).toBe("c");
    expect(isImageBuildWaiting(imageBuildStartProgress())).toBe(true);
    expect(isImageBuildWaiting(imageBuildDoneProgress())).toBe(false);
  });
});
