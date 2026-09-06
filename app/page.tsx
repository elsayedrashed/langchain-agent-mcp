"use client";

import { useEffect, useState, type FormEvent } from "react";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import AssistantResponseCard from "@/components/AssistantResponseCard";
import {
  createBrowserConversation,
  initializeBrowserConversation,
} from "@/lib/chat/conversation-client";
import { getChatMessageText } from "@/lib/chat/messages";
import type { ChatMessage } from "@/types/chat";

const CONVERSATION_STORAGE_KEY = "astra-conversation-id";

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const [isRestoring, setIsRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<string>();
  const [lastRequest, setLastRequest] = useState<{
    text: string;
    requestId: string;
  }>();
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    error: chatError,
    clearError,
  } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    onData: (dataPart) => {
      if (dataPart.type === "data-norris-fact") {
        console.trace("norris fact:", dataPart.data);
      }
    },
  });
  const isLoading =
    isRestoring || status === "submitted" || status === "streaming";

  useEffect(() => {
    let active = true;

    async function restoreConversation() {
      try {
        const storedId = window.localStorage.getItem(CONVERSATION_STORAGE_KEY);
        const conversation = await initializeBrowserConversation(storedId);

        if (!active) return;
        setConversationId(conversation.id);
        setMessages(conversation.messages);
        window.localStorage.setItem(
          CONVERSATION_STORAGE_KEY,
          conversation.id,
        );
      } catch (error) {
        if (!active) return;
        console.error("Failed to restore conversation:", error);
        setRestoreError("Could not restore the conversation.");
      } finally {
        if (active) setIsRestoring(false);
      }
    }

    void restoreConversation();
    return () => {
      active = false;
    };
  }, [setMessages]);

  async function startNewConversation() {
    if (isLoading) return;

    setIsRestoring(true);
    setRestoreError(undefined);
    clearError();
    try {
      const conversation = await createBrowserConversation();
      setConversationId(conversation.id);
      setMessages([]);
      setLastRequest(undefined);
      window.localStorage.setItem(CONVERSATION_STORAGE_KEY, conversation.id);
    } catch (error) {
      console.error("Failed to create conversation:", error);
      setRestoreError("Could not create a new conversation.");
    } finally {
      setIsRestoring(false);
    }
  }

  function sendPersistedMessage(
    text: string,
    requestId: string,
    retry = false,
  ) {
    if (!conversationId) return;

    clearError();
    void sendMessage(
      retry
        ? undefined
        : {
            id: requestId,
            parts: [{ type: "text", text }],
          },
      { body: { conversationId, requestId } },
    );
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading || !conversationId) return;

    const requestId = crypto.randomUUID();
    setLastRequest({ text, requestId });
    sendPersistedMessage(text, requestId);
    setInput("");
  };

  return (
    <div className="flex flex-col max-w-2xl mx-auto p-4 space-y-4 h-screen">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Astra AI</h1>
        <button
          type="button"
          className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          onClick={() => void startNewConversation()}
          disabled={isLoading}
        >
          New conversation
        </button>
      </div>

      {(restoreError || chatError) && (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          <div>{restoreError ?? "The assistant response failed."}</div>
          {chatError && lastRequest && conversationId && (
            <button
              type="button"
              className="mt-2 font-medium underline"
              onClick={() =>
                sendPersistedMessage(
                  lastRequest.text,
                  lastRequest.requestId,
                  true,
                )
              }
            >
              Retry response
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto border border-gray-300 rounded-lg p-4 space-y-4 bg-gray-50">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            Ask for a Chuck Norris Fact or Joke!
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const content = getChatMessageText(msg);

          if (isUser) {
            return (
              <div
                key={msg.id}
                className="p-3 rounded-lg max-w-[80%] bg-blue-500 text-white ml-auto"
              >
                <div className="text-sm font-medium mb-1 text-blue-100">You</div>
                <div className="whitespace-pre-wrap">{content}</div>
              </div>
            );
          }

          return content ? (
            <AssistantResponseCard key={msg.id} content={content} />
          ) : (
            <div
              key={msg.id}
              className="p-3 rounded-lg max-w-[80%] bg-white border shadow-sm"
            >
              <div className="text-sm font-medium mb-1 text-gray-600">AI / Tool</div>
              <div className="whitespace-pre-wrap">{content}</div>
            </div>
          );
        })}

        {isLoading && (
          <div className="bg-white border shadow-sm p-3 rounded-lg max-w-[80%]">
            <div className="text-sm font-medium mb-1 text-gray-600">AI</div>
            <div className="flex items-center space-x-2 text-gray-500">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0.1s" }}
                ></div>
                <div
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0.2s" }}
                ></div>
              </div>
              <span className="text-sm">Thinking...</span>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex space-x-3">
        <input
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask for a Chuck Norris joke or question..."
          disabled={isLoading || !conversationId}
        />
        <button
          type="submit"
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          disabled={isLoading || !conversationId || !input.trim()}
        >
          {isLoading ? "..." : "Send"}
        </button>
      </form>
    </div>
  );
}
