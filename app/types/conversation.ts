import { z } from "zod";
import {
  norrisFactDataSchema,
  type ChatMessage,
} from "@/types/chat";

const restoredMessageSchema = z.discriminatedUnion("role", [
  z.object({
    id: z.string().uuid(),
    role: z.literal("user"),
    parts: z.array(
      z.object({
        type: z.literal("text"),
        text: z.string(),
      }),
    ),
  }),
  z.object({
    id: z.string().uuid(),
    role: z.literal("assistant"),
    parts: z.array(
      z.object({
        type: z.literal("data-norris-fact"),
        id: z.string().uuid(),
        data: norrisFactDataSchema,
      }),
    ),
  }),
]);

const conversationBaseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
});

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  messageCount: number;
};

export type ConversationDetail = Omit<ConversationSummary, "messageCount"> & {
  messages: ChatMessage[];
};

export const conversationSummarySchema: z.ZodType<ConversationSummary> =
  conversationBaseSchema.extend({
  messageCount: z.number().int().nonnegative(),
});

export const conversationDetailSchema: z.ZodType<ConversationDetail> =
  conversationBaseSchema.extend({
    messages: z.array(restoredMessageSchema),
  });
