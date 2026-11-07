import {
  BUILTIN_SLASH_NAMES,
  formatSkillPrompt,
  lastUserMessage,
  parsePlanCommand,
  parseSkillCommand,
  pasteChipPromptMatches,
  promptMatchesQueue,
  slashCommandFromInput,
  type AgentRuntime,
  type AgentSkill,
  type ChatMessage,
  type PromptQueueItem,
  type SlashCommand,
} from "@locus/shared";

export type ChatLandedSession = {
  status: string;
  messages: ChatMessage[];
  queue?: PromptQueueItem[];
};

export type ComposerIntent =
  | { kind: "noop" }
  | { kind: "plan-mode" }
  | { kind: "plan-task"; task: string }
  | { kind: "slash"; command: SlashCommand }
  | { kind: "skill"; prompt: string; skillName: string }
  | { kind: "chat"; content: string; plan: boolean; steer: boolean };

export type ChatPostOpts = {
  plan?: boolean;
  skill?: string;
  steer?: boolean;
  attachments?: Array<{ name: string; mime?: string; contentBase64: string }>;
  focusPath?: string;
  assetRefs?: string[];
};

export type EchoAttachment = { name: string; type?: string; size: number };

export const DROPPED_CHAT_ERROR =
  "Couldn't send — connection dropped. Your message is still in the box.";

/** Plan / slash / skill / steer vs a normal Turn send. Queue bypasses this and always chats. */
export function resolveComposerIntent(input: {
  text: string;
  fileCount: number;
  turning: boolean;
  planning: boolean;
  runtime: AgentRuntime;
  skills: AgentSkill[];
}): ComposerIntent {
  if (!input.text.trim() && input.fileCount === 0) return { kind: "noop" };
  const planTask = parsePlanCommand(input.text);
  if (planTask !== undefined) {
    return planTask ? { kind: "plan-task", task: planTask } : { kind: "plan-mode" };
  }
  const command = slashCommandFromInput(input.text, input.runtime);
  if (command) return { kind: "slash", command };
  const skillHit = parseSkillCommand(input.text, input.skills, BUILTIN_SLASH_NAMES);
  if (skillHit) {
    return {
      kind: "skill",
      prompt: formatSkillPrompt(skillHit.skill, skillHit.rest),
      skillName: skillHit.skill.name,
    };
  }
  return {
    kind: "chat",
    content: input.text,
    plan: input.planning,
    steer: input.turning,
  };
}

/** True when POST /chat likely landed even though the client lost the response. */
export function chatPromptLanded(session: ChatLandedSession, content: string): boolean {
  const last = lastUserMessage(session.messages);
  if (!last) return false;
  if (!pasteChipPromptMatches(content, last.content)) return false;
  const index = session.messages.lastIndexOf(last);
  const after = session.messages.slice(index + 1);
  if (session.status === "running") return true;
  return !after.some((message) => message.role === "assistant" && message.content.trim());
}

export function outboundPromptLanded(session: ChatLandedSession, pending: ChatMessage): boolean {
  if (chatPromptLanded(session, pending.content)) return true;
  if (promptMatchesQueue(session.queue, pending.content)) return true;
  if (pending.content.trim()) return false;
  const last = lastUserMessage(session.messages);
  return Boolean(last && last.createdAt >= pending.createdAt);
}

export function echoUserMessage(
  content: string,
  opts?: { steer?: boolean; files?: EchoAttachment[] },
): ChatMessage {
  const files = opts?.files ?? [];
  return {
    id: `pending-${Date.now()}`,
    role: "user",
    content: content.trim(),
    steer: opts?.steer || undefined,
    attachments: files.length
      ? files.map((file) => ({
          name: file.name,
          mime: file.type || "application/octet-stream",
          bytes: file.size,
          storedName: file.name,
        }))
      : undefined,
    createdAt: new Date().toISOString(),
  };
}

export function chatPostBody(opts: ChatPostOpts): ChatPostOpts | undefined {
  const body: ChatPostOpts = {
    ...(opts.plan ? { plan: true } : {}),
    ...(opts.skill ? { skill: opts.skill } : {}),
    ...(opts.steer ? { steer: true } : {}),
    ...(opts.attachments ? { attachments: opts.attachments } : {}),
    ...(opts.focusPath ? { focusPath: opts.focusPath } : {}),
    ...(opts.assetRefs?.length ? { assetRefs: opts.assetRefs } : {}),
  };
  return Object.keys(body).length ? body : undefined;
}

export function recoverDroppedChat(
  fresh: ChatLandedSession | null,
  content: string,
): "landed" | "restore" {
  if (fresh && chatPromptLanded(fresh, content)) return "landed";
  return "restore";
}
