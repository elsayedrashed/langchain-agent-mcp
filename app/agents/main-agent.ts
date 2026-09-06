import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { createAgent } from "langchain";

export const DEFAULT_MAIN_AGENT_MODEL = "gemini-3.6-flash";

export function getMainAgentModelName(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MAIN_AGENT_MODEL;
}

export function createMainAgent(tools: DynamicStructuredTool[]) {
  const model = new ChatGoogleGenerativeAI({
    model: getMainAgentModelName(),
    temperature: 0,
    apiKey: process.env.GEMINI_API_KEY,
  });

  return createAgent({ model, tools });
}

export type MainAgent = ReturnType<typeof createMainAgent>;
