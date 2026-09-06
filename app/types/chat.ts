import type { UIMessage } from "ai";
import { z } from "zod";

export const norrisFactDataSchema = z.object({
  content: z.string().max(32_000),
});

export const notificationDataSchema = z.object({
  message: z.string().max(2_000),
  level: z.enum(["info", "warning", "error"]),
});

export type ChatDataParts = {
  "norris-fact": z.infer<typeof norrisFactDataSchema>;
  notification: z.infer<typeof notificationDataSchema>;
};

export type ChatMessage = UIMessage<unknown, ChatDataParts>;
