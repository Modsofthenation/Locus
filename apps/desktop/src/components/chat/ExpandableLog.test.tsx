import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ExpandableLog } from "./ExpandableLog";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FSDEV_BLOB = `[2026-08-18T12:10:18.546Z] creating
[2026-08-18T12:10:18.589Z] booting
C:\\Program Files\\qemu\\qemu-system-x86_64.exe: -fsdev local,id=cidata,path=C:\\Users\\locus\\.locus\\vms\\6308db78-4104-4440-a426-7f88c36e8657\\cidata,security_model=mapped-xattr: There is no option group 'fsdev'
C:\\Program Files\\qemu\\qemu-system-x86_64.exe: -fsdev local,id=cidata,path=C:\\Users\\locus\\.locus\\vms\\6308db78-4104-4440-a426-7f88c36e8657\\cidata,security_model=mapped-xattr: fsdev support is disabled`;

describe("ExpandableLog", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(node);
    });
  }

  it("keeps a short note as a single line", () => {
    render(<ExpandableLog text="Guest is ready." />);
    expect(host.querySelector("details")).toBeNull();
    expect(host.textContent).toBe("Guest is ready.");
  });

  it("collapses a QEMU dump behind a one-sentence summary", () => {
    render(<ExpandableLog text={FSDEV_BLOB} />);
    const details = host.querySelector("details.log-blob") as HTMLDetailsElement | null;
    expect(details).toBeTruthy();
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe(
      "This QEMU build has fsdev/9p disabled, so the guest could not start.",
    );
    expect(host.querySelector("pre")?.textContent).toContain("fsdev support is disabled");
    act(() => {
      details!.querySelector("summary")!.click();
    });
    expect(details?.open).toBe(true);
  });

  it("pads docker term logs and expandable log bodies", () => {
    expect(css).toMatch(/\.term-log \{[\s\S]*?padding: var\(--space-4\) 18px/);
    expect(css).toMatch(/\.term-log \{[\s\S]*?color:\s*var\(--term-fg\)/);
    expect(css).toMatch(/\.log-blob pre \{[\s\S]*?padding: var\(--space-3-5\) var\(--space-4\)/);
    expect(css).toMatch(/\.term-log \.log-blob > summary \{[\s\S]*?color:\s*var\(--term-fg\)/);
  });
  it("shows a Docker-down error as a plain sentence with the raw text in details", () => {
    const raw =
      "ERROR: failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /var/run/docker.sock: connect: no such file or directory";
    render(<ExpandableLog compact danger text={raw} />);
    expect(host.querySelector("summary")?.textContent).toBe(
      "Docker isn't running — switch to Host or start Docker",
    );
    expect(host.querySelector("pre")?.textContent).toBe(raw);
  });
});
