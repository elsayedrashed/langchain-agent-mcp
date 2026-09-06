import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  formatError,
  isDirectExecution,
  textResult,
} from "./shared";

const SERVER_NAME = "time-mcp-server";
const SERVER_VERSION = "1.0.0";

const timeSchema = z
  .string()
  .regex(
    /^(?:[01]?\d|2[0-3]):[0-5]\d$/,
    "Time must use 24-hour HH:MM format.",
  );

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format.");

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function createFormatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      ...options,
    });
  } catch {
    throw new Error(`Invalid IANA time zone "${timeZone}".`);
  }
}

function getDateTimeParts(date: Date, timeZone: string): DateTimeParts {
  const formatter = createFormatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function formatDate(parts: DateTimeParts): string {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function formatTime(parts: DateTimeParts): string {
  return [
    String(parts.hour).padStart(2, "0"),
    String(parts.minute).padStart(2, "0"),
    String(parts.second).padStart(2, "0"),
  ].join(":");
}

function getTimeZoneName(date: Date, timeZone: string): string {
  const formatter = createFormatter(timeZone, {
    timeZoneName: "long",
  });
  return (
    formatter
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? timeZone
  );
}

function getOffsetMilliseconds(date: Date, timeZone: string): number {
  const parts = getDateTimeParts(date, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - date.getTime();
}

function zonedTimeToDate(
  dateValue: string,
  timeValue: string,
  timeZone: string,
): Date {
  createFormatter(timeZone);

  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const desiredWallTime = Date.UTC(year, month - 1, day, hour, minute);

  let candidate = new Date(desiredWallTime);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const offset = getOffsetMilliseconds(candidate, timeZone);
    candidate = new Date(desiredWallTime - offset);
  }

  const resolved = getDateTimeParts(candidate, timeZone);
  if (
    resolved.year !== year ||
    resolved.month !== month ||
    resolved.day !== day ||
    resolved.hour !== hour ||
    resolved.minute !== minute
  ) {
    throw new Error(
      `${dateValue} ${timeValue} does not exist in ${timeZone}, usually because of a daylight-saving transition.`,
    );
  }

  return candidate;
}

function currentTimePayload(timeZone: string) {
  const now = new Date();
  const parts = getDateTimeParts(now, timeZone);
  return {
    timezone: timeZone,
    timezoneName: getTimeZoneName(now, timeZone),
    date: formatDate(parts),
    time: formatTime(parts),
    isoInstant: now.toISOString(),
  };
}

function registerTools(server: McpServer): void {
  server.tool(
    "get_current_time",
    "Get the current date and time in an IANA time zone such as Australia/Sydney. Defaults to UTC.",
    {
      timezone: z
        .string()
        .trim()
        .min(1)
        .default("UTC")
        .describe("IANA time zone name"),
    },
    async ({ timezone }) => {
      try {
        return textResult(
          JSON.stringify(currentTimePayload(timezone), null, 2),
        );
      } catch (error) {
        return textResult(`Error getting current time: ${formatError(error)}`);
      }
    },
  );

  server.tool(
    "convert_time",
    "Convert a wall-clock time from one IANA time zone to another. The optional date defaults to the current date in the source time zone.",
    {
      source_timezone: z.string().trim().min(1),
      time: timeSchema,
      target_timezone: z.string().trim().min(1),
      date: dateSchema.optional(),
    },
    async ({ source_timezone, time, target_timezone, date }) => {
      try {
        const sourceDate =
          date ??
          formatDate(getDateTimeParts(new Date(), source_timezone));
        const instant = zonedTimeToDate(sourceDate, time, source_timezone);
        const targetParts = getDateTimeParts(instant, target_timezone);

        return textResult(
          JSON.stringify(
            {
              source: {
                timezone: source_timezone,
                date: sourceDate,
                time,
              },
              target: {
                timezone: target_timezone,
                timezoneName: getTimeZoneName(instant, target_timezone),
                date: formatDate(targetParts),
                time: formatTime(targetParts).slice(0, 5),
              },
              isoInstant: instant.toISOString(),
            },
            null,
            2,
          ),
        );
      } catch (error) {
        return textResult(`Error converting time: ${formatError(error)}`);
      }
    },
  );
}

export function createTimeMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  registerTools(server);
  return server;
}

async function main(): Promise<void> {
  const server = createTimeMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Time MCP Server running on stdio");
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error("Fatal error starting Time MCP Server:", error);
    process.exitCode = 1;
  });
}
