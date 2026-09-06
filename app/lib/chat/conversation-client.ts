import { z } from "zod";
import {
  conversationDetailSchema,
  type ConversationDetail,
} from "@/types/conversation";

const conversationIdSchema = z.string().uuid();
let initializationPromise: Promise<ConversationDetail> | undefined;

async function readConversationResponse(
  response: Response,
): Promise<ConversationDetail> {
  if (!response.ok) {
    throw new Error(`Conversation request failed with status ${response.status}.`);
  }

  const body = await response.json();
  const parsedBody = z
    .object({ conversation: conversationDetailSchema })
    .safeParse(body);
  if (!parsedBody.success) {
    throw new Error("Conversation response has an invalid structure.");
  }
  return parsedBody.data.conversation;
}

export async function createBrowserConversation(): Promise<ConversationDetail> {
  const response = await fetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  return readConversationResponse(response);
}

export async function loadBrowserConversation(
  conversationId: string,
): Promise<ConversationDetail | null> {
  if (!conversationIdSchema.safeParse(conversationId).success) return null;

  const response = await fetch(
    `/api/conversations/${encodeURIComponent(conversationId)}`,
  );
  if (response.status === 404) return null;
  return readConversationResponse(response);
}

export function initializeBrowserConversation(
  storedConversationId: string | null,
): Promise<ConversationDetail> {
  if (!initializationPromise) {
    const pendingInitialization = (async () => {
      const existingConversation = storedConversationId
        ? await loadBrowserConversation(storedConversationId)
        : null;
      return existingConversation ?? createBrowserConversation();
    })();

    initializationPromise = pendingInitialization;
    void pendingInitialization.then(
      () => {
        if (initializationPromise === pendingInitialization) {
          initializationPromise = undefined;
        }
      },
      () => {
        if (initializationPromise === pendingInitialization) {
          initializationPromise = undefined;
        }
      },
    );
  }

  return initializationPromise;
}
