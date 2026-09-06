import { z } from "zod";
import {
  norrisFactDataSchema,
  notificationDataSchema,
} from "@/types/chat";

export const CHAT_REQUEST_LIMITS = {
  maxBodyBytes: 256 * 1024,
  maxMessages: 50,
  maxPartsPerMessage: 100,
  maxTextLength: 16_000,
} as const;

const textPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().max(CHAT_REQUEST_LIMITS.maxTextLength),
  })
  .passthrough();

const norrisFactPartSchema = z
  .object({
    type: z.literal("data-norris-fact"),
    id: z.string().max(128).optional(),
    data: norrisFactDataSchema,
  })
  .passthrough();

const notificationPartSchema = z
  .object({
    type: z.literal("data-notification"),
    id: z.string().max(128).optional(),
    data: notificationDataSchema,
  })
  .passthrough();

const contentPartSchema = z
  .object({
    text: z.string().max(CHAT_REQUEST_LIMITS.maxTextLength).optional(),
  })
  .passthrough();

export const incomingChatMessageSchema = z
  .object({
    id: z.string().max(128).optional(),
    role: z.enum(["user", "assistant"]),
    parts: z
      .array(
        z.union([
          textPartSchema,
          norrisFactPartSchema,
          notificationPartSchema,
        ]),
      )
      .max(CHAT_REQUEST_LIMITS.maxPartsPerMessage)
      .optional(),
    content: z
      .union([
        z.string().max(CHAT_REQUEST_LIMITS.maxTextLength),
        z
          .array(contentPartSchema)
          .max(CHAT_REQUEST_LIMITS.maxPartsPerMessage),
      ])
      .optional(),
  })
  .refine(
    (message) => message.parts !== undefined || message.content !== undefined,
    { message: "Each message must include parts or content." },
  )
  .passthrough();

export const chatRequestSchema = z
  .object({
    conversationId: z.string().uuid().optional(),
    requestId: z.string().uuid().optional(),
    messages: z
      .array(incomingChatMessageSchema)
      .min(1)
      .max(CHAT_REQUEST_LIMITS.maxMessages)
      .optional(),
    input: z
      .string()
      .trim()
      .min(1)
      .max(CHAT_REQUEST_LIMITS.maxTextLength)
      .optional(),
  })
  .refine((request) => request.messages !== undefined || request.input !== undefined, {
    message: "Provide messages or input.",
  });

export type IncomingChatMessage = z.infer<typeof incomingChatMessageSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export function getRequestMessages(request: ChatRequest): IncomingChatMessage[] {
  if (request.messages) return request.messages;

  return [{ role: "user", content: request.input ?? "" }];
}

export function isRequestBodyTooLarge(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return false;

  const parsedLength = Number(contentLength);
  return (
    Number.isFinite(parsedLength) &&
    parsedLength > CHAT_REQUEST_LIMITS.maxBodyBytes
  );
}
