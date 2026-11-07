import { describe, expect, it } from "vitest";
import { isSshTransportError } from "./ssh.js";
import { waitForGuest } from "./ready.js";
import { WindowsGuestRuntime } from "./windows.js";
import {
  powershellEncodedCommand,
  probeWinRm,
  winrmRun,
  xmlValue,
  type WinRmPost,
} from "./winrm.js";

describe("powershellEncodedCommand", () => {
  it("uses UTF-16LE EncodedCommand", () => {
    const cmd = powershellEncodedCommand("Write-Output hi");
    expect(cmd).toContain("-EncodedCommand");
    const b64 = cmd.split(" ").at(-1)!;
    expect(Buffer.from(b64, "base64").toString("utf16le")).toBe("Write-Output hi");
  });
});

describe("xmlValue", () => {
  it("reads ShellId selectors and CommandId tags", () => {
    expect(xmlValue(`<w:Selector Name="ShellId">abc</w:Selector>`, "ShellId")).toBe("abc");
    expect(xmlValue(`<rsp:CommandId>cmd-1</rsp:CommandId>`, "CommandId")).toBe("cmd-1");
  });
});

describe("WinRM", () => {
  it("probes IdentifyResponse", async () => {
    const post: WinRmPost = async () => ({ status: 200, text: "<IdentifyResponse/>" });
    expect(await probeWinRm({ host: "127.0.0.1", port: 5985, username: "locus" }, { post })).toBe(
      true,
    );
    const miss: WinRmPost = async () => ({ status: 200, text: "nope" });
    expect(
      await probeWinRm({ host: "127.0.0.1", port: 5985, username: "locus" }, { post: miss }),
    ).toBe(false);
  });

  it("runs a command through create/command/receive/delete", async () => {
    const actions: string[] = [];
    const post: WinRmPost = async (_url, headers, body) => {
      actions.push(String(headers.SOAPAction));
      if (headers.SOAPAction?.includes("Create")) {
        return { status: 200, text: `<w:Selector Name="ShellId">shell-1</w:Selector>` };
      }
      if (headers.SOAPAction?.includes("Command")) {
        expect(body).toContain("EncodedCommand");
        return { status: 200, text: `<rsp:CommandId>cmd-1</rsp:CommandId>` };
      }
      if (headers.SOAPAction?.includes("Receive")) {
        return {
          status: 200,
          text: `<rsp:Stream Name="stdout">${Buffer.from("hello-winrm").toString("base64")}</rsp:Stream><rsp:CommandState State="http://schemas.microsoft.com/wbem/wsman/1/windows/shell/CommandState/Done"/><rsp:ExitCode>0</rsp:ExitCode>`,
        };
      }
      return { status: 200, text: "" };
    };
    const result = await winrmRun(
      { host: "127.0.0.1", port: 5985, username: "locus", password: "x" },
      "Write-Output hi",
      post,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("hello-winrm");
    expect(actions.some((a) => a.includes("Delete"))).toBe(true);
  });
});

describe("WindowsGuestRuntime", () => {
  it("keeps the guest OS for Windows 10", () => {
    const runtime = new WindowsGuestRuntime({
      os: "windows-10",
      ssh: { host: "127.0.0.1", port: 2201, username: "locus" },
    });
    expect(runtime.os).toBe("windows-10");
  });

  it("falls back to WinRM when SSH cannot connect", async () => {
    const runtime = new WindowsGuestRuntime({
      ssh: { host: "127.0.0.1", port: 2201, username: "locus" },
      winrm: { host: "127.0.0.1", port: 5985, username: "locus", password: "x" },
      sshExec: async () => ({ code: 255, stdout: "", stderr: "Connection refused" }),
      winrmPost: async (_url, headers) => {
        if (headers.SOAPAction?.includes("Create")) {
          return { status: 200, text: `<w:Selector Name="ShellId">s</w:Selector>` };
        }
        if (headers.SOAPAction?.includes("Command")) {
          return { status: 200, text: `<rsp:CommandId>c</rsp:CommandId>` };
        }
        if (headers.SOAPAction?.includes("Receive")) {
          return {
            status: 200,
            text: `<rsp:Stream Name="stdout">${Buffer.from("from-winrm").toString("base64")}</rsp:Stream><rsp:CommandState State="Done"/><rsp:ExitCode>0</rsp:ExitCode>`,
          };
        }
        return { status: 200, text: "" };
      },
    });
    const result = await runtime.execute({ name: "exec", args: { command: "hostname" } });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("from-winrm");
  });

  it("does not fall back when the guest command itself failed", async () => {
    const runtime = new WindowsGuestRuntime({
      ssh: { host: "127.0.0.1", port: 2201, username: "locus" },
      winrm: { host: "127.0.0.1", port: 5985, username: "locus", password: "x" },
      sshExec: async () => ({ code: 1, stdout: "", stderr: "Get-ChildItem: path not found" }),
      winrmPost: async () => {
        throw new Error("should not use WinRM");
      },
    });
    const result = await runtime.execute({ name: "exec", args: { command: "hostname" } });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("path not found");
  });
});

describe("isSshTransportError", () => {
  it("detects connection failures only", () => {
    expect(isSshTransportError({ ok: true, output: "ok" })).toBe(false);
    expect(isSshTransportError({ ok: false, output: "Connection refused" })).toBe(true);
    expect(isSshTransportError({ ok: false, output: "(exit 255)" })).toBe(true);
    expect(isSshTransportError({ ok: false, output: "command failed" })).toBe(false);
  });
});

describe("waitForGuest", () => {
  it("succeeds via WinRM when SSH stays down", async () => {
    const ok = await waitForGuest(
      {
        os: "windows-11",
        ssh: { host: "127.0.0.1", port: 2201, username: "locus" },
        winrm: { host: "127.0.0.1", port: 2203, username: "locus" },
      },
      {
        timeoutMs: 2000,
        intervalMs: 1,
        sshExec: async () => ({ code: 255, stdout: "", stderr: "Connection refused" }),
        winrmPost: async () => ({ status: 200, text: "<IdentifyResponse/>" }),
      },
    );
    expect(ok).toBe(true);
  });

  it("uses EncodedCommand for the Windows SSH probe", async () => {
    let probe = "";
    const ok = await waitForGuest(
      { os: "windows-11", ssh: { host: "127.0.0.1", port: 2201, username: "locus" } },
      {
        timeoutMs: 2000,
        intervalMs: 1,
        sshExec: async (argv) => {
          probe = argv.at(-1) ?? "";
          return { code: 0, stdout: "LOCUS_READY\n", stderr: "" };
        },
      },
    );
    expect(ok).toBe(true);
    expect(probe).toContain("-EncodedCommand");
  });
});

describe("guestReadyTimeoutMs", () => {
  it("gives Omarchy the long ISO-install window", async () => {
    const { guestReadyTimeoutMs } = await import("./ready.js");
    expect(guestReadyTimeoutMs("ubuntu")).toBe(1_800_000);
    expect(guestReadyTimeoutMs("omarchy")).toBe(2_400_000);
    expect(guestReadyTimeoutMs("windows-11")).toBe(2_400_000);
  });
});
