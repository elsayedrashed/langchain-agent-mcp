import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ChatMessage } from "@/types/chat";
import type {
  ConversationDetail,
  ConversationSummary,
} from "@/types/conversation";

const STORE_VERSION = 1;
const PENDING_TURN_TIMEOUT_MS = 5 * 60 * 1000;
const STORE_DIRECTORY = path.resolve(
  process.env.CONVERSATION_DATA_DIR ?? path.join(process.cwd(), ".data"),
);
const STORE_PATH = path.join(STORE_DIRECTORY, "conversations.json");

const storedMessageSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  status: z.enum(["pending", "completed", "failed"]),
  sequenceNumber: z.number().int().positive(),
  model: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const storedToolRunSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
  toolCallId: z.string(),
  toolName: z.string(),
  output: z.string(),
  status: z.enum(["completed", "failed"]),
  createdAt: z.string().datetime(),
});

const storedConversationSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  title: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
  messages: z.array(storedMessageSchema),
  toolRuns: z.array(storedToolRunSchema).default([]),
});

const conversationStoreSchema = z.object({
  version: z.literal(STORE_VERSION),
  conversations: z.array(storedConversationSchema),
});

type StoredMessage = z.infer<typeof storedMessageSchema>;
type StoredConversation = z.infer<typeof storedConversationSchema>;
type ConversationStore = z.infer<typeof conversationStoreSchema>;

export type BeginTurnResult = {
  assistantMessageId: string;
  history: StoredMessage[];
  existingAnswer?: string;
};

export type ToolRunInput = {
  toolCallId: string;
  toolName: string;
  output: string;
  status: "completed" | "failed";
};

export class ConversationNotFoundError extends Error {
  constructor() {
    super("Conversation not found.");
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationBusyError extends Error {
  constructor() {
    super("This conversation already has a response in progress.");
    this.name = "ConversationBusyError";
  }
}

export class ConversationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationConflictError";
  }
}

let storeQueue: Promise<void> = Promise.resolve();

async function withStoreLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = storeQueue.then(operation, operation);
  storeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function emptyStore(): ConversationStore {
  return { version: STORE_VERSION, conversations: [] };
}

async function readStore(): Promise<ConversationStore> {
  let fileContent: string;
  try {
    fileContent = await readFile(STORE_PATH, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return emptyStore();
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`Conversation store contains invalid JSON: ${STORE_PATH}`, {
      cause: error,
    });
  }

  const validated = conversationStoreSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `Conversation store has an invalid structure: ${validated.error.message}`,
    );
  }

  return validated.data;
}

async function writeStore(store: ConversationStore): Promise<void> {
  await mkdir(STORE_DIRECTORY, { recursive: true });
  const temporaryPath = `${STORE_PATH}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, STORE_PATH);
}

function findOwnedConversation(
  store: ConversationStore,
  ownerId: string,
  conversationId: string,
): StoredConversation {
  const conversation = store.conversations.find(
    (candidate) =>
      candidate.id === conversationId && candidate.ownerId === ownerId,
  );
  if (!conversation) throw new ConversationNotFoundError();
  return conversation;
}

function toSummary(conversation: StoredConversation): ConversationSummary {
  const {
    ownerId: _ownerId,
    messages,
    toolRuns: _toolRuns,
    ...summary
  } = conversation;
  return { ...summary, messageCount: messages.length };
}

function toChatMessage(message: StoredMessage): ChatMessage | null {
  if (message.status !== "completed") return null;

  if (message.role === "user") {
    return {
      id: message.id,
      role: "user",
      parts: [{ type: "text", text: message.content }],
    };
  }

  return {
    id: message.id,
    role: "assistant",
    parts: [
      {
        type: "data-norris-fact",
        id: message.id,
        data: { content: message.content },
      },
    ],
  };
}

function toDetail(conversation: StoredConversation): ConversationDetail {
  const {
    ownerId: _ownerId,
    messages,
    toolRuns: _toolRuns,
    ...detail
  } = conversation;
  return {
    ...detail,
    messages: messages
      .map(toChatMessage)
      .filter((message): message is ChatMessage => message !== null),
  };
}

export async function createConversation(
  ownerId: string,
  title = "New conversation",
): Promise<ConversationDetail> {
  return withStoreLock(async () => {
    const store = await readStore();
    const now = new Date().toISOString();
    const conversation: StoredConversation = {
      id: randomUUID(),
      ownerId,
      title: title.trim().slice(0, 80) || "New conversation",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      messages: [],
      toolRuns: [],
    };
    store.conversations.push(conversation);
    await writeStore(store);
    return toDetail(conversation);
  });
}

export async function listConversations(
  ownerId: string,
): Promise<ConversationSummary[]> {
  return withStoreLock(async () => {
    const store = await readStore();
    return store.conversations
      .filter((conversation) => conversation.ownerId === ownerId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(toSummary);
  });
}

export async function getConversation(
  ownerId: string,
  conversationId: string,
): Promise<ConversationDetail> {
  return withStoreLock(async () => {
    const store = await readStore();
    return toDetail(findOwnedConversation(store, ownerId, conversationId));
  });
}

export async function setConversationArchived(
  ownerId: string,
  conversationId: string,
  archived: boolean,
): Promise<ConversationDetail> {
  return withStoreLock(async () => {
    const store = await readStore();
    const conversation = findOwnedConversation(
      store,
      ownerId,
      conversationId,
    );
    const now = new Date().toISOString();
    conversation.archivedAt = archived ? now : null;
    conversation.updatedAt = now;
    await writeStore(store);
    return toDetail(conversation);
  });
}

export async function deleteConversation(
  ownerId: string,
  conversationId: string,
): Promise<void> {
  return withStoreLock(async () => {
    const store = await readStore();
    const index = store.conversations.findIndex(
      (conversation) =>
        conversation.id === conversationId && conversation.ownerId === ownerId,
    );
    if (index === -1) throw new ConversationNotFoundError();
    store.conversations.splice(index, 1);
    await writeStore(store);
  });
}

export async function beginConversationTurn(input: {
  ownerId: string;
  conversationId: string;
  requestId: string;
  content: string;
}): Promise<BeginTurnResult> {
  return withStoreLock(async () => {
    const store = await readStore();
    const conversation = findOwnedConversation(
      store,
      input.ownerId,
      input.conversationId,
    );
    if (conversation.archivedAt) {
      throw new ConversationConflictError(
        "Archived conversations cannot accept new messages.",
      );
    }

    const existingUser = conversation.messages.find(
      (message) =>
        message.requestId === input.requestId && message.role === "user",
    );
    if (existingUser && existingUser.content !== input.content) {
      throw new ConversationConflictError(
        "The request ID is already associated with different content.",
      );
    }

    const existingAssistant = conversation.messages.find(
      (message) =>
        message.requestId === input.requestId && message.role === "assistant",
    );

    if (existingAssistant?.status === "completed") {
      return {
        assistantMessageId: existingAssistant.id,
        existingAnswer: existingAssistant.content,
        history: conversation.messages.filter(
          (message) => message.status === "completed",
        ),
      };
    }

    if (existingAssistant?.status === "pending") {
      const pendingAge =
        Date.now() - new Date(existingAssistant.updatedAt).getTime();
      if (pendingAge <= PENDING_TURN_TIMEOUT_MS) {
        throw new ConversationBusyError();
      }
      existingAssistant.status = "failed";
    }

    const now = new Date().toISOString();

    if (!existingUser) {
      conversation.messages.push({
        id: input.requestId,
        requestId: input.requestId,
        role: "user",
        content: input.content,
        status: "completed",
        sequenceNumber: conversation.messages.length + 1,
        createdAt: now,
        updatedAt: now,
      });
    }

    let assistantMessage = existingAssistant;
    if (assistantMessage) {
      assistantMessage.status = "pending";
      assistantMessage.content = "";
      assistantMessage.updatedAt = now;
    } else {
      assistantMessage = {
        id: randomUUID(),
        requestId: input.requestId,
        role: "assistant",
        content: "",
        status: "pending",
        sequenceNumber: conversation.messages.length + 1,
        createdAt: now,
        updatedAt: now,
      };
      conversation.messages.push(assistantMessage);
    }

    if (conversation.title === "New conversation") {
      conversation.title = input.content.slice(0, 80);
    }
    conversation.updatedAt = now;
    await writeStore(store);

    return {
      assistantMessageId: assistantMessage.id,
      history: conversation.messages.filter(
        (message) => message.status === "completed",
      ),
    };
  });
}

export async function completeAssistantMessage(input: {
  ownerId: string;
  conversationId: string;
  assistantMessageId: string;
  content: string;
  model: string;
  toolRuns?: ToolRunInput[];
}): Promise<void> {
  return withStoreLock(async () => {
    const store = await readStore();
    const conversation = findOwnedConversation(
      store,
      input.ownerId,
      input.conversationId,
    );
    const message = conversation.messages.find(
      (candidate) =>
        candidate.id === input.assistantMessageId &&
        candidate.role === "assistant",
    );
    if (!message) throw new ConversationNotFoundError();

    const now = new Date().toISOString();
    message.content = input.content;
    message.status = "completed";
    message.model = input.model;
    message.updatedAt = now;
    conversation.toolRuns.push(
      ...(input.toolRuns ?? []).map((toolRun) => ({
        id: randomUUID(),
        messageId: message.id,
        ...toolRun,
        createdAt: now,
      })),
    );
    conversation.updatedAt = now;
    await writeStore(store);
  });
}

export async function failAssistantMessage(input: {
  ownerId: string;
  conversationId: string;
  assistantMessageId: string;
}): Promise<void> {
  return withStoreLock(async () => {
    const store = await readStore();
    const conversation = findOwnedConversation(
      store,
      input.ownerId,
      input.conversationId,
    );
    const message = conversation.messages.find(
      (candidate) =>
        candidate.id === input.assistantMessageId &&
        candidate.role === "assistant",
    );
    if (!message) throw new ConversationNotFoundError();

    const now = new Date().toISOString();
    message.status = "failed";
    message.updatedAt = now;
    conversation.updatedAt = now;
    await writeStore(store);
  });
}
