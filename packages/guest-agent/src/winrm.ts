import { randomUUID } from "node:crypto";
import type { GuestOs } from "@locus/shared";
import { commandFor, isSupported, parseRecordScreenResult } from "./commands.js";
import type { GuestRuntime, ToolRequest, ToolResult } from "./types.js";

export interface WinRmTarget {
  host: string;
  port: number;
  username: string;
  password?: string;
}

export type WinRmPost = (
  url: string,
  headers: Record<string, string>,
  body: string,
  signal?: AbortSignal,
) => Promise<{ status: number; text: string }>;

const CMD_URI = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd";
const CREATE_ACTION = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Create";
const DELETE_ACTION = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Delete";
const COMMAND_ACTION = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Command";
const RECEIVE_ACTION = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Receive";

const IDENTIFY_BODY = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:wsmid="http://schemas.dmtf.org/wbem/wsman/identity/1/wsmanidentity.xsd">
  <s:Header/>
  <s:Body><wsmid:Identify/></s:Body>
</s:Envelope>`;

export function powershellEncodedCommand(script: string): string {
  return `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}

export class WinRmGuestRuntime implements GuestRuntime {
  readonly os: GuestOs;
  readonly liveGuest = true;

  constructor(
    private readonly target: WinRmTarget,
    private readonly post: WinRmPost = nodeWinRmPost,
    os: GuestOs = "windows-11",
  ) {
    this.os = os;
  }

  async syncHostDirToGuest(_hostDir: string, _guestDir: string): Promise<void> {}

  async prepareHostWorkspace(): Promise<void> {}

  chromium() {
    return undefined;
  }

  async execute(req: ToolRequest): Promise<ToolResult> {
    if (!isSupported(this.os, req.name)) {
      return { ok: false, output: `${req.name} is not available on ${this.os}` };
    }
    const script = commandFor(this.os, req);
    try {
      const result = await winrmRun(this.target, script, this.post);
      const output = (result.stdout || result.stderr).trim();
      if (req.name === "screenshot" && result.code === 0 && output.length > 80) {
        return {
          ok: true,
          output: "screenshot captured",
          screenshotBase64: output.replace(/\s/g, ""),
        };
      }
      if (req.name === "record_screen") {
        const parsed = parseRecordScreenResult(output);
        const cleaned = output.replace(/LOCUS_RECORDING:\S+\s*/g, "").trim();
        return { ok: result.code === 0, output: cleaned || `(exit ${result.code})`, ...parsed };
      }
      return { ok: result.code === 0, output: output || `(exit ${result.code})` };
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : "WinRM failed" };
    }
  }
}

export async function probeWinRm(
  target: WinRmTarget,
  opts: { post?: WinRmPost; signal?: AbortSignal } = {},
): Promise<boolean> {
  const post = opts.post ?? nodeWinRmPost;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/soap+xml;charset=UTF-8",
    };
    if (target.password) {
      headers.Authorization = `Basic ${Buffer.from(`${target.username}:${target.password}`).toString("base64")}`;
    }
    const res = await post(
      `http://${target.host}:${target.port}/wsman`,
      headers,
      IDENTIFY_BODY,
      opts.signal,
    );
    return res.status < 500 && res.text.includes("IdentifyResponse");
  } catch {
    return false;
  }
}

export async function winrmRun(
  target: WinRmTarget,
  script: string,
  post: WinRmPost = nodeWinRmPost,
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const url = `http://${target.host}:${target.port}/wsman`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const auth = basicAuth(target);
  const headers = (action: string): Record<string, string> => ({
    "Content-Type": "application/soap+xml;charset=UTF-8",
    SOAPAction: `"${action}"`,
    ...(auth ? { Authorization: auth } : {}),
  });

  const created = await post(
    url,
    headers(CREATE_ACTION),
    envelope(url, CREATE_ACTION, CMD_URI, shellBody()),
    signal,
  );
  const shellId = xmlValue(created.text, "ShellId");
  if (!shellId) throw new Error(created.text.slice(0, 300) || "WinRM create shell failed");

  try {
    const commandXml = envelope(
      url,
      COMMAND_ACTION,
      CMD_URI,
      `<rsp:CommandLine><rsp:Command>powershell.exe</rsp:Command><rsp:Arguments>-NoProfile</rsp:Arguments><rsp:Arguments>-NonInteractive</rsp:Arguments><rsp:Arguments>-EncodedCommand</rsp:Arguments><rsp:Arguments>${xmlEscape(encoded)}</rsp:Arguments></rsp:CommandLine>`,
      shellId,
    );
    const commanded = await post(url, headers(COMMAND_ACTION), commandXml, signal);
    const commandId = xmlValue(commanded.text, "CommandId");
    if (!commandId) throw new Error(commanded.text.slice(0, 300) || "WinRM command failed");

    let stdout = "";
    let stderr = "";
    let code = 1;
    for (let i = 0; i < 40; i++) {
      const receiveXml = envelope(
        url,
        RECEIVE_ACTION,
        CMD_URI,
        `<rsp:Receive><rsp:DesiredStream CommandId="${commandId}">stdout stderr</rsp:DesiredStream></rsp:Receive>`,
        shellId,
      );
      const received = await post(url, headers(RECEIVE_ACTION), receiveXml, signal);
      stdout += decodeStreams(received.text, "stdout");
      stderr += decodeStreams(received.text, "stderr");
      const exit = xmlValue(received.text, "ExitCode");
      if (exit !== undefined && exit !== "") code = Number(exit);
      if (received.text.includes("CommandState") && received.text.includes("Done")) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    return { code, stdout, stderr };
  } finally {
    await post(
      url,
      headers(DELETE_ACTION),
      envelope(url, DELETE_ACTION, CMD_URI, "", shellId),
      signal,
    ).catch(() => undefined);
  }
}

export function xmlValue(xml: string, tag: string): string | undefined {
  const named = xml.match(new RegExp(`Name="${tag}"[^>]*>([^<]*)`));
  if (named?.[1]) return named[1];
  const direct = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([^<]*)`));
  return direct?.[1];
}

function decodeStreams(xml: string, name: string): string {
  const re = new RegExp(`<(?:\\w+:)?Stream[^>]*Name="${name}"[^>]*>([^<]*)</`, "g");
  let out = "";
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const chunk = match[1] ?? "";
    if (!chunk) continue;
    try {
      out += Buffer.from(chunk, "base64").toString("utf8");
    } catch {
      out += chunk;
    }
  }
  return out;
}

function envelope(
  to: string,
  action: string,
  resource: string,
  body: string,
  shellId?: string,
): string {
  const selector = shellId
    ? `<w:SelectorSet><w:Selector Name="ShellId">${xmlEscape(shellId)}</w:Selector></w:SelectorSet>`
    : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:w="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
  <s:Header>
    <a:To>${xmlEscape(to)}</a:To>
    <a:ReplyTo><a:Address s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>
    <a:MessageID>uuid:${randomUUID()}</a:MessageID>
    <a:Action s:mustUnderstand="true">${action}</a:Action>
    <w:ResourceURI s:mustUnderstand="true">${resource}</w:ResourceURI>
    <w:MaxEnvelopeSize s:mustUnderstand="true">153600</w:MaxEnvelopeSize>
    <w:Locale xml:lang="en-US" s:mustUnderstand="false"/>
    <w:OperationTimeout>PT30S</w:OperationTimeout>
    ${selector}
  </s:Header>
  <s:Body>${body}</s:Body>
</s:Envelope>`;
}

function shellBody(): string {
  return `<rsp:Shell><rsp:InputStreams>stdin</rsp:InputStreams><rsp:OutputStreams>stdout stderr</rsp:OutputStreams></rsp:Shell>`;
}

function basicAuth(target: WinRmTarget): string | undefined {
  if (!target.password) return undefined;
  return `Basic ${Buffer.from(`${target.username}:${target.password}`).toString("base64")}`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function nodeWinRmPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal?: AbortSignal,
): Promise<{ status: number; text: string }> {
  const res = await fetch(url, { method: "POST", headers, body, signal });
  return { status: res.status, text: await res.text() };
}
