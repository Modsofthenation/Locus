import {
  clusterChatThread,
  isHiddenChatMessage,
  operatorVisibleText,
  type ChatMessage,
} from "@locus/shared";

type FindBlock = { id: string; text: string };

let findBlocksCache: { messages: ChatMessage[]; blocks: FindBlock[] } | undefined;

function findBlocks(messages: ChatMessage[]): FindBlock[] {
  if (findBlocksCache?.messages === messages) return findBlocksCache.blocks;
  const blocks: FindBlock[] = [];
  for (const block of clusterChatThread(messages.filter((row) => !isHiddenChatMessage(row)))) {
    const tools = block.kind === "turn" ? block.tools : [];
    const text = [block.message, ...tools]
      .map((row) => operatorVisibleText(row.role, row.content))
      .join("\n")
      .toLowerCase();
    blocks.push({ id: block.message.id, text });
  }
  findBlocksCache = { messages, blocks };
  return blocks;
}

export function chatFindHits(messages: ChatMessage[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return findBlocks(messages)
    .filter((block) => block.text.includes(q))
    .map((block) => block.id);
}

export function stepChatFindIndex(hits: number, current: number, delta: number): number {
  if (hits <= 0) return 0;
  return (current + delta + hits * 8) % hits;
}
