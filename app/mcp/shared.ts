import { pathToFileURL } from "node:url";
import { z } from "zod";

export function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "An unknown error occurred";
}

export async function fetchAndValidate<T>(
  url: URL | string,
  schema: z.ZodType<T>,
  serviceName: string,
): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `${serviceName} returned ${response.status} ${response.statusText}.`,
    );
  }

  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(`${serviceName} returned an invalid response.`);
  }
  return parsed.data;
}

export function isDirectExecution(moduleUrl: string): boolean {
  return (
    process.argv[1] !== undefined &&
    moduleUrl === pathToFileURL(process.argv[1]).href
  );
}
