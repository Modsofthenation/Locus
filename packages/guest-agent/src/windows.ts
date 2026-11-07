import type { GuestOs } from "@locus/shared";
import { isSupported } from "./commands.js";
import { isSshTransportError, SshGuestRuntime, type SshExec, type SshTarget } from "./ssh.js";
import type { GuestRuntime, ToolRequest, ToolResult } from "./types.js";
import { WinRmGuestRuntime, type WinRmPost, type WinRmTarget } from "./winrm.js";

export class WindowsGuestRuntime implements GuestRuntime {
  readonly os: GuestOs;
  readonly liveGuest = true;
  private readonly ssh?: SshGuestRuntime;
  private readonly winrm?: WinRmGuestRuntime;

  constructor(opts: {
    os?: GuestOs;
    ssh?: SshTarget;
    winrm?: WinRmTarget;
    sshExec?: SshExec;
    winrmPost?: WinRmPost;
  }) {
    this.os = opts.os ?? "windows-11";
    this.ssh = opts.ssh ? new SshGuestRuntime(this.os, opts.ssh, opts.sshExec) : undefined;
    this.winrm = opts.winrm
      ? new WinRmGuestRuntime(opts.winrm, opts.winrmPost, this.os)
      : undefined;
  }

  async syncHostDirToGuest(_hostDir: string, _guestDir: string): Promise<void> {}

  async prepareHostWorkspace(): Promise<void> {}

  chromium() {
    return undefined;
  }

  async execute(
    req: ToolRequest,
    signal?: AbortSignal,
    onOutput?: (chunk: string) => void,
  ): Promise<ToolResult> {
    if (!isSupported(this.os, req.name)) {
      return { ok: false, output: `${req.name} is not available on ${this.os}` };
    }
    if (this.ssh) {
      const result = await this.ssh.execute(req, signal, onOutput);
      if (!isSshTransportError(result)) return result;
      if (!this.winrm) return result;
    }
    if (this.winrm) return this.winrm.execute(req);
    return { ok: false, output: "Windows guest has no SSH or WinRM endpoint" };
  }
}
