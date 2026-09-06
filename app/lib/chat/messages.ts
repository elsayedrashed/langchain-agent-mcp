import type { ChatMessage } from "@/types/chat";
import type { IncomingChatMessage } from "./request";

export function getChatMessageText(message: ChatMessage): string {
  if (message.role === "user") {
    return message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .filter(Boolean)
      .join("\n");
  }

  return message.parts
    .flatMap((part) =>
      part.type === "data-norris-fact" &&
      (!part.id || !part.id.endsWith("-user"))
        ? [part.data.content]
        : [],
    )
    .join("\n");
}

export function getIncomingMessageText(message: IncomingChatMessage): string {
  if (message.parts?.length) {
    return message.parts
      .flatMap((part) => {
        if (part.type === "text") return [part.text];
        if (
          message.role === "assistant" &&
          part.type === "data-norris-fact"
        ) {
          return [part.data.content];
        }
        return [];
      })
      .join(" ")
      .trim();
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => part.text ?? "")
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  return message.content?.trim() ?? "";
}
