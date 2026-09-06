import { randomUUID } from "node:crypto";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import {
  type AIMessage,
  type BaseMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { toLangChainMessages } from "@/lib/agent/messages";
import {
  applySessionCookie,
  getAnonymousSession,
  type AnonymousSession,
} from "@/lib/auth/session";
import {
  chatRequestSchema,
  getRequestMessages,
  isRequestBodyTooLarge,
} from "@/lib/chat/request";
import { getIncomingMessageText } from "@/lib/chat/messages";
import {
  beginConversationTurn,
  completeAssistantMessage,
  ConversationBusyError,
  ConversationConflictError,
  ConversationNotFoundError,
  createConversation,
  failAssistantMessage,
  type ToolRunInput,
} from "@/lib/persistence/conversations";
import type { ChatMessage } from "@/types/chat";
import {
  createMainAgent,
  getMainAgentModelName,
  type MainAgent,
} from "@/agents/main-agent";

export const runtime = "nodejs";

async function createMCPClient() {
  console.log("[DEBUG] Creating MCP client...");
  const client = new MultiServerMCPClient({
    useStandardContentBlocks: true,
    mcpServers: {
      norris: {
        transport: "stdio",
        command: process.execPath,
        args: ["--import", "tsx", "app/mcp/norris-mcp-server.ts"],
      },
      weather: {
        transport: "stdio",
        command: process.execPath,
        args: ["--import", "tsx", "app/mcp/weather-mcp-server.ts"],
      },
      time: {
        transport: "stdio",
        command: process.execPath,
        args: ["--import", "tsx", "app/mcp/time-mcp-server.ts"],
      },
      exchangeRates: {
        transport: "stdio",
        command: process.execPath,
        args: ["--import", "tsx", "app/mcp/exchange-rates-mcp-server.ts"],
      },
    },
  });

  const tools = await client.getTools();
  console.log("[DEBUG] MCP client initialized with tools:", tools.map(t => t.name));
  return { client, tools };
}

type AgentResult = {
  aiMessage?: AIMessage;
  toolRuns: ToolRunInput[];
};

function getMessageText(message: BaseMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((content) => ("text" in content ? content.text : ""))
    .filter(Boolean)
    .join(" ");
}

async function invokeAgent(
  agent: MainAgent,
  messages: BaseMessage[],
): Promise<AgentResult> {
  console.log("[DEBUG] Invoking agents with messages:", messages.length);
  const result = await agent.invoke({ messages });
  console.log("[DEBUG] Agent returned messages:", result.messages);
  return {
    aiMessage: result.messages
      .filter((message): message is AIMessage => message.type === "ai")
      .pop(),
    toolRuns: result.messages
      .filter((message): message is ToolMessage =>
        ToolMessage.isInstance(message),
      )
      .map((message) => ({
        toolCallId: message.tool_call_id,
        toolName: message.name ?? "unknown-tool",
        output: getMessageText(message),
        status: message.status === "error" ? "failed" : "completed",
      })),
  };
}

function getAIMessageText(aiMessage: AIMessage | undefined): string {
  if (!aiMessage) return "";
  if (typeof aiMessage.content === "string") return aiMessage.content;

  return aiMessage.content
    .map((content) => ("text" in content ? content.text : ""))
    .filter(Boolean)
    .join(" ");
}

function streamMessage(content: string, messageId: string) {
  return createUIMessageStream<ChatMessage>({
    execute: async ({ writer }) => {
      console.log("[STREAM] AI message:", messageId, content);
      writer.write({
        type: "data-norris-fact",
        data: { content },
        id: messageId,
      });
    },
  });
}

function conversationResponse(
  response: Response,
  session: AnonymousSession,
  conversationId: string,
): Response {
  response.headers.set("x-conversation-id", conversationId);
  return applySessionCookie(response, session);
}

export async function POST(req: Request) {
  let session: AnonymousSession | undefined;

  try {
    if (isRequestBodyTooLarge(req)) {
      return Response.json(
        { error: "Chat request exceeds the maximum allowed size." },
        { status: 413 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const parsedRequest = chatRequestSchema.safeParse(body);
    if (!parsedRequest.success) {
      return Response.json(
        {
          error: "Invalid chat request.",
          issues: parsedRequest.error.issues.map(({ path, message }) => ({
            path,
            message,
          })),
        },
        { status: 400 },
      );
    }

    const rawMessages = getRequestMessages(parsedRequest.data);
    const lastRawMessage = rawMessages[rawMessages.length - 1];
    if (lastRawMessage.role !== "user") {
      return Response.json(
        { error: "The latest message must have the user role." },
        { status: 400 },
      );
    }

    const normalizedMessage = getIncomingMessageText(lastRawMessage);
    if (!normalizedMessage) {
      return Response.json(
        { error: "The latest message must contain text." },
        { status: 400 },
      );
    }

    console.log("[DEBUG] Normalized user message:", normalizedMessage);
    session = await getAnonymousSession(req);
    const conversationId =
      parsedRequest.data.conversationId ??
      (await createConversation(session.ownerId)).id;
    const requestId = parsedRequest.data.requestId ?? randomUUID();

    try {
      const turn = await beginConversationTurn({
        ownerId: session.ownerId,
        conversationId,
        requestId,
        content: normalizedMessage,
      });

      if (turn.existingAnswer) {
        const stream = streamMessage(
          turn.existingAnswer,
          turn.assistantMessageId,
        );
        return conversationResponse(
          createUIMessageStreamResponse({ stream }),
          session,
          conversationId,
        );
      }

      try {
        const agentMessages = toLangChainMessages(turn.history);
        const { client, tools } = await createMCPClient();
        let agentResult: AgentResult;

        try {
          const agent = createMainAgent(tools);
          agentResult = await invokeAgent(agent, agentMessages);
        } finally {
          await client.close();
        }

        const aiContent = getAIMessageText(agentResult.aiMessage);
        if (!aiContent) {
          throw new Error("The agents returned no assistant text.");
        }

        await completeAssistantMessage({
          ownerId: session.ownerId,
          conversationId,
          assistantMessageId: turn.assistantMessageId,
          content: aiContent,
          model: getMainAgentModelName(),
          toolRuns: agentResult.toolRuns,
        });

        const stream = streamMessage(aiContent, turn.assistantMessageId);
        return conversationResponse(
          createUIMessageStreamResponse({ stream }),
          session,
          conversationId,
        );
      } catch (error) {
        try {
          await failAssistantMessage({
            ownerId: session.ownerId,
            conversationId,
            assistantMessageId: turn.assistantMessageId,
          });
        } catch (persistenceError) {
          console.error(
            "[ERROR] Failed to mark assistant message as failed:",
            persistenceError,
          );
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof ConversationNotFoundError) {
        return conversationResponse(
          Response.json({ error: error.message }, { status: 404 }),
          session,
          conversationId,
        );
      }
      if (error instanceof ConversationBusyError) {
        return conversationResponse(
          Response.json({ error: error.message }, { status: 409 }),
          session,
          conversationId,
        );
      }
      if (error instanceof ConversationConflictError) {
        return conversationResponse(
          Response.json({ error: error.message }, { status: 409 }),
          session,
          conversationId,
        );
      }
      throw error;
    }
  } catch (err) {
    console.error("[ERROR] /api/chat failed:", err);
    const response = new Response(JSON.stringify({ error: "Chat request failed." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
    return session ? applySessionCookie(response, session) : response;
  }
}