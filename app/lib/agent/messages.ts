import {
  AIMessage,
  BaseMessage,
  HumanMessage,
} from "@langchain/core/messages";
import { getIncomingMessageText } from "@/lib/chat/messages";
import type { IncomingChatMessage } from "@/lib/chat/request";

export const AGENT_HISTORY_LIMITS = {
  maxMessages: 20,
  maxCharacters: 48_000,
} as const;

function toLangChainMessage(message: IncomingChatMessage): BaseMessage | null {
  const text = getIncomingMessageText(message);
  if (!text) return null;

  if (message.role === "assistant") {
    return new AIMessage(text);
  }

  return new HumanMessage(text);
}

export function toLangChainMessages(
  messages: IncomingChatMessage[],
): BaseMessage[] {
  const converted = messages
    .map(toLangChainMessage)
    .filter((message): message is BaseMessage => message !== null);

  const selected: BaseMessage[] = [];
  let characterCount = 0;

  for (let index = converted.length - 1; index >= 0; index -= 1) {
    if (selected.length >= AGENT_HISTORY_LIMITS.maxMessages) break;

    const message = converted[index];
    const nextCharacterCount = characterCount + message.text.length;

    // Always retain the newest message, then keep only a contiguous suffix.
    if (
      selected.length > 0 &&
      nextCharacterCount > AGENT_HISTORY_LIMITS.maxCharacters
    ) {
      break;
    }

    selected.push(message);
    characterCount = nextCharacterCount;
  }

  return selected.reverse();
}
