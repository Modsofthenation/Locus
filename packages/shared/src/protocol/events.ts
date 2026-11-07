import type { AgentSession, ChatMessage, ToolCall } from "../models/session.js";
import type { ToolOverlay } from "../models/tools.js";
import type { VmInstance, VmLifecycle } from "../models/vm.js";
import type { Automation, AutomationRun } from "../models/automation.js";
import type { BoardDocument } from "../models/board.js";
import type { ProjectDocument } from "../models/project.js";
import type {
  IssueDetail,
  IssueRef,
  LinkedRepo,
  PullRequestDetail,
  PullRequestRef,
} from "../models/repo.js";
import type { SlackConversation, SlackMessage } from "../models/slack.js";

export type ClientEvent =
  | { type: "session.updated"; session: AgentSession }
  | { type: "session.deleted"; id: string }
  | { type: "vm.updated"; vm: VmInstance }
  | { type: "vm.status"; id: string; status: VmLifecycle; error?: string }
  | { type: "chat.delta"; sessionId: string; messageId: string; delta: string }
  | { type: "chat.thinking"; sessionId: string; snippet: string }
  | { type: "chat.thinkingDelta"; sessionId: string; messageId: string; delta: string }
  | {
      type: "clone.progress";
      sessionId: string;
      percent: number;
      phase: string;
      done?: boolean;
      clear?: boolean;
      phasePercent?: number;
      received?: number;
      total?: number;
      size?: string;
      rate?: string;
    }
  | {
      type: "image.progress";
      sessionId: string;
      percent: number;
      phase: string;
      done?: boolean;
      clear?: boolean;
      step?: number;
      total?: number;
      cached?: boolean;
      detail?: string;
    }
  | {
      type: "qemu.install.progress";
      phase: string;
      log: string;
      percent: number;
      done?: boolean;
      error?: string;
      clear?: boolean;
    }
  | { type: "canvas.updated"; sessionId: string; html: string; mtime?: string }
  | { type: "workspace.changed"; sessionId: string; paths?: string[] }
  | { type: "chat.message"; sessionId: string; message: ChatMessage }
  | { type: "chat.done"; sessionId: string; messageId: string }
  | { type: "tool.updated"; sessionId: string; toolCall: ToolCall }
  | ({ type: "tool.overlay" } & ToolOverlay)
  | { type: "terminal.data"; vmId: string; data: string }
  | { type: "display.frame"; vmId: string; mime: string; dataBase64: string }
  | { type: "automation.updated"; automation: Automation }
  | { type: "automation.deleted"; id: string }
  | { type: "automation.run"; run: AutomationRun }
  | { type: "board.updated"; board: BoardDocument }
  | { type: "board.deleted"; id: string }
  | { type: "project.updated"; project: ProjectDocument }
  | { type: "project.deleted"; id: string }
  | { type: "brain.updated"; brain: import("../models/brain.js").BrainSummary }
  | { type: "repo.updated"; repo: LinkedRepo }
  | { type: "repo.deleted"; id: string }
  | { type: "pull.updated"; pull: PullRequestRef | PullRequestDetail }
  | { type: "issue.updated"; issue: IssueRef | IssueDetail }
  | {
      type: "slack.status";
      connected: boolean;
      socket: "up" | "down";
      teamId?: string;
      teamName?: string;
      userId?: string;
      userName?: string;
      avatarUrl?: string;
      canPostAsBot?: boolean;
    }
  | { type: "slack.channel"; conversation: SlackConversation }
  | { type: "slack.message"; message: SlackMessage }
  | {
      type: "slack.run";
      sessionId: string;
      channelId: string;
      threadTs: string;
      status: string;
    };

export type ServerCommand =
  | { type: "chat.send"; sessionId: string; content: string }
  | { type: "chat.abort"; sessionId: string }
  | { type: "vm.start"; sessionId: string }
  | { type: "vm.stop"; sessionId: string }
  | { type: "vm.pause"; sessionId: string }
  | { type: "vm.resume"; sessionId: string }
  | { type: "terminal.input"; vmId: string; data: string }
  | { type: "display.input"; vmId: string; payload: DisplayInput };

export type DisplayInput =
  | { kind: "mouse"; x: number; y: number; buttons: number }
  | { kind: "key"; down: boolean; key: string }
  | { kind: "clipboard"; text: string };
