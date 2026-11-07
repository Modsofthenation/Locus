import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSET_BUILD_DEFAULTS, type AgentSession, type AssetBuild } from "@locus/shared";
import { api } from "@/lib/api";
import { AssetBuildPicker } from "./AssetBuildPicker";
import { useAssetBuild } from "./useAssetBuild";

vi.mock("@/lib/api", () => ({
  api: {
    patchSession: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const base = { id: "a1", assetBuild: { ...ASSET_BUILD_DEFAULTS } } as AgentSession;

let latest: AssetBuild | undefined;

let markApplied: ((next: AssetBuild) => Promise<void>) | undefined;

function Harness() {
  const [session, setSession] = useState<AgentSession>(base);
  const hook = useAssetBuild(session, (action) => setSession(action.session));
  latest = hook.build;
  markApplied = hook.markApplied;
  return <AssetBuildPicker value={hook.build} onChange={hook.change} />;
}

function button(host: HTMLElement, label: string) {
  return [...host.querySelectorAll("button")].find((btn) => btn.textContent === label)!;
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("useAssetBuild", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.mocked(api.patchSession).mockReset();
    latest = undefined;
    markApplied = undefined;
  });

  function render() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Harness />));
  }

  function pendingPatches() {
    const calls: {
      patch: { assetBuild?: AssetBuild; assetAppliedBuild?: AssetBuild };
      reply: ReturnType<typeof deferred<AgentSession>>;
    }[] = [];
    vi.mocked(api.patchSession).mockImplementation((_id, patch) => {
      const reply = deferred<AgentSession>();
      calls.push({
        patch: {
          assetBuild: patch.assetBuild as AssetBuild | undefined,
          assetAppliedBuild: patch.assetAppliedBuild as AssetBuild | undefined,
        },
        reply,
      });
      return reply.promise;
    });
    return calls;
  }

  it("keeps both quick toggles while the first save is still in flight", async () => {
    const calls = pendingPatches();
    render();
    act(() => button(host, "Split").click());
    act(() => button(host, "Printability").click());
    await act(flush);
    expect(latest).toMatchObject({ split: true, printable: true });
    expect(calls).toHaveLength(1);

    await act(async () => {
      calls[0]!.reply.resolve({ ...base, assetBuild: calls[0]!.patch.assetBuild });
      await flush();
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.patch.assetBuild).toMatchObject({ split: true, printable: true });
    expect(latest).toMatchObject({ split: true, printable: true });

    await act(async () => {
      calls[1]!.reply.resolve({ ...base, assetBuild: calls[1]!.patch.assetBuild });
      await flush();
    });
    expect(latest).toMatchObject({ split: true, printable: true });
    expect(button(host, "Split").getAttribute("aria-pressed")).toBe("true");
    expect(button(host, "Printability").getAttribute("aria-pressed")).toBe("true");
  });

  it("falls back to the saved build when the save fails", async () => {
    const calls = pendingPatches();
    render();
    await act(async () => {
      button(host, "Split").click();
      await flush();
    });
    expect(latest?.split).toBe(true);
    await act(async () => {
      calls[0]!.reply.reject(new Error("offline"));
      await flush();
    });
    expect(latest?.split).toBe(false);
  });

  it("queues markApplied behind in-flight knob patches", async () => {
    const calls = pendingPatches();
    render();
    act(() => button(host, "Split").click());
    await act(flush);
    const applied = { ...ASSET_BUILD_DEFAULTS, split: true };
    const marked = markApplied!(applied);
    await act(async () => {
      calls[0]!.reply.resolve({ ...base, assetBuild: applied });
      await flush();
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.patch.assetAppliedBuild).toMatchObject({ split: true });
    await act(async () => {
      calls[1]!.reply.resolve({
        ...base,
        assetBuild: applied,
        assetAppliedBuild: applied,
      });
      await marked;
    });
  });
});
